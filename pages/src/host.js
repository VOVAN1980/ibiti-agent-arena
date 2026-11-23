// The arena on Cloudflare: one Worker for everything, as pages/tools/local-arena.mjs does locally.
//   /, /index.html, /match.html, /rating.html,
//   /agent.html, /rules.html                       the public site, with link-preview tags (og.js)
//   /assets/*                                      the site's static files (served by Cloudflare)
//   /config.js                                     the site's settings for this arena
//   /rpc                                           read-only JSON-RPC for the site (same origin)
//   /join/<address>?name=…&model=…, /fight/<address>?key=…&step=…,
//   /calldata/answer?round=…&code=…, /skill.md      the fighters' side (worker.js)
//
// And every minute (a Cron Trigger) the judge scores the fights that are over (judge-cron.js).
//
// Settings (wrangler.jsonc vars): RPC_URL, ARENA, DECOYS, CHAIN_ID, DEPLOY_BLOCK, BLOCKS_PER_WEEK,
// ROUND_TIME, and SITE_RPC_URL (optional: another node for the site's reads, so the audience never
// spends the judge's quota). RPC_LIMIT (a rate-limit binding) caps each visitor's reads. The season secret and the judge's key are Worker secrets (`wrangler secret put SECRET`,
// `wrangler secret put JUDGE_KEY`), never vars. Static files are served straight from Cloudflare's
// asset store; only the HTML pages and the routes above run this code (assets.run_worker_first).

import { handleFight } from './worker.js';
import { withPreview } from './og.js';
import { judgeRun } from './judge-cron.js';

const PAGES = /^\/(home|index|match|rating|agent|rules)\.html$/;
// only reading methods pass through to the node
const READ_ONLY = new Set(['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_call', 'eth_chainId']);
const NO_STORE = { 'cache-control': 'no-store' };
// the arena's views the site reads, and nothing else (no costly or unknown call goes to the node)
const VIEWS = new Set([
  '0x32799e5d', // fightOf(address,uint32)
  '0xa2fcf826', // drawEvery()
  '0x78a2ce59', // hall()
  '0xb5c81661', // hallCount()
  '0x748e1910', // nextDrawAt()
  '0xef92e6ba', // pendingCutoff()
  '0xee5f8c8f', // roundTime()
  '0x787a08a6', // cooldown()
  '0xe757b20d', // seasonEnd() (an earlier arena's)
  '0xfda7b9db', // seasonBook()
  '0xbcb39621', // currentSeason()
]);
// the season calendar (ArenaSeasons): what the site reads of it
const BOOK_VIEWS = new Set([
  '0x9fa6a6e3', // current()
  '0x715f8fe8', // seasonCount()
  '0x6ebaeda9', // seasons(uint16)
]);
// the season's contract (the ranking, the close, the certificates): what the site reads of it
const SEASON_VIEWS = new Set([
  '0xfe6dcdba', // top()
  '0x9ef27b00', // closedAt()
  '0x6c4470fb', // participants()
  '0xc50b0fb0', // season()
  '0x6b067159', // tookPart(address)
  '0x222d825b', // placeOf(address)
  '0x623c4047', // resultOf(address)
  '0xc87b56dd', // tokenURI(uint256)
]);
const MAX_BODY = 4096;

/** The certificate contract of every season of this arena, from SEASONS ({ "<n>": { "certificate" } }). */
function seasonCertificates(env) {
  let s = env.SEASONS ?? {};
  if (typeof s === 'string') {
    try {
      s = JSON.parse(s);
    } catch {
      s = {};
    }
  }
  return Object.values(s ?? {}).map((x) => x?.certificate).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(x ?? ''));
}

/** Earlier arenas of this site (their fights stay readable by links that name them). */
function archive(env) {
  let list = env.ARCHIVE ?? [];
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = [];
    }
  }
  return (Array.isArray(list) ? list : []).filter((x) => /^0x[0-9a-fA-F]{40}$/.test(String(x?.arena)));
}

/** The request body, read up to `max` bytes (null past it): a body without a length is never read whole. */
async function bodyOf(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, 'content-type': 'application/json' } });

/** The sites of both rings, when this site knows them: { red, green }, https links only. */
function rings(env) {
  let r = env.RINGS;
  try {
    if (typeof r === 'string') r = JSON.parse(r);
  } catch {
    return null;
  }
  const ok = (u) => typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(u);
  return r && ok(r.red) && ok(r.green) ? { red: r.red, green: r.green } : null;
}

export function siteConfig(env) {
  return `window.ARENA_CONFIG = ${JSON.stringify({
    rpc: '/rpc',
    arena: env.ARENA,
    chainId: Number(env.CHAIN_ID ?? 56),
    roundTime: Number(env.ROUND_TIME ?? 60),
    deployBlock: Number(env.DEPLOY_BLOCK ?? 0),
    blocksPerWeek: Number(env.BLOCKS_PER_WEEK ?? 604800),
    pollMs: 2000,
    // the season calendar (the site reads the season running now from it); an earlier arena of this
    // site has its own season number and certificate contract in `archive`
    seasonBook: env.SEASON_BOOK ?? null,
    season: Number(env.SEASON ?? 1),
    certificate: env.CERTIFICATE ?? null,
    // a season arena draws every fight at random: no challenges (CHALLENGES "open" only elsewhere)
    challenges: env.CHALLENGES === 'open',
    // the ring: "red" (the season, the default) or "green" (free fights, the workshop of new tasks);
    // RINGS gives the sites of both, so a visitor can switch: { "red": url, "green": url }
    ring: env.RING === 'green' ? 'green' : 'red',
    rings: rings(env),
    // earlier arenas of this site: a link that names one opens its fight
    archive: archive(env).map((x) => ({ arena: x.arena, deployBlock: Number(x.deployBlock ?? 0), season: x.season ?? null, certificate: x.certificate ?? null })),
  })};\n`;
}

/** The arena's season calendar and the certificate contract of each of its seasons, read from the chain
 *  (kept a minute). An arena without a calendar (an earlier one) gives none. */
let calendar = { at: 0, book: null, certs: [] };
async function calendarOf(env) {
  if (Date.now() - calendar.at < 60000) return calendar;
  const call = async (to, data) => {
    const r = await (await fetch(env.SITE_RPC_URL ?? env.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }) })).json();
    if (r.error || typeof r.result !== 'string' || r.result.length < 66) throw new Error('no answer');
    return r.result.slice(2);
  };
  try {
    const book = '0x' + (await call(env.ARENA, '0xfda7b9db')).slice(24, 64); // seasonBook()
    const count = Math.min(parseInt(await call(book, '0x715f8fe8'), 16), 500); // seasonCount()
    const certs = [];
    for (let n = 1; n <= count; n++) certs.push('0x' + (await call(book, '0x6ebaeda9' + n.toString(16).padStart(64, '0'))).slice(64 * 4 + 24, 64 * 5)); // seasons(n).certificate
    calendar = { at: Date.now(), book: book.toLowerCase(), certs: certs.map((x) => x.toLowerCase()) };
  } catch {
    calendar = { at: Date.now(), book: null, certs: [] };
  }
  return calendar;
}

/** The site's read-only window on the chain: one JSON-RPC call at a time, reading methods only. */
async function rpc(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST a JSON-RPC call' }, 405);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'too large' }, 413);
  if (env.RPC_LIMIT) {
    const { success } = await env.RPC_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'anonymous' });
    if (!success) return json({ error: 'too many reads: slow down' }, 429);
  }
  const text = await bodyOf(request, MAX_BODY);
  if (text === null) return json({ error: 'too large' }, 413);
  let q;
  try {
    q = JSON.parse(text);
  } catch {
    return json({ error: 'not JSON' }, 400);
  }
  if (!q || Array.isArray(q) || !READ_ONLY.has(q.method)) {
    return json({ jsonrpc: '2.0', id: q?.id ?? null, error: { code: -32601, message: 'read-only' } });
  }
  // this arena only, in bounded ranges: the judge shares the node, so the site's reads stay small
  const refuse = (message) => json({ jsonrpc: '2.0', id: q.id ?? null, error: { code: -32602, message } });
  const arena = String(env.ARENA).toLowerCase();
  const old = archive(env);
  const arenas = new Set([arena, ...old.map((x) => x.arena.toLowerCase())]);
  const seasons = new Set([env.CERTIFICATE, ...seasonCertificates(env), ...old.map((x) => x.certificate)].filter(Boolean).map((x) => String(x).toLowerCase()));
  let book = env.SEASON_BOOK ? String(env.SEASON_BOOK).toLowerCase() : null;
  // the calendar and every season's certificate, read from the chain when the config does not name them
  const known = (a) => arenas.has(a) || seasons.has(a) || a === book;
  const learn = async (a) => {
    if (known(a)) return true;
    const c = await calendarOf(env);
    book ??= c.book;
    for (const x of c.certs) seasons.add(x);
    return known(a);
  };
  const p0 = Array.isArray(q.params) ? q.params[0] : undefined;
  let params = q.params ?? []; // what goes to the node: rebuilt from the checked fields only
  if (q.method === 'eth_call') {
    const to = String(p0?.to ?? '').toLowerCase();
    if (!(await learn(to))) return refuse('this arena only');
    // a known view, its arguments, at the latest block: no sender, gas, value or state override
    const data = String(p0.data ?? p0.input ?? '');
    if (Object.keys(p0).some((k) => !['to', 'data', 'input'].includes(k)) || q.params.length > 2 || (q.params.length === 2 && q.params[1] !== 'latest')) return refuse('a plain call of a view');
    if (!/^0x[0-9a-fA-F]{8}([0-9a-fA-F]{64}){0,2}$/.test(data) || !(to === book ? BOOK_VIEWS : seasons.has(to) ? SEASON_VIEWS : VIEWS).has(data.slice(0, 10).toLowerCase())) return refuse('the views the site reads only');
    params = [{ to, data }, 'latest'];
  }
  if (q.method === 'eth_getLogs') {
    const address = String(p0?.address ?? '').toLowerCase();
    if (!(await learn(address)) || address === book) return refuse('this arena only');
    const from = parseInt(p0?.fromBlock, 16);
    const to = parseInt(p0?.toBlock, 16);
    if (!(Number.isFinite(from) && Number.isFinite(to)) || to < from || to - from >= 50000) return refuse('a range of at most 50000 blocks');
    params = [{ address, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), ...(Array.isArray(p0.topics) ? { topics: p0.topics } : {}) }];
  }
  if (q.method === 'eth_getBlockByNumber' && (Array.isArray(q.params) ? q.params[1] : false) !== false) return refuse('no full blocks');
  const res = await fetch(env.SITE_RPC_URL ?? env.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id ?? 1, method: q.method, params }) });
  return new Response(await res.text(), { status: res.status, headers: { ...NO_STORE, 'content-type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/home.html' : url.pathname; // the front door: both rings
    try {
      if (path === '/config.js') return new Response(siteConfig(env), { headers: { ...NO_STORE, 'content-type': 'text/javascript; charset=utf-8' } });
      if (path === '/rpc') return await rpc(request, env);
      if (PAGES.test(path)) {
        // the page, with the tags a chat app reads for its link preview
        const page = await env.ASSETS.fetch(new Request(new URL(path, url.origin)));
        if (!page.ok) return page;
        const html = await withPreview(await page.text(), new URL(path + url.search, url.origin), { rpc: env.RPC_URL, arena: env.ARENA, deployBlock: Number(env.DEPLOY_BLOCK ?? 0), site: url.origin });
        return new Response(html, { headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' } });
      }
      return await handleFight(url, { ...env, SITE_URL: env.SITE_URL ?? url.origin }, { authorization: request.headers.get('authorization') });
    } catch {
      return new Response('The chain could not be read. Try again in a few seconds.\n', { status: 502, headers: NO_STORE });
    }
  },

  /** Every minute: judge the fights that are over. */
  async scheduled(event, env, ctx) {
    if (!env.JUDGE_KEY) return; // a server without the judge's key only serves pages
    ctx.waitUntil(
      judgeRun(env).then(
        (r) => r.sent && console.log(`sent ${r.sent} transaction(s), ${r.confirmed} confirmed; ${r.judged} judgement(s) among them${r.closed ? '; the season is closed' : ''}`),
        (e) => console.log(`judge: ${e.message}`),
      ),
    );
  },
};

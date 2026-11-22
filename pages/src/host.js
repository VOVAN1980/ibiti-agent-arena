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

const PAGES = /^\/(index|match|rating|agent|rules)\.html$/;
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
  '0xe757b20d', // seasonEnd()
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

export function siteConfig(env) {
  return `window.ARENA_CONFIG = ${JSON.stringify({
    rpc: '/rpc',
    arena: env.ARENA,
    chainId: Number(env.CHAIN_ID ?? 56),
    roundTime: Number(env.ROUND_TIME ?? 60),
    deployBlock: Number(env.DEPLOY_BLOCK ?? 0),
    blocksPerWeek: Number(env.BLOCKS_PER_WEEK ?? 604800),
    pollMs: 2000,
    // the season: its number, its contract (the ranking, the close, the certificates)
    season: Number(env.SEASON ?? 1),
    certificate: env.CERTIFICATE ?? null,
    // earlier arenas of this site: a link that names one opens its fight
    archive: archive(env).map((x) => ({ arena: x.arena, deployBlock: Number(x.deployBlock ?? 0), season: x.season ?? null, certificate: x.certificate ?? null })),
  })};\n`;
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
  const seasons = new Set([env.CERTIFICATE, ...old.map((x) => x.certificate)].filter(Boolean).map((x) => String(x).toLowerCase()));
  const p0 = Array.isArray(q.params) ? q.params[0] : undefined;
  let params = q.params ?? []; // what goes to the node: rebuilt from the checked fields only
  if (q.method === 'eth_call') {
    const to = String(p0?.to ?? '').toLowerCase();
    if (!arenas.has(to) && !seasons.has(to)) return refuse('this arena only');
    // a known view, its arguments, at the latest block: no sender, gas, value or state override
    const data = String(p0.data ?? p0.input ?? '');
    if (Object.keys(p0).some((k) => !['to', 'data', 'input'].includes(k)) || q.params.length > 2 || (q.params.length === 2 && q.params[1] !== 'latest')) return refuse('a plain call of a view');
    if (!/^0x[0-9a-fA-F]{8}([0-9a-fA-F]{64}){0,2}$/.test(data) || !(seasons.has(to) ? SEASON_VIEWS : VIEWS).has(data.slice(0, 10).toLowerCase())) return refuse('the views the site reads only');
    params = [{ to, data }, 'latest'];
  }
  if (q.method === 'eth_getLogs') {
    const address = String(p0?.address ?? '').toLowerCase();
    if (!arenas.has(address) && !seasons.has(address)) return refuse('this arena only');
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
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
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

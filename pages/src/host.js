// The arena on Cloudflare: one Worker for everything, as pages/tools/local-arena.mjs does locally.
//   /, /index.html, /match.html, /rating.html,
//   /agent.html, /rules.html                       the public site, with link-preview tags (og.js)
//   /assets/*                                      the site's static files (served by Cloudflare)
//   /config.js                                     the site's settings for this arena
//   /rpc                                           read-only JSON-RPC for the site (same origin): one
//                                                  call or a batch (one poll of a page), shared through
//                                                  a short cache, log ranges from the archive (HISTORY)
//   /join/<address>?name=…&model=…, /fight/<address>?key=…&step=…,
//   /calldata/answer?round=…&code=…, /skill.md      the fighters' side (worker.js)
//
// And every minute (a Cron Trigger) the judge scores the fights that are over (judge-cron.js).
//
// Settings (wrangler.jsonc vars): RPC_URL (and RPC_URLS: the judge's and the fighters' nodes in order,
// see rpc.js), ARENA, DECOYS, CHAIN_ID, DEPLOY_BLOCK, BLOCKS_PER_WEEK, ROUND_TIME, and SITE_RPC_URLS or
// SITE_RPC_URL (optional: other nodes for the site's reads and link previews, so the audience never
// spends the judge's quota; without them the site reads through RPC_URLS / RPC_URL), SITE_LOG_SPAN (the
// widest log range the proxy asks the nodes for at once), HISTORY (a KV binding: the arena's history,
// archive.js). RPC_LIMIT (a rate-limit binding) caps each visitor's reads (a batch weighs one per eight calls). The season secret and the judge's key are Worker secrets (`wrangler secret put SECRET`,
// `wrangler secret put JUDGE_KEY`), never vars. Static files are served straight from Cloudflare's
// asset store; only the HTML pages and the routes above run this code (assets.run_worker_first).

import { handleFight } from './worker.js';
import { withPreview } from './og.js';
import { judgeRun, NODE_TRUST_HOURS } from './judge-cron.js';
import { rpcFetch, endpointsOf, COOLDOWNS } from './rpc.js';
import { archiveRun, ARCHIVE_BUDGET, chunkOf, chunkRange, chunkText, spanOf, spanRange, spanText } from './archive.js';
import { cacheFor } from './cache.js';

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
// a batch of the site's calls for one poll: a few dozen calls of a few hundred bytes each
const MAX_BODY = 32768;
const MAX_BATCH = 48;
// the subrequests of one invocation on Workers Free (the cron's judge and archive share them)
const INVOCATION_SUBREQUESTS = 50;

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
    // the pages' polls while a fight is live or about to start, and otherwise (ms): raised here (POLL_MS,
    // IDLE_POLL_MS) when the account's daily Worker invocations run short (Workers Free: 100,000)
    pollMs: Math.max(1000, Number(env.POLL_MS ?? 2000)),
    idlePollMs: Math.max(2000, Number(env.IDLE_POLL_MS ?? 10000)),
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

/** The site's reads (the /rpc window, the calendar, link previews): over SITE_RPC_URLS (or SITE_RPC_URL),
 *  else the judge's nodes, with short timeouts. A wide log range can go only to a node that serves it
 *  in at most four pieces (publicnode for a 50000-block replay chunk; 48.club takes the small polls),
 *  and it gets up to 25 s by its width: publicnode answers 50000 blocks of the arena in 10-19 s. */
function siteNodes(env) {
  const site = endpointsOf(env, 'SITE_RPC_URL');
  return site.length ? site : endpointsOf(env, 'RPC_URL');
}
function siteFetch(env, budget = null) {
  return rpcFetch(siteNodes(env), { timeoutMs: 2500, logsTimeoutMs: 25000, tries: 3, maxPieces: 4, cooldowns: COOLDOWNS, budget });
}

/** The arena's season calendar and the certificate contract of each of its seasons, read from the chain
 *  (kept a minute). An arena without a calendar (an earlier one) gives none; after a failed read that
 *  empty answer is kept 5 s only, so one rate-limited read does not refuse the season's views for a minute.
 *  One read at a time for the whole isolate: every call of a batch (and every request in the same moment)
 *  that needs it waits for the same read, which spends the invocation's budget of the request that
 *  started it: three requests (seasonBook, seasonCount, then every season in one JSON-RPC batch). */
let calendar = { at: 0, ttl: 0, book: null, certs: [] };
let calendarRead = null;
/** For tests: forget the calendar this isolate read. */
export function forgetCalendar() {
  calendar = { at: 0, ttl: 0, book: null, certs: [] };
  calendarRead = null;
}
function calendarOf(env, budget = null) {
  if (Date.now() - calendar.at < calendar.ttl) return Promise.resolve(calendar);
  if (calendarRead) return calendarRead;
  calendarRead = (async () => {
    const net = siteFetch(env, budget);
    const word = (r) => {
      if (!r || r.error || typeof r.result !== 'string' || r.result.length < 66) throw new Error('no answer');
      return r.result.slice(2);
    };
    const call = async (to, data) => word((await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] })).j);
    try {
      const book = '0x' + (await call(env.ARENA, '0xfda7b9db')).slice(24, 64); // seasonBook()
      const count = Math.min(parseInt(await call(book, '0x715f8fe8'), 16), 500); // seasonCount()
      const certs = [];
      for (let n = 1; n <= count; n += 25) {
        const qs = Array.from({ length: Math.min(25, count - n + 1) }, (_, k) => ({ jsonrpc: '2.0', id: k + 1, method: 'eth_call', params: [{ to: book, data: '0x6ebaeda9' + (n + k).toString(16).padStart(64, '0') }, 'latest'] }));
        const { j } = await net.batch(qs);
        if (!Array.isArray(j)) throw new Error('no answer');
        for (const r of j) certs.push('0x' + word(r).slice(64 * 4 + 24, 64 * 5)); // seasons(n).certificate
      }
      calendar = { at: Date.now(), ttl: 60000, book: book.toLowerCase(), certs: certs.map((x) => x.toLowerCase()) };
    } catch {
      calendar = { at: Date.now(), ttl: 5000, book: null, certs: [] };
    }
    return calendar;
  })().finally(() => {
    calendarRead = null;
  });
  return calendarRead;
}

/**
 * One call of the site, checked: { q: the call as it goes to the node (rebuilt from the checked fields
 * only) } or { error: { code, message } }. The rules are the same for a call alone and for every call
 * of a batch: reading methods only, this arena (and its earlier ones, its calendar, its seasons' contracts)
 * only, the views the site reads only, log ranges of at most 50000 blocks, no full blocks.
 */
async function checkCall(q, env, budget = null) {
  if (!q || typeof q !== 'object' || Array.isArray(q) || !READ_ONLY.has(q.method)) return { error: { code: -32601, message: 'read-only' } };
  // this arena only, in bounded ranges: the judge shares the node, so the site's reads stay small
  const refuse = (message) => ({ error: { code: -32602, message } });
  const arena = String(env.ARENA).toLowerCase();
  const old = archive(env);
  const arenas = new Set([arena, ...old.map((x) => x.arena.toLowerCase())]);
  const seasons = new Set([env.CERTIFICATE, ...seasonCertificates(env), ...old.map((x) => x.certificate)].filter(Boolean).map((x) => String(x).toLowerCase()));
  let book = env.SEASON_BOOK ? String(env.SEASON_BOOK).toLowerCase() : null;
  // the calendar and every season's certificate, read from the chain when the config does not name them
  const known = (a) => arenas.has(a) || seasons.has(a) || a === book;
  const learn = async (a) => {
    if (known(a)) return true;
    const c = await calendarOf(env, budget);
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
    params = [{ to, data: data.toLowerCase() }, 'latest'];
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
  return { q: { jsonrpc: '2.0', id: 1, method: q.method, params } };
}

// the subrequests one /rpc invocation may spend (Workers Free: 50), Cache API and KV calls included
const PROXY_BUDGET = 45;
// a range of blocks at least this far behind the head never changes again (the archive's margin)
const FINAL_BLOCKS = 200;
// how long a read is kept (seconds): one that depends on the head; a final range a node that may prune
// answered (publicnode, 48.club: kept a minute only, so an answer cut short by pruning does not stay);
// what never changes (a final range from an archive node or the KV archive)
const SHORT_TTL = 1;
const MID_TTL = 60;
const LONG_TTL = 7 * 24 * 3600;
// views the contracts never change: drawEvery(), roundTime(), cooldown(), seasonBook()
const IMMUTABLE = new Set(['0xa2fcf826', '0xee5f8c8f', '0x787a08a6', '0xfda7b9db']);
// the head this isolate saw last (a log range far behind it never changes, so it is kept long)
let seenHead = { block: 0, at: 0 };
const noteHead = (q, result) => {
  if (q.method === 'eth_blockNumber' && typeof result === 'string') seenHead = { block: parseInt(result, 16) || 0, at: Date.now() };
};
/** For tests: forget the head this isolate saw. */
export function forgetHead() {
  seenHead = { block: 0, at: 0 };
}
const keyOf = (env, q) => `${String(env.ARENA).toLowerCase()}|${q.method}|${JSON.stringify(q.params)}`;
const ttlOf = (q) => (q.method === 'eth_chainId' || (q.method === 'eth_call' && IMMUTABLE.has(String(q.params[0].data).slice(0, 10))) ? 3600 : SHORT_TTL);

/** A log's topics against a filter's topics (each position: null, one topic, or a list of them). */
function topicsMatch(log, topics) {
  if (!Array.isArray(topics)) return true;
  return topics.every((t, i) => t == null || (Array.isArray(t) ? t.length === 0 || t.map((x) => String(x).toLowerCase()).includes(String(log.topics?.[i]).toLowerCase()) : String(t).toLowerCase() === String(log.topics?.[i]).toLowerCase()));
}
// a JSON array's items as text: "[a,b]" -> "a,b"
const inner = (text) => text.trim().slice(1, -1).trim();

/** The site's log nodes that are archives (RPC_URLS / SITE_RPC_URLS entries with "archive": true). */
const archivesOf = (env) => new Set(siteNodes(env).filter((e) => e.archive).map((e) => e.url));

/**
 * eth_getLogs for the site: the archived part of the range from the cache or KV (HISTORY, this arena
 * only: a whole span of 50000 blocks in one read where the range covers it, else chunk by chunk), the
 * rest from the log nodes in spans of SITE_LOG_SPAN blocks (each split by rpc.js into the node's
 * pieces). A part older than NODE_TRUST_HOURS goes only to the archive nodes when the list has any (a
 * pruning node may answer [] for it). The result as JSON text, or { error } when a part could not be
 * read (the site keeps that range for a later poll). A final range is kept long only when it came from
 * the KV archive or an archive node; one a pruning node answered a minute; one near the head a second.
 */
async function logsOf(env, q, { cache, net, budget }) {
  const p = q.params[0];
  const from = parseInt(p.fromBlock, 16);
  const to = parseInt(p.toBlock, 16);
  const topics = p.topics;
  const key = keyOf(env, q);
  const hit = await cache.get(key);
  if (hit !== null) return { text: hit };
  const out = await cache.once(key, async () => {
    const parts = []; // [{ text, whole }]: archived spans and chunks, in order
    let cursor = from;
    const deploy = Number(env.DEPLOY_BLOCK ?? 0);
    /** An archived value: from the cache, else KV (then kept long); null when not stored or no subrequest is left. */
    const archived = async (k, read) => {
      const t = await cache.get(k);
      if (t !== null) return t;
      if (budget.left <= 1) return null;
      budget.left--;
      let text = null;
      try {
        text = await read();
      } catch {
        text = null;
      }
      if (text !== null) cache.put(k, text, LONG_TTL);
      return text;
    };
    if (env.HISTORY && p.address === String(env.ARENA).toLowerCase()) {
      while (cursor <= to) {
        // a whole span inside the range: one read for 50000 blocks
        const s = spanOf(cursor);
        const [s0, s1] = spanRange(s);
        if (cursor <= Math.max(s0, deploy) && s1 <= to) {
          const text = await archived(`span|${p.address}|${s}`, () => spanText(env.HISTORY, p.address, s));
          if (text !== null) {
            parts.push({ text, whole: true });
            cursor = s1 + 1;
            continue;
          }
        }
        const c = chunkOf(cursor);
        const [c0, c1] = chunkRange(c);
        const text = await archived(`chunk|${p.address}|${c}`, () => chunkText(env.HISTORY, p.address, c));
        if (text === null) break; // not stored yet: the rest from the nodes
        parts.push({ text, whole: Math.max(c0, deploy) >= from && c1 <= to });
        cursor = c1 + 1;
      }
    }
    const fromNodes = [];
    const span = Math.max(1, Number(env.SITE_LOG_SPAN ?? 50000));
    const archives = archivesOf(env);
    const trusted = Math.ceil(Number(env.BLOCKS_PER_WEEK ?? 604800) / 168) * NODE_TRUST_HOURS;
    let byArchive = true; // every node answer came from an archive node
    for (let a = cursor; a <= to; a += span) {
      const b = Math.min(to, a + span - 1);
      const old = seenHead.block > 0 && a < seenHead.block - trusted;
      const { j, node } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: p.address, fromBlock: '0x' + a.toString(16), toBlock: '0x' + b.toString(16), ...(topics ? { topics } : {}) }] }, { maxPieces: 4, archive: old });
      if (j.error || !Array.isArray(j.result)) return { error: j.error ?? { code: -32000, message: 'not a log list' } };
      if (!archives.has(node)) byArchive = false;
      fromNodes.push(j.result);
    }
    let text;
    if (!topics && parts.every((x) => x.whole)) {
      // whole chunks and spans and no filter: their texts as they are, no parsing (the CPU of a Free
      // Worker is short)
      text = '[' + [...parts.map((x) => inner(x.text)), ...fromNodes.map((l) => inner(JSON.stringify(l)))].filter(Boolean).join(',') + ']';
    } else {
      const logs = [];
      for (const x of parts) {
        for (const l of JSON.parse(x.text)) {
          const b = parseInt(l.blockNumber, 16);
          if (b >= from && b <= to && topicsMatch(l, topics)) logs.push(l);
        }
      }
      for (const l of fromNodes) logs.push(...l);
      text = JSON.stringify(logs);
    }
    const final = seenHead.block > 0 && to <= seenHead.block - FINAL_BLOCKS;
    cache.put(key, text, !final ? SHORT_TTL : byArchive ? LONG_TTL : MID_TTL);
    return { text };
  });
  return out;
}

/** The site's read-only window on the chain: one JSON-RPC call, or a batch of them (one answer, in the
 *  calls' order), reading methods only, each call checked with the same rules. Reads are shared through
 *  the cache (cache.js: this isolate's memory; on a custom domain also the Cache API, one entry for the
 *  calls of a poll that depend on the head), the calls a batch still needs go to a node as one batch,
 *  log ranges come from the archive and the log nodes (logsOf). */
async function rpc(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'POST a JSON-RPC call' }, 405);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'too large' }, 413);
  const text = await bodyOf(request, MAX_BODY);
  if (text === null) return json({ error: 'too large' }, 413);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'not JSON' }, 400);
  }
  const batch = Array.isArray(body);
  const calls = batch ? body : [body];
  if (batch && (calls.length === 0 || calls.length > MAX_BATCH)) return json({ jsonrpc: '2.0', id: null, error: { code: -32600, message: `a batch of 1 to ${MAX_BATCH} calls` } });
  if (env.RPC_LIMIT) {
    // a batch weighs by its calls: one unit per eight
    const key = request.headers.get('cf-connecting-ip') ?? 'anonymous';
    const units = await Promise.all(Array.from({ length: Math.ceil(calls.length / 8) }, () => env.RPC_LIMIT.limit({ key })));
    if (units.some((u) => !u.success)) return json({ error: 'too many reads: slow down' }, 429);
  }
  const budget = { left: PROXY_BUDGET };
  const net = siteFetch(env, budget);
  const url = new URL(request.url);
  // the Cache API stores nothing on *.workers.dev: there it would only spend subrequests
  const sharedCache = env.SHARED_CACHE === 'on' || (env.SHARED_CACHE !== 'off' && !url.hostname.endsWith('.workers.dev'));
  const cache = cacheFor({ origin: url.origin, budget, later: (p) => (ctx?.waitUntil ? ctx.waitUntil(p.catch(() => {})) : p.catch(() => {})), reserve: 4, shared: sharedCache });
  const idOf = (x) => (x && typeof x === 'object' && !Array.isArray(x) && 'id' in x ? x.id : null);
  const answers = new Array(calls.length);
  const answer = (i, part) => {
    const id = JSON.stringify(idOf(calls[i]) ?? null);
    answers[i] = 'text' in part ? `{"jsonrpc":"2.0","id":${id},"result":${part.text}}` : `{"jsonrpc":"2.0","id":${id},"error":${JSON.stringify(part.error)}}`;
  };
  const checked = await Promise.all(calls.map((q) => checkCall(q, env, budget)));
  // the calls other than logs: from this isolate's memory, then (custom domain) one shared entry for
  // all of them, the rest from a node in one request (alone: as one call)
  const pending = [];
  for (const [i, c] of checked.entries()) {
    if (c.error) answer(i, c);
    else if (c.q.method !== 'eth_getLogs') pending.push({ i, q: c.q, key: keyOf(env, c.q) });
  }
  const got = (x, t) => {
    x.text = t;
    if (x.q.method === 'eth_blockNumber') noteHead(x.q, JSON.parse(t));
    answer(x.i, { text: t });
  };
  for (const x of pending) {
    x.text = cache.local(x.key);
    if (x.text !== null) got(x, x.text);
  }
  const misses = pending.filter((x) => x.text === null);
  const bundleKey = misses.length && cache.shared ? 'calls|' + misses.map((x) => x.key).sort().join('\n') : null;
  if (bundleKey) {
    const t = await cache.get(bundleKey);
    let all = null;
    try {
      all = t === null ? null : JSON.parse(t);
    } catch {}
    if (all && misses.every((x) => typeof all[x.key] === 'string')) {
      for (const x of misses) {
        cache.keep(x.key, all[x.key], ttlOf(x.q));
        got(x, all[x.key]);
      }
    }
  }
  // a read another viewer's request is asking right now is waited for, not asked again
  const missing = pending.filter((x) => x.text === null).map((x) => Object.assign(x, { turn: cache.lead(x.key) }));
  const ask = missing.filter((x) => x.turn.done);
  try {
    if (ask.length) {
      const r = ask.length === 1 ? await net.call({ ...ask[0].q, id: 1 }) : await net.batch(ask.map((x, k) => ({ ...x.q, id: k + 1 })));
      const list = Array.isArray(r.j) ? r.j : ask.length === 1 ? [r.j] : null;
      ask.forEach((x, k) => {
        const a = list?.[k];
        if (!list) answer(x.i, { error: r.j?.error ?? { code: -32000, message: 'no node answered' } });
        else if (a.error) answer(x.i, { error: a.error });
        else {
          const t = JSON.stringify(a.result ?? null);
          cache.keep(x.key, t, ttlOf(x.q));
          got(x, t);
          x.turn.done(t);
        }
      });
    }
  } finally {
    for (const x of ask) x.turn.done(null); // (a second done() changes nothing)
  }
  await Promise.all(missing.filter((x) => x.turn.wait).map(async (x) => {
    const t = await x.turn.wait;
    if (t === null) answer(x.i, { error: { code: -32000, message: 'not available now: ask again' } });
    else got(x, t);
  }));
  // the shared entry of this poll's calls: when every one of them was answered
  if (bundleKey && misses.every((x) => typeof x.text === 'string')) {
    cache.put(bundleKey, JSON.stringify(Object.fromEntries(misses.map((x) => [x.key, x.text]))), Math.min(...misses.map((x) => ttlOf(x.q))));
  }
  // the log ranges, one after another within the budget, the newest first: a poll's newest blocks are
  // answered before any of its history ranges (which the page asks again, split, if they do not fit)
  const ranges = [...checked.entries()].filter(([, c]) => !c.error && c.q.method === 'eth_getLogs').sort(([, a], [, b]) => parseInt(b.q.params[0].toBlock, 16) - parseInt(a.q.params[0].toBlock, 16));
  for (const [i, c] of ranges) {
    answer(i, budget.left > 1 ? await logsOf(env, c.q, { cache, net, budget }) : { error: { code: -32000, message: 'not available now: ask again' } });
  }
  const out = batch ? '[' + answers.join(',') + ']' : answers[0];
  return new Response(out, { status: 200, headers: { ...NO_STORE, 'content-type': 'application/json' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/home.html' : url.pathname; // the front door: both rings
    try {
      if (path === '/config.js') return new Response(siteConfig(env), { headers: { ...NO_STORE, 'content-type': 'text/javascript; charset=utf-8' } });
      if (path === '/rpc') return await rpc(request, env, ctx);
      if (PAGES.test(path)) {
        // the page, with the tags a chat app reads for its link preview
        const page = await env.ASSETS.fetch(new Request(new URL(path, url.origin)));
        if (!page.ok) return page;
        const html = await withPreview(await page.text(), new URL(path + url.search, url.origin), { rpc: env.RPC_URL, fetchFn: siteFetch(env), arena: env.ARENA, site: url.origin });
        return new Response(html, { headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' } });
      }
      return await handleFight(url, { ...env, SITE_URL: env.SITE_URL ?? url.origin }, { authorization: request.headers.get('authorization') });
    } catch {
      return new Response('The chain could not be read. Try again in a few seconds.\n', { status: 502, headers: NO_STORE });
    }
  },

  /** Every minute: judge the fights that are over; then, with what is left of the invocation's
   *  subrequests, add to the arena's history in KV (archive.js, where HISTORY is bound). Both share the
   *  nodes' cooldowns of this minute and a count of the requests each node got, so the archive never
   *  pushes an archive node past its burst limit after the judge's own reads. */
  async scheduled(event, env, ctx) {
    const spent = new Map(); // url -> requests in this invocation
    const cooldowns = new Map();
    const counted = (url, init) => {
      spent.set(url, (spent.get(url) ?? 0) + 1);
      return fetch(url, init);
    };
    const judged = env.JUDGE_KEY // a server without the judge's key only serves pages (and keeps the history)
      ? judgeRun(env, { fetchFn: counted, cooldowns }).then(
          (r) => {
            if (r.sent) console.log(`sent ${r.sent} transaction(s), ${r.confirmed} confirmed; ${r.judged} judgement(s) among them${r.closed ? '; the season is closed' : ''}`);
            return r;
          },
          (e) => {
            console.log(`judge: ${e.message}`);
            return { used: e.used ?? Number(env.SUBREQ_BUDGET ?? 45), head: null };
          },
        )
      : Promise.resolve({ used: 0, head: null });
    if (env.JUDGE_KEY) ctx.waitUntil(judged);
    if (env.HISTORY) {
      ctx.waitUntil(
        judged
          .then((r) => archiveRun(env, { fetchFn: counted, spent, cooldowns, head: r.head ?? null, budget: { left: Math.max(0, Math.min(Number(env.ARCHIVE_BUDGET ?? ARCHIVE_BUDGET), INVOCATION_SUBREQUESTS - 1 - (r.used ?? 0))) } }))
          .catch((e) => console.log(`archive: ${e.message}`)),
      );
    }
  },
};

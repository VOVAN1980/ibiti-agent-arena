// The viewer's own reads (site/assets/rpc-client.js): calls batched to one node, log ranges to the node
// that serves them in the fewest requests among those trusted for them (a pruning node never for blocks
// it may have dropped), split by each node's cap, failover with cooldowns, at most one request per node
// every 2 s per viewer on average, the history to the Worker by design, and the Worker as the last
// resort with a backoff. Then the pages themselves (arena.js) with these nodes: the polls cost the
// Worker nothing, the history comes from its KV archive once, and a tab's other pages read it from the
// tab's storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const DEPLOY = 900_000;
const DS = 'https://ds.test';
const DF = 'https://df.test';
const NI = 'https://ni.test';
const C48 = 'https://c48.test';
const TW = 'https://tw.test';
const PN = 'https://pn.test';
const NODES = [
  { url: DS, calls: true, logs: 0 },
  { url: DF, calls: true, logs: 0 },
  { url: NI, calls: true, logs: 0 },
  { url: C48, logs: 250, keep: 6 },
  { url: TW, logs: 1000, archive: true },
  { url: PN, logs: 50000, keep: 1 }, // (as in wrangler.jsonc: publicnode answers [] for blocks older than about 2 h)
];
const BLOCKS_PER_HOUR = 8000;
globalThis.window = { ARENA_CONFIG: { rpc: '/rpc', arena: ARENA, chainId: 56, roundTime: 60, deployBlock: DEPLOY, blocksPerWeek: BLOCKS_PER_HOUR * 168, pollMs: 2000, nodes: NODES, historyPerPoll: 12 } };
const { createClient, isRate } = await import('../../site/assets/rpc-client.js');
const arena = await import('../../site/assets/arena.js');
const { default: host, siteConfig } = await import('../src/host.js');
const { clearCache } = await import('../src/cache.js');
const { COOLDOWNS } = await import('../src/rpc.js');

// the pages' clock (Date.now): moved on by the tests, never back (the nodes' cooldowns and budgets live on it)
const realNow = Date.now;
let shift = 0;
Date.now = () => realNow() + shift;

const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
const hex = (n) => '0x' + n.toString(16);
const STARTED = '0x1f0a803b340f18c069591b04eca4f49892175c5fcb11f82bd92c7e01eef3498b';
const agent = (i) => '0x' + i.toString(16).padStart(2, '0').repeat(20);
const started = (a, n, block, opponent = '0') => ({ address: ARENA, blockNumber: hex(block), logIndex: '0x0', transactionHash: '0x' + word(hex(block)), topics: [STARTED, '0x' + word(a), '0x' + word(hex(n)), '0x' + word(opponent)], data: '0x' + word('5e') + word('0') + word('0') + word('0') + word('1') });
const logsQ = (from, to) => ({ method: 'eth_getLogs', params: [{ address: ARENA, fromBlock: hex(from), toBlock: hex(to) }] });
const CALL = { method: 'eth_call', params: [{ to: ARENA, data: '0x78a2ce59' }, 'latest'] };

/**
 * A fake chain behind fake nodes: `head`, `logs`; each node answers as a public node does (a log range
 * wider than its cap is an error), unless `w.behave[url]` says otherwise: { status } (an HTTP error),
 * 'throw' (a network error), 'hang' (never answers), or a function (q) -> an answer to use instead.
 * Every request is recorded: { url, at, calls }.
 */
function chainWorld({ head = 1_000_000, logs = [], caps = { [C48]: 250, [TW]: 1000, [PN]: 50000 } } = {}) {
  const w = { head, now: 1_700_000_000, logs, behave: {}, requests: [], worker: [], clock: 0 };
  const answer = (url, q) => {
    const ok = (result) => ({ jsonrpc: '2.0', id: q.id, result });
    const special = typeof w.behave[url] === 'function' ? w.behave[url](q) : null;
    if (special) return special;
    if (q.method === 'eth_blockNumber') return ok(hex(w.head));
    if (q.method === 'eth_getBlockByNumber') return ok({ number: hex(w.head), timestamp: hex(w.now) });
    if (q.method === 'eth_call') return ok('0x' + word('0').repeat(3));
    if (q.method === 'eth_getLogs') {
      const from = parseInt(q.params[0].fromBlock, 16);
      const to = parseInt(q.params[0].toBlock, 16);
      if (!caps[url] || to - from + 1 > caps[url]) return { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'block range too wide' } };
      return ok(w.logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to));
    }
    return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'no' } };
  };
  w.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (url === '/rpc') {
      w.worker.push(body);
      const list = Array.isArray(body) ? body : [body];
      const out = list.map((q) => answer(TW, q).error ? answer(PN, q) : answer(TW, q)); // the Worker: archive and nodes behind it
      return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]));
    }
    w.requests.push({ url, at: w.clock, calls: Array.isArray(body) ? body : [body] });
    const b = w.behave[url];
    if (b?.status) return new Response('{"error":"no"}', { status: b.status, headers: b.headers ?? {} });
    if (b === 'throw') throw new TypeError('Failed to fetch');
    if (b === 'hang') return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    const out = (Array.isArray(body) ? body : [body]).map((q) => answer(url, q));
    return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]));
  };
  return w;
}

/** A client over `w` with a fake clock (sleeping moves it on). */
function clientOf(w, opts = {}) {
  const slept = [];
  const c = createClient({ nodes: NODES, worker: '/rpc', fetchFn: w.fetch, now: () => w.clock, sleep: async (ms) => { slept.push(ms); w.clock += ms; }, blocksPerHour: BLOCKS_PER_HOUR, ...opts });
  c.slept = slept;
  return c;
}
const to = (w, url) => w.requests.filter((r) => r.url === url);
const ok = (o) => {
  assert.ok(o && 'result' in o, JSON.stringify(o));
  return o.result;
};

test('one moment\'s calls: one batch to the first calls node; the newest blocks to 48.club; nothing to the Worker', async () => {
  const w = chainWorld({ logs: [started(agent(1), 1, 999_900)] });
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]); // the head: known from now on
  w.requests = [];
  const out = await c.send([{ method: 'eth_blockNumber', params: [] }, { method: 'eth_getBlockByNumber', params: ['latest', false] }, CALL, CALL, logsQ(999_870, 999_997)]);
  assert.equal(out.length, 5);
  out.forEach(ok);
  assert.equal(ok(out[4]).length, 1, 'the fight');
  assert.deepEqual(w.requests.map((r) => [r.url, r.calls.length]), [[DS, 4], [C48, 1]], 'two requests: the calls together, the logs');
  assert.equal(w.worker.length, 0);
});

test('a log range goes to the fewest requests among the nodes trusted for it; a pruning node never for blocks it may have dropped', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  const H = 1_000_000;
  const where = async (from, toBlock) => {
    w.requests = [];
    w.worker = [];
    ok((await c.send([logsQ(from, toBlock)]))[0]);
    return [...w.requests.map((r) => `${r.url}:${r.calls.length}`), ...w.worker.map(() => 'worker')];
  };
  // no head seen yet: only an archive node may answer a log range
  assert.deepEqual(await where(H - 500, H - 300), [`${TW}:1`], 'no head yet: the archive node');
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  assert.deepEqual(await where(H - 200, H - 2), [`${C48}:1`], 'the newest blocks: 48.club, one request');
  assert.deepEqual(await where(H - 2000, H - 2), [`${PN}:1`], '2000 recent blocks: publicnode in one request');
  assert.deepEqual(await where(H - 900, H - 1), [`${TW}:1`], '900 blocks: thirdweb (one request) before 48.club (four)');
  assert.deepEqual(await where(H - 100_000, H - 99_001), [`${TW}:1`], '12 hours back: not 48.club (6 hours)');
  // 60 hours back: thirdweb only; with thirdweb down, the Worker (its archive), never publicnode
  assert.deepEqual(await where(H - 480_000, H - 479_001), [`${TW}:1`]);
  w.behave[TW] = { status: 503 };
  assert.deepEqual(await where(H - 480_000, H - 479_001), [`${TW}:1`, 'worker'], 'thirdweb fails: the Worker; publicnode is never asked');
  w.clock += 2000; // (the Worker's backoff after the first fallback)
  assert.deepEqual(await where(H - 470_000, H - 469_001), ['worker'], 'thirdweb cooling down: straight to the Worker');
  assert.ok(!w.requests.some((r) => r.url === PN));
  // a pruning node alone with an old range: the Worker by design
  const lone = createClient({ nodes: [{ url: DS, calls: true }, { url: C48, logs: 250 }], fetchFn: w.fetch, now: () => w.clock, blocksPerHour: BLOCKS_PER_HOUR });
  ok((await lone.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  w.requests = [];
  w.worker = [];
  ok((await lone.send([logsQ(H - 200_000, H - 199_900)]))[0]);
  assert.deepEqual([w.requests.length, w.worker.length], [0, 1]);
});

test('a range wider than one node request is split by the node\'s cap, in one batch, the answers merged in order', async () => {
  const w = chainWorld({ logs: [started(agent(1), 1, 999_100), started(agent(2), 1, 999_400), started(agent(3), 1, 999_950)] });
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  for (const n of c.nodes) if (n.url === TW || n.url === PN) n.coolUntil = Infinity; // both down for now
  w.requests = [];
  const got = ok((await c.send([logsQ(999_001, 999_999)]))[0]);
  assert.deepEqual(w.requests.map((r) => [r.url, r.calls.map((q) => [parseInt(q.params[0].fromBlock, 16), parseInt(q.params[0].toBlock, 16)])]), [[C48, [[999_001, 999_250], [999_251, 999_500], [999_501, 999_750], [999_751, 999_999]]]]);
  assert.deepEqual(got.map((l) => parseInt(l.blockNumber, 16)), [999_100, 999_400, 999_950]);
});

test('the history (a range wider than 5000 blocks) goes to the Worker by design, even while the fallback waits', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  for (const n of [DS, DF, NI]) w.behave[n] = 'throw';
  await c.send([CALL]); // every calls node fails: the Worker once, then the backoff
  w.worker = [];
  const out = await c.send([CALL, logsQ(900_000, 949_999)]);
  assert.ok(out[0].fail, 'the call: no node, and the fallback waits');
  ok(out[1]);
  assert.equal(w.worker.length, 1);
  assert.equal(JSON.parse(JSON.stringify(w.worker[0])).params[0].fromBlock, hex(900_000), 'only the history range');
});

test('failover: a node that answers 429 cools down 30 s (Retry-After honoured), the calls go to the next one at once', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  w.behave[DS] = { status: 429 };
  ok((await c.send([CALL]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [DS, DF]);
  w.requests = [];
  w.clock += 29_000;
  ok((await c.send([CALL]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [DF], 'still cooling down: not asked');
  w.behave[DS] = null;
  w.clock += 1_500;
  w.requests = [];
  ok((await c.send([CALL]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [DS], 'back after 30 s');
  // a Retry-After of 90 s
  w.behave[DS] = { status: 429, headers: { 'retry-after': '90' } };
  await c.send([CALL]);
  w.behave[DS] = null;
  w.clock += 60_000;
  w.requests = [];
  await c.send([CALL]);
  assert.notEqual(w.requests[0].url, DS);
  w.clock += 31_000;
  w.requests = [];
  await c.send([CALL]);
  assert.equal(w.requests[0].url, DS);
});

test('failover: a timeout and a network error cool a node down 10 s, twice as long when it fails again', async () => {
  const w = chainWorld();
  const c = clientOf(w, { callTimeoutMs: 20 });
  w.behave[DS] = 'hang';
  ok((await c.send([CALL]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [DS, DF]);
  const ds = c.nodes.find((n) => n.url === DS);
  assert.equal(ds.coolUntil - w.clock, 10_000);
  w.behave[DS] = 'throw';
  w.clock += 10_001;
  await c.send([CALL]);
  assert.equal(ds.coolUntil - w.clock, 20_000, 'the second failure in a row: 20 s');
  w.behave[DS] = null;
  w.clock += 20_001;
  await c.send([CALL]);
  assert.equal(ds.strikes, 0, 'an answer: forgiven');
});

test('a call\'s own error moves it to another node without a cooldown; a rate limit in the batch cools the node; a revert is final', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  // 48.club a block behind: a range past its head is an error there
  w.behave[C48] = (q) => (q.method === 'eth_getLogs' && parseInt(q.params[0].toBlock, 16) > w.head - 3 ? { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'block range extends beyond current head block' } } : null);
  w.requests = [];
  ok((await c.send([logsQ(999_900, 999_998)]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [C48, TW]);
  w.requests = [];
  ok((await c.send([logsQ(999_800, 999_900)]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [C48], 'no cooldown for that');
  // a rate limit inside the batch
  w.behave[C48] = (q) => ({ jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } });
  w.requests = [];
  ok((await c.send([logsQ(999_800, 999_900)]))[0]);
  assert.deepEqual(w.requests.map((r) => r.url), [C48, TW]);
  assert.ok(c.nodes.find((n) => n.url === C48).coolUntil > w.clock + 29_000);
  // a revert: the chain's answer
  w.behave[DS] = (q) => ({ jsonrpc: '2.0', id: q.id, error: { code: 3, message: 'execution reverted' } });
  w.requests = [];
  w.worker = [];
  const out = await c.send([CALL]);
  assert.equal(out[0].error.message, 'execution reverted');
  assert.deepEqual([w.requests.map((r) => r.url), w.worker.length], [[DS], 0]);
  assert.ok(isRate({ code: -32005 }) && isRate({ message: 'Too Many Requests' }) && !isRate({ message: 'execution reverted' }));
});

test('a whole batch refused (one error object for all, a body that is not JSON) cools the node down and moves on', async () => {
  const w = chainWorld();
  const node = w.fetch;
  w.fetch = async (url, init) => {
    if (url !== DS && url !== DF) return node(url, init);
    w.requests.push({ url, at: w.clock, calls: [] });
    return new Response(url === DS ? JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32005, message: 'rate limit' } }) : '<html>busy</html>');
  };
  const c = clientOf(w);
  (await c.send([CALL, CALL])).forEach(ok);
  assert.deepEqual(w.requests.map((r) => r.url), [DS, DF, NI]);
  assert.ok(c.nodes[0].coolUntil > w.clock + 29_000, 'the rate limit: 30 s');
  assert.ok(c.nodes[1].coolUntil > w.clock + 9_000, 'the broken answer: 10 s');
});

test('no node answers: the Worker once, then not before 2 s, 4 s, 8 s ... (up to 30 s); a direct answer resets it', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  for (const n of [DS, DF, NI]) w.behave[n] = { status: 503 };
  const worker = () => w.worker.length;
  ok((await c.send([CALL]))[0]);
  assert.equal(worker(), 1, 'the page still works');
  const seen = [];
  // a poll every second for two minutes: the nodes keep failing (their cooldowns run out now and then)
  for (let s = 1; s <= 120; s++) {
    w.clock += 1000;
    const before = worker();
    const out = await c.send([CALL]);
    if (worker() > before) {
      ok(out[0]);
      seen.push(s);
    } else assert.ok(out[0].fail);
  }
  const gaps = seen.map((x, i) => x - (seen[i - 1] ?? 0));
  assert.deepEqual(gaps.slice(0, 5), [2, 4, 8, 16, 30], `the Worker at ${seen}`);
  assert.ok(gaps.slice(4).every((g) => g === 30));
  assert.ok(seen.length <= 8, `${seen.length + 1} Worker requests in two minutes, not 121`);
  // the nodes answer again: direct, and the next failure falls back at once
  for (const n of [DS, DF, NI]) w.behave[n] = null;
  w.clock += 400_000;
  ok((await c.send([CALL]))[0]);
  for (const n of [DS, DF, NI]) w.behave[n] = { status: 503 };
  w.clock += 400_000;
  const before = worker();
  ok((await c.send([CALL]))[0]);
  assert.equal(worker(), before + 1);
});

test('polite: no node gets more than 3 requests at once or one per 2 s on average; past that, the next node, then a short wait', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  // 400 moments, every 300 ms, each with calls and the newest blocks: far more than one viewer polls
  for (let i = 0; i < 400; i++) {
    w.clock += 300;
    w.head += 1;
    (await c.send([CALL, logsQ(w.head - 100, w.head - 2)])).forEach(ok);
  }
  for (const url of [DS, DF, NI, C48, TW, PN]) {
    const at = to(w, url).map((r) => r.at);
    for (let i = 0; i < at.length; i++) {
      for (let k = i; k < at.length; k++) assert.ok(k - i + 1 <= 3 + (at[k] - at[i]) / 2000, `${url}: ${k - i + 1} requests in ${at[k] - at[i]} ms`);
    }
  }
  assert.equal(w.worker.length, 0, 'never the Worker');
  assert.ok(c.slept.length > 0, 'waited when every node had spent its budget');
});

test('a moment with more calls than one batch takes: every call answered, at most 40 a request', async () => {
  const w = chainWorld();
  const c = clientOf(w);
  const out = await c.send(Array.from({ length: 95 }, () => CALL));
  out.forEach(ok);
  assert.ok(w.requests.every((r) => r.calls.length <= 40));
  assert.equal(w.worker.length, 0);
});

// ------------------------------------------------------------------ the pages (arena.js) with these nodes

const SRV = 'https://srv-thirdweb.test'; // the Worker's own node (its requests are not the viewer's)
const ENV = { ARENA, CHAIN_ID: 56, SEASON_BOOK: '0x' + 'b0'.repeat(20), DEPLOY_BLOCK: DEPLOY, SITE_RPC_URLS: JSON.stringify([{ url: SRV, logs: 1000, archive: true }]), SITE_LOG_SPAN: 4000, BROWSER_RPC_URLS: JSON.stringify(NODES), ASSETS: { fetch: async () => new Response('', { status: 404 }) } };

/** The page's world: the browser's fetch to the fake nodes (counted per node and minute) and to the
 *  real /rpc of host.js (counted: Worker invocations), whose own node and KV archive are fakes too. */
function pageWorld({ head = 1_000_000, logs = [], fight = null, special = null } = {}) {
  const w = chainWorld({ head, logs });
  const kv = { gets: 0 };
  kv.get = async (key) => {
    kv.gets++;
    const [kind, , n] = key.split(':');
    const size = kind === 'span' ? 50_000 : 5000;
    const [from, toB] = [Number(n) * size, Number(n) * size + size - 1];
    if (toB > w.head - 200) return null;
    return JSON.stringify(w.logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= toB));
  };
  w.kv = kv;
  w.env = { ...ENV, HISTORY: kv };
  w.invocations = 0;
  w.bodies = [];
  const nodeFetch = w.fetch;
  w.behave[DS] = w.behave[DF] = w.behave[NI] = (q) => {
    if (q.method !== 'eth_call') return null;
    const s = special?.(q, w);
    if (s) return s;
    if (fight && q.params[0].data.startsWith('0x32799e5d')) return { jsonrpc: '2.0', id: q.id, result: fight(w) };
    return null;
  };
  globalThis.fetch = async (url, init) => {
    if (url === '/rpc') {
      w.invocations++;
      w.bodies.push(JSON.parse(init.body));
      return host.fetch(new Request('https://arena.example.workers.dev/rpc', { method: 'POST', body: init.body }), w.env);
    }
    if (url === SRV) {
      const body = JSON.parse(init.body);
      const one = (q) => {
        const from = parseInt(q.params?.[0]?.fromBlock, 16);
        const toB = parseInt(q.params?.[0]?.toBlock, 16);
        if (q.method === 'eth_getLogs') return toB - from + 1 > 1000 ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'too wide' } } : { jsonrpc: '2.0', id: q.id, result: w.logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= toB) };
        if (q.method === 'eth_blockNumber') return { jsonrpc: '2.0', id: q.id, result: hex(w.head) };
        return special?.(q, w) ?? { jsonrpc: '2.0', id: q.id, result: '0x' + word('0').repeat(3) };
      };
      return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)));
    }
    w.clock = Date.now();
    return nodeFetch(url, init);
  };
  clearCache();
  COOLDOWNS.clear();
  return w;
}

test('config.js: the node list and the history ranges per /rpc call on mainnet; nothing new without BROWSER_RPC_URLS', () => {
  const cfg = (env, host = 'arena.example.workers.dev') => JSON.parse(siteConfig(env, new URL(`https://${host}/config.js`)).replace(/^window\.ARENA_CONFIG = /, '').replace(/;\s*$/, ''));
  const main = cfg({ ...ENV, BROWSER_RPC_URLS: [...NODES, { url: 'javascript:alert(1)', calls: true }] });
  assert.deepEqual(main.nodes, NODES.map((n) => ({ url: n.url, calls: n.calls === true, logs: n.logs, ...(n.archive ? { archive: true } : {}), ...(n.keep ? { keep: n.keep } : {}) })), 'only http(s) nodes');
  assert.equal(main.historyPerPoll, 12, 'workers.dev: one KV read per span');
  assert.equal(cfg(ENV, 'arena.ibiticoin.com').historyPerPoll, 6, 'a custom domain: the Cache API costs subrequests too');
  const testnet = cfg({ ...ENV, BROWSER_RPC_URLS: undefined });
  assert.ok(!('nodes' in testnet) && !('historyPerPoll' in testnet), 'testnet: everything through /rpc, as before');
});

test('a page load: the newest fights from the nodes, the history from the Worker\'s archive in one invocation; then the polls cost the Worker nothing', async () => {
  const old = agent(0x11);
  const mid = agent(0x33);
  const fresh = agent(0x22);
  const w = pageWorld({ logs: [started(old, 1, 905_000), started(mid, 1, 960_000), started(fresh, 1, 999_700)] });
  const s = arena.emptyState();
  await arena.refresh(s);
  assert.ok(s.fights.has(`${fresh}#1`) && s.fights.has(`${old}#1`) && s.fights.has(`${mid}#1`), 'the newest fight and the history');
  assert.equal(s.gaps.length, 0);
  assert.equal(w.invocations, 1, 'one Worker invocation: the history');
  assert.ok(w.bodies[0].every((q) => q.method === 'eth_getLogs'), 'only log ranges went to the Worker');
  for (let i = 0; i < 20; i++) {
    w.head += 5;
    shift += 2000;
    await arena.refresh(s);
  }
  assert.equal(w.invocations, 1, '20 polls later: still one');
  assert.ok(s.latestBlock >= 1_000_100);
});

test('another page of the same tab: the history it read already comes from the tab\'s storage, not from the Worker', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const w = pageWorld({ logs: [started(agent(0x11), 1, 905_000), started(agent(0x33), 1, 960_000)] });
    const first = arena.emptyState();
    await arena.refresh(first);
    assert.equal(w.invocations, 1);
    const spans = w.bodies[0].map((q) => parseInt(q.params[0].fromBlock, 16));
    assert.ok(spans.includes(900_000) && spans.includes(950_000));
    assert.ok(store.size >= 2, 'the final ranges kept');
    w.head += 50; // the next page, a little later
    shift += 5000;
    w.bodies = [];
    const next = arena.emptyState();
    await arena.refresh(next);
    assert.ok(next.fights.has(`${agent(0x11)}#1`) && next.fights.has(`${agent(0x33)}#1`));
    const asked = w.bodies.flat().map((q) => parseInt(q.params[0].fromBlock, 16));
    assert.ok(!asked.includes(900_000), `the span 900000-949999 not asked again: ${asked}`);
    // storage that throws (blocked): read again, nothing breaks
    globalThis.sessionStorage = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const third = arena.emptyState();
    await arena.refresh(third);
    assert.ok(third.fights.has(`${agent(0x11)}#1`));
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('the Worker refuses a history request as a whole (too many reads): the polls go on, the ranges are not split, fewer next time', async () => {
  const w = pageWorld({ logs: [started(agent(0x11), 1, 905_000), started(agent(0x22), 1, 999_700)] });
  let refuse = true;
  w.env = { ...w.env, RPC_LIMIT: { limit: async () => ({ success: !refuse }) } };
  const s = arena.emptyState();
  await arena.refresh(s);
  assert.ok(s.fights.has(`${agent(0x22)}#1`), 'the newest fight: from the nodes');
  const gaps = JSON.stringify(s.gaps);
  assert.equal(s.gaps.length, 2);
  shift += 2000;
  await arena.refresh(s);
  assert.equal(JSON.stringify(s.gaps), gaps, 'not split');
  assert.equal(s.failures, 0, 'the poll itself went well');
  assert.notEqual(arena.pollDelay(s), 300, 'not at once');
  assert.ok(s.gapsPerPoll < 2, `${s.gapsPerPoll} ranges next time`);
  refuse = false;
  for (let i = 0; i < 6 && s.gaps.length; i++) {
    shift += 2000;
    await arena.refresh(s);
  }
  assert.equal(s.gaps.length, 0);
  assert.ok(s.fights.has(`${agent(0x11)}#1`));
});

test('invocations and node requests per viewer: the match page and the hall, idle and with a fight live, an hour each', async (t) => {
  const BOOK = '0x' + 'b0'.repeat(20);
  const CERT = '0x' + 'ce'.repeat(20);
  window.ARENA_CONFIG.seasonBook = BOOK;
  try {
    for (const [page, factor, live] of [['the match page', 1, false], ['the match page', 1, true], ['the hall', 1.5, false], ['the hall', 1.5, true]]) {
      const special = (q, w) => {
        const { to: addr, data } = q.params[0];
        const res = (r) => ({ jsonrpc: '2.0', id: q.id, result: r });
        if (data === '0xfda7b9db') return res('0x' + word(BOOK));
        if (addr === BOOK && (data === '0x9fa6a6e3' || data === '0x715f8fe8')) return res('0x' + word('1'));
        if (addr === BOOK) return res('0x' + [word(hex(w.now - 1000)), word(hex(w.now + 10 ** 6)), word('0'), word('0'), word(CERT)].join(''));
        if (addr === CERT) return res('0x' + word('0').repeat(4));
        return null;
      };
      const fight = live ? (w) => '0x' + [word('5e'), word(hex(w.now - 60)), word('0'), word('0'), word('1'), word('0'), word('1'), word('0'), word('0'), word(hex(w.now + 30)), word('0'), word('0'), word('0'), word('0'), word('0'), word('1'), word('0'), word('1'), word('77'), word('0'), word('0'), word('1')].join('') : null;
      const w = pageWorld({ logs: live ? [started(agent(0x55), 1, 999_900)] : [], fight, special });
      const s = arena.emptyState();
      s.fromBlock = 998_000; // (no history: the hour's own polls only)
      let elapsed = 0;
      let polls = 0;
      const t0 = Date.now();
      const before = w.requests.length;
      while (elapsed < 3600 * 1000) {
        await Promise.all([arena.refresh(s), arena.seasonState().catch(() => null), arena.podiumSeason().catch(() => null)]);
        const d = arena.pollDelay(s, factor);
        elapsed += d;
        shift += d;
        polls++;
        w.head += Math.round(d / 450);
        w.now += Math.round(d / 1000);
      }
      const reqs = w.requests.slice(before);
      const perNode = {};
      let worst = 0;
      for (const r of reqs) {
        const name = new URL(r.url).hostname.split('.')[0];
        perNode[name] = (perNode[name] ?? 0) + 1;
      }
      // the busiest node in any minute
      for (const url of [DS, DF, NI, C48, TW, PN]) {
        const at = reqs.filter((r) => r.url === url).map((r) => r.at - t0);
        for (let m = 0; m < 60; m++) worst = Math.max(worst, at.filter((x) => x >= m * 60000 && x < (m + 1) * 60000).length);
      }
      const minutes = 60;
      t.diagnostic(`${page}, ${live ? 'a fight live all hour' : 'idle'}: ${polls} polls, ${w.invocations} Worker invocations, ${reqs.length} node requests (${(reqs.length / minutes).toFixed(1)} a minute: ${Object.entries(perNode).map(([k, v]) => `${k} ${(v / minutes).toFixed(1)}`).join(', ')}); the busiest node in a minute: ${worst}`);
      assert.ok(w.invocations <= 1, `${w.invocations} Worker invocations`);
      assert.ok(worst <= 33, `${worst} requests to one node in a minute`);
      if (live) assert.ok(polls >= 1700 / factor && polls <= 1810 / factor, `${polls}`);
    }
  } finally {
    delete window.ARENA_CONFIG.seasonBook;
  }
});

test('every node down: the page still updates through the Worker, a few times a minute, not every poll', async (t) => {
  const w = pageWorld();
  try {
    const s = arena.emptyState();
    s.fromBlock = 999_000;
    await arena.refresh(s);
    for (const n of [DS, DF, NI, C48, TW, PN]) w.behave[n] = { status: 503 };
    const start = w.invocations;
    let elapsed = 0;
    let updates = 0;
    while (elapsed < 10 * 60 * 1000) {
      const before = s.latestBlock;
      await arena.refresh(s).catch(() => null);
      if (s.latestBlock > before) updates++;
      const d = arena.pollDelay(s);
      elapsed += d;
      shift += d;
      w.head += Math.round(d / 450);
    }
    const n = w.invocations - start;
    assert.ok(updates >= 15, `${updates} updates in 10 minutes`);
    t.diagnostic(`every node down for 10 minutes: ${n} Worker invocations, ${updates} updates of the page`);
    assert.ok(n <= 40, `${n} Worker invocations in 10 minutes (a poll every 2 s would be 300)`);
  } finally {
    for (const n of [DS, DF, NI, C48, TW, PN]) w.behave[n] = null;
  }
});

// ------------------------------------------------------------------ the reviewers' cases

/** publicnode as measured on 2026-11-24 from a home address: [] with no error for blocks older than
 *  about 2.2 hours (17600 blocks), whatever it holds. */
const pruned = (w) => (q) => (q.method === 'eth_getLogs' && parseInt(q.params[0].fromBlock, 16) < w.head - 17_600 ? { jsonrpc: '2.0', id: q.id, result: [] } : null);

test('mainnet config: publicnode is trusted for an hour at most (it drops logs after about 2 h); 48.club for 6', async () => {
  const { readFileSync } = await import('node:fs');
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8');
  const pn = [...text.matchAll(/"url": "https:\/\/bsc-rpc\.publicnode\.com", "logs": \d+, "keep": (\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const club = [...text.matchAll(/"url": "https:\/\/rpc-bsc\.48\.club", "logs": \d+, "keep": (\d+)/g)].map((m) => Number(m[1]));
  assert.equal(pn.length, 2, 'both mainnet envs name publicnode with a keep');
  assert.ok(pn.every((k) => k <= 1), `publicnode keep ${pn}`);
  assert.deepEqual(club, [6, 6]);
});

test('a range 2 to 48 hours old never goes to publicnode, even when it would serve it in one request; the answer says which node gave it', async () => {
  const H = 1_000_000;
  const w = chainWorld({ logs: [started(agent(1), 1, H - 24_000 + 100), started(agent(2), 1, H - 240_000 + 100), started(agent(3), 1, H - 1500), started(agent(4), 1, H - 100)] });
  w.behave[PN] = pruned(w);
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  const read = async (from, toB) => {
    w.requests = [];
    w.worker = [];
    const [o] = await c.send([logsQ(from, toB)]);
    ok(o);
    assert.ok(!w.requests.some((r) => r.url === PN), `${from}-${toB}: publicnode asked`);
    return o;
  };
  // 3500 blocks three hours back: thirdweb in four pieces, not publicnode in one
  let o = await read(H - 24_000, H - 20_501);
  assert.deepEqual([o.result.length, o.from, o.mayPrune], [1, TW, false]);
  // 4500 blocks: more than thirdweb's four pieces: the Worker (its archive), still never publicnode
  w.clock += 10_000;
  o = await read(H - 24_000, H - 19_501);
  assert.equal(o.from, 'worker');
  // 3000 blocks thirty hours back: thirdweb
  w.clock += 10_000;
  o = await read(H - 240_000, H - 237_001);
  assert.deepEqual([o.result.length, o.from], [1, TW]);
  // recent blocks: publicnode in one request, and the answer says a pruning node gave it
  w.clock += 10_000;
  const [p] = await c.send([logsQ(H - 3000, H - 2)]);
  assert.deepEqual([ok(p).length, p.from, p.mayPrune], [2, PN, true]);
  // 48.club answers a recent narrow range: a pruning node too
  w.clock += 10_000;
  const [q] = await c.send([logsQ(H - 200, H - 2)]);
  assert.deepEqual([q.from, q.mayPrune], [C48, true]);
});

test('a tab shown again after three hours: the blocks it missed come from thirdweb or the Worker, never an empty answer of publicnode', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  shift += 20 * 60_000; // (the earlier tests' cooldowns and backoffs run out)
  try {
    const w = pageWorld({ head: 1_046_600 });
    w.behave[PN] = pruned(w);
    const s = arena.emptyState();
    s.fromBlock = 1_046_000;
    await arena.refresh(s);
    // hidden three hours: a fight started in blocks the page did not read
    const a = agent(0x44);
    w.logs.push(started(a, 1, 1_047_000));
    w.head += 24_000;
    w.now += 3 * 3600;
    shift += 3 * 3600 * 1000;
    for (let i = 0; i < 20 && (i < 2 || s.gaps.length); i++) {
      await arena.refresh(s);
      shift += arena.pollDelay(s);
    }
    assert.equal(s.gaps.length, 0);
    assert.ok(s.fights.has(`${a}#1`), 'the fight of the missed blocks');
    const old = w.requests.filter((r) => r.url === PN && r.calls.some((q) => q.method === 'eth_getLogs' && parseInt(q.params[0].fromBlock, 16) < w.head - 8000));
    assert.equal(old.length, 0, 'publicnode never asked for blocks older than an hour');
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('a history range a pruning node answered is never kept in the tab\'s storage; one from thirdweb is', async () => {
  const store = new Map();
  globalThis.sessionStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  shift += 20 * 60_000;
  try {
    // (a head above every earlier test's: the page's client keeps the highest head it has seen)
    const w = pageWorld({ head: 1_220_000 });
    const s = arena.emptyState();
    s.fromBlock = 1_219_500;
    await arena.refresh(s);
    // two narrow history ranges: 1200 blocks 30 minutes old (publicnode serves them in one request), and
    // 1000 blocks 2 hours old (thirdweb only)
    s.gaps.push({ from: 1_215_000, to: 1_216_199 }, { from: 1_204_000, to: 1_204_999 });
    s.gaps.sort((x, y) => x.from - y.from);
    for (let i = 0; i < 5 && s.gaps.length; i++) {
      shift += 2000;
      await arena.refresh(s);
    }
    assert.equal(s.gaps.length, 0);
    const kept = [...store.keys()].map((k) => k.split('|').slice(2).join('-'));
    assert.ok(kept.includes('1204000-1204999'), `thirdweb's range kept: ${kept}`);
    const recent = w.requests.find((r) => r.calls.some((q) => q.method === 'eth_getLogs' && q.params[0].fromBlock === hex(1_215_000)));
    assert.ok(recent && recent.url !== TW, 'the recent range: a pruning node');
    assert.ok(!kept.includes('1215000-1216199'), 'not kept: a pruning node answered it');
  } finally {
    delete globalThis.sessionStorage;
  }
});

test('one kind of node down while the other answers: that kind reaches the Worker on the 2/4/8/16/30 s schedule, not every poll', async (t) => {
  for (const [name, down] of [['the log nodes', [C48, TW, PN]], ['the dataseeds', [DS, DF, NI]]]) {
    const w = chainWorld();
    const c = clientOf(w);
    ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
    w.behave[down[0]] = { status: 429 };
    w.behave[down[1]] = { status: name === 'the dataseeds' ? 403 : 503 };
    w.behave[down[2]] = 'throw';
    const seen = [];
    let direct = 0;
    // 15 minutes of polls every 2 s, each with its calls and the newest blocks
    for (let k = 1; k <= 450; k++) {
      w.clock += 2000;
      w.head += 4;
      const before = w.worker.length;
      const out = await c.send([{ method: 'eth_blockNumber', params: [] }, CALL, logsQ(w.head - 100, w.head - 2)]);
      if (w.worker.length > before) seen.push(Math.round(w.clock / 1000));
      const mine = name === 'the log nodes' ? out.slice(0, 2) : out.slice(2);
      mine.forEach(ok); // the kind that works: always answered, directly
      if (mine.every((o) => o.from && o.from !== 'worker')) direct++;
    }
    const gaps = seen.map((x, i) => x - (seen[i - 1] ?? x));
    t.diagnostic(`${name} down for 15 minutes: ${seen.length} Worker requests in 450 polls`);
    assert.equal(direct, 450);
    assert.ok(seen.length <= 40, `${name} down: ${seen.length} Worker requests in 450 polls`);
    assert.ok(gaps.slice(5).every((g) => g >= 28), `the Worker at ${seen}`);
  }
});

test('the page with its log nodes down for one viewer: a live fight\'s 15 minutes cost a few dozen Worker invocations, not one a poll, and new fights still arrive', async (t) => {
  shift += 20 * 60_000;
  const w = pageWorld();
  try {
    const s = arena.emptyState();
    s.fromBlock = 999_000;
    await arena.refresh(s);
    w.behave[C48] = { status: 429 };
    w.behave[TW] = { status: 429 };
    w.behave[PN] = 'throw';
    const start = w.invocations;
    let elapsed = 0;
    let polls = 0;
    const late = agent(0x66);
    while (elapsed < 15 * 60 * 1000) {
      if (elapsed > 5 * 60 * 1000 && !w.logs.length) w.logs.push(started(late, 1, w.head - 10));
      await arena.refresh(s).catch(() => null);
      polls++;
      const d = arena.pollDelay(s, 1, 2000); // a live fight's pace
      elapsed += d;
      shift += d;
      w.head += Math.round(d / 450);
    }
    const n = w.invocations - start;
    t.diagnostic(`log nodes down, 15 minutes at 2 s: ${polls} polls, ${n} Worker invocations`);
    assert.ok(polls >= 400, `${polls} polls`);
    assert.ok(n <= 50, `${n} Worker invocations (one a poll would be ${polls})`);
    assert.ok(s.fights.has(`${late}#1`), 'the fight that started meanwhile');
  } finally {
    for (const n of [C48, TW, PN]) w.behave[n] = null;
  }
});

test('the Worker refusing every history request: the history waits 2, 4, 8 ... 60 s between tries, never 300 ms, at least one range a try', async (t) => {
  for (const calm of [null, 2000]) {
    shift += 20 * 60_000;
    const w = pageWorld({ logs: [started(agent(0x11), 1, 905_000)] });
    w.env = { ...w.env, RPC_LIMIT: { limit: async () => ({ success: false }) } };
    const s = arena.emptyState();
    let elapsed = 0;
    let polls = 0;
    const tries = [];
    while (elapsed < 15 * 60 * 1000) {
      const before = w.invocations;
      await arena.refresh(s);
      polls++;
      if (w.invocations > before) tries.push(Math.round(elapsed / 1000));
      assert.ok(s.gapsPerPoll === undefined || s.gapsPerPoll >= 1, 'never a poll with no range allowed');
      const d = arena.pollDelay(s, 1, calm);
      assert.notEqual(d, 300, 'never the history pace while it is refused');
      elapsed += d;
      shift += d;
      w.head += Math.round(d / 450);
    }
    t.diagnostic(`history refused for 15 minutes (${calm ? '2 s' : 'idle'} pace): ${polls} polls, ${w.invocations} Worker invocations at ${tries.join(', ')} s`);
    assert.ok(w.invocations <= 25, `${w.invocations} Worker invocations`);
    assert.equal(s.failures, 0, 'the polls themselves went well');
    // the Worker answers again: the history comes in
    w.env = { ...w.env, RPC_LIMIT: { limit: async () => ({ success: true }) } };
    for (let i = 0; i < 20 && s.gaps.length; i++) {
      shift += arena.pollDelay(s, 1, calm);
      await arena.refresh(s);
    }
    assert.equal(s.gaps.length, 0);
    assert.ok(s.fights.has(`${agent(0x11)}#1`));
  }
});

test('log reads are charged per piece: a pile of old ranges goes to thirdweb at most four pieces a request and one piece per 2 s on average; the rest wait (busy), never the Worker', async () => {
  const H = 1_000_000;
  const w = chainWorld();
  const c = clientOf(w);
  ok((await c.send([{ method: 'eth_blockNumber', params: [] }]))[0]);
  // twelve ranges of 4000 blocks, 3 to 9 hours old: only thirdweb may serve them, in four pieces each
  let left = Array.from({ length: 12 }, (_, i) => logsQ(H - 72_000 + i * 4000, H - 68_001 + i * 4000));
  const first = await c.send(left);
  assert.equal(first.filter((o) => 'result' in o).length, 1, 'one range now');
  assert.equal(first.filter((o) => o.busy).length, 11, 'the others busy');
  // a poll every 300 ms with what is left
  for (let k = 0; k < 400 && left.length; k++) {
    const out = await c.send(left);
    left = left.filter((_, i) => !('result' in out[i]));
    w.clock += 300;
  }
  assert.equal(left.length, 0, 'every range read in the end');
  assert.equal(w.worker.length, 0, 'never the Worker');
  const tw = to(w, TW);
  assert.ok(tw.every((r) => r.calls.filter((q) => q.method === 'eth_getLogs').length <= 4), 'at most four pieces a request');
  const at = tw.flatMap((r) => r.calls.filter((q) => q.method === 'eth_getLogs').map(() => r.at));
  for (let i = 0; i < at.length; i++) {
    for (let k = i; k < at.length; k++) assert.ok(k - i + 1 <= 3 + 4 + (at[k] - at[i]) / 2000, `${k - i + 1} pieces in ${at[k] - at[i]} ms`);
  }
});

// The arena's history in KV (archive.js): a chunk is stored only when it is final, read from an archive
// node only (never from a pruning or unknown-retention node), and only when every page came back as this
// arena's logs in range from a node whose head is past the page (a page that failed is never stored as
// empty); a chunk moves on over several runs a few pages at a time; the archive never pushes thirdweb
// past its burst limit after the judge's own requests; a span of ten chunks is stored once they all are;
// the writes stay far under Workers KV Free's 1,000 a day, a backfill included; and the cron runs it after
// the judge with what is left of the invocation's subrequests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveRun, chunkKey, spanKey, cursorKey, forgetCursors, CHUNK, ARCHIVE_MARGIN } from '../src/archive.js';
import host from '../src/host.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const TW = 'https://thirdweb.test';
const CLUB = 'https://club.test';
const PN = 'https://publicnode.test';
const DS = 'https://dataseed.test';
// as on mainnet: thirdweb the archive node, 48.club and publicnode log nodes that are not
const NODES = [{ url: DS, logs: 0, send: true }, { url: TW, logs: 1000, archive: true }, { url: CLUB, logs: 250 }, { url: PN, logs: 50000, send: true }];
const hex = (n) => '0x' + n.toString(16);
const log = (block, address = ARENA) => ({ address, blockNumber: hex(block), logIndex: '0x0', transactionHash: '0x' + block.toString(16).padStart(64, '0'), topics: ['0x' + 'aa'.repeat(32)], data: '0x' });

function kvOf() {
  const map = new Map();
  const kv = { gets: 0, puts: 0, map, get: async (k) => (kv.gets++, map.get(k) ?? null), put: async (k, v) => (kv.puts++, void map.set(k, v)) };
  return kv;
}
/**
 * Fake nodes: one log every 500 blocks; `bad(url, q)` may answer otherwise (an error, a wrong list);
 * `burst`: thirdweb answers HTTP 429 past that many requests (one fake per minute); `head`: the head
 * each node reports; publicnode has pruned everything (it answers [] for any range).
 */
function nodes(bad = () => null, { burst = Infinity, head = 1_000_000 } = {}) {
  const calls = [];
  let tw = 0;
  const fetchFn = async (url, init) => {
    const q = JSON.parse(init.body);
    calls.push({ url, q });
    const reply = (x) => ({ json: async () => x });
    if (url === TW && ++tw > burst) return { status: 429, json: async () => { throw new SyntaxError('<html>'); } };
    const b = bad(url, q);
    if (b) return reply(b);
    if (q.method === 'eth_blockNumber') return reply({ jsonrpc: '2.0', id: q.id, result: hex(typeof head === 'function' ? head(url) : head) });
    const from = parseInt(q.params[0].fromBlock, 16);
    const to = parseInt(q.params[0].toBlock, 16);
    if (url === DS || to - from + 1 > (url === TW ? 1000 : url === CLUB ? 250 : 50000)) return reply({ jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'limit exceeded' } });
    if (url === PN) return reply({ jsonrpc: '2.0', id: q.id, result: [] }); // pruned: silently empty
    const out = [];
    for (let b = Math.ceil(from / 500) * 500; b <= to; b += 500) out.push(log(b));
    return reply({ jsonrpc: '2.0', id: q.id, result: out });
  };
  return { calls, fetchFn };
}
const env = (kv, extra = {}) => ({ ARENA, DEPLOY_BLOCK: 990_100, RPC_URLS: NODES, HISTORY: kv, ...extra });
const quiet = { log: () => {}, pauseMs: 0, gapMs: 0 };
const cursor = (kv) => JSON.parse(kv.map.get(cursorKey(ARENA)));

test('a final chunk is stored whole, in 1000-block pages from the archive node only, and the cursor moves on', async () => {
  forgetCursors();
  const kv = kvOf();
  const { calls, fetchFn } = nodes();
  // chunk 198 (990000-994999) is final at head 995199; chunk 199 is not
  const r = await archiveRun(env(kv), { ...quiet, fetchFn, head: 994_999 + ARCHIVE_MARGIN, budget: { left: 16 } });
  assert.equal(r.stored, 1);
  assert.equal(r.next, 199);
  const logs = JSON.parse(kv.map.get(chunkKey(ARENA, 198)));
  assert.deepEqual(logs.map((l) => parseInt(l.blockNumber, 16)), [990500, 991000, 991500, 992000, 992500, 993000, 993500, 994000, 994500], 'from the deployment block on, every log, in order');
  assert.equal(cursor(kv).next, 199);
  assert.deepEqual(calls.map((c) => [c.url, c.q.method === 'eth_getLogs' ? parseInt(c.q.params[0].fromBlock, 16) : c.q.method]), [[TW, 'eth_blockNumber'], [TW, 990_100], [TW, 991_100], [TW, 992_100], [TW, 993_100], [TW, 994_100]], 'the archive node\'s own head first, then the pages');
  assert.equal(kv.puts, 2, 'the chunk and the cursor (this run started from KV)');
  // the next minute: chunk 199 is not final yet: no KV read, no request
  const gets = kv.gets;
  const n = calls.length;
  const r2 = await archiveRun(env(kv), { ...quiet, fetchFn, head: 995_300, budget: { left: 16 } });
  assert.equal(r2.stored, 0);
  assert.equal(kv.gets, gets);
  assert.equal(calls.length, n);
});

test('only the archive nodes: thirdweb down, nothing is stored, and 48.club or a pruned publicnode is never asked', async () => {
  forgetCursors();
  const kv = kvOf();
  const down = (url, q) => (url === TW ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } } : null);
  const { calls, fetchFn } = nodes(down);
  const r = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn, head: 1_000_000, budget: { left: 16 } });
  assert.equal(r.stored, 0);
  assert.equal(kv.map.get(chunkKey(ARENA, 198)), undefined, 'never stored as empty');
  assert.ok(calls.length > 0 && calls.every((c) => c.url === TW), 'never 48.club, never publicnode');
  // without an archive node in the list, the archive does not run at all
  forgetCursors();
  const other = kvOf();
  const x = await archiveRun(env(other, { RPC_URLS: NODES.map(({ archive, ...n }) => n) }), { ...quiet, fetchFn: nodes().fetchFn, head: 1_000_000 });
  assert.match(x.skipped, /no archive node/);
  assert.equal(other.puts + other.gets, 0);
});

test('a page that failed is never stored as empty: the chunk waits, and a later run reads only what is missing', async () => {
  forgetCursors();
  const kv = kvOf();
  const failing = (url, q) => (q.method === 'eth_getLogs' && parseInt(q.params[0].fromBlock, 16) === 992_000 ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } } : null);
  const lines = [];
  const r = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, log: (s) => lines.push(s), fetchFn: nodes(failing).fetchFn, head: 1_000_000, budget: { left: 16 } });
  assert.equal(r.stored, 0);
  assert.equal(kv.map.get(chunkKey(ARENA, 198)), undefined);
  assert.ok(lines.some((s) => s.startsWith('archive: chunk 198 not complete (blocks 992000-992999')), lines.join('\n'));
  assert.equal(cursor(kv).at, 992_000, 'the two pages read are kept (with the cursor: this run started from KV)');
  // a node that answers with logs out of the page's range, another contract's, no list, or a head behind the page: not stored either
  const wrongs = [
    [(url, q) => (q.method === 'eth_getLogs' ? { jsonrpc: '2.0', id: q.id, result: [log(parseInt(q.params[0].toBlock, 16) + 1)] } : null), {}],
    [(url, q) => (q.method === 'eth_getLogs' ? { jsonrpc: '2.0', id: q.id, result: [log(parseInt(q.params[0].fromBlock, 16), '0x' + '99'.repeat(20))] } : null), {}],
    [(url, q) => (q.method === 'eth_getLogs' ? { jsonrpc: '2.0', id: q.id, result: null } : null), {}],
    [() => null, { head: 990_500 }], // the archive node far behind the judge's head: its [] would be a lie
  ];
  for (const [wrong, shape] of wrongs) {
    forgetCursors();
    const k = kvOf();
    const x = await archiveRun(env(k, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn: nodes(wrong, shape).fetchFn, head: 1_000_000, budget: { left: 16 } });
    assert.equal(x.stored, 0);
    assert.ok(![...k.map.keys()].some((key) => key.startsWith('logs:')));
  }
  // a new isolate (the pages kept in the cursor), the node well again: only the pages still missing
  forgetCursors();
  const well = nodes();
  const r2 = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn: well.fetchFn, head: 1_000_000, budget: { left: 16 } });
  assert.equal(r2.stored, 1);
  assert.deepEqual(well.calls.filter((c) => c.q.method === 'eth_getLogs').slice(0, 3).map((c) => parseInt(c.q.params[0].fromBlock, 16)), [992_000, 993_000, 994_000], 'only the pages still missing');
  assert.equal(JSON.parse(kv.map.get(chunkKey(ARENA, 198))).length, 10);
});

test('a chunk stored already (a cursor read that lagged its write) is not read again; the budget is never passed', async () => {
  forgetCursors();
  const kv = kvOf();
  kv.map.set(chunkKey(ARENA, 198), '[]');
  kv.map.set(cursorKey(ARENA), '198'); // a plain cursor, the write of the run that stored 198 not seen yet
  const { calls, fetchFn } = nodes();
  const budget = { left: 9 };
  await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn, head: 1_010_000, budget });
  assert.equal(kv.map.get(chunkKey(ARENA, 198)), '[]', 'kept as it was');
  assert.ok(!calls.some((c) => c.q.method === 'eth_getLogs' && parseInt(c.q.params[0].fromBlock, 16) < 995_000), 'its blocks not read again');
  assert.ok(budget.left >= 0, 'never past the budget');
  for (const left of [0, 1, 2, 3, 5]) {
    forgetCursors();
    const b = { left };
    const x = nodes();
    await archiveRun(env(kvOf(), { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn: x.fetchFn, head: 1_010_000, budget: b });
    assert.ok(b.left >= 0 && x.calls.length <= left, `a budget of ${left}: ${x.calls.length} requests`);
  }
});

test('thirdweb\'s burst limit: the archive sends at most ARCHIVE_BURST requests a minute with the judge\'s, and none while it cools down', async () => {
  forgetCursors();
  const kv = kvOf();
  const { calls, fetchFn } = nodes(() => null, { burst: 8 });
  // the judge sent thirdweb 4 requests this minute: 3 left (the head and two pages)
  const r = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn, head: 1_000_000, budget: { left: 16 }, spent: new Map([[TW, 4], [DS, 3]]) });
  assert.equal(calls.length, 3);
  assert.equal(r.stored, 0);
  assert.equal(cursor(kv).at, 992_000, 'two pages read, kept');
  // the judge sent it 6: nothing (a head and a page would make 8)
  const n = calls.length;
  const r2 = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn, head: 1_000_000, budget: { left: 16 }, spent: new Map([[TW, 6]]) });
  assert.match(r2.skipped, /had 6 request/);
  assert.equal(calls.length, n);
  // thirdweb failed the judge this minute (its cooldown): nothing either
  const r3 = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn, head: 1_000_000, budget: { left: 16 }, cooldowns: new Map([[TW, Date.now() + 30000]]) });
  assert.match(r3.skipped, /cools down/);
  assert.equal(calls.length, n);
  // minute after minute with the judge's 3-5 requests, under a burst limit of 8 a minute: the chunk is
  // stored over a few minutes and thirdweb never refuses
  let stored = 0;
  for (let m = 0; m < 6 && !stored; m++) {
    const x = nodes(() => null, { burst: 8 });
    const judge = 3 + (m % 3);
    const out = await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn: x.fetchFn, head: 1_000_000, budget: { left: 16 }, spent: new Map([[TW, judge]]) });
    assert.ok(x.calls.length + judge <= 7, `minute ${m}: ${x.calls.length} + ${judge}`);
    stored += out.stored;
  }
  assert.equal(stored, 1);
  assert.equal(JSON.parse(kv.map.get(chunkKey(ARENA, 198))).length, 10, 'whole, over several minutes');
});

test('a chunk read over several runs in new isolates: every page read once', async () => {
  forgetCursors();
  const kv = kvOf();
  const spent = new Map([[TW, 4]]); // two pages a run
  const pages = [];
  for (let i = 0; i < 3; i++) {
    forgetCursors(); // a new isolate each minute: the pages come back from the cursor in KV
    const x = nodes();
    await archiveRun(env(kv, { DEPLOY_BLOCK: 990_000 }), { ...quiet, fetchFn: x.fetchFn, head: 1_000_000, budget: { left: 16 }, spent });
    pages.push(...x.calls.filter((c) => c.q.method === 'eth_getLogs').map((c) => parseInt(c.q.params[0].fromBlock, 16)));
  }
  assert.deepEqual(pages.slice(0, 5), [990_000, 991_000, 992_000, 993_000, 994_000]);
  assert.equal(JSON.parse(kv.map.get(chunkKey(ARENA, 198))).length, 10);
});

test('a span of ten chunks is stored once they all are: one value for 50000 blocks', async () => {
  forgetCursors();
  const kv = kvOf();
  const deploy = 1_000_000; // span 20 starts here
  const { fetchFn } = nodes(() => null, { head: 2_000_000 });
  let spans = 0;
  for (let m = 0; m < 40 && !spans; m++) spans += (await archiveRun(env(kv, { DEPLOY_BLOCK: deploy }), { ...quiet, fetchFn, head: 1_060_000, budget: { left: 16 } })).spans;
  assert.equal(spans, 1);
  const span = JSON.parse(kv.map.get(spanKey(ARENA, 20)));
  const chunks = Array.from({ length: 10 }, (_, i) => JSON.parse(kv.map.get(chunkKey(ARENA, 200 + i)))).flat();
  assert.deepEqual(span, chunks, 'the ten chunks, in order');
  assert.equal(span.length, 100);
});

test('a day of the chain costs about 50 KV writes a ring, and a three-day backfill about 1.2 a chunk', async (t) => {
  forgetCursors();
  const kv = kvOf();
  const { fetchFn } = nodes(() => null, { head: 10 ** 9 });
  const start = 1_000_000;
  let stored = 0;
  for (let m = 0; m < 24 * 60; m++) {
    const r = await archiveRun(env(kv, { DEPLOY_BLOCK: start }), { ...quiet, fetchFn, head: start + 134 * m, budget: { left: 16 }, spent: new Map([[TW, 3 + (m % 4)]]) });
    stored += r.stored;
  }
  const chunks = Math.floor((start + 134 * 1439 - ARCHIVE_MARGIN + 1) / CHUNK) - Math.floor(start / CHUNK);
  assert.ok(stored >= chunks - 1, `every final chunk stored once (${stored} of ${chunks}; the last one may still be on its way)`);
  assert.ok(kv.puts <= 1.5 * chunks + 4 && kv.puts <= 70, `${kv.puts} writes`);
  t.diagnostic(`a day: ${stored} chunks, ${kv.puts} KV writes, ${kv.gets} KV reads`);
  // the namespace created three days after the deployment: the backlog, at a few pages a minute
  forgetCursors();
  const late = kvOf();
  const head = start + 3 * 24 * 60 * 134;
  let minutes = 0;
  let next = 0;
  const target = () => Math.floor((head + minutes * 134 - ARCHIVE_MARGIN + 1) / CHUNK) - 1;
  for (; minutes < 1000 && next < target(); minutes++) next = (await archiveRun(env(late, { DEPLOY_BLOCK: start }), { ...quiet, fetchFn, head: head + minutes * 134, budget: { left: 16 }, spent: new Map([[TW, 3 + (minutes % 4)]]) })).next ?? next;
  const backlog = next - Math.floor(start / CHUNK);
  t.diagnostic(`a three-day backfill: ${backlog} chunks in ${minutes} minutes, ${late.puts} KV writes`);
  assert.ok(minutes < 600, `caught up in ${minutes} minutes`);
  assert.ok(late.puts <= 1.3 * backlog, `${late.puts} writes for ${backlog} chunks`);
});

test('the cron: the archive after the judge, with what is left of the invocation\'s 50 subrequests', async () => {
  forgetCursors();
  const kv = kvOf();
  const { calls, fetchFn } = nodes();
  const real = globalThis.fetch;
  globalThis.fetch = fetchFn; // (the fakes answer with json() only, as rpc.js takes them)
  const waits = [];
  try {
    // no judge key here: the archive alone, at most ARCHIVE_BUDGET (16) subrequests
    await host.scheduled({}, env(kv, { DEPLOY_BLOCK: 990_000, ARCHIVE_MARGIN: 200 }), { waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  } finally {
    globalThis.fetch = real;
  }
  assert.ok(kv.map.has(chunkKey(ARENA, 198)), 'stored from the cron');
  assert.ok(calls.length + kv.gets + kv.puts <= 16);
  assert.ok(calls.length <= 7 && calls.every((c) => c.url === TW));
});

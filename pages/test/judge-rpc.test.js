// The judge over several nodes (judge-cron.js + rpc.js): a rate-limited node changes nothing it sends,
// the nonce pair comes from one node, a send that went through is never counted as a failure, the
// log reads stay behind the head in requests a 1000-block node serves and never need publicnode, a fight
// an outage left out is found by the catch-up walk (from the nodes or the KV archive), a run without
// its live window is degraded (it never closes a season), a season closes only after a full read, and
// the runs stay inside the subrequest budget (measured: an idle run, a draw of 16 fights, 8 judgements).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRun, STARTED, JUDGED, DRAWN, LOCKED, ENDED, HEAD_MARGIN } from '../src/judge-cron.js';
import { chunkKey } from '../src/archive.js';
import { arenaKeys } from '../src/keys.js';
import { keccak256 } from '../src/keccak.js';
import { planOf, PLAN_VERSION } from '../src/plan.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const JUDGE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil key #1
const JUDGE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const KEYS = arenaKeys('11'.repeat(32));
const BOOK = '0x' + 'b0'.repeat(20);
const CERT = '0x' + 'ce'.repeat(20);
const DS = 'https://dataseed.test'; // calls and sends, no logs
const PN = 'https://publicnode.test'; // logs up to 50000 blocks
const CLUB = 'https://club.test'; // logs up to 250 blocks, never a sender
const NODES = [{ url: DS, logs: 0, send: true }, { url: PN, logs: 50000, send: true }, { url: CLUB, logs: 250, send: false }];
const ENV = { RPC_URL: PN, RPC_URLS: NODES, ARENA, CHAIN_ID: 56, DEPLOY_BLOCK: 0, BLOCKS_PER_WEEK: 1343552, SECRET: '11'.repeat(32), JUDGE_KEY };
const sel = (sig) => keccak256(Buffer.from(sig).toString('hex')).slice(2, 10);
const DRAW = sel('draw()');
const LOCK = sel('lockTraps(address[],uint32[],bytes32[])');
const JUDGE_FIGHT = sel('judgeFight(address,uint32,bytes32[12],bytes32,uint8[36],bytes32)');
const CLOSE = sel('close()');
const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
const agent = (i) => '0x' + i.toString(16).padStart(2, '0').repeat(20);
const seedOf = (i) => '0x' + (0x50 + i).toString(16).repeat(32);
const WINDOW = 134 * 20; // twenty minutes of blocks at 1343552 a week: 2680

/** fightOf words: a fight `over` (finished, five rounds answered, its plan locked) or fresh (drawn just
 *  now, its bell ahead, no plan locked). */
function fightWords(a, n, seed, { over = false, opponent = '0', oppNumber = 0, clockAt = 100050 } = {}) {
  const locked = over ? KEYS.trapsCommit(planOf(KEYS.cardSeed(seed)).traps, KEYS.trapSalt(ARENA, seed)) : '0';
  const f = over
    ? [seed, 'a', '64', '0', n.toString(16), '0', '5', '0', '0', 'a', '0', '0', '0', KEYS.commitment(ARENA, a, n), opponent, '1', oppNumber.toString(16), '1', locked]
    : [seed, 'a', '0', '0', n.toString(16), '0', '1', '0', '0', clockAt.toString(16), '0', '0', '0', KEYS.commitment(ARENA, a, n), opponent, '1', oppNumber.toString(16), '1', locked];
  return '0x' + [...f.map(word), word('0'), word('0'), word('1')].join(''); // name, season 1
}
const startedLog = (a, n, seed, block, opponent = '0') => ({ address: ARENA, topics: [STARTED, '0x' + word(a), '0x' + word(n.toString(16)), '0x' + word(opponent)], data: '0x' + word(seed) + word('0').repeat(4), blockNumber: '0x' + block.toString(16) });

/**
 * A fake chain behind fake nodes. The chain: season 1 judged by JUDGE (ending at `seasonEnd`), `fights`
 * by "agent#n", Started/Judged `logs`; with `hall` 2 and a draw due the judge seals, then holds the
 * draw, whose receipt carries `drawn` (Started logs, added to the chain's logs unless `receiptOnly`).
 * The nodes: `nodes[url]` -> { limitEvery, noLogs, logCap, refuse(q), down, burst (HTTP 429 past that
 * many requests in the run: thirdweb's burst limit) } shape how each answers.
 */
function world({ fights = {}, logs = [], head = 10000, now = 100000, seasonEnd = 10 ** 12, hall = 0, drawn = [], receiptOnly = false, nonces = {}, sendErrors = {}, views = {} } = {}, nodes = {}) {
  const w = { sent: [], calls: [], receipts: new Map(), logs: [...logs], cutoff: 0, mined: new Set() };
  const answer = (url, q) => {
    const p = q.params?.[0];
    switch (q.method) {
      case 'eth_getBalance': return '0x' + (10n ** 18n).toString(16);
      case 'eth_call': {
        const d = p.data;
        if (views[d.slice(0, 10)] !== undefined) return '0x' + word(views[d.slice(0, 10)].toString(16));
        if (d.startsWith('0xfda7b9db')) return '0x' + word(BOOK);
        if (d.startsWith('0x715f8fe8')) return '0x' + word('1');
        if (d.startsWith('0x6ebaeda9')) return '0x' + [word('0'), word(seasonEnd.toString(16)), word(JUDGE), word(KEYS.commit), word(CERT)].join('');
        if (d.startsWith('0xbcb39621')) return '0x' + word(now < seasonEnd ? '1' : '0');
        if (d.startsWith('0x32799e5d')) return fights[`0x${d.slice(34, 74)}#${parseInt(d.slice(74), 16)}`] ?? '0x' + word('0').repeat(22);
        if (d.startsWith('0xee5f8c8f')) return '0x' + word('3c'); // roundTime()
        if (d.startsWith('0xef92e6ba')) return '0x' + word(w.cutoff.toString(16)); // pendingCutoff()
        if (d.startsWith('0x748e1910')) return '0x' + word(hall ? (1000).toString(16) : '0'); // nextDrawAt()
        if (d.startsWith('0xb5c81661')) return '0x' + word(hall.toString(16)); // hallCount()
        return '0x' + word('0'); // seedBlock(), closedAt() and the rest
      }
      case 'eth_getTransactionCount': return '0x' + ((nonces[url] ?? {})[q.params[1]] ?? 5).toString(16);
      case 'eth_blockNumber': return '0x' + head.toString(16);
      case 'eth_getBlockByNumber': return { number: '0x' + head.toString(16), timestamp: '0x' + now.toString(16) };
      case 'eth_getLogs': {
        const from = parseInt(p.fromBlock, 16);
        const to = p.toBlock === 'latest' ? head : parseInt(p.toBlock, 16);
        const topics = [p.topics[0]].flat();
        return w.logs.filter((l) => topics.includes(l.topics[0]) && parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to);
      }
      case 'eth_estimateGas': return '0x30000';
      case 'eth_gasPrice': return '0x5f5e100';
      case 'eth_sendRawTransaction': {
        const raw = q.params[0];
        const hash = keccak256(raw);
        if (w.mined.has(hash)) throw Object.assign(new Error('nonce too low'), { code: -32000 });
        w.mined.add(hash);
        w.sent.push(raw);
        let receiptLogs = [];
        if (raw.includes(DRAW)) {
          if (!w.cutoff) w.cutoff = 1; // sealed
          else {
            w.cutoff = 0; // held: the drawn fights start
            receiptLogs = drawn;
            if (!receiptOnly) w.logs.push(...drawn);
          }
        }
        w.receipts.set(hash, { status: '0x1', logs: receiptLogs });
        if (sendErrors[url]) throw Object.assign(new Error(sendErrors[url]), { code: -32000 });
        return hash;
      }
      case 'eth_getTransactionReceipt': return w.receipts.get(q.params[0]) ?? null;
      case 'eth_getTransactionByHash': return w.mined.has(q.params[0]) ? { hash: q.params[0] } : null;
      default: throw new Error('unexpected ' + q.method);
    }
  };
  const counts = {};
  w.fetchFn = async (url, init) => {
    const body = JSON.parse(init.body);
    const o = nodes[url] ?? {};
    w.calls.push({ url, body });
    counts[url] = (counts[url] ?? 0) + 1;
    const reply = (x) => ({ json: async () => x });
    const fail = (q, code, message) => ({ jsonrpc: '2.0', id: q?.id ?? null, error: { code, message } });
    if (o.down || (o.burst && counts[url] > o.burst)) return { status: 429, json: async () => { throw new SyntaxError('<html>'); } };
    if (o.limitEvery && counts[url] % o.limitEvery === 0) return reply(fail(Array.isArray(body) ? null : body, -32005, 'rate limit exceeded'));
    const one = (q) => {
      const r = o.refuse?.(q);
      if (r) return r;
      if (q.method === 'eth_getLogs') {
        const p = q.params[0];
        if (o.noLogs) return fail(q, -32005, 'limit exceeded');
        const span = (p.toBlock === 'latest' ? head : parseInt(p.toBlock, 16)) - parseInt(p.fromBlock, 16) + 1;
        if (o.logCap && span > o.logCap) return fail(q, -32005, `block range limited to ${o.logCap}`);
      }
      try {
        return { jsonrpc: '2.0', id: q.id, result: answer(url, q) };
      } catch (e) {
        return fail(q, e.code ?? -32000, e.message);
      }
    };
    if (o.http) {
      const status = o.http(body);
      if (status) return { status, json: async () => { throw new SyntaxError('<html>'); } };
    }
    return reply(Array.isArray(body) ? body.map(one) : one(body));
  };
  return w;
}

const NODE_SHAPES = { [DS]: { noLogs: true }, [PN]: { logCap: 50000 }, [CLUB]: { logCap: 250 } };
const run = async (w, env = {}) => {
  const lines = [];
  const r = await judgeRun({ ...ENV, ...env }, { fetchFn: w.fetchFn, log: (s) => lines.push(s), wait: async () => {} });
  return { r, lines };
};
const getLogs = (w) => w.calls.filter((c) => !Array.isArray(c.body) && c.body.method === 'eth_getLogs').map((c) => ({ url: c.url, ...c.body.params[0] }));

/** A busy minute: a draw due (two in the hall), whose hold starts a fresh match (C#1 vs D#1), and an
 *  earlier fight over and unjudged (A#1). */
function busy() {
  const A = agent(0xa1);
  const C = agent(0xc1);
  const D = agent(0xd1);
  const fights = {
    [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }),
    [`${C}#1`]: fightWords(C, 1, seedOf(2), { opponent: D.slice(2), oppNumber: 1 }),
    [`${D}#1`]: fightWords(D, 1, seedOf(2), { opponent: C.slice(2), oppNumber: 1 }),
  };
  return { A, C, D, opts: { fights, hall: 2, logs: [startedLog(A, 1, seedOf(1), 8000)], drawn: [startedLog(C, 1, seedOf(2), 10000, D), startedLog(D, 1, seedOf(2), 10000, C)] } };
}

test('a node rate-limited on every second call changes nothing the judge sends', async () => {
  const clean = world(busy().opts, NODE_SHAPES);
  const { r } = await run(clean);
  assert.equal(r.sent, 4, 'seal, hold, the lock of the fresh match, the judgement of A#1');
  assert.ok(clean.sent[0].includes(DRAW) && clean.sent[1].includes(DRAW) && clean.sent[2].includes(LOCK) && clean.sent[3].includes(JUDGE_FIGHT));
  const flaky = world(busy().opts, { ...NODE_SHAPES, [DS]: { noLogs: true, limitEvery: 2 } });
  const { r: r2, lines } = await run(flaky);
  assert.deepEqual(flaky.sent, clean.sent, 'the very same transactions, in the same order');
  assert.equal(r2.confirmed, 4);
  assert.ok(lines.some((s) => /^rpc: dataseed\.test \d+ ok \d+ failed \(rate limit \d+\)/.test(s)), 'one summary line of the nodes');
  assert.ok(!flaky.calls.some((c) => c.url === CLUB && !Array.isArray(c.body) && c.body.method === 'eth_sendRawTransaction'), 'never a send to the MEV relay');
});


// ------------------------------------------------------------------ the mainnet shape of the nodes

const TW = 'https://thirdweb.test'; // logs up to 1000 blocks, an archive, never a sender here
// as measured from Cloudflare: the dataseed serves everything but logs, thirdweb and 48.club serve
// logs, publicnode answers HTTP 429 (here: always)
const MAIN = [{ url: DS, logs: 0, send: true }, { url: TW, logs: 1000, send: false, archive: true }, { url: CLUB, logs: 250, send: false }, { url: PN, logs: 50000, send: true }];
const MAIN_SHAPES = { [DS]: { noLogs: true }, [TW]: { logCap: 1000 }, [CLUB]: { logCap: 250 }, [PN]: { down: true } };
// as the mainnet envs are set: the calendar and the seasons' certificates named, read in the first batch
const MAIN_ENV = { RPC_URLS: MAIN, LOG_UNIT: 1000, SEASON_BOOK: BOOK, SEASONS: { 1: { plan: PLAN_VERSION, certificate: CERT } } };
const PER_MIN = 134; // blocks a minute at 1343552 a week, rounded up as the judge does
const LIVE = PER_MIN * 22;
const SEED_BLOCK = '0x' + sel('seedBlock()');
const DRAWS = '0x' + sel('draws()');
const hexOf = (n) => '0x' + n.toString(16);
const drawnLog = (d, block) => ({ address: ARENA, topics: [DRAWN, '0x' + word(d.toString(16))], data: '0x' + word('0').repeat(5), blockNumber: hexOf(block) });
const endedLog = (a, n, block) => ({ address: ARENA, topics: [ENDED, '0x' + word(a), '0x' + word(n.toString(16))], data: '0x' + word('5') + word('64'), blockNumber: hexOf(block) });
const judgedLog = (a, n, block) => ({ address: ARENA, topics: [JUDGED, '0x' + word(a), '0x' + word(n.toString(16))], data: '0x', blockNumber: hexOf(block) });
const lockedLog = (a, n, block) => ({ address: ARENA, topics: [LOCKED, '0x' + word(a), '0x' + word(n.toString(16))], data: '0x' + word('1'), blockNumber: hexOf(block) });
const judgedIn = (w, a) => w.sent.some((tx) => tx.includes(JUDGE_FIGHT) && tx.includes(a.slice(2)));
const lockOf = (w) => w.sent.find((tx) => tx.includes(LOCK));

/** A fake KV namespace (the archive): its reads and writes counted. */
function kvOf(entries = {}) {
  const map = new Map(Object.entries(entries));
  const kv = { gets: 0, puts: 0, map, get: async (k) => (kv.gets++, map.get(k) ?? null), put: async (k, v) => (kv.puts++, void map.set(k, v)) };
  return kv;
}

/** `pairs` matches (2 fights each), over, judged by nobody yet, both Started at `block` (seeds from `seed0`). */
function matchesOver(pairs, block, seed0 = 10) {
  const fights = {};
  const logs = [];
  for (let i = 0; i < pairs; i++) {
    const a = agent(0x40 + 2 * i);
    const b = agent(0x41 + 2 * i);
    const seed = seedOf(seed0 + i);
    fights[`${a}#1`] = fightWords(a, 1, seed, { over: true, opponent: b.slice(2), oppNumber: 1 });
    fights[`${b}#1`] = fightWords(b, 1, seed, { over: true, opponent: a.slice(2), oppNumber: 1 });
    logs.push(startedLog(a, 1, seed, block, b), startedLog(b, 1, seed, block, a));
  }
  return { fights, logs };
}

test('the nonce pair always travels in one batch from one node: pending and latest never come from two nodes', async () => {
  // the dataseed answers the pending count and rate-limits the mined one; publicnode has both, equal.
  // Mixed, they would read 6 > 5: a transaction "stuck" that is not, and a replacement.
  const w = world({ nonces: { [DS]: { pending: 6, latest: 5 }, [PN]: { pending: 6, latest: 6 } } }, {
    ...NODE_SHAPES,
    [DS]: { noLogs: true, refuse: (q) => (q.method === 'eth_getTransactionCount' && q.params[1] === 'latest' ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } } : null) },
  });
  const { r } = await run(w);
  assert.equal(r.waiting, false, 'nothing stuck');
  assert.equal(w.sent.length, 0, 'no replacement');
  const counts = w.calls.filter((c) => (Array.isArray(c.body) ? c.body : [c.body]).some((q) => q.method === 'eth_getTransactionCount'));
  for (const c of counts) {
    assert.ok(Array.isArray(c.body), 'always in a batch');
    assert.deepEqual(c.body.filter((q) => q.method === 'eth_getTransactionCount').map((q) => q.params[1]), ['pending', 'latest'], 'always as a pair');
  }
  assert.equal(counts.at(-1).url, PN, 'the answer used came from one node');
});

test('a fight only in the hold receipt is locked; the newest blocks are read only when another sender just held a draw', async () => {
  const b = busy();
  const w = world({ ...b.opts, receiptOnly: true }, NODE_SHAPES);
  await run(w);
  const lock = lockOf(w);
  assert.ok(lock, 'the fresh match is locked although no node has its Started events yet');
  assert.ok(lock.includes(KEYS.trapsCommit(planOf(KEYS.cardSeed(seedOf(2))).traps, KEYS.trapSalt(ARENA, seedOf(2))).slice(2)));
  assert.ok(!getLogs(w).some((s) => s.toBlock === 'latest'), 'the judge held it itself: nothing read past the margin');

  // another sender held a draw 10 blocks ago (sealed 12 blocks ago): its events are behind the margin
  const head = 10000;
  const C = agent(0xc1);
  const D = agent(0xd1);
  const fights = { [`${C}#1`]: fightWords(C, 1, seedOf(2), { opponent: D.slice(2), oppNumber: 1 }), [`${D}#1`]: fightWords(D, 1, seedOf(2), { opponent: C.slice(2), oppNumber: 1 }) };
  const at = (block) => [startedLog(C, 1, seedOf(2), block, D), startedLog(D, 1, seedOf(2), block, C), drawnLog(1, block)];
  const v = world({ head, fights, logs: at(head - 10), views: { [SEED_BLOCK]: head - 12, [DRAWS]: 1 } }, NODE_SHAPES);
  await run(v);
  const newest = getLogs(v).filter((s) => s.toBlock === 'latest');
  assert.equal(newest.length, 1, 'the newest blocks, once');
  assert.equal(parseInt(newest[0].fromBlock, 16), head - HEAD_MARGIN + 1);
  assert.ok(lockOf(v), 'and its match is locked before its bell');
  // the same draw an earlier minute (its Drawn event in the live window): no read past the margin
  const u = world({ head, fights, logs: at(head - 200), views: { [SEED_BLOCK]: head - 202, [DRAWS]: 1 } }, NODE_SHAPES);
  await run(u);
  assert.ok(!getLogs(u).some((s) => s.toBlock === 'latest'));
  assert.ok(lockOf(u), 'locked from the live window');
  // a match locked already (its TrapsLocked events in the window) is not read again
  const t = world({ head, fights, logs: [...at(head - 200), lockedLog(C, 1, head - 150), lockedLog(D, 1, head - 150)], views: { [SEED_BLOCK]: head - 202, [DRAWS]: 1 } }, NODE_SHAPES);
  await run(t);
  assert.ok(!lockOf(t));
  assert.ok(!t.calls.some((c) => Array.isArray(c.body) && c.body.some((q) => q.method === 'eth_call' && q.params[0].data.startsWith('0x32799e5d'))), 'no fight read');
});

test('every log read stays HEAD_MARGIN behind the head, in requests of LOG_UNIT blocks, and none needs publicnode', async () => {
  const head = 500000;
  const cases = [['thirdweb', MAIN_SHAPES, TW, 1000], ['thirdweb down: 48.club in pieces', { ...MAIN_SHAPES, [TW]: { down: true } }, CLUB, 250]];
  for (const [what, shapes, node, width] of cases) {
    const w = world({ head }, shapes);
    const { r } = await run(w, MAIN_ENV);
    assert.equal(r.degraded, false, what);
    const reads = getLogs(w).filter((s) => s.url !== TW || node === TW); // (a down thirdweb is asked once)
    for (const s of reads) {
      assert.ok(parseInt(s.toBlock, 16) <= head - HEAD_MARGIN, what);
      assert.ok(parseInt(s.toBlock, 16) - parseInt(s.fromBlock, 16) + 1 <= width, what);
      assert.equal(s.url, node, what);
    }
    const live = reads.filter((s) => parseInt(s.fromBlock, 16) >= head - LIVE);
    assert.equal(Math.min(...live.map((s) => parseInt(s.fromBlock, 16))), head - LIVE, `${what}: the live window from 22 minutes back`);
    assert.equal(Math.max(...live.map((s) => parseInt(s.toBlock, 16))), head - HEAD_MARGIN, what);
    assert.ok(!getLogs(w).some((s) => s.url === PN), `${what}: no log read from publicnode`);
  }
});

test('no log node reads the live window: a degraded run judges what it read and never closes the season', async () => {
  const head = 500000;
  const A = agent(0xa1);
  const B = agent(0xb1);
  const fights = { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }), [`${B}#1`]: fightWords(B, 1, seedOf(3), { over: true }) };
  const logs = [startedLog(A, 1, seedOf(1), head - 2000), startedLog(B, 1, seedOf(3), head - 9000)]; // A in the live window, B older
  const opts = { head, fights, logs, now: 100000, seasonEnd: 500 }; // the season is over: its close is due
  const clean = world(opts, MAIN_SHAPES);
  const { r: ok, lines: okLines } = await run(clean, MAIN_ENV);
  assert.equal(ok.degraded, false);
  assert.equal(ok.full, true, 'a close is due: the run reads the whole look-back window');
  assert.ok(okLines.some((s) => /^scan: .*\(full\)$/.test(s)));
  assert.ok(judgedIn(clean, A) && judgedIn(clean, B), 'both judged (B from the look-back window)');
  assert.ok(!clean.sent.some((tx) => tx.includes(CLOSE)), 'fights judged in this run: the close waits for a run with nothing left');

  // the live window's second request fails on every log node
  const failing = (q) => (q.method === 'eth_getLogs' && parseInt(q.params[0].fromBlock, 16) >= head - LIVE + 1000 && parseInt(q.params[0].fromBlock, 16) < head - LIVE + 2000 ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'limit exceeded' } } : null);
  const shapes = { ...MAIN_SHAPES, [TW]: { logCap: 1000, refuse: failing }, [CLUB]: { logCap: 250, refuse: failing } };
  const w = world(opts, shapes);
  const { r, lines } = await run(w, MAIN_ENV);
  assert.equal(r.degraded, true);
  assert.ok(lines.some((s) => s.startsWith('degraded run:')));
  assert.ok(judgedIn(w, A), 'what it read is judged');
  assert.ok(!w.sent.some((tx) => tx.includes(CLOSE)));
  // everything judged, the window still not readable: still no close
  const later = world({ ...opts, fights: {} }, shapes);
  const { r: r3 } = await run(later, MAIN_ENV);
  assert.equal(r3.degraded, true);
  assert.equal(r3.closed, false);
  // and a clean full run with nothing left closes it
  const done = world({ ...opts, fights: {}, logs: [] }, MAIN_SHAPES);
  assert.equal((await run(done, MAIN_ENV)).r.closed, true);
  // a catch-up step that fails is not degraded: it is read again by a later step
  const deepFails = (q) => (q.method === 'eth_getLogs' && parseInt(q.params[0].toBlock, 16) < head - LIVE ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'limit exceeded' } } : null);
  const quiet = world({ head }, { ...MAIN_SHAPES, [TW]: { logCap: 1000, refuse: deepFails }, [CLUB]: { down: true } });
  const { r: r4, lines: l4 } = await run(quiet, MAIN_ENV);
  assert.equal(r4.degraded, false);
  assert.ok(l4.some((s) => s.startsWith('catch-up: blocks')));
});

test('a full run reads the archive for the stored part of the look-back window; a chunk not stored comes from the nodes', async () => {
  const head = 500000;
  const B = agent(0xb1);
  const old = startedLog(B, 1, seedOf(3), 485123);
  const kv = kvOf({ [chunkKey(ARENA, 97)]: JSON.stringify([old]) }); // blocks 485000-489999 stored
  const w = world({ head, fights: { [`${B}#1`]: fightWords(B, 1, seedOf(3), { over: true }) }, logs: [], now: 100000, seasonEnd: 500 }, MAIN_SHAPES);
  const { r } = await run(w, { ...MAIN_ENV, HISTORY: kv });
  assert.equal(r.full, true);
  assert.ok(judgedIn(w, B), 'the fight only the archive has is judged');
  const reads = getLogs(w);
  assert.ok(!reads.some((s) => parseInt(s.fromBlock, 16) <= 489999 && parseInt(s.toBlock, 16) >= 485000), 'the stored chunk is not read from the nodes');
  assert.ok(reads.some((s) => parseInt(s.fromBlock, 16) === 480000), 'the chunks not stored are');
  assert.ok(kv.gets >= 4, 'one KV read per chunk of the window');
});

/**
 * Runs the judge once a minute for `minutes` minutes after an outage: the chain's head moves 134 blocks
 * a minute, the fights stay over and unjudged (the fake chain does not record judgements). Returns, per
 * agent, the first minute in which it was judged.
 */
async function afterOutage(fightsAt, minutes, env = MAIN_ENV, shapes = MAIN_SHAPES) {
  const head0 = 2_000_000;
  const fights = {};
  const logs = [];
  for (const [i, ageMinutes] of fightsAt.entries()) {
    const a = agent(0x60 + i);
    fights[`${a}#1`] = fightWords(a, 1, seedOf(20 + i), { over: true });
    logs.push(startedLog(a, 1, seedOf(20 + i), head0 - ageMinutes * PER_MIN));
  }
  const found = new Map();
  let most = 0;
  for (let m = 0; m < minutes && found.size < fightsAt.length; m++) {
    const gets = env.HISTORY?.gets ?? 0;
    const w = world({ head: head0 + m * PER_MIN, now: 6_000_000 + 60 * m, fights, logs }, shapes);
    await run(w, env);
    most = Math.max(most, w.calls.length + (env.HISTORY?.gets ?? 0) - gets);
    for (const k of Object.keys(fights)) {
      const a = k.split('#')[0];
      if (!found.has(a) && judgedIn(w, a)) found.set(a, m);
    }
  }
  return { found, most, agents: fightsAt.map((_, i) => agent(0x60 + i)) };
}

test('fights an outage left out are found: 5, 30 and 120 minutes without a run', async (t) => {
  // the fights over by the time the runs come back: drawn during the outage or up to 15 minutes before it
  const cases = { 5: [16, 18, 20], 30: [16, 25, 35, 45], 120: [16, 40, 70, 100, 135] };
  for (const [outage, ages] of Object.entries(cases)) {
    const { found, most, agents } = await afterOutage(ages, 240);
    for (const [i, a] of agents.entries()) assert.ok(found.has(a), `${outage} min outage: the fight drawn ${ages[i]} minutes before the runs came back is judged`);
    const worst = Math.max(...found.values());
    t.diagnostic(`outage ${outage} min, no archive: every fight judged within ${worst + 1} run(s) (most subrequests in a run: ${most})`);
    assert.ok(most <= 45);
    if (outage === '5') assert.equal(worst, 0, 'the live window holds them all');
  }
  // with the archive (every chunk final when the runs come back stored, with its logs): the walk reads
  // one stored chunk a step; a fight drawn ten hours before is found there too
  const kv = kvOf();
  const head0 = 2_000_000;
  const ages = [16, 40, 70, 100, 135, 600];
  const started = ages.map((age, i) => startedLog(agent(0x60 + i), 1, seedOf(20 + i), head0 - age * PER_MIN));
  for (let c = Math.floor((head0 - 24 * 60 * PER_MIN) / 5000); (c + 1) * 5000 - 1 <= head0 - 200; c++) {
    kv.map.set(chunkKey(ARENA, c), JSON.stringify(started.filter((l) => Math.floor(parseInt(l.blockNumber, 16) / 5000) === c)));
  }
  const { found, most, agents } = await afterOutage(ages, 240, { ...MAIN_ENV, HISTORY: kv });
  for (const [i, x] of agents.entries()) assert.ok(found.has(x), `with the archive: the fight drawn ${ages[i]} minutes before is judged`);
  t.diagnostic(`outages up to 10 hours, with the archive: every fight judged within ${Math.max(...found.values()) + 1} run(s) (most subrequests in a run: ${most})`);
});

test('subrequests of a run (Workers Free: 50 an invocation): idle, holding a draw of 16 fights, judging 8 fights', async (t) => {
  const head = 3_000_000;
  const counts = {};
  // idle: nobody in the hall, no fight anywhere
  // the four minutes of the catch-up cycle: the newest slice, the near walk, the whole walk, the near walk
  for (const phase of [0, 1, 2, 3]) {
    const w = world({ head, now: 6_000_000 + 60 * phase }, MAIN_SHAPES);
    await run(w, MAIN_ENV);
    counts[`idle, minute ${phase} of the cycle`] = w.calls.length;
  }
  // with the archive: every chunk stored but the newest one (the archive keeps 200 blocks behind the head)
  for (const phase of [1, 2, 3]) {
    const kv = kvOf();
    for (let c = Math.floor((head - 24 * 60 * PER_MIN) / 5000); (c + 1) * 5000 - 1 <= head - 200; c++) kv.map.set(chunkKey(ARENA, c), '[]');
    const w = world({ head, now: 6_000_000 + 60 * phase }, MAIN_SHAPES);
    await run(w, { ...MAIN_ENV, HISTORY: kv });
    counts[`idle with the archive, minute ${phase} of the cycle (KV reads counted)`] = w.calls.length + kv.gets;
  }
  // a draw of 32 agents (16 fights: 16 Started events in the hold's receipt), their plans locked in the same run
  {
    const fights = {};
    const drawn = [];
    for (let i = 0; i < 8; i++) {
      const a = agent(0x10 + 2 * i);
      const b = agent(0x11 + 2 * i);
      fights[`${a}#1`] = fightWords(a, 1, seedOf(30 + i), { opponent: b.slice(2), oppNumber: 1, clockAt: 6_000_060 });
      fights[`${b}#1`] = fightWords(b, 1, seedOf(30 + i), { opponent: a.slice(2), oppNumber: 1, clockAt: 6_000_060 });
      drawn.push(startedLog(a, 1, seedOf(30 + i), head - 1, b), startedLog(b, 1, seedOf(30 + i), head - 1, a));
    }
    const w = world({ head, now: 6_000_000, fights, hall: 32, drawn }, MAIN_SHAPES);
    const { r, lines } = await run(w, MAIN_ENV);
    assert.ok(r.drew);
    const lock = lockOf(w);
    // one corner per match: the contract locks both with the one hash
    assert.ok(lock && drawn.filter((_, i) => i % 2 === 0).every((l) => lock.includes(l.topics[1].slice(26))), 'every match of the draw locked in one transaction');
    assert.ok(lines.some((s) => /^lock the trap plans of 8 fight\(s\): sent/.test(s)));
    counts['seal and hold a draw of 16 fights, lock them'] = w.calls.length;
  }
  // 8 fights (4 matches) over in the live window
  {
    const { fights, logs } = matchesOver(4, head - 2000);
    const w = world({ head, now: 6_000_000, fights, logs }, MAIN_SHAPES);
    const { r } = await run(w, MAIN_ENV);
    assert.equal(r.judged, 8);
    assert.equal(r.confirmed, 8);
    counts['judge 8 fights'] = w.calls.length;
  }
  // and the most a run may judge (MAX_PER_RUN 16), with the dataseed rate-limiting every fifth request
  {
    const { fights, logs } = matchesOver(8, head - 2000);
    const w = world({ head, now: 6_000_000, fights, logs }, { ...MAIN_SHAPES, [DS]: { noLogs: true, limitEvery: 5 } });
    const { r } = await run(w, MAIN_ENV);
    assert.equal(r.judged, 16);
    counts['judge 16 fights, the dataseed rate-limiting every fifth request'] = w.calls.length;
  }
  for (const [name, n] of Object.entries(counts)) {
    t.diagnostic(`${name}: ${n} subrequests`);
    assert.ok(n <= 45, `${name}: ${n}`);
  }
  assert.ok(counts['idle, minute 0 of the cycle'] <= 5 && counts['idle, minute 2 of the cycle'] <= 8);
});

test('a run past its budget stops cleanly: never past it, the rest left for the next run', async () => {
  const { fights, logs } = matchesOver(8, 3_000_000 - 2000);
  const w = world({ head: 3_000_000, now: 6_000_000, fights, logs }, MAIN_SHAPES);
  const { r, lines } = await run(w, { ...MAIN_ENV, SUBREQ_BUDGET: 18 });
  assert.ok(w.calls.length <= 18, `${w.calls.length} requests for a budget of 18`);
  assert.ok(r.judged > 0 && r.judged < 16, 'some judged, the rest next run');
  assert.equal(r.confirmed, r.sent, 'every receipt read');
  assert.ok(lines.some((s) => /subrequests are spent/.test(s)));
  const tight = world({ head: 3_000_000, now: 6_000_000, fights, logs }, MAIN_SHAPES);
  await run(tight, { ...MAIN_ENV, SUBREQ_BUDGET: 4 }).catch(() => {});
  assert.ok(tight.calls.length <= 4, `${tight.calls.length} requests for a budget of 4`);
});

test('a fight still running is not read; one that ended early (its Ended event) is judged at once', async () => {
  const head = 3_000_000;
  const A = agent(0xa1);
  const B = agent(0xb1);
  const fights = { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }), [`${B}#1`]: fightWords(B, 1, seedOf(3), { over: true }) };
  // both drawn three minutes ago (no fight can be over by its clock yet: the countdown, eleven breaks and
  // a last round take 3 min 50 s at least), their plans locked; only A has finished (Ended)
  const drawnAt = head - 3 * PER_MIN;
  const logs = [startedLog(A, 1, seedOf(1), drawnAt), startedLog(B, 1, seedOf(3), drawnAt), lockedLog(A, 1, drawnAt + 20), lockedLog(B, 1, drawnAt + 20), endedLog(A, 1, head - 100)];
  const w = world({ head, now: 6_000_000, fights, logs }, MAIN_SHAPES);
  await run(w, MAIN_ENV);
  assert.ok(judgedIn(w, A));
  assert.ok(!judgedIn(w, B), 'B is still running: not read, not judged');
  const reads = w.calls.filter((c) => Array.isArray(c.body)).flatMap((c) => c.body).filter((q) => q.method === 'eth_call' && q.params[0].data.startsWith('0x32799e5d'));
  assert.ok(!reads.some((q) => q.params[0].data.includes(B.slice(2))));
  // judged fights (their Judged events) are never read again
  const v = world({ head, now: 6_000_000, fights, logs: [...logs, judgedLog(A, 1, head - 50)] }, MAIN_SHAPES);
  await run(v, MAIN_ENV);
  assert.ok(!judgedIn(v, A));
});

test('the hourly guard counts the Judged events of the live window, scaled to its length', async () => {
  const head = 3_000_000;
  const { fights, logs } = matchesOver(2, head - 2000);
  // 240 an hour: 89 in a 22-minute window; 89 judged already
  const many = Array.from({ length: 89 }, (_, i) => judgedLog(agent(0x80), 100 + i, head - 1000));
  const w = world({ head, now: 6_000_000, fights, logs: [...logs, ...many] }, MAIN_SHAPES);
  const { r, lines } = await run(w, MAIN_ENV);
  assert.equal(r.limited, true);
  assert.equal(r.judged, 0);
  assert.ok(lines.some((s) => s.startsWith('hourly limit reached: 89 judgements in the last 22 minutes')));
});

test('a first node that refuses every request (HTTP 403 page) or hangs costs one request: both fights are judged', async () => {
  const twoOver = () => {
    const A = agent(0xa1);
    const B = agent(0xb1);
    return { fights: { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }), [`${B}#1`]: fightWords(B, 1, seedOf(3), { over: true }) }, logs: [startedLog(A, 1, seedOf(1), 7500), startedLog(B, 1, seedOf(3), 7600)] };
  };
  const clean = world(twoOver(), NODE_SHAPES);
  const { r: base } = await run(clean);
  assert.equal(base.judged, 2);

  const refused = world(twoOver(), { ...NODE_SHAPES, [DS]: { noLogs: true, http: () => 403 } });
  const { r, lines } = await run(refused);
  assert.equal(r.judged, 2, 'both judged');
  assert.equal(r.confirmed, 2);
  assert.ok(refused.calls.length <= 45, `${refused.calls.length} requests for a budget of 45`);
  assert.equal(refused.calls.filter((c) => c.url === DS).length, 1, 'the refusing node is asked once, then tried last');
  assert.ok(!lines.some((s) => /subrequests are spent/.test(s)));

  const stuck = world(twoOver(), NODE_SHAPES);
  const answer = stuck.fetchFn;
  let hung = 0;
  stuck.fetchFn = (url, init) => (url === DS ? (hung++, new Promise(() => {})) : answer(url, init));
  const t0 = Date.now();
  const lines2 = [];
  const r2 = await judgeRun(ENV, { fetchFn: stuck.fetchFn, log: (s) => lines2.push(s), wait: async () => {}, timeoutMs: 50 });
  assert.equal(r2.judged, 2, 'both judged');
  assert.equal(hung, 1, 'one timeout, then the hanging node is tried last');
  assert.ok(stuck.calls.length + hung <= 45);
  assert.ok(Date.now() - t0 < 2000, 'one timeout of time, not one per read');
  assert.ok(lines2.some((s) => /^rpc: dataseed\.test 0 ok 1 failed \(timeout 1\)/.test(s)));
});

test('the nonce pair is read only from the nodes the judge sends to: with them busy the run ends', async () => {
  const busyCount = (q) => (q.method === 'eth_getTransactionCount' ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } } : null);
  const w = world({}, { ...NODE_SHAPES, [DS]: { noLogs: true, refuse: busyCount }, [PN]: { logCap: 50000, refuse: busyCount } });
  await assert.rejects(run(w), /eth_getTransactionCount: rate limit/);
  const counts = w.calls.filter((c) => (Array.isArray(c.body) ? c.body : [c.body]).some((q) => q.method === 'eth_getTransactionCount'));
  assert.ok(counts.length > 0);
  assert.ok(counts.every((c) => c.url !== CLUB), 'never from the MEV relay (send:false)');
  assert.equal(w.sent.length, 0, 'nothing sent on a nonce from elsewhere');
});

test('a log read slower than a plain call but in step with its width is read, not degraded', async () => {
  // a log node answering 0.5 ms a block (publicnode measured 0.2-0.7 ms); a plain request gets 50 ms here
  const w = world({ head: 10000 }, NODE_SHAPES);
  const answer = w.fetchFn;
  w.fetchFn = async (url, init) => {
    const q = JSON.parse(init.body);
    if (!Array.isArray(q) && q.method === 'eth_getLogs' && q.params[0].toBlock !== 'latest') {
      await new Promise((r) => setTimeout(r, (parseInt(q.params[0].toBlock, 16) - parseInt(q.params[0].fromBlock, 16) + 1) / 2));
    }
    return answer(url, init);
  };
  const env = { ...ENV, BLOCKS_PER_WEEK: 16800, LIVE_BLOCKS: 400, LOG_UNIT: 400 };
  const lines = [];
  const r = await judgeRun(env, { fetchFn: w.fetchFn, log: (s) => lines.push(s), wait: async () => {}, timeoutMs: 50 });
  assert.equal(r.degraded, false, lines.join('\n'));
});

test('the mainnet envs: log reads in 1000-block requests, publicnode the last log node, an archive binding', async () => {
  const { readFileSync } = await import('node:fs');
  const { LOG_MS_PER_BLOCK, endpointsOf } = await import('../src/rpc.js');
  const { TIMEOUT_MS, LOGS_TIMEOUT_MS } = await import('../src/judge-cron.js');
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, s) => s ?? '') // comments out, strings kept
    .replace(/,(\s*[\]}])/g, '$1');
  const config = JSON.parse(text);
  for (const name of ['mainnet', 'mainnet-street']) {
    const { vars } = config.env[name];
    const unit = Number(vars.LOG_UNIT);
    assert.equal(unit, 1000, name);
    assert.ok(unit * 0.7 * 1.5 <= Math.max(TIMEOUT_MS, Math.min(LOGS_TIMEOUT_MS, unit * LOG_MS_PER_BLOCK)), name);
    for (const key of ['RPC_URL', 'SITE_RPC_URL']) {
      const nodes = endpointsOf(vars, key);
      const logNodes = nodes.filter((n) => n.logs > 0);
      assert.match(logNodes.at(-1).url, /publicnode/, `${name} ${key}: publicnode last`);
      assert.ok(logNodes.some((n) => n.logs >= unit && !/publicnode/.test(n.url)), `${name} ${key}: a node other than publicnode serves a whole LOG_UNIT`);
      assert.ok(!nodes.some((n) => /48\.club/.test(n.url) && n.send), `${name}: never a sender through the MEV relay`);
    }
    assert.ok((config.env[name].kv_namespaces ?? []).some((k) => k.binding === 'HISTORY'), `${name}: HISTORY`);
  }
  for (const name of ['testnet', 'testnet-green']) assert.ok(!(config.env[name].kv_namespaces ?? []).length, `${name}: no archive, as before`);
});

// ------------------------------------------------------------------ the review's cases

/** A draw of 32 agents held by this run: 16 fights, 8 matches, their Started events in the receipt. */
function bigDraw(head) {
  const fights = {};
  const drawn = [];
  for (let i = 0; i < 8; i++) {
    const a = agent(0x10 + 2 * i);
    const b = agent(0x11 + 2 * i);
    fights[`${a}#1`] = fightWords(a, 1, seedOf(30 + i), { opponent: b.slice(2), oppNumber: 1, clockAt: 6_000_060 });
    fights[`${b}#1`] = fightWords(b, 1, seedOf(30 + i), { opponent: a.slice(2), oppNumber: 1, clockAt: 6_000_060 });
    drawn.push(startedLog(a, 1, seedOf(30 + i), head - 1, b), startedLog(b, 1, seedOf(30 + i), head - 1, a));
  }
  return { fights, drawn };
}

test('the locks come before any older block: a draw of 16 fights is locked in its run with thirdweb refusing, in every minute of the cycle, the archive lagging, or a close due', async (t) => {
  const head = 3_000_000;
  const shapes = { ...MAIN_SHAPES, [TW]: { down: true } };
  const cases = [];
  for (const phase of [0, 1, 2, 3]) {
    cases.push([`minute ${phase}, no archive`, {}, { now: 6_000_000 + 60 * phase }]);
    cases.push([`minute ${phase}, the archive 2 hours behind`, { HISTORY: kvOf() }, { now: 6_000_000 + 60 * phase }]);
  }
  cases.push(['a close due (a full run)', {}, { now: 6_000_000, seasonEnd: 500 }]);
  // a fight over in the live window too: its judgement is not starved by the older blocks either
  const { fights: over, logs: overLogs } = matchesOver(1, head - 2000, 60);
  for (const [what, env, opts] of cases) {
    const { fights, drawn } = bigDraw(head);
    const w = world({ head, hall: 32, fights: { ...fights, ...over }, drawn, logs: overLogs, ...opts }, shapes);
    const { r, lines } = await run(w, { ...MAIN_ENV, ...env });
    assert.ok(r.drew, what);
    assert.ok(lines.some((s) => /^lock the trap plans of 8 fight\(s\): sent/.test(s)), `${what}: locked in this run\n${lines.join('\n')}`);
    assert.ok(w.sent.findIndex((tx) => tx.includes(LOCK)) >= 0);
    assert.ok(w.calls.length + (env.HISTORY?.gets ?? 0) <= 45, `${what}: ${w.calls.length}`);
    assert.equal(r.judged, 2, `${what}: the match over in the live window is judged in the same run`);
    t.diagnostic(`${what}: ${w.calls.length + (env.HISTORY?.gets ?? 0)} subrequests`);
  }
});

test('thirdweb\'s burst limit (HTTP 429 past 8 requests in a run): no run is degraded, the draw is locked', async () => {
  const head = 3_000_000;
  const shapes = { ...MAIN_SHAPES, [TW]: { logCap: 1000, burst: 8 } };
  for (const phase of [0, 1, 2, 3]) {
    for (const env of [{}, { HISTORY: kvOf() }]) {
      const w = world({ head, now: 6_000_000 + 60 * phase }, shapes);
      const { r } = await run(w, { ...MAIN_ENV, ...env });
      assert.equal(r.degraded, false);
      const { fights, drawn } = bigDraw(head);
      const v = world({ head, hall: 32, fights, drawn, now: 6_000_000 + 60 * phase }, shapes);
      const { r: r2 } = await run(v, { ...MAIN_ENV, ...env });
      assert.equal(r2.degraded, false);
      assert.ok(lockOf(v));
    }
  }
});

test('a fight over early by its clock (both corners quick, no Ended event) is read and judged at once', async () => {
  const head = 3_000_000;
  const A = agent(0xa1);
  const fights = { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }) };
  // drawn five minutes ago: eleven rounds answered at once, the twelfth not answered: over by time, no Ended
  const drawnAt = head - 5 * PER_MIN;
  const w = world({ head, now: 6_000_000, fights, logs: [startedLog(A, 1, seedOf(1), drawnAt), lockedLog(A, 1, drawnAt + 20)] }, MAIN_SHAPES);
  await run(w, MAIN_ENV);
  assert.ok(judgedIn(w, A));
});

test('the testnet shape (one node, no LOG_UNIT): every run reads the whole look-back window, as before', async () => {
  const testnet = { RPC_URL: PN, RPC_URLS: undefined, BLOCKS_PER_WEEK: 1342500 };
  const head = 500_000;
  const A = agent(0xa1);
  // a fight two hours old, over and not judged: past the live window, in the look-back window (20000 blocks)
  const w = world({ head, fights: { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }) }, logs: [startedLog(A, 1, seedOf(1), head - 2 * 7991)] }, NODE_SHAPES);
  const { r, lines } = await run(w, testnet);
  assert.equal(r.full, true);
  assert.ok(lines.some((s) => /^scan: .*\(full\)$/.test(s)));
  assert.ok(judgedIn(w, A), 'judged in the first run');
  const reads = getLogs(w);
  assert.equal(Math.min(...reads.map((s) => parseInt(s.fromBlock, 16))), head - 20000, 'from the start of the look-back window');
  assert.ok(reads.every((s) => s.url === PN), 'its one node');
  // FULL_SCAN may still be set either way
  const v = world({ head }, NODE_SHAPES);
  assert.equal((await run(v, { ...testnet, FULL_SCAN: 'no' })).r.full, false);
});

test('a log range older than six hours is read only from the archive node: never from 48.club or publicnode', async () => {
  const head0 = 2_000_000;
  const shapes = { ...MAIN_SHAPES, [TW]: { down: true }, [PN]: { logCap: 50000 } };
  const env = { ...MAIN_ENV, CATCHUP_LOOKBACK_BLOCKS: 24 * 60 * PER_MIN };
  const trusted = 6 * Math.ceil(1343552 / 168);
  let old = 0;
  for (let m = 0; m < 48; m++) {
    const head = head0 + m * PER_MIN;
    const w = world({ head, now: 6_000_000 + 60 * m }, shapes);
    await run(w, env);
    for (const s of getLogs(w)) {
      if (parseInt(s.fromBlock, 16) < head - trusted) {
        old++;
        assert.equal(s.url, TW, `blocks ${parseInt(s.fromBlock, 16)}: ${s.url}`);
      }
    }
  }
  assert.ok(old > 0, 'the whole walk did reach the older blocks');
});

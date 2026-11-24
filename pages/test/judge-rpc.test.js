// The judge over several nodes (judge-cron.js + rpc.js): a rate-limited node changes nothing it sends,
// the nonce pair comes from one node, a send that went through is never counted as a failure, the
// log reads stay behind the head, a run without its wide log reads is degraded (it still judges the
// last twenty minutes and never closes a season), and a busy run stays inside the subrequest budget.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRun, STARTED, HEAD_MARGIN } from '../src/judge-cron.js';
import { arenaKeys } from '../src/keys.js';
import { keccak256 } from '../src/keccak.js';
import { planOf } from '../src/plan.js';

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
function fightWords(a, n, seed, { over = false, opponent = '0', oppNumber = 0 } = {}) {
  const locked = over ? KEYS.trapsCommit(planOf(KEYS.cardSeed(seed)).traps, KEYS.trapSalt(ARENA, seed)) : '0';
  const f = over
    ? [seed, 'a', '64', '0', n.toString(16), '0', '5', '0', '0', 'a', '0', '0', '0', KEYS.commitment(ARENA, a, n), opponent, '1', oppNumber.toString(16), '1', locked]
    : [seed, 'a', '0', '0', n.toString(16), '0', '1', '0', '0', (100050).toString(16), '0', '0', '0', KEYS.commitment(ARENA, a, n), opponent, '1', oppNumber.toString(16), '1', locked];
  return '0x' + [...f.map(word), word('0'), word('0'), word('1')].join(''); // name, season 1
}
const startedLog = (a, n, seed, block, opponent = '0') => ({ address: ARENA, topics: [STARTED, '0x' + word(a), '0x' + word(n.toString(16)), '0x' + word(opponent)], data: '0x' + word(seed) + word('0').repeat(4), blockNumber: '0x' + block.toString(16) });

/**
 * A fake chain behind fake nodes. The chain: season 1 judged by JUDGE (ending at `seasonEnd`), `fights`
 * by "agent#n", Started/Judged `logs`; with `hall` 2 and a draw due the judge seals, then holds the
 * draw, whose receipt carries `drawn` (Started logs, added to the chain's logs unless `receiptOnly`).
 * The nodes: `nodes[url]` -> { limitEvery, noLogs, logCap, refuse(q) } shape how each answers.
 */
function world({ fights = {}, logs = [], head = 10000, now = 100000, seasonEnd = 10 ** 12, hall = 0, drawn = [], receiptOnly = false, nonces = {}, sendErrors = {} } = {}, nodes = {}) {
  const w = { sent: [], calls: [], receipts: new Map(), logs: [...logs], cutoff: 0, mined: new Set() };
  const answer = (url, q) => {
    const p = q.params?.[0];
    switch (q.method) {
      case 'eth_getBalance': return '0x' + (10n ** 18n).toString(16);
      case 'eth_call': {
        const d = p.data;
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
  return { A, C, D, opts: { fights, hall: 2, logs: [startedLog(A, 1, seedOf(1), 5000)], drawn: [startedLog(C, 1, seedOf(2), 10000, D), startedLog(D, 1, seedOf(2), 10000, C)] } };
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

test('the nonce pair is one batch from one node: pending and latest never come from two nodes', async () => {
  // the dataseed answers the pending count and rate-limits the mined one; publicnode has both, equal.
  // Mixed, they would read 6 > 5: a transaction "stuck" that is not, and a replacement.
  const w = world({ nonces: { [DS]: { pending: 6, latest: 5 }, [PN]: { pending: 6, latest: 6 } } }, {
    ...NODE_SHAPES,
    [DS]: { noLogs: true, refuse: (q) => (q.method === 'eth_getTransactionCount' && q.params[1] === 'latest' ? { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } } : null) },
  });
  const { r } = await run(w);
  assert.equal(r.waiting, false, 'nothing stuck');
  assert.equal(w.sent.length, 0, 'no replacement');
  const counts = w.calls.filter((c) => Array.isArray(c.body) || c.body.method === 'eth_getTransactionCount');
  assert.ok(counts.every((c) => !Array.isArray(c.body) || c.body.length === 2), 'asked as a pair');
  assert.deepEqual(counts.at(-1), { url: PN, body: counts.at(-1).body }, 'the answer used came from one node, as a batch');
  assert.ok(Array.isArray(counts.at(-1).body));
});

test('"already known": the send counts, under the hash of its own bytes', async () => {
  const b = busy();
  const w = world({ fights: { [`${b.A}#1`]: b.opts.fights[`${b.A}#1`] }, logs: b.opts.logs, sendErrors: { [DS]: 'already known' } }, NODE_SHAPES);
  const { r, lines } = await run(w);
  assert.equal(w.sent.length, 1);
  const hash = keccak256(w.sent[0]);
  assert.ok(lines.includes(`${b.A}#1 judged: sent ${hash}`), 'logged under keccak256(raw)');
  assert.equal(r.sent, 1);
  assert.equal(r.confirmed, 1, 'its receipt is found by that hash');
});

test('"nonce too low" after a retried send: found by its hash, it counts as sent', async () => {
  const b = busy();
  const opts = { fights: { [`${b.A}#1`]: b.opts.fights[`${b.A}#1`] }, logs: b.opts.logs };
  // the dataseed takes the transaction and then fails with a 502; publicnode then says "nonce too low"
  const shapes = { ...NODE_SHAPES, [DS]: { noLogs: true } };
  const w = world(opts, shapes);
  const answerFirst = w.fetchFn;
  w.fetchFn = async (url, init) => {
    const res = await answerFirst(url, init);
    const q = JSON.parse(init.body);
    if (url === DS && q.method === 'eth_sendRawTransaction') return { status: 502, json: async () => { throw new SyntaxError('<html>'); } };
    return res;
  };
  const { r, lines } = await run(w);
  assert.equal(w.sent.length, 1, 'one transaction, sent once');
  assert.ok(lines.includes(`${b.A}#1 judged: sent ${keccak256(w.sent[0])}`));
  assert.equal(r.confirmed, 1);
  assert.ok(w.calls.some((c) => c.body.method === 'eth_getTransactionByHash'), 'checked by its hash');

  // a first try that never was: "nonce too low" ends the run, as before
  const v = world(opts, shapes);
  const failing = v.fetchFn;
  v.fetchFn = async (url, init) => {
    const q = JSON.parse(init.body);
    if (q.method === 'eth_sendRawTransaction') return { json: async () => ({ jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'nonce too low' } }) };
    return failing(url, init);
  };
  await assert.rejects(run(v), /nonce too low/);
});

test('the lock scan reads to "latest", and a fight only in the hold receipt is locked', async () => {
  const b = busy();
  const w = world({ ...b.opts, receiptOnly: true }, NODE_SHAPES);
  await run(w);
  const lock = w.sent.find((tx) => tx.includes(LOCK));
  assert.ok(lock, 'the fresh match is locked although no node has its Started events yet');
  const commit = KEYS.trapsCommit(planOf(KEYS.cardSeed(seedOf(2))).traps, KEYS.trapSalt(ARENA, seedOf(2)));
  assert.ok(lock.includes(commit.slice(2)));
  const scans = getLogs(w);
  assert.equal(scans.filter((s) => s.toBlock === 'latest').length, 1, 'the lock scan');
  assert.deepEqual(scans.find((s) => s.toBlock === 'latest').topics, [STARTED]);
});

test('the judgement scan stays HEAD_MARGIN behind the head; LOG_CHUNK sets its requests', async () => {
  const head = 50000;
  const reads = async (env) => {
    const w = world({ head }, NODE_SHAPES);
    await run(w, env);
    return getLogs(w).filter((s) => s.toBlock !== 'latest');
  };
  const four = await reads({});
  assert.equal(HEAD_MARGIN, 25);
  assert.equal(four.length, 4, '20000 blocks in chunks of 5000 (the default)');
  assert.ok(four.every((s) => parseInt(s.toBlock, 16) <= head - HEAD_MARGIN && s.url === PN));
  assert.equal(parseInt(four.at(-1).toBlock, 16), head - HEAD_MARGIN);
  const one = await reads({ LOG_CHUNK: 20000 });
  assert.equal(one.length, 1, 'one request with LOG_CHUNK 20000');
  assert.deepEqual([parseInt(one[0].fromBlock, 16), parseInt(one[0].toBlock, 16)], [head - 20000, head - HEAD_MARGIN]);
});

test('no wide log read: a degraded run judges the last twenty minutes and never closes the season', async () => {
  const head = 200000;
  const A = agent(0xa1);
  const B = agent(0xb1);
  const fights = { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }), [`${B}#1`]: fightWords(B, 1, seedOf(3), { over: true }) };
  const logs = [startedLog(A, 1, seedOf(1), head - 1000), startedLog(B, 1, seedOf(3), head - 10000)]; // B: outside the window
  const opts = { head, fights, logs, now: 100000, seasonEnd: 500 }; // the season is over: a clean run would close it
  const clean = world(opts, NODE_SHAPES);
  const { r: ok } = await run(clean);
  assert.equal(ok.degraded, false);
  assert.ok(clean.sent.some((tx) => tx.includes(CLOSE)) === false, 'two fights judged in this run: the close waits for a run with nothing left');
  assert.equal(clean.sent.filter((tx) => tx.includes(JUDGE_FIGHT)).length, 2);

  const w = world(opts, { ...NODE_SHAPES, [PN]: { noLogs: true } });
  const { r, lines } = await run(w);
  assert.equal(r.degraded, true);
  const judged = w.sent.filter((tx) => tx.includes(JUDGE_FIGHT));
  assert.equal(judged.length, 1, 'only the fight inside the window');
  assert.ok(judged[0].includes(A.slice(2)));
  assert.ok(!w.sent.some((tx) => tx.includes(CLOSE)));
  assert.ok(lines.some((s) => s.startsWith('degraded run:')));
  const pieces = getLogs(w).filter((s) => s.url === CLUB);
  assert.equal(pieces.length, Math.ceil((WINDOW - HEAD_MARGIN + 1) / 250), 'the window in 250-block pieces on the small node');
  assert.ok(pieces.every((s) => parseInt(s.toBlock, 16) <= head - HEAD_MARGIN));

  // the next run, with everything judged and the window read the same way: still no close
  const later = world({ ...opts, fights: {} }, { ...NODE_SHAPES, [PN]: { noLogs: true } });
  const { r: r3 } = await run(later);
  assert.equal(r3.degraded, true);
  assert.equal(r3.closed, false);
  assert.ok(!later.sent.some((tx) => tx.includes(CLOSE)));
  // and a clean run with nothing left closes it
  const done = world({ ...opts, fights: {}, logs: [] }, NODE_SHAPES);
  assert.equal((await run(done)).r.closed, true);
});

test('a run that holds a draw with 16 fights to judge stays inside the subrequest budget', async () => {
  const b = busy();
  const fights = { ...b.opts.fights };
  const logs = [];
  for (let i = 0; i < 16; i++) {
    const a = agent(0x10 + i);
    const opp = agent(0x10 + (i ^ 1)); // matches of two
    fights[`${a}#1`] = fightWords(a, 1, seedOf(4 + (i >> 1)), { over: true, opponent: opp.slice(2), oppNumber: 1 });
    logs.push(startedLog(a, 1, seedOf(4 + (i >> 1)), 5000 + (i >> 1), opp));
  }
  // the default budget (45: Workers Free allows 50 subrequests an invocation), a node rate-limiting too
  const w = world({ ...b.opts, fights, logs }, { ...NODE_SHAPES, [DS]: { noLogs: true, limitEvery: 5 } });
  const { r, lines } = await run(w);
  assert.ok(w.calls.length <= 45, `${w.calls.length} requests for a budget of 45`);
  assert.ok(r.drew, 'the draw is held');
  assert.ok(w.sent.some((tx) => tx.includes(LOCK)), 'the fresh match is locked before its bell');
  assert.ok(r.judged >= 1, 'some fights judged; the rest next run');
  assert.equal(r.confirmed, r.sent, 'every receipt read');
  assert.equal(r.closed, false);
  assert.equal(lines.filter((s) => /subrequests are spent/.test(s)).length, 1, 'the rest is left for the next run, said once');
  // a budget too small for a run's fixed reads: the run ends early, and still never goes past it
  const tight = world({ ...b.opts, fights, logs }, NODE_SHAPES);
  await run(tight, { SUBREQ_BUDGET: 20 }).catch(() => {});
  assert.ok(tight.calls.length <= 20, `${tight.calls.length} requests for a budget of 20`);
});

/** Two fights over and unjudged, no draw due: a plain run judges both. */
function twoOver() {
  const A = agent(0xa1);
  const B = agent(0xb1);
  const fights = { [`${A}#1`]: fightWords(A, 1, seedOf(1), { over: true }), [`${B}#1`]: fightWords(B, 1, seedOf(3), { over: true }) };
  return { fights, logs: [startedLog(A, 1, seedOf(1), 5000), startedLog(B, 1, seedOf(3), 6000)] };
}

test('a first node that refuses every request (HTTP 403 page) or hangs costs one request: both fights are judged', async () => {
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
  const w = world(twoOver(), { ...NODE_SHAPES, [DS]: { noLogs: true, refuse: busyCount }, [PN]: { logCap: 50000, refuse: busyCount } });
  await assert.rejects(run(w), /eth_getTransactionCount: rate limit/);
  const counts = w.calls.filter((c) => (Array.isArray(c.body) ? c.body : [c.body]).some((q) => q.method === 'eth_getTransactionCount'));
  assert.ok(counts.length > 0);
  assert.ok(counts.every((c) => c.url !== CLUB), 'never from the MEV relay (send:false)');
  assert.equal(w.sent.length, 0, 'nothing sent on a nonce from elsewhere');
});

test('a judgement scan slower than a plain call but in step with its width is read, not degraded', async () => {
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
  const env = { ...ENV, BLOCKS_PER_WEEK: 16800, LOOKBACK_BLOCKS: 400, LOG_CHUNK: 400 };
  const lines = [];
  const r = await judgeRun(env, { fetchFn: w.fetchFn, log: (s) => lines.push(s), wait: async () => {}, timeoutMs: 50 });
  assert.equal(r.degraded, false, lines.join('\n'));
  assert.equal(getLogs(w).filter((s) => s.toBlock !== 'latest').length, 1, 'one request of about 375 blocks, about 190 ms');
});

test('the mainnet envs read the look-back window in requests that fit their timeout with room to spare', async () => {
  const { readFileSync } = await import('node:fs');
  const { LOG_MS_PER_BLOCK } = await import('../src/rpc.js');
  const { TIMEOUT_MS, LOGS_TIMEOUT_MS } = await import('../src/judge-cron.js');
  const text = readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8')
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g, (m, s) => s ?? '') // comments out, strings kept
    .replace(/,(\s*[\]}])/g, '$1');
  const config = JSON.parse(text);
  for (const name of ['mainnet', 'mainnet-street']) {
    const chunk = Number(config.env[name].vars.LOG_CHUNK ?? 5000);
    const allowed = Math.max(TIMEOUT_MS, Math.min(LOGS_TIMEOUT_MS, chunk * LOG_MS_PER_BLOCK));
    // the slowest publicnode measured for the arena: 0.7 ms a block (20000 blocks in 13.8 s)
    assert.ok(chunk * 0.7 * 1.5 <= allowed, `${name}: LOG_CHUNK ${chunk} needs up to ${chunk * 0.7} ms of ${allowed}`);
  }
});

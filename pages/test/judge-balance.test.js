import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeRun, addressOf, bnb, LOW_BALANCE } from '../src/judge-cron.js';
import { arenaKeys } from '../src/keys.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const JUDGE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'; // anvil key #1
const JUDGE = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';
const KEYS = arenaKeys('11'.repeat(32));
const BOOK = '0x' + 'b0'.repeat(20);
const CERT = '0x' + 'ce'.repeat(20);
const env = { RPC_URL: 'http://rpc', ARENA, CHAIN_ID: 56, DEPLOY_BLOCK: 0, BLOCKS_PER_WEEK: 604800, SECRET: '11'.repeat(32), JUDGE_KEY };
const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');

/** A fake chain for judgeRun: season 1 judged by JUDGE, two agents in the hall and a draw due (so a run
 *  sends one transaction, the seal), and the judge's balance `balance` (an Error: the read fails). */
function fakeChain(balance, sent, reads) {
  const node = async (url, { body }) => {
    const q = JSON.parse(body);
    // a JSON-RPC batch (the judge's first reads): each call answered as alone, in one reply
    if (Array.isArray(q)) {
      const parts = await Promise.all(q.map(async (x) => (await node(url, { body: JSON.stringify(x) })).json()));
      return { json: async () => parts };
    }
    const ok = (result) => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, result }) });
    const p = q.params?.[0];
    switch (q.method) {
      case 'eth_getBalance':
        reads.push(q.params);
        if (balance instanceof Error) return { json: async () => ({ jsonrpc: '2.0', id: q.id, error: { message: balance.message } }) };
        return ok('0x' + balance.toString(16));
      case 'eth_call': {
        if (p.data.startsWith('0xfda7b9db')) return ok('0x' + word(BOOK.slice(2))); // seasonBook()
        if (p.data.startsWith('0x715f8fe8')) return ok('0x' + word('1')); // seasonCount()
        if (p.data.startsWith('0x6ebaeda9')) return ok('0x' + [word('0'), word((10 ** 12).toString(16)), word(JUDGE.slice(2)), word(KEYS.commit.slice(2)), word(CERT.slice(2))].join('')); // seasons(1)
        if (p.data.startsWith('0xbcb39621')) return ok('0x' + word('1')); // currentSeason()
        if (p.data.startsWith('0xee5f8c8f')) return ok('0x' + word('3c')); // roundTime() = 60
        if (p.data.startsWith('0x748e1910')) return ok('0x' + word((1000).toString(16))); // nextDrawAt(): long past
        if (p.data.startsWith('0xb5c81661')) return ok('0x' + word('2')); // hallCount()
        return ok('0x' + word('0')); // pendingCutoff() and the rest
      }
      case 'eth_getTransactionCount': return ok('0x5');
      case 'eth_blockNumber': return ok('0x' + (10000).toString(16));
      case 'eth_getBlockByNumber': return ok({ timestamp: '0x' + (100000).toString(16) });
      case 'eth_getLogs': return ok([]);
      case 'eth_estimateGas': return ok('0x30000');
      case 'eth_gasPrice': return ok('0x5f5e100');
      case 'eth_sendRawTransaction': sent.push(q.params[0]); return ok('0x' + 'aa'.repeat(32));
      case 'eth_getTransactionReceipt': return ok({ status: '0x1' });
      default: throw new Error(q.method);
    }
  };
  return node;
}

async function run(balance, extra = {}) {
  const sent = [];
  const reads = [];
  const lines = [];
  const r = await judgeRun({ ...env, ...extra }, { fetchFn: fakeChain(balance, sent, reads), log: (s) => lines.push(s), wait: async () => {} });
  return { r, sent, reads, warnings: lines.filter((s) => s.startsWith('judge balance')) };
}

test('the judge address of the test key', () => {
  assert.equal(addressOf(JUDGE_KEY), JUDGE);
});

test('wei as BNB', () => {
  assert.equal(bnb(0n), '0');
  assert.equal(bnb(400_000_000_000_000n), '0.0004');
  assert.equal(bnb(LOW_BALANCE), '0.0015');
  assert.equal(bnb(10n ** 18n), '1');
  assert.equal(bnb(12_345_678_900_000_000_000n), '12.345678', 'six decimals, rounded down');
  assert.equal(bnb(999_999_999_999n), '0', 'under a millionth of a BNB');
});

test('the default threshold is a day of one match an hour at 0.05 gwei, as measured', () => {
  const match = 29_085n + 462_800n + 88_757n + 264_430n + 247_330n; // seal, hold, lock, two judgements
  assert.equal(match, 1_092_402n);
  const day = 24n * match * 50_000_000n; // 0.05 gwei
  assert.ok(day <= LOW_BALANCE && LOW_BALANCE - day < 200_000_000_000_000n, 'rounded up by less than 0.0002 BNB');
});

test('a low balance gives one warning line with the address to top up, and the judge goes on', async () => {
  const { r, sent, reads, warnings } = await run(400_000_000_000_000n);
  assert.deepEqual(reads, [[JUDGE, 'latest']], 'read once a run, for the judge');
  assert.deepEqual(warnings, [`judge balance low: 0.0004 BNB (warning below 0.0015 BNB), top up ${JUDGE}`]);
  assert.equal(sent.length, 1, 'the draw is still sealed');
  assert.equal(r.waiting, false);
});

test('an empty wallet still only warns', async () => {
  const { sent, warnings } = await run(0n);
  assert.deepEqual(warnings, [`judge balance low: 0 BNB (warning below 0.0015 BNB), top up ${JUDGE}`]);
  assert.equal(sent.length, 1);
});

test('at or above the threshold: no warning', async () => {
  for (const balance of [LOW_BALANCE, LOW_BALANCE + 1n, 10n ** 18n]) {
    const { sent, warnings } = await run(balance);
    assert.deepEqual(warnings, [], String(balance));
    assert.equal(sent.length, 1);
  }
});

test('JUDGE_LOW_BALANCE sets the threshold in wei (a string or a number)', async () => {
  assert.deepEqual((await run(LOW_BALANCE, { JUDGE_LOW_BALANCE: '2000000000000000' })).warnings, [`judge balance low: 0.0015 BNB (warning below 0.002 BNB), top up ${JUDGE}`]);
  assert.deepEqual((await run(400_000_000_000_000n, { JUDGE_LOW_BALANCE: 100_000_000_000_000 })).warnings, [], 'below the default, above this one');
  assert.deepEqual((await run(0n, { JUDGE_LOW_BALANCE: '0' })).warnings, [], 'zero: never warns');
});

test('a balance that cannot be read is logged once and judging goes on', async () => {
  const { sent, reads, warnings } = await run(new Error('node down'));
  assert.equal(reads.length, 1);
  assert.deepEqual(warnings, ['judge balance not read: eth_getBalance: node down']);
  assert.equal(sent.length, 1, 'the draw is still sealed');
});

test('a run that only replaces a stuck transaction still warns first', async () => {
  const sent = [];
  const reads = [];
  const lines = [];
  const chain = fakeChain(1n, sent, reads);
  const fetchFn = async (url, init) => {
    const q = JSON.parse(init.body);
    if (Array.isArray(q)) {
      const parts = await Promise.all(q.map(async (x) => (await fetchFn(url, { body: JSON.stringify(x) })).json()));
      return { json: async () => parts };
    }
    if (q.method === 'eth_getTransactionCount') return { json: async () => ({ jsonrpc: '2.0', id: q.id, result: q.params[1] === 'pending' ? '0x6' : '0x5' }) };
    return chain(url, init);
  };
  const r = await judgeRun(env, { fetchFn, log: (s) => lines.push(s), wait: async () => {} });
  assert.equal(r.waiting, true);
  assert.equal(sent.length, 1, 'the replacement');
  assert.equal(lines.filter((s) => s.startsWith('judge balance low:')).length, 1);
});

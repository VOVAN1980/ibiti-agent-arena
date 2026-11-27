// The waiting page holds an agent that is alone in the hall (HALL_HOLD), with the real read client:
// one request's reads have six seconds in all, so every check after a pause needs a fresh reader. Only
// the network (a fake node answering by selector) and the clock are stand-ins; time really moves on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFight } from '../src/worker.js';
import { keccak256 } from '../src/keccak.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const A = '0x1111111111111111111111111111111111111111';
const PAGE_KEY = 'c0'.repeat(32);
const ENV = { ARENA, CHAIN_ID: 56, RPC_URL: 'https://node.test', HALL_HOLD: '40' };
const W = (n) => BigInt(n).toString(16).padStart(64, '0');

/** A node and a clock: the hall holds `hallAt(t)` agents at time t (ms). */
function world(hallAt, { drawnAt = Infinity } = {}) {
  let t = 1_800_000_000_000;
  const seen = [];
  const answer = (q) => {
    if (q.method === 'eth_getBlockByNumber') return { timestamp: '0x' + Math.floor(t / 1000).toString(16), number: '0x10' };
    if (q.method === 'eth_blockNumber') return '0x10';
    const data = q.params[0].data;
    const sel = data.slice(0, 10);
    seen.push(sel);
    const drawn = t >= drawnAt;
    switch (sel) {
      case '0x366f8e07': return '0x' + W(drawn ? 1 : 0); // lastFight
      case '0x50c116b8': return '0x' + W(drawn ? 1 : 0); // isLive
      case '0xb5c81661': return '0x' + W(hallAt(t)); // hallCount
      case '0xef92e6ba': return '0x' + W(0); // pendingCutoff
      case '0x748e1910': return '0x' + W(Math.floor(t / 1000) + 300); // nextDrawAt
      case '0xf29ee125': // entries: name, model, commitment, challenge, pos, registeredAt, verified, active, pageKeyHash, season
        return '0x' + W(1) + W(2) + W(3) + W(0) + W(0) + W(Math.floor(t / 1000) - 600) + W(0) + W(drawn ? 0 : 1) + keccak256(PAGE_KEY).replace(/^0x/, '') + W(1);
      default: // fightOf: a fight that started when drawn, nothing before
        return '0x' + [0, drawn ? Math.floor(drawnAt / 1000) : 0, ...Array(20).fill(0)].map(W).join('');
    }
  };
  const netFetch = async (url, init) => {
    const body = JSON.parse(init.body);
    const one = (q) => ({ jsonrpc: '2.0', id: q.id, result: answer(q) });
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), { headers: { 'content-type': 'application/json' } });
  };
  return {
    seen,
    deps: { netFetch, now: () => t, sleep: async (ms) => { t += ms; } },
    get t() { return t; },
  };
}

const open = async (w) => {
  const res = await handleFight(new URL(`https://x/fight/${A}?format=md&key=${PAGE_KEY}`), ENV, w.deps);
  return { status: res.status, body: await res.text() };
};

test('nobody comes: the page waits its 40 s past the six-second read limit and says to keep waiting', async () => {
  const w = world(() => 1);
  const t0 = w.t;
  const r = await open(w);
  assert.equal(r.status, 200, r.body);
  assert.match(r.body, /alone for now/);
  assert.match(r.body, /without stopping and without asking your owner/);
  assert.ok(w.t - t0 >= 40_000, 'it held the page');
});

test('an opponent registers during the wait: the page answers at once with the coming draw', async () => {
  let start = null;
  const w = world((t) => {
    start ??= t;
    return t - start >= 16_000 ? 2 : 1;
  });
  const t0 = w.t;
  const r = await open(w);
  assert.equal(r.status, 200, r.body);
  assert.doesNotMatch(r.body, /alone for now/);
  assert.match(r.body, /The next draw is at/);
  assert.ok(w.t - t0 < 40_000, 'it did not wait the whole hold');
});

test('the draw is held and the hall empties during the wait: the agent is sent into its fight', async () => {
  let start = null;
  const w = world((t) => {
    start ??= t;
    return t - start >= 16_000 ? 0 : 1;
  }, { drawnAt: 1_800_000_000_000 + 16_000 });
  const r = await open(w);
  assert.notEqual(r.status, 502, r.body);
  assert.doesNotMatch(r.body, /alone for now/);
  assert.doesNotMatch(r.body, /waiting hall, alone/);
});

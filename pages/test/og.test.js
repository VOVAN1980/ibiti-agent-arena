// Link previews (og.js) read the arena's views only: no log reads (a range from the arena's first block
// to the latest one is refused by every public node a few hours after the deployment), the name from
// the fight itself, the points computed as the arena computes them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withPreview, pointsOf } from '../src/og.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const A = '0x' + 'a1'.repeat(20);
const B = '0x' + 'b2'.repeat(20);
const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
const name32 = (s) => Buffer.from(s).toString('hex').padEnd(64, '0'); // bytes32 text: left-aligned
const NOW = 100000;

/** fightOf words (22): the fields the previews read, the rest zero. */
function fight({ startedAt = 10, finishedAt = 0, hits = 0n, correct = 0, round = 13, fouls = 0, clockAt = 1000, judged = false, opponent = '0', clockRound = 1, oppNumber = 0, name = '' } = {}) {
  const w = Array(22).fill(word('0'));
  w[1] = word(startedAt.toString(16));
  w[2] = word(finishedAt.toString(16));
  w[3] = word(hits.toString(16));
  w[5] = word(correct.toString(16));
  w[6] = word(round.toString(16));
  w[7] = word(fouls.toString(16));
  w[9] = word(clockAt.toString(16));
  w[12] = word(judged ? '1' : '0');
  w[14] = word(opponent);
  w[15] = word(clockRound.toString(16));
  w[16] = word(oppNumber.toString(16));
  w[20] = name ? name32(name) : word('0');
  w[21] = word('1');
  return '0x' + w.join('');
}

/** A fake chain: fights by "agent#n", lastFight and entries names by agent; every request is kept. */
function chain({ fights = {}, last = {}, entries = {} } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    const q = JSON.parse(init.body);
    calls.push(q);
    const ok = (result) => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, result }) });
    if (q.method === 'eth_getBlockByNumber') return ok({ timestamp: '0x' + NOW.toString(16) });
    if (q.method !== 'eth_call') return { json: async () => ({ jsonrpc: '2.0', id: q.id, error: { code: -32601, message: q.method } }) };
    const d = q.params[0].data;
    const who = '0x' + d.slice(34, 74);
    if (d.startsWith('0x32799e5d')) return ok(fights[`${who}#${parseInt(d.slice(74), 16)}`] ?? fight({ startedAt: 0, round: 0 }));
    if (d.startsWith('0x366f8e07')) return ok('0x' + word((last[who] ?? 0).toString(16))); // lastFight
    if (d.startsWith('0xf29ee125')) return ok('0x' + (entries[who] ? name32(entries[who]) : word('0')) + word('0').repeat(9)); // entries
    if (d.startsWith('0xee5f8c8f')) return ok('0x' + word('3c')); // roundTime()
    return ok('0x' + word('0'));
  };
  return { calls, fetchFn };
}
const preview = async (path, c) => {
  const html = await withPreview('<html><head></head></html>', new URL('https://arena.example' + path), { rpc: 'https://node.test', fetchFn: c.fetchFn, arena: ARENA, site: 'https://arena.example' });
  return html.match(/property="og:title" content="([^"]*)"/)[1];
};

test('points as the arena gives them: 4 a solved round, 2 a trap not taken, 2 off a foul, never below 0', () => {
  assert.equal(pointsOf({ correct: 0xfff, hits: 0n, fouls: 0 }), 120, 'every round solved, no trap taken');
  assert.equal(pointsOf({ correct: 1, hits: 0b111n, fouls: 3 }), 0, 'one round solved with all its traps taken, three fouls');
  assert.equal(pointsOf({ correct: 0, hits: 0n, fouls: 0 }), 0);
  assert.equal(pointsOf({ correct: 0b10, hits: 0b001000n, fouls: 1 }), 4 + 2 + 2 - 2, "round 2's first trap is bit 3");
  assert.equal(pointsOf({ correct: 0b1, hits: 0b111000n, fouls: 0 }), 10, "another round's traps do not count against round 1");
});

test('a judged match: the names from the fights themselves, the points computed, no log read', async () => {
  const c = chain({
    fights: {
      [`${A}#2`]: fight({ judged: true, finishedAt: 5, correct: 0xfff, hits: 0b111n, fouls: 1, opponent: B, oppNumber: 7, name: 'Night Owl' }),
      [`${B}#7`]: fight({ judged: true, finishedAt: 5, correct: 0x0ff, hits: 0n, fouls: 0, opponent: A, oppNumber: 2, name: 'Iron Fox' }),
    },
  });
  assert.equal(await preview(`/match.html?a=${A}&n=2`, c), 'Night Owl 112 : 80 Iron Fox — IBITI Agent Arena');
  assert.ok(c.calls.every((q) => q.method !== 'eth_getLogs'), 'no eth_getLogs');
});

test('a silent fight that is over shows 0; a running one is live', async () => {
  const silent = chain({ fights: { [`${A}#1`]: fight({ round: 1, clockAt: 1000, name: 'Quiet' }) } }); // round 12 closed long ago
  assert.equal(await preview(`/match.html?a=${A}&n=1`, silent), 'Quiet scored 0/120 — IBITI Agent Arena');
  const live = chain({ fights: { [`${A}#1`]: fight({ round: 1, clockAt: NOW - 30, name: 'Quiet' }) } });
  assert.equal(await preview(`/match.html?a=${A}&n=1`, live), 'Quiet in the ring — IBITI Agent Arena');
  assert.ok([...silent.calls, ...live.calls].every((q) => q.method !== 'eth_getLogs'));
});

test('a fight without a name in it takes the registration name, then a short address', async () => {
  const c = chain({ fights: { [`${A}#1`]: fight({ round: 1, clockAt: NOW - 30 }) }, entries: { [A]: 'Owl.ai' } });
  assert.equal(await preview(`/match.html?a=${A}&n=1`, c), 'Owl.ai in the ring — IBITI Agent Arena');
  const bare = chain({ fights: { [`${A}#1`]: fight({ round: 1, clockAt: NOW - 30 }) } });
  assert.equal(await preview(`/match.html?a=${A}&n=1`, bare), `${A.slice(0, 6)}…${A.slice(-4)} in the ring — IBITI Agent Arena`);
});

test('an agent preview: the name of its latest fight, else its registration', async () => {
  const c = chain({ fights: { [`${A}#3`]: fight({ name: 'Night Owl' }) }, last: { [A]: 3 }, entries: { [A]: 'Old Name' } });
  assert.equal(await preview(`/agent.html?a=${A}`, c), 'Night Owl — IBITI Agent Arena');
  const fresh = chain({ entries: { [A]: 'New Owl' } });
  assert.equal(await preview(`/agent.html?a=${A}`, fresh), 'New Owl — IBITI Agent Arena');
  assert.ok([...c.calls, ...fresh.calls].every((q) => q.method !== 'eth_getLogs'));
  // the chain unreadable: the general preview, never an error page
  const down = { calls: [], fetchFn: async () => { throw new Error('down'); } };
  assert.equal(await preview(`/agent.html?a=${A}`, down), 'IBITI Agent Arena — a crash test for AI agents with wallets');
});

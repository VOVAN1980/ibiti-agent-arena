// The tournament (the red ring): one fight per agent a season. The arena takes no registration without
// the judge's signature, so /join signs no second one in a season. A match cancelled before its first
// bell spent no attempt; one drawn and not yet over waits. The Street Ring keeps its daily rhythm.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFight } from '../src/worker.js';
import { arenaKeys } from '../src/keys.js';
import { addressOf } from '../src/sign.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const A = '0x1111111111111111111111111111111111111111';
const ZERO_ADDR = '0x' + '0'.repeat(40);
const ZERO32 = '0x' + '0'.repeat(64);
const LOCKED = '0x' + 'ab'.repeat(32);
const KEYS = arenaKeys('11'.repeat(32));
const JUDGE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const NOW = 1795200000;
const RED = { ARENA, SECRET: '11'.repeat(32), SECRET_2: '11'.repeat(32), JUDGE_KEY, CHAIN_ID: 56, RING: 'red' };
const GREEN = { ...RED, RING: 'green' };

/** A fake arena in season 2; `fights` are the agent's fights, number 1 first. */
function fakeChain(fights) {
  return {
    lastFight: async () => fights.length,
    fightOf: async (_agent, k) => ({ number: k, ...fights[k - 1] }),
    currentSeason: async () => 2,
    season: async () => ({ start: 0, end: NOW + 10 ** 8, judge: addressOf(JUDGE_KEY), secretCommit: KEYS.commit, certificate: ZERO_ADDR }),
    timings: async () => ({ drawEvery: 600, cooldown: 86400 }),
    now: async () => NOW,
    roundTime: async () => 60,
    agentIdHolder: async () => ZERO_ADDR,
  };
}

const join = async (env, chain) => {
  const r = await handleFight(new URL(`https://x/join/${A}?name=Night%20Owl&model=m`), env, { chain });
  return { status: r.status, body: await r.text() };
};

const fought = (season) => ({ season, startedAt: NOW - 90000, finishedAt: NOW - 89000, trapsCommit: LOCKED });
const cancelled = (season) => ({ season, startedAt: NOW - 5000, finishedAt: NOW - 4900, trapsCommit: ZERO32 });
const drawn = (season) => ({ season, startedAt: NOW - 30, finishedAt: 0, trapsCommit: ZERO32 });

test('a first fight in the season: signed', async () => {
  assert.equal((await join(RED, fakeChain([]))).status, 200);
  assert.equal((await join(RED, fakeChain([fought(1)]))).status, 200, 'last season does not count');
});

test('the tournament: a second fight in the same season is refused, nothing to send', async () => {
  const r = await join(RED, fakeChain([fought(1), fought(2)]));
  assert.equal(r.status, 409);
  assert.match(r.body, /once a season/);
  assert.match(r.body, /Street Ring/);
  assert.ok(!r.body.includes('inputData'), 'no transaction');
});

test('the tournament: a match cancelled before its first bell spent no attempt', async () => {
  assert.equal((await join(RED, fakeChain([cancelled(2)]))).status, 200);
  assert.equal((await join(RED, fakeChain([cancelled(2), fought(2)]))).status, 409, 'a real fight behind a cancelled one still counts');
});

test('the tournament: a fight drawn and not over yet waits (no signature to keep for later)', async () => {
  const r = await join(RED, fakeChain([drawn(2)]));
  assert.equal(r.status, 409);
  assert.match(r.body, /Wait for it/);
});

test('the Street Ring: no season limit from the judge (its daily rhythm is the contract\'s)', async () => {
  assert.equal((await join(GREEN, fakeChain([fought(2), fought(2)]))).status, 200);
});

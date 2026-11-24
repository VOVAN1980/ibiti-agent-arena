// /join tells an agent before it sends whether its registration is official (its own Agent ID name),
// open, or one the arena would refuse (NameTaken), the way AgentArena._agentIdOf decides it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFight } from '../src/worker.js';
import { keccak256 } from '../src/keccak.js';
import { arenaKeys } from '../src/keys.js';
import { addressOf } from '../src/sign.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const REGISTRY = '0x9b4e1f0a2c3d5e6f708192a3b4c5d6e7f8091a2b';
const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
const ZERO_ADDR = '0x' + '0'.repeat(40);
const KEYS = arenaKeys('11'.repeat(32));
const JUDGE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ENV = { ARENA, SECRET: '11'.repeat(32), JUDGE_KEY, CHAIN_ID: 56 };
const NOW = 1795200000;

const utf8hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
/** The registry's token number of a label: keccak256 of its bytes. */
const tokenOf = (label) => keccak256(utf8hex(label)).toLowerCase();

/** A fake arena in a running season, with a fake Agent ID registry: `holders` maps a label to its
 *  holder. Every token number the server asks about is kept in `asked`. */
function fakeChain(holders = {}) {
  const byToken = Object.fromEntries(Object.entries(holders).map(([label, who]) => [tokenOf(label), who]));
  const asked = [];
  return {
    asked,
    lastFight: async () => 2,
    currentSeason: async () => 1,
    season: async () => ({ start: 0, end: NOW + 10 ** 8, judge: addressOf(JUDGE_KEY), secretCommit: KEYS.commit, certificate: ZERO_ADDR }),
    timings: async () => ({ drawEvery: 600, cooldown: 3600 }),
    now: async () => NOW,
    roundTime: async () => 60,
    agentIdHolder: async (tokenId) => {
      asked.push(tokenId.toLowerCase());
      return byToken[tokenId.toLowerCase()] ?? ZERO_ADDR;
    },
  };
}

const join = async (name, chain, env = ENV, deps = {}) => {
  const r = await handleFight(new URL(`https://x/join/${A}?name=${encodeURIComponent(name)}&model=m`), env, { chain, ...deps });
  const body = await r.text();
  return { status: r.status, body, json: r.status === 200 ? JSON.parse(body) : null };
};

test('its own Agent ID, with or without ".ai" and in any case: official', async () => {
  for (const name of ['ibitilabs', 'IbitiLabs', 'ibitilabs.ai', 'IBITILABS.AI']) {
    const chain = fakeChain({ ibitilabs: A });
    const r = await join(name, chain);
    assert.equal(r.status, 200, name);
    assert.equal(r.json.official, true, name);
    assert.match(r.json.officialNote, /official ranking/);
    assert.ok(r.json.transaction.inputData, 'the transaction comes with it');
    assert.deepEqual(chain.asked, [tokenOf('ibitilabs')], 'only the label it asked for, nothing else');
  }
});

test('a name that is no Agent ID: open, with the transaction', async () => {
  const chain = fakeChain({ ibitilabs: B });
  const r = await join('Night Owl', chain);
  assert.equal(r.status, 200);
  assert.equal(r.json.official, false);
  assert.match(r.json.officialNote, /only in the open ranking/);
  assert.deepEqual(chain.asked, [tokenOf('night owl')], 'lowered like the contract does');
});

test('a ".ai" name it does not hold: refused before any gas, holder never named', async () => {
  for (const [name, holders] of [['nobody.ai', {}], ['ibitilabs.ai', { ibitilabs: B }], ['IbitiLabs.Ai', { ibitilabs: B }]]) {
    const r = await join(name, fakeChain(holders));
    assert.equal(r.status, 409, name);
    assert.match(r.body, /NameTaken/);
    assert.match(r.body, /name without "\.ai"/);
    assert.ok(!r.body.toLowerCase().includes(B.slice(2)), 'no holder in the answer');
    assert.ok(!r.body.includes('inputData'), 'no transaction');
  }
});

test('another holder\'s Agent ID name without ".ai": refused (the arena reverts it too)', async () => {
  const r = await join('IbitiLabs', fakeChain({ ibitilabs: B }));
  assert.equal(r.status, 409);
  assert.match(r.body, /NameTaken/);
  assert.ok(!r.body.toLowerCase().includes(B.slice(2)), 'no holder in the answer');
});

test('".ai" alone has no label: refused without asking the registry', async () => {
  const chain = fakeChain();
  const r = await join('.AI', chain);
  assert.equal(r.status, 409);
  assert.deepEqual(chain.asked, []);
});

test('only A-Z are lowered, as in the contract; the 32-byte limit stays first', async () => {
  const chain = fakeChain({ 'Äb': A });
  const r = await join('ÄB.ai', chain);
  assert.equal(r.status, 200);
  assert.equal(r.json.official, true);
  assert.deepEqual(chain.asked, [tokenOf('Äb')], 'Ä stays as it is');
  const long = fakeChain();
  assert.equal((await join('n'.repeat(30) + '.ai', long)).status, 400, '33 bytes: refused as too long');
  assert.deepEqual(long.asked, [], 'no registry read for a name that cannot register');
  assert.equal((await join('n'.repeat(29) + '.ai', fakeChain({ ['n'.repeat(29)]: A }))).json.official, true, '32 bytes with ".ai": fine');
});

// The server's own registry read: agentIdRegistry() from the arena once, then ownerOf(tokenId).
function fakeRpc(holders, { down = false } = {}) {
  const calls = [];
  const fetchFn = async (url, init) => {
    if (down) throw new Error('network down');
    const { method, params } = JSON.parse(init.body);
    assert.equal(method, 'eth_call');
    const { to, data } = params[0];
    calls.push({ to: to.toLowerCase(), data: data.toLowerCase() });
    const reply = (x) => ({ json: async () => x });
    if (to.toLowerCase() === ARENA && data === '0x8854a0ff') return reply({ result: '0x' + REGISTRY.slice(2).padStart(64, '0') });
    if (to.toLowerCase() === REGISTRY && data.startsWith('0x6352211e')) {
      const who = holders[data.slice(10).toLowerCase()];
      if (!who) return reply({ error: { code: 3, message: 'execution reverted: ERC721: invalid token ID' } }); // OpenZeppelin ERC-721
      return reply({ result: '0x' + who.slice(2).padStart(64, '0') });
    }
    return reply({ error: { code: -32601, message: 'unexpected call' } });
  };
  return { calls, fetchFn };
}

test('the server reads the registry itself: the arena\'s registry once, then that one token', async () => {
  const chain = fakeChain();
  delete chain.agentIdHolder; // the real chain reader has none: the worker reads through RPC_URL
  const env = { ...ENV, RPC_URL: 'https://rpc.invalid' };
  const rpc = fakeRpc({ [tokenOf('owl').slice(2)]: A, [tokenOf('cat').slice(2)]: B });
  let r = await join('Owl.ai', chain, env, { fetchFn: rpc.fetchFn });
  assert.equal(r.status, 200);
  assert.equal(r.json.official, true);
  assert.equal((await join('dog.ai', chain, env, { fetchFn: rpc.fetchFn })).status, 409, 'no such Agent ID: ownerOf reverts, refused');
  assert.equal((await join('cat.ai', chain, env, { fetchFn: rpc.fetchFn })).status, 409, "another holder's");
  r = await join('dog', chain, env, { fetchFn: rpc.fetchFn });
  assert.equal(r.json.official, false, 'no Agent ID: open');
  assert.deepEqual(rpc.calls.filter((c) => c.to === ARENA), [{ to: ARENA, data: '0x8854a0ff' }], 'agentIdRegistry() read once');
  assert.deepEqual(rpc.calls.filter((c) => c.to === REGISTRY).map((c) => c.data), ['owl', 'dog', 'cat', 'dog'].map((l) => '0x6352211e' + tokenOf(l).slice(2)), 'one ownerOf per request, of its own label');
});

test('the registry cannot be read: a ".ai" name waits, another name gets no promise', async () => {
  const chain = fakeChain();
  delete chain.agentIdHolder;
  const env = { ...ENV, RPC_URL: 'https://rpc.invalid' };
  const { fetchFn } = fakeRpc({}, { down: true });
  assert.equal((await join('owl.ai', chain, env, { fetchFn })).status, 503);
  const r = await join('owl', chain, env, { fetchFn });
  assert.equal(r.status, 200);
  assert.equal(r.json.official, null);
  assert.match(r.json.officialNote, /could not be read/);
});

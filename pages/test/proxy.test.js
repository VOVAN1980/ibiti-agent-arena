// The site's /rpc window over several nodes (host.js + rpc.js): a rate-limited node is not an error
// for the visitor, wide log ranges go only to a node that serves them, the checks before forwarding
// are unchanged, and a failed calendar read is retried after 5 s, not a minute.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import host from '../src/host.js';
import { COOLDOWNS } from '../src/rpc.js';
import { clearCache } from '../src/cache.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const BOOK = '0x' + 'b0'.repeat(20);
const CERT = '0x' + 'ce'.repeat(20);
const PN = 'https://publicnode.test';
const CLUB = 'https://club.test';
const NINI = 'https://ninicoin.test';
const SITE = [{ url: PN, logs: 50000 }, { url: CLUB, logs: 250 }, { url: NINI, logs: 0 }];
const ENV = { ARENA, CHAIN_ID: 56, RPC_URL: 'https://judge.test', SITE_RPC_URLS: JSON.stringify(SITE), ASSETS: { fetch: async () => new Response('no', { status: 404 }) } };
const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');

/** Fake nodes behind the global fetch: `answer(url, q)` gives a JSON body, a Response, or throws. */
async function withNodes(answer, fn) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    // a JSON-RPC batch (the season calendar's seasons): each call answered as alone, one response
    const parts = [];
    for (const q of Array.isArray(body) ? body : [body]) {
      calls.push({ url, q });
      parts.push(await answer(url, q));
    }
    const out = Array.isArray(body) ? (parts.find((x) => x instanceof Response) ?? parts) : parts[0];
    return out instanceof Response ? out : new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  };
  COOLDOWNS.clear();
  clearCache(); // each test starts with nothing kept from another
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = real;
    COOLDOWNS.clear();
    clearCache();
  }
}
const ask = (method, params, env = ENV) => host.fetch(new Request('https://arena.example/rpc', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 3, method, params }) }), env).then((r) => r.json());
const limited = (q) => ({ jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'rate limit exceeded' } });
const logs = (from, to) => [{ address: ARENA, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16) }];

test('the proxy falls back to the next site node when the first one rate-limits', async () => {
  await withNodes((url, q) => (url === PN ? limited(q) : { jsonrpc: '2.0', id: q.id, result: '0x7b' }), async (calls) => {
    assert.deepEqual(await ask('eth_blockNumber', []), { jsonrpc: '2.0', id: 3, result: '0x7b' });
    assert.deepEqual(calls.map((c) => c.url), [PN, CLUB]);
    assert.ok(calls.every((c) => c.url !== ENV.RPC_URL), "the audience never spends the judge's nodes");
  });
  await withNodes((url, q) => (url === PN ? new Response('<html>busy</html>', { status: 429 }) : { jsonrpc: '2.0', id: q.id, result: '0x38' }), async () => {
    assert.equal((await ask('eth_chainId', [])).result, '0x38', 'an HTTP 429 too');
  });
});

test('a small log range falls back to the narrow node in pieces; a replay-wide one only to the wide node', async () => {
  await withNodes((url, q) => (url === PN ? limited(q) : { jsonrpc: '2.0', id: q.id, result: [{ from: q.params[0].fromBlock }] }), async (calls) => {
    const j = await ask('eth_getLogs', logs(1000, 1599));
    assert.deepEqual(j.result.map((l) => l.from), ['0x3e8', '0x4e2', '0x5dc'], 'three 250-block pieces, joined in order');
    assert.deepEqual(calls.map((c) => c.url), [PN, CLUB, CLUB, CLUB]);
    assert.ok(!calls.some((c) => c.url === NINI), 'never to a node without logs');
  });
  await withNodes((url, q) => (url === PN ? limited(q) : assert.fail('a 50000-block chunk sent to a narrow node')), async (calls) => {
    const j = await ask('eth_getLogs', logs(0, 49999));
    assert.equal(j.error.code, -32005, 'the site sees an error and retries its poll later');
    assert.ok(calls.every((c) => c.url === PN));
  });
});

test('the checks before forwarding are unchanged; without SITE_RPC_URLS the site reads through RPC_URL', async () => {
  await withNodes((url, q) => ({ jsonrpc: '2.0', id: q.id, result: url }), async (calls) => {
    assert.equal((await ask('eth_getLogs', logs(0, 60000))).error.message, 'a range of at most 50000 blocks');
    assert.equal((await ask('eth_call', [{ to: '0x' + '99'.repeat(20), data: '0x78a2ce59' }, 'latest'], { ...ENV, SEASON_BOOK: BOOK })).error.message, 'this arena only');
    assert.equal((await ask('eth_sendRawTransaction', ['0x01'])).error.message, 'read-only');
    // (an unknown address makes the server read the season calendar; nothing refused is forwarded)
    assert.ok(calls.every((c) => c.q.method === 'eth_call' && c.q.params[0].to !== '0x' + '99'.repeat(20)), 'nothing refused reached a node');
    const testnet = { ...ENV, SITE_RPC_URLS: undefined, RPC_URL: 'https://testnet.test' };
    assert.equal((await ask('eth_blockNumber', [], testnet)).result, 'https://testnet.test');
  });
});

test('a calendar read that failed is retried after 5 s, not a minute', async () => {
  let down = true;
  const realNow = Date.now;
  let shift = 60000; // past any calendar kept by an earlier test
  Date.now = () => realNow() + shift;
  try {
    await withNodes((url, q) => {
      if (down) return limited(q);
      const { to, data } = q.params[0];
      if (data === '0xfda7b9db') return { jsonrpc: '2.0', id: q.id, result: '0x' + word(BOOK) }; // seasonBook()
      if (to === BOOK && data === '0x715f8fe8') return { jsonrpc: '2.0', id: q.id, result: '0x' + word('1') }; // seasonCount()
      if (to === BOOK && data.startsWith('0x6ebaeda9')) return { jsonrpc: '2.0', id: q.id, result: '0x' + [word('0'), word('64'), word('0'), word('0'), word(CERT)].join('') };
      return { jsonrpc: '2.0', id: q.id, result: '0x' + word('5') }; // top()
    }, async (calls) => {
      const top = () => ask('eth_call', [{ to: CERT, data: '0xfe6dcdba' }, 'latest']);
      assert.equal((await top()).error.message, 'this arena only', 'the calendar could not be read');
      down = false;
      const before = calls.length;
      assert.equal((await top()).error.message, 'this arena only', 'within 5 s: the empty answer is kept');
      assert.equal(calls.length, before, 'no new calendar read');
      shift += 6000;
      assert.equal((await top()).result, '0x' + word('5'), 'after 5 s: read again, and the season contract is known');
    });
  } finally {
    Date.now = realNow;
  }
});

test("the fighters' side reads over RPC_URLS: one rate-limited node is not a failed page", async () => {
  const { handleFight } = await import('../src/worker.js');
  const DS = 'https://dataseed.test';
  const env = { ...ENV, RPC_URLS: [{ url: DS, logs: 0, send: true }, { url: PN, logs: 50000, send: true }] };
  await withNodes((url, q) => {
    if (url === DS) return limited(q);
    const data = q.params[0].data;
    if (data === '0xee5f8c8f') return { jsonrpc: '2.0', id: q.id, result: '0x' + word('2d') }; // roundTime() = 45
    if (data === '0xa2fcf826') return { jsonrpc: '2.0', id: q.id, result: '0x' + word('258') }; // drawEvery() = 600
    return { jsonrpc: '2.0', id: q.id, result: '0x' + word('3c') }; // cooldown()
  }, async (calls) => {
    const body = await (await handleFight(new URL('https://arena.example/skill.md'), env)).text();
    assert.match(body, /Each round is open for 45 seconds/, 'read from the second node');
    assert.ok(calls.some((c) => c.url === DS) && calls.some((c) => c.url === PN));
  });
});

test('a wide replay chunk gets the time its width needs, not a plain call\'s 2.5 s', async () => {
  // publicnode answers 20000 blocks of the arena in 9-14 s on mainnet; here 2.7 s, past a plain call's 2.5 s
  await withNodes(async (url, q) => {
    if (url !== PN) return assert.fail('a 20000-block chunk sent to a narrow node');
    await new Promise((r) => setTimeout(r, 2700));
    return { jsonrpc: '2.0', id: q.id, result: [{ ok: 1 }] };
  }, async (calls) => {
    const j = await ask('eth_getLogs', logs(100000, 119999));
    assert.deepEqual(j.result, [{ ok: 1 }]);
    assert.equal(calls.length, 1, 'one request, not three aborted ones');
  });
});

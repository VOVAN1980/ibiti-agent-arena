// rpc.js: several public nodes behind one fetch, each call kind routed to the nodes that serve it,
// bounded retries, and nothing past the budget or the deadline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rpcFetch, endpointsOf, COOLDOWN_MS } from '../src/rpc.js';

const A = 'https://a.test'; // a dataseed: calls and sends, no logs
const B = 'https://b.test';
const C = 'https://c.test';
const fast = { wait: async () => {} };

/** Fake nodes: `nodes[url](q, n)` answers the n-th request to that node (q: the call, or the batch). */
function net(nodes) {
  const calls = [];
  const counts = {};
  const fetchFn = async (url, init) => {
    const q = JSON.parse(init.body);
    calls.push({ url, q });
    counts[url] = (counts[url] ?? 0) + 1;
    return nodes[url](q, counts[url]);
  };
  return { calls, fetchFn };
}
// replies with only json(), as the tests' fakes give them
const ok = (q, result) => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, result }) });
const err = (q, code, message) => ({ json: async () => ({ jsonrpc: '2.0', id: q.id, error: { code, message } }) });
const http = (status) => ({ status, json: async () => { throw new SyntaxError('<html>'); } });
const limited = (q) => err(q, -32005, 'rate limit exceeded');
const hang = () => new Promise(() => {});
const ask = (f, method, params = [], id = 7) => f('ignored', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) });
const askJson = async (...a) => (await ask(...a)).json();
const range = (from, to) => [{ address: '0x' + '11'.repeat(20), fromBlock: '0x' + from.toString(16), toBlock: typeof to === 'number' ? '0x' + to.toString(16) : to }];
const span = (c) => [parseInt(c.q.params[0].fromBlock, 16), c.q.params[0].toBlock.startsWith('0x') ? parseInt(c.q.params[0].toBlock, 16) : c.q.params[0].toBlock];

test('the nodes of a setting: a list (JSON or its text), else the single URL as a node that does everything', () => {
  const list = [{ url: A, logs: 0, send: true }, { url: B, logs: 250 }, { url: 'not a url', logs: 5 }];
  assert.deepEqual(endpointsOf({ RPC_URLS: list, RPC_URL: C }, 'RPC_URL'), [{ url: A, logs: 0, send: true }, { url: B, logs: 250, send: false }]);
  assert.deepEqual(endpointsOf({ RPC_URLS: JSON.stringify(list) }, 'RPC_URL').length, 2, 'as JSON text');
  assert.deepEqual(endpointsOf({ RPC_URL: C }, 'RPC_URL'), [{ url: C, logs: 50000, send: true }], 'the testnet: one node, as before');
  assert.deepEqual(endpointsOf({ RPC_URLS: '[broken', RPC_URL: C }, 'RPC_URL'), [{ url: C, logs: 50000, send: true }]);
  assert.deepEqual(endpointsOf({}, 'SITE_RPC_URL'), []);
});

test('a rate limit (-32005), HTTP 429 and a timeout move the call to the next node', async () => {
  for (const [what, bad] of [['-32005', limited], ['429', () => http(429)], ['502', () => http(502)], ['not JSON', () => http(200)], ['network', () => { throw new TypeError('fetch failed'); }], ['timeout', hang]]) {
    const { calls, fetchFn } = net({ [A]: bad, [B]: (q) => ok(q, '0x10') });
    const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, timeoutMs: 20, ...fast });
    const res = await ask(f, 'eth_blockNumber');
    assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 7, result: '0x10' }, what);
    assert.deepEqual(calls.map((c) => c.url), [A, B], what);
    assert.equal(res.attempts, 2, what);
  }
});

test('an answer about the call itself comes back unchanged after one attempt', async () => {
  const cases = [
    [3, 'execution reverted: NameTaken'],
    [-32000, 'execution reverted'],
    [-32000, 'nonce too low'],
    [-32000, 'already known'],
    [-32000, 'replacement transaction underpriced'],
    [-32000, 'insufficient funds for gas * price + value'],
    [-32602, 'invalid argument 0: hex string without 0x prefix'],
  ];
  for (const [code, message] of cases) {
    const { calls, fetchFn } = net({ [A]: (q) => err(q, code, message), [B]: (q) => ok(q, '0x') });
    const f = rpcFetch([{ url: A, send: true }, { url: B, send: true }], { fetchFn, ...fast });
    assert.deepEqual(await askJson(f, 'eth_sendRawTransaction', ['0xf86b']), { jsonrpc: '2.0', id: 7, error: { code, message } }, message);
    assert.equal(calls.length, 1, message);
  }
});

test('eth_getLogs skips the nodes that serve no logs', async () => {
  const { calls, fetchFn } = net({ [A]: () => assert.fail('a dataseed got a log read'), [B]: (q) => ok(q, [{ n: 1 }]) });
  const f = rpcFetch([{ url: A, logs: 0, send: true }, { url: B, logs: 50000 }], { fetchFn, ...fast });
  assert.deepEqual((await askJson(f, 'eth_getLogs', range(100, 200))).result, [{ n: 1 }]);
  assert.deepEqual(calls.map((c) => c.url), [B]);
});

test('a numeric range is split to the node\'s width, in order; a range to "latest" never is', async () => {
  const { calls, fetchFn } = net({ [B]: (q) => ok(q, [parseInt(q.params[0].fromBlock, 16)]) });
  const f = rpcFetch([{ url: B, logs: 1000 }], { fetchFn, maxPieces: 5, ...fast });
  const j = await askJson(f, 'eth_getLogs', range(1000, 5999));
  assert.deepEqual(calls.map(span), [[1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999], [5000, 5999]]);
  assert.deepEqual(j, { jsonrpc: '2.0', id: 7, result: [1000, 2000, 3000, 4000, 5000] }, 'joined in order, as one answer');
  // 'latest' with no head seen yet: one request, the node decides
  calls.length = 0;
  await askJson(f, 'eth_getLogs', range(1000, 'latest'));
  assert.deepEqual(calls.map(span), [[1000, 'latest']]);
  // with the head known (5999), 5000 blocks to 'latest' do not fit 1000: no node for it, nothing split
  const g = rpcFetch([{ url: B, logs: 1000 }], { fetchFn: async (url, init) => {
    const q = JSON.parse(init.body);
    calls.push({ url, q });
    return q.method === 'eth_blockNumber' ? ok(q, '0x176f') : ok(q, []);
  }, ...fast });
  await ask(g, 'eth_blockNumber');
  calls.length = 0;
  const j2 = await askJson(g, 'eth_getLogs', range(1000, 'latest'));
  assert.match(j2.error.message, /no node serves eth_getLogs/);
  assert.deepEqual(calls, [], 'never sent, never split');
  assert.equal((await askJson(g, 'eth_getLogs', range(5500, 'latest'))).result.length, 0, 'a narrow one goes');
});

test('a node that would need more than maxPieces pieces is skipped; a call may allow more', async () => {
  const { calls, fetchFn } = net({ [B]: (q) => ok(q, []), [C]: (q) => ok(q, []) });
  const f = rpcFetch([{ url: B, logs: 1000 }, { url: C, logs: 50000 }], { fetchFn, maxPieces: 4, ...fast });
  await ask(f, 'eth_getLogs', range(0, 4999));
  assert.deepEqual(calls.map((c) => c.url), [C], 'five pieces: the wide node');
  calls.length = 0;
  await f.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: range(0, 4999) }, { maxPieces: 12 });
  assert.deepEqual(calls.map((c) => c.url), [B, B, B, B, B], 'allowed for this call');
});

test('a send goes only to send:true nodes, and a retry sends the very same bytes', async () => {
  const raw = '0xf86b0585012a05f2008252089470997970c51812dc3a010c7d01b50e0d17dc79c880801ba0';
  const { calls, fetchFn } = net({ [A]: () => http(503), [B]: () => assert.fail('the MEV relay got a transaction'), [C]: (q) => ok(q, '0xhash') });
  const f = rpcFetch([{ url: A, send: true }, { url: B, logs: 250, send: false }, { url: C, send: true }], { fetchFn, ...fast });
  const res = await ask(f, 'eth_sendRawTransaction', [raw]);
  assert.equal((await res.json()).result, '0xhash');
  assert.deepEqual(calls.map((c) => [c.url, c.q.params[0]]), [[A, raw], [C, raw]]);
  assert.equal(res.attempts, 2, 'the caller learns that the send was retried');
});

test('after a log read answered by the log node, the next call still starts at the first node', async () => {
  const { calls, fetchFn } = net({ [A]: (q) => ok(q, '0x1'), [B]: (q) => ok(q, []) });
  const f = rpcFetch([{ url: A, logs: 0, send: true }, { url: B, logs: 50000 }], { fetchFn, ...fast });
  await ask(f, 'eth_getLogs', range(1, 2));
  await ask(f, 'eth_call', [{ to: '0x' + '11'.repeat(20), data: '0x12345678' }, 'latest']);
  await ask(f, 'eth_sendRawTransaction', ['0x01']);
  assert.deepEqual(calls.map((c) => c.url), [B, A, A]);
});

test('a node that rate-limited cools down for 30 s: tried last, then first again', async () => {
  let t = 1000;
  const { calls, fetchFn } = net({ [A]: (q, n) => (n === 1 ? limited(q) : ok(q, 'a')), [B]: (q) => ok(q, 'b') });
  const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, now: () => t, ...fast });
  assert.equal((await askJson(f, 'eth_chainId')).result, 'b');
  assert.equal((await askJson(f, 'eth_chainId')).result, 'b', 'A cools down');
  t += COOLDOWN_MS + 1;
  assert.equal((await askJson(f, 'eth_chainId')).result, 'a', 'back at the front');
  assert.deepEqual(calls.map((c) => c.url), [A, B, B, A]);
  assert.match(f.summary(), /^rpc: a\.test 1 ok 1 failed \(rate limit 1\); b\.test 2 ok$/);
});

test('the budget and the deadline stop new attempts', async () => {
  const { calls, fetchFn } = net({ [A]: limited, [B]: limited });
  const budget = { left: 3 };
  const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, tries: 10, budget, ...fast });
  const j = await askJson(f, 'eth_chainId');
  assert.equal(calls.length, 3, 'three attempts, then the budget is spent');
  assert.equal(budget.left, 0);
  assert.equal(j.error.code, -32603);
  assert.match((await askJson(f, 'eth_chainId')).error.message, /budget/);
  assert.equal(calls.length, 3, 'nothing more');
  let t = 0;
  const late = net({ [A]: (q) => ok(q, '0x1') });
  const g = rpcFetch([{ url: A }], { fetchFn: late.fetchFn, deadline: 100, now: () => t, ...fast });
  assert.equal((await askJson(g, 'eth_chainId')).result, '0x1');
  t = 101;
  assert.match((await askJson(g, 'eth_chainId')).error.message, /out of time/);
  assert.equal(late.calls.length, 1);
});

test('exhausted: the last node error is returned as a JSON-RPC error, never thrown', async () => {
  const { fetchFn } = net({ [A]: limited });
  const f = rpcFetch([{ url: A }], { fetchFn, tries: 3, ...fast });
  const res = await ask(f, 'eth_chainId');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { jsonrpc: '2.0', id: 7, error: { code: -32005, message: 'rate limit exceeded' } });
  assert.equal(res.attempts, 3, 'one node: tried again, up to `tries`');
  assert.deepEqual(await askJson(rpcFetch([], fast), 'eth_chainId'), { jsonrpc: '2.0', id: 7, error: { code: -32603, message: 'no node serves eth_chainId for this request' } });
});

test('a batch is answered by one node; a node that takes no batches is asked one by one, still alone', async () => {
  const pair = [{ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: ['0xme', 'pending'] }, { jsonrpc: '2.0', id: 2, method: 'eth_getTransactionCount', params: ['0xme', 'latest'] }];
  const both = (q, p, l) => ({ json: async () => q.map((x) => ({ jsonrpc: '2.0', id: x.id, result: x.params[1] === 'pending' ? p : l })) });
  // A takes no batches and rate-limits the second single: the whole pair is read again from B
  const { calls, fetchFn } = net({
    [A]: (q, n) => (Array.isArray(q) ? err({ id: null }, -32600, 'batch not supported') : n === 2 ? ok(q, '0x6') : limited(q)),
    [B]: (q) => both(q, '0x7', '0x7'),
  });
  const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, ...fast });
  const r = await f.batch(pair);
  assert.deepEqual(r.j.map((x) => x.result), ['0x7', '0x7'], 'never pending from one node and latest from another');
  assert.equal(r.node, B);
  assert.deepEqual(calls.map((c) => [c.url, Array.isArray(c.q)]), [[A, true], [A, false], [A, false], [B, true]]);
  // through the fetch interface too
  const res = await f('x', { method: 'POST', body: JSON.stringify(pair) });
  assert.deepEqual((await res.json()).map((x) => x.id), [1, 2]);
});

test('a node that fails in a way that is not about the call cools down: one failed request, not one a call', async () => {
  const cases = [
    ['timeout', hang],
    ['network', () => { throw new TypeError('fetch failed'); }],
    ['HTTP 403 page', () => ({ status: 403, json: async () => { throw new SyntaxError('<html>'); } })],
    ['HTTP 404', () => ({ status: 404, json: async () => ({ message: 'not found' }) })],
    ['not JSON', () => http(200)],
    ['JSON, not JSON-RPC', () => ({ json: async () => ({ message: 'forbidden' }) })],
  ];
  for (const [what, bad] of cases) {
    const { calls, fetchFn } = net({ [A]: bad, [B]: (q) => ok(q, '0x10') });
    const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, timeoutMs: 20, cooldowns: new Map(), ...fast });
    for (let i = 0; i < 4; i++) assert.equal((await askJson(f, 'eth_blockNumber')).result, '0x10', what);
    assert.deepEqual(calls.map((c) => c.url), [A, B, B, B, B], what + ': asked once, then tried last');
  }
  // a 400 that carries a JSON-RPC error about the call is that answer, as it is (no other node asked)
  const { calls, fetchFn } = net({ [A]: (q) => ({ status: 400, json: async () => ({ jsonrpc: '2.0', id: q.id, error: { code: -32602, message: 'invalid argument' } }) }), [B]: (q) => ok(q, '0x10') });
  const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, ...fast });
  assert.equal((await askJson(f, 'eth_call', [{}, 'latest'])).error.message, 'invalid argument');
  assert.deepEqual(calls.map((c) => c.url), [A]);
});

test('a hanging first node costs one timeout of a request, not one per read (shared by the isolate too)', async () => {
  const cooldowns = new Map();
  const { calls, fetchFn } = net({ [A]: hang, [B]: (q) => ok(q, '0x1') });
  const t0 = Date.now();
  const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, timeoutMs: 100, tries: 3, deadline: t0 + 250, cooldowns, ...fast });
  for (let i = 0; i < 4; i++) assert.equal((await askJson(f, 'eth_call', [{}, 'latest'])).result, '0x1', 'read ' + (i + 1));
  assert.ok(Date.now() - t0 < 250, 'four reads inside a deadline that fits only two timeouts');
  // the next request of the same isolate starts at the healthy node
  const g = rpcFetch([{ url: A }, { url: B }], { fetchFn, timeoutMs: 100, cooldowns, ...fast });
  await ask(g, 'eth_call', [{}, 'latest']);
  assert.deepEqual(calls.map((c) => c.url), [A, B, B, B, B, B]);
});

test('an attempt cut short by the deadline is not the node\'s fault: no cooldown, no more attempts', async () => {
  const cooldowns = new Map();
  const { calls, fetchFn } = net({ [A]: hang, [B]: (q) => ok(q, '0x1') });
  const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, timeoutMs: 1000, deadline: Date.now() + 30, cooldowns, ...fast });
  assert.match((await askJson(f, 'eth_chainId')).error.message, /out of time/);
  assert.deepEqual(calls.map((c) => c.url), [A]);
  assert.equal(cooldowns.size, 0);
});

test('a log read gets time by its width, and a log read that timed out is not asked of that node again', async () => {
  // the node answers a log read in 0.25 ms a block (publicnode: 0.2-0.7 ms); a plain call gets 20 ms
  const slowLogs = (q) => new Promise((r) => setTimeout(() => r(ok(q, [])), (parseInt(q.params[0].toBlock, 16) - parseInt(q.params[0].fromBlock, 16) + 1) / 4));
  const { calls, fetchFn } = net({ [B]: slowLogs });
  const f = rpcFetch([{ url: B, logs: 50000 }], { fetchFn, timeoutMs: 20, logsTimeoutMs: 1000, ...fast });
  assert.deepEqual((await askJson(f, 'eth_getLogs', range(0, 399))).result, [], '400 blocks: 100 ms of a 400-ms allowance');
  assert.equal(calls.length, 1);
  const flat = rpcFetch([{ url: B, logs: 50000 }], { fetchFn, timeoutMs: 20, ...fast });
  assert.match((await askJson(flat, 'eth_getLogs', range(0, 399))).error.message, /timeout/, 'without logsTimeoutMs: a plain call\'s time');
  assert.equal(calls.length, 2, 'timed out once: not asked the same wide read again (tries 3)');
  // a wide read that hangs on the only node that serves it: one request, then the error
  const stuck = net({ [B]: hang });
  const g = rpcFetch([{ url: B, logs: 50000 }], { fetchFn: stuck.fetchFn, timeoutMs: 10, logsTimeoutMs: 40, tries: 3, ...fast });
  assert.match((await askJson(g, 'eth_getLogs', range(0, 49999))).error.message, /timeout/);
  assert.equal(stuck.calls.length, 1);
});

test('a batch that times out, fails or gets an HTML page moves to the next node, not to single calls there', async () => {
  const pair = [{ jsonrpc: '2.0', id: 1, method: 'eth_getTransactionCount', params: ['0xme', 'pending'] }, { jsonrpc: '2.0', id: 2, method: 'eth_getTransactionCount', params: ['0xme', 'latest'] }];
  const both = (q) => ({ json: async () => q.map((x) => ({ jsonrpc: '2.0', id: x.id, result: '0x7' })) });
  for (const [what, bad] of [['timeout', hang], ['network', () => { throw new TypeError('fetch failed'); }], ['HTTP 403', () => http(403)], ['not JSON', () => http(200)], ['rate limit in an item', (q) => ({ json: async () => q.map((x) => ({ jsonrpc: '2.0', id: x.id, error: { code: -32005, message: 'rate limit exceeded' } })) })]]) {
    const { calls, fetchFn } = net({ [A]: bad, [B]: both });
    const f = rpcFetch([{ url: A }, { url: B }], { fetchFn, timeoutMs: 20, ...fast });
    const r = await f.batch(pair);
    assert.equal(r.node, B, what);
    assert.deepEqual(calls.map((c) => [c.url, Array.isArray(c.q)]), [[A, true], [B, true]], what);
  }
  // `senders`: only from the nodes our transactions go to, even when they are cooling down
  const { calls, fetchFn } = net({ [A]: (q) => ({ json: async () => q.map((x) => ({ jsonrpc: '2.0', id: x.id, error: { code: -32005, message: 'rate limit exceeded' } })) }), [B]: both });
  const f = rpcFetch([{ url: A, send: true }, { url: B, send: false }], { fetchFn, ...fast });
  const r = await f.batch(pair, { senders: true });
  assert.equal(r.node, null);
  assert.equal(r.j.error.code, -32005);
  assert.ok(calls.every((c) => c.url === A), 'never from a send:false node');
});

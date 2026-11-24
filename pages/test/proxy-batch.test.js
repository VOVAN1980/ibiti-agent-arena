// The site's /rpc window for one poll (host.js + cache.js + archive.js): a JSON-RPC batch answered in
// one response, every call checked with the same rules as a call alone, the calls it still needs sent
// to a node as one request, reads shared through the cache (the isolate's memory; the Cache API only on
// a custom domain, one entry for a poll's calls), the season calendar read once for a whole batch, log
// ranges from the KV archive (a span of 50000 blocks in one read) merged with the live tail, a range
// older than an hour (or any range while the isolate knows no head) only from the archive node, a final
// range kept long only from the archive, and a range not available yet answered with an error for that
// call only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import host, { forgetHead, forgetCalendar } from '../src/host.js';
import { COOLDOWNS } from '../src/rpc.js';
import { clearCache } from '../src/cache.js';
import { chunkKey, spanKey } from '../src/archive.js';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const BOOK = '0x' + 'b0'.repeat(20);
const CLUB = 'https://club.test'; // logs up to 250 blocks
const TW = 'https://thirdweb.test'; // logs up to 1000 blocks
const NINI = 'https://ninicoin.test'; // calls only
const SITE = [{ url: NINI, logs: 0 }, { url: CLUB, logs: 250 }, { url: TW, logs: 1000, archive: true }];
const ENV = { ARENA, CHAIN_ID: 56, SEASON_BOOK: BOOK, RPC_URL: 'https://judge.test', SITE_RPC_URLS: JSON.stringify(SITE), SITE_LOG_SPAN: 4000, ASSETS: { fetch: async () => new Response('no', { status: 404 }) } };
const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
const hex = (n) => '0x' + n.toString(16);
const log = (block, i = 0, topic = '0x' + 'aa'.repeat(32)) => ({ address: ARENA, blockNumber: hex(block), logIndex: hex(i), transactionHash: '0x' + word(hex(block * 10 + i)), topics: [topic], data: '0x' });

/** Fake nodes behind the global fetch: batches answered call by call; every request kept. */
async function withNodes(answer, fn) {
  const requests = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, body });
    const one = async (q) => {
      try {
        return { jsonrpc: '2.0', id: q.id, result: await answer(url, q) };
      } catch (e) {
        return { jsonrpc: '2.0', id: q.id, error: { code: e.code ?? -32000, message: e.message } };
      }
    };
    const out = Array.isArray(body) ? await Promise.all(body.map(one)) : await one(body);
    return new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json' } });
  };
  COOLDOWNS.clear();
  clearCache();
  forgetHead();
  forgetCalendar();
  try {
    return await fn(requests);
  } finally {
    globalThis.fetch = real;
    COOLDOWNS.clear();
    clearCache();
    forgetHead();
    forgetCalendar();
  }
}
const post = (body, env = ENV, headers = {}) => host.fetch(new Request('https://arena.example/rpc', { method: 'POST', headers, body: JSON.stringify(body) }), env);
const call = (id, method, params) => ({ jsonrpc: '2.0', id, method, params });
const view = (id, data, to = ARENA) => call(id, 'eth_call', [{ to, data }, 'latest']);
const logsCall = (id, from, to, extra = {}) => call(id, 'eth_getLogs', [{ address: ARENA, fromBlock: hex(from), toBlock: hex(to), ...extra }]);
/** The chain behind the fakes: head 1,000,000, every view answers its selector, logs one per 100 blocks. */
const chain = (url, q) => {
  if (q.method === 'eth_blockNumber') return hex(1_000_000);
  if (q.method === 'eth_getBlockByNumber') return { number: hex(1_000_000), timestamp: hex(1_700_000_000) };
  if (q.method === 'eth_call' && q.params[0].data === '0x715f8fe8') return '0x' + word('1'); // seasonCount()
  if (q.method === 'eth_call' && q.params[0].data.startsWith('0x6ebaeda9')) return '0x' + [word('0'), word('64'), word('0'), word('0'), word('ce'.repeat(20))].join(''); // seasons(1)
  if (q.method === 'eth_call') return '0x' + word(q.params[0].data.slice(2, 10));
  if (q.method === 'eth_getLogs') {
    const from = parseInt(q.params[0].fromBlock, 16);
    const to = parseInt(q.params[0].toBlock, 16);
    const width = url === CLUB ? 250 : url === TW ? 1000 : 0;
    if (to - from + 1 > width) throw Object.assign(new Error(`block range limited to ${width}`), { code: -32005 });
    const out = [];
    for (let b = Math.ceil(from / 100) * 100; b <= to; b += 100) out.push(log(b));
    return out;
  }
  throw new Error('unexpected ' + q.method);
};

test('a poll is one request and one response: every call checked as alone, the rest sent to a node as one batch', async () => {
  await withNodes(chain, async (requests) => {
    const body = [
      call(1, 'eth_blockNumber', []),
      call(2, 'eth_getBlockByNumber', ['latest', false]),
      view(3, '0x78a2ce59'), // hall()
      view(4, '0xb5c81661'), // hallCount()
      view(5, '0x78a2ce59', '0x' + '99'.repeat(20)), // another contract: refused
      call(6, 'eth_sendRawTransaction', ['0x01']), // not a read: refused
      view(7, '0x12345678'), // not a view the site reads: refused
      call(8, 'eth_getBlockByNumber', ['latest', true]), // a full block: refused
      logsCall(9, 999_000, 999_199), // a small tail: 48.club
    ];
    const res = await post(body);
    const out = await res.json();
    assert.equal(res.status, 200);
    assert.deepEqual(out.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9], 'in the calls\' order, with their ids');
    assert.equal(out[0].result, hex(1_000_000));
    assert.equal(out[2].result, '0x' + word('78a2ce59'));
    assert.equal(out[4].error.message, 'this arena only');
    assert.equal(out[5].error.message, 'read-only');
    assert.equal(out[6].error.message, 'the views the site reads only');
    assert.equal(out[7].error.message, 'no full blocks');
    assert.equal(out[8].result.length, 2);
    // one node request for the four calls, one for the log range; nothing refused reached a node
    const batches = requests.filter((r) => Array.isArray(r.body) && r.body.some((q) => q.method === 'eth_blockNumber'));
    assert.equal(batches.length, 1);
    assert.deepEqual(batches[0].body.map((q) => q.method), ['eth_blockNumber', 'eth_getBlockByNumber', 'eth_call', 'eth_call']);
    assert.equal(batches[0].url, NINI);
    assert.ok(!requests.some((r) => JSON.stringify(r.body).includes('99'.repeat(20)) || JSON.stringify(r.body).includes('eth_sendRawTransaction') || JSON.stringify(r.body).includes('12345678')));
    // (and the season calendar, read once by the server to learn the unknown address: seasonBook,
    // seasonCount, then every season in one batch)
    const calendar = requests.filter((r) => (Array.isArray(r.body) ? r.body : [r.body]).every((q) => q.method === 'eth_call' && ['0xfda7b9db', '0x715f8fe8', '0x6ebaeda9'].includes(q.params[0].data.slice(0, 10))));
    assert.equal(calendar.length, 3);
    assert.equal(requests.length, 5, 'the calendar (3), the poll\'s calls (1), the log range (1)');
  });
});

test('limits: a batch of at most 48 calls and 32 KB; a batch weighs one rate-limit unit per eight calls', async () => {
  await withNodes(chain, async (requests) => {
    const many = Array.from({ length: 49 }, (_, i) => call(i, 'eth_blockNumber', []));
    assert.match((await (await post(many)).json()).error.message, /a batch of 1 to 48 calls/);
    assert.match((await (await post([])).json()).error.message, /a batch of 1 to 48 calls/);
    const big = await host.fetch(new Request('https://arena.example/rpc', { method: 'POST', body: 'x'.repeat(40000) }), ENV);
    assert.equal(big.status, 413);
    let units = 0;
    const env = { ...ENV, RPC_LIMIT: { limit: async () => ({ success: ++units <= 3 }) } };
    assert.equal((await post(Array.from({ length: 16 }, (_, i) => call(i, 'eth_blockNumber', [])), env)).status, 200, '16 calls: two units');
    assert.equal(units, 2);
    assert.equal((await post(Array.from({ length: 16 }, (_, i) => call(i, 'eth_blockNumber', [])), env)).status, 429, 'past the limit');
    assert.equal(requests.length, 1, 'the second batch of 16 came from the cache');
  });
});

test('many viewers in the same second cost one node call; a second later the head is read again; immutable views are kept an hour', async () => {
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    await withNodes(chain, async (requests) => {
      const poll = [call(1, 'eth_blockNumber', []), view(2, '0xb5c81661'), view(3, '0xee5f8c8f')]; // hallCount(), roundTime()
      const answers = await Promise.all(Array.from({ length: 20 }, () => post(poll).then((r) => r.json())));
      assert.ok(answers.every((a) => a[0].result === hex(1_000_000)));
      assert.equal(requests.length, 1, 'twenty viewers, one node request');
      shift += 1500;
      await post(poll);
      assert.equal(requests.length, 2, 'a second later: read again');
      assert.deepEqual(requests[1].body.map((q) => q.params[0]?.data ?? q.method), ['eth_blockNumber', '0xb5c81661'], 'roundTime() is immutable: still kept');
    });
  } finally {
    Date.now = realNow;
  }
});

test('the Cache API shares a read between the isolates of a data centre', async () => {
  const store = new Map();
  const puts = [];
  globalThis.caches = {
    default: {
      match: async (req) => (store.has(req.url) ? new Response(store.get(req.url).text, { headers: store.get(req.url).headers }) : undefined),
      put: async (req, res) => {
        puts.push(req.url);
        store.set(req.url, { text: await res.text(), headers: Object.fromEntries(res.headers) });
      },
    },
  };
  try {
    await withNodes(chain, async (requests) => {
      const waits = [];
      const ctx = { waitUntil: (p) => waits.push(p) };
      const poll = [call(1, 'eth_blockNumber', []), view(2, '0xb5c81661')];
      await host.fetch(new Request('https://arena.example/rpc', { method: 'POST', body: JSON.stringify(poll) }), ENV, ctx);
      await Promise.all(waits);
      assert.equal(puts.length, 1, 'one shared entry for the poll\'s calls');
      assert.ok(puts.every((u) => u.startsWith('https://arena.example/__cache/')));
      clearCache(); // another isolate: nothing in its memory
      const out = await (await host.fetch(new Request('https://arena.example/rpc', { method: 'POST', body: JSON.stringify(poll) }), ENV, ctx)).json();
      assert.equal(out[1].result, '0x' + word('b5c81661'));
      assert.equal(requests.length, 1, 'the second isolate read the shared cache, not a node');
    });
  } finally {
    delete globalThis.caches;
  }
});

test('log ranges from the archive: stored chunks from KV (then the cache), the live tail from the nodes, merged in order', async () => {
  const gets = [];
  const chunk = (c) => Array.from({ length: 5 }, (_, i) => log(c * 5000 + i * 1000 + 7, i));
  const kv = { get: async (k) => (gets.push(k), k === chunkKey(ARENA, 198) ? JSON.stringify(chunk(198)) : k === chunkKey(ARENA, 199) ? JSON.stringify(chunk(199)) : null) };
  const env = { ...ENV, HISTORY: kv };
  await withNodes(chain, async (requests) => {
    // blocks 990000-1001999: chunks 198 and 199 stored, 1000000-1001999 from the nodes (thirdweb: 1000 a request)
    const [j] = await (await post([logsCall(1, 990_000, 1_001_999)], env)).json();
    const blocks = j.result.map((l) => parseInt(l.blockNumber, 16));
    assert.deepEqual(blocks.slice(0, 10), chunk(198).concat(chunk(199)).map((l) => parseInt(l.blockNumber, 16)), 'the archived part first');
    assert.deepEqual(blocks.slice(10), Array.from({ length: 20 }, (_, i) => 1_000_000 + i * 100), 'then the tail from the nodes');
    assert.deepEqual(gets, [chunkKey(ARENA, 198), chunkKey(ARENA, 199), chunkKey(ARENA, 200)], 'KV: the two chunks, and the first one not stored');
    const tail = requests.filter((r) => r.body.method === 'eth_getLogs');
    assert.deepEqual(tail.map((r) => [r.url, parseInt(r.body.params[0].fromBlock, 16)]), [[TW, 1_000_000], [TW, 1_001_000]], 'the tail in requests of 1000 blocks');
    // a part of a chunk, with a topic filter: from the chunk in memory, filtered (no KV read, no node)
    const before = gets.length;
    const n = requests.length;
    const [k] = await (await post([logsCall(2, 991_000, 993_500, { topics: ['0x' + 'aa'.repeat(32)] })], env)).json();
    assert.deepEqual(k.result.map((l) => parseInt(l.blockNumber, 16)), [991_007, 992_007, 993_007]);
    const [none] = await (await post([logsCall(3, 991_000, 993_500, { topics: ['0x' + 'bb'.repeat(32)] })], env)).json();
    assert.deepEqual(none.result, []);
    assert.equal(gets.length, before);
    assert.equal(requests.length, n);
  });
});

test('a range not available now is an error for that call only; the rest of the batch is answered', async () => {
  const kv = { get: async () => null }; // nothing archived yet
  await withNodes(chain, async () => {
    // 50000 blocks from the nodes: thirteen spans of 4000, fifty requests of 1000: past the invocation's budget
    const out = await (await post([call(1, 'eth_blockNumber', []), logsCall(2, 900_000, 949_999), logsCall(3, 999_000, 999_099)], { ...ENV, HISTORY: kv })).json();
    assert.equal(out[0].result, hex(1_000_000));
    assert.ok(out[1].error, 'the wide range: not available now');
    assert.ok(Array.isArray(out[2].result) || out[2].error, 'the small range: answered, or not available now');
  });
});

test('a log range far behind the head is kept long; one near the head a second', async () => {
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    await withNodes(chain, async (requests) => {
      await post([call(1, 'eth_blockNumber', [])]); // the isolate learns the head: 1,000,000
      const far = [logsCall(2, 900_000, 900_999)];
      const near = [logsCall(3, 999_900, 999_990)];
      await post(far);
      await post(near);
      const n = requests.length;
      shift += 5000;
      await post(far);
      assert.equal(requests.length, n, 'far behind the head: still kept');
      await post(near);
      assert.equal(requests.length, n + 1, 'near the head: read again');
    });
  } finally {
    Date.now = realNow;
  }
});

test('on *.workers.dev the Cache API is never called: it stores nothing there, and every call would spend the budget', async () => {
  let used = 0;
  globalThis.caches = { default: { match: async () => (used++, undefined), put: async () => void used++ } };
  const kv = { get: async (k) => (k.startsWith('span:') || k.startsWith('logs:') ? '[]' : null) };
  try {
    await withNodes(chain, async (requests) => {
      const poll = [call(1, 'eth_blockNumber', []), call(2, 'eth_getBlockByNumber', ['latest', false]), view(3, '0x78a2ce59'), view(4, '0xb5c81661'), view(5, '0x748e1910'), view(6, '0xef92e6ba'), logsCall(7, 998_000, 999_799), logsCall(8, 850_000, 899_999), logsCall(9, 900_000, 949_999)];
      const env = { ...ENV, HISTORY: kv };
      const ask = (host) => host.fetch(new Request(`https://${host}/rpc`, { method: 'POST', body: JSON.stringify(poll) }), env, { waitUntil: () => {} });
      const out = await (await host.fetch(new Request('https://ibiti-agent-arena.drainshieldguard.workers.dev/rpc', { method: 'POST', body: JSON.stringify(poll) }), env, { waitUntil: () => {} })).json();
      assert.ok(out.every((x) => 'result' in x), 'the whole poll answered, two archived spans included');
      assert.equal(used, 0, 'no Cache API call on workers.dev');
      // on a custom domain: a few, within the budget
      clearCache();
      const out2 = await (await host.fetch(new Request('https://arena.ibiticoin.com/rpc', { method: 'POST', body: JSON.stringify(poll) }), env, { waitUntil: () => {} })).json();
      assert.ok(out2.every((x) => 'result' in x));
      assert.ok(used > 0 && used <= 12, `${used} Cache API calls on a custom domain`);
      assert.ok(requests.length > 0 && typeof ask === 'function');
    });
  } finally {
    delete globalThis.caches;
  }
});

test('a batch of calls to a season contract the config does not name reads the calendar once, in three requests', async () => {
  const S2 = '0x' + 'c2'.repeat(20);
  const twoSeasons = (url, q) => {
    if (q.method === 'eth_call' && q.params[0].data === '0x715f8fe8') return '0x' + word('2'); // seasonCount(): 2
    if (q.method === 'eth_call' && q.params[0].data.startsWith('0x6ebaeda9')) return '0x' + [word('0'), word('64'), word('0'), word('0'), (q.params[0].data.endsWith('2') ? 'c2' : 'ce').repeat(20).padStart(64, '0')].join('');
    return chain(url, q);
  };
  const realNow = Date.now;
  Date.now = () => realNow() + 10 * 60 * 1000; // past any calendar an earlier test kept
  try {
    await withNodes(twoSeasons, async (requests) => {
      const env = { ...ENV, SEASON_BOOK: BOOK, SEASONS: { 1: { certificate: '0x' + 'ce'.repeat(20) } } };
      const out = await (await post(Array.from({ length: 20 }, (_, i) => view(i + 1, '0xfe6dcdba', S2)), env)).json(); // top() of season 2
      assert.ok(out.every((x) => x.result === '0x' + word('fe6dcdba')), 'season 2 is known from the calendar');
      assert.ok(requests.length <= 4, `${requests.length} node requests: the calendar in three, the twenty calls in one`);
      // and twenty requests in the same moment (twenty viewers): still one calendar read
      forgetCalendar();
      const n = requests.length;
      await Promise.all(Array.from({ length: 20 }, () => post([view(1, '0x9ef27b00', S2)], env))); // closedAt()
      assert.ok(requests.length - n <= 4, `${requests.length - n} node requests`);
    });
  } finally {
    Date.now = realNow;
  }
});

test('a whole span of 50000 blocks is one KV read; a range older than six hours goes only to the archive node; a final range from a node that may prune is kept a minute, not a week', async () => {
  const gets = [];
  const span = Array.from({ length: 10 }, (_, i) => log(900_000 + i * 5000 + 1, i));
  const kv = { get: async (k) => (gets.push(k), k === spanKey(ARENA, 18) ? JSON.stringify(span) : null) };
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    await withNodes(chain, async (requests) => {
      const env = { ...ENV, HISTORY: kv, BLOCKS_PER_WEEK: 1343552 };
      await post([call(1, 'eth_blockNumber', [])], env); // the head: 1,000,000
      const [a] = await (await post([logsCall(2, 900_000, 949_999)], env)).json();
      assert.equal(a.result.length, 10);
      assert.deepEqual(gets, [spanKey(ARENA, 18)], 'one KV read for the span');
      // 930000-931999 (six hours are 48000 blocks: older than that), not archived: from thirdweb only
      const n = requests.length;
      const [b] = await (await post([logsCall(3, 930_000, 931_999)], env)).json();
      assert.ok(Array.isArray(b.result));
      assert.ok(requests.slice(n).every((r) => r.url === TW), 'never 48.club for blocks older than six hours');
      // thirdweb down: an old range is not available (the page waits), never answered by 48.club
      const m = requests.length;
      const down = (url, q) => (url === TW ? (() => { throw Object.assign(new Error('rate limit exceeded'), { code: -32005 }); })() : chain(url, q));
      await withNodes(down, async (reqs) => {
        await post([call(1, 'eth_blockNumber', [])], env);
        const [c] = await (await post([logsCall(4, 940_000, 940_999)], env)).json();
        assert.ok(c.error, 'not available now');
        assert.ok(!reqs.some((r) => r.url === CLUB && r.body.method === 'eth_getLogs'));
        // a recent final range answered by 48.club: kept a minute only
        const [d] = await (await post([logsCall(5, 998_000, 998_499)], env)).json();
        assert.ok(Array.isArray(d.result));
        const k = reqs.length;
        shift += 30_000;
        await post([logsCall(5, 998_000, 998_499)], env);
        assert.equal(reqs.length, k, 'within the minute: from the cache');
        shift += 60_000;
        await post([call(1, 'eth_blockNumber', [])], env);
        const k2 = reqs.length;
        await post([logsCall(5, 998_000, 998_499)], env);
        assert.ok(reqs.length > k2, 'after a minute: read again');
      });
      assert.ok(requests.length >= m);
    });
  } finally {
    Date.now = realNow;
  }
});

test('with direct reads a page sends /rpc only its history: the isolate asks the head itself, so a pruning node never answers blocks older than an hour, and a final range is kept a week', async () => {
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  const logReads = (reqs) => reqs.filter((r) => [].concat(r.body).some((q) => q.method === 'eth_getLogs'));
  const heads = (reqs) => reqs.filter((r) => [].concat(r.body).some((q) => q.method === 'eth_blockNumber'));
  try {
    const env = { ...ENV, BLOCKS_PER_WEEK: 1343552 };
    await withNodes(chain, async (requests) => {
      // a fresh isolate, no eth_blockNumber from the page; 980000-983999 is 2 to 2.5 hours old, where
      // publicnode already answers []: the archive node only
      const [a] = await (await post([logsCall(1, 980_000, 983_999)], env)).json();
      assert.equal(a.result.length, 40);
      assert.equal(heads(requests).length, 1, 'the head asked once');
      assert.ok(logReads(requests).every((r) => r.url === TW), 'only the archive node for blocks two hours old');
      // final and from the archive node: kept long
      const n = requests.length;
      shift += 120_000;
      await post([logsCall(1, 980_000, 983_999)], env);
      assert.equal(requests.length, n, 'a final range: from the cache');
      // a range within the hour: any log node; the head asked again only once it is 30 s old
      await post([logsCall(2, 999_000, 999_249)], env);
      await post([logsCall(3, 999_250, 999_499)], env);
      assert.equal(heads(requests).length, 2, 'once more after two minutes, then not again within 30 s');
    });
    // thirdweb down: a range two hours old is not available now (the page asks again later); 48.club,
    // which may have pruned it, is never asked
    const twDown = (url, q) => (url === TW ? (() => { throw Object.assign(new Error('rate limit exceeded'), { code: -32005 }); })() : chain(url, q));
    await withNodes(twDown, async (requests) => {
      const [b] = await (await post([logsCall(4, 984_000, 984_999)], env)).json();
      assert.ok(b.error, 'not available now');
      assert.ok(!logReads(requests).some((r) => r.url === CLUB));
    });
    // no head to be had (every node fails eth_blockNumber): the archive node only, even for recent blocks
    const noHead = (url, q) => (q.method === 'eth_blockNumber' ? (() => { throw new Error('unavailable'); })() : chain(url, q));
    await withNodes(noHead, async (requests) => {
      const [c] = await (await post([logsCall(5, 999_000, 999_249)], env)).json();
      assert.ok(Array.isArray(c.result));
      assert.ok(logReads(requests).every((r) => r.url === TW), 'no head known: the archive node only');
    });
  } finally {
    Date.now = realNow;
  }
});

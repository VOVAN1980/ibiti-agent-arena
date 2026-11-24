// The site's polls (site/assets/arena.js) through the real /rpc window (host.js) over fake nodes: one
// request a poll, the newest fights at once while the history comes in parts (from the KV archive: one
// read per 50000 blocks), a range that cannot be read now never freezes the page (the newest blocks go
// on, the range stays to read, split down to what a node serves, then waits), a poll that failed whole
// backs off with fewer history ranges, a hidden tab reads nothing, and the next poll comes in 2 s only
// while something is on the ring, else in 10 s.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ARENA = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const TW = 'https://thirdweb.test';
const NINI = 'https://ninicoin.test';
const DEPLOY = 900_000;
globalThis.window = { ARENA_CONFIG: { rpc: '/rpc', arena: ARENA, chainId: 56, roundTime: 60, deployBlock: DEPLOY, blocksPerWeek: 1343552, pollMs: 2000 } };
const arena = await import('../../site/assets/arena.js');
const { default: host } = await import('../src/host.js');
const { clearCache } = await import('../src/cache.js');
const { COOLDOWNS } = await import('../src/rpc.js');

const word = (h) => String(h).replace(/^0x/, '').padStart(64, '0');
const hex = (n) => '0x' + n.toString(16);
const STARTED = '0x1f0a803b340f18c069591b04eca4f49892175c5fcb11f82bd92c7e01eef3498b';
const agent = (i) => '0x' + i.toString(16).padStart(2, '0').repeat(20);
const started = (a, n, block, opponent = '0') => ({ address: ARENA, blockNumber: hex(block), logIndex: '0x0', transactionHash: '0x' + word(hex(block)), topics: [STARTED, '0x' + word(a), '0x' + word(hex(n)), '0x' + word(opponent)], data: '0x' + word('5e') + word('0') + word('0') + word('0') + word('1') });
const ENV = { ARENA, CHAIN_ID: 56, SEASON_BOOK: '0x' + 'b0'.repeat(20), DEPLOY_BLOCK: DEPLOY, SITE_RPC_URLS: JSON.stringify([{ url: NINI, logs: 0 }, { url: TW, logs: 1000 }]), SITE_LOG_SPAN: 4000, ASSETS: { fetch: async () => new Response('', { status: 404 }) } };

/**
 * The world: the chain's head and clock, its logs, which log ranges the nodes refuse, and the fights'
 * clocks (fightOf). The page's fetch('/rpc') goes to host.js; the server's fetches to the fake nodes.
 */
function world({ head = 1_000_000, now = 1_700_000_000, logs = [], refuse = () => false, fight = null, env = ENV } = {}) {
  const w = { head, now, logs, refuse, fight, env, pageRequests: 0, nodeRequests: 0 };
  globalThis.fetch = async (url, init) => {
    if (url === '/rpc') {
      w.pageRequests++;
      return host.fetch(new Request('https://arena.example/rpc', { method: 'POST', body: init.body }), w.env);
    }
    w.nodeRequests++;
    const body = JSON.parse(init.body);
    const one = (q) => {
      const ok = (result) => ({ jsonrpc: '2.0', id: q.id, result });
      if (q.method === 'eth_blockNumber') return ok(hex(w.head));
      if (q.method === 'eth_getBlockByNumber') return ok({ number: hex(w.head), timestamp: hex(w.now) });
      if (q.method === 'eth_call') {
        const d = q.params[0].data;
        if (d.startsWith('0x32799e5d')) return ok(w.fight ? w.fight(d) : '0x' + word('0').repeat(22));
        return ok('0x' + word('0').repeat(3)); // the hall: empty, nothing drawn
      }
      if (q.method === 'eth_getLogs') {
        const from = parseInt(q.params[0].fromBlock, 16);
        const to = parseInt(q.params[0].toBlock, 16);
        if (url !== TW || to - from + 1 > 1000) return { jsonrpc: '2.0', id: q.id, error: { code: -32005, message: 'limit exceeded' } };
        if (w.refuse(from, to)) return { jsonrpc: '2.0', id: q.id, error: { code: -32000, message: 'range not served' } };
        return ok(w.logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to));
      }
      return { jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'no' } };
    };
    return new Response(JSON.stringify(Array.isArray(body) ? body.map(one) : one(body)), { headers: { 'content-type': 'application/json' } });
  };
  clearCache();
  COOLDOWNS.clear();
  return w;
}

/** The KV archive of the fake chain: every final chunk and span of `w.logs`, KV reads counted. */
function archiveOf(w) {
  const kv = { gets: 0 };
  kv.get = async (key) => {
    kv.gets++;
    const [kind, , n] = key.split(':');
    const size = kind === 'span' ? 50_000 : 5000;
    const [from, to] = [Number(n) * size, Number(n) * size + size - 1];
    if (to > w.head - 200) return null;
    return JSON.stringify(w.logs.filter((l) => parseInt(l.blockNumber, 16) >= from && parseInt(l.blockNumber, 16) <= to).sort((a, b) => parseInt(a.blockNumber, 16) - parseInt(b.blockNumber, 16)));
  };
  return kv;
}

test('the newest fights at once, the history in parts after them; then one request a poll', async () => {
  const old = agent(0x11);
  const fresh = agent(0x22);
  const w = world({ logs: [started(old, 1, 905_000), started(fresh, 1, 999_700)] });
  const s = arena.emptyState();
  await arena.refresh(s);
  assert.equal(w.pageRequests, 3, 'the first poll: the head, then its logs, then the clocks of the fights it found');
  assert.ok(s.fights.has(`${fresh}#1`), 'the newest fight is there at once');
  assert.ok(s.gaps.length > 0 && arena.historyState(s) === 'loading', 'the history: still to read');
  // no archive here: 50000 blocks are too many for the nodes in one poll; the range is split, and the
  // next poll comes at the page's normal pace, not at once
  assert.notEqual(arena.pollDelay(s), 300, 'not at once after a history read that failed');
  for (let i = 0; i < 40 && s.gaps.length; i++) await arena.refresh(s);
  assert.equal(s.gaps.length, 0, 'all of it read');
  assert.ok(s.fights.has(`${old}#1`), 'the old fight too');
  assert.equal(arena.historyState(s), null);
  // from now on: one request a poll, whatever the poll needs
  const before = w.pageRequests;
  w.head += 5;
  clearCache(); // (a second later: the server's short cache has let the head go)
  await arena.refresh(s);
  assert.equal(w.pageRequests - before, 1);
});

test('with the KV archive the history comes with the first poll: one read per 50000 blocks', async () => {
  const old = agent(0x11);
  const mid = agent(0x33);
  const fresh = agent(0x22);
  const w = world({ logs: [started(old, 1, 905_000), started(mid, 1, 960_000), started(fresh, 1, 999_700)] });
  const kv = archiveOf(w);
  w.env = { ...ENV, HISTORY: kv };
  const s = arena.emptyState();
  await arena.refresh(s);
  assert.ok(s.fights.has(`${fresh}#1`) && s.fights.has(`${old}#1`) && s.fights.has(`${mid}#1`), 'the newest fight and the history');
  assert.equal(s.gaps.length, 0);
  assert.equal(arena.historyState(s), null);
  assert.ok(kv.gets <= 12, `${kv.gets} KV reads: the span 900000-949999 in one, the part after it by chunks`);
  assert.equal(w.pageRequests, 3);
});

test('a range that cannot be read now never freezes the page: the newest blocks go on, the range stays (split)', async () => {
  const late = agent(0x33);
  // the nodes refuse everything below block 950000 (no archive here)
  const w = world({ logs: [started(agent(0x11), 1, 905_000)], refuse: (from) => from < 950_000 });
  const s = arena.emptyState();
  for (let i = 0; i < 30; i++) await arena.refresh(s);
  assert.equal(arena.historyState(s), 'waiting');
  assert.ok(s.gaps.every((g) => g.from < 950_000), 'only the refused part stays to read');
  assert.ok(s.gaps.some((g) => g.to - g.from + 1 <= 1000), 'split down to what a node could serve');
  assert.equal(arena.pollDelay(s), 10000, 'no hurry while it waits');
  // a fight drawn now shows up although the old range is still not read
  w.logs.push(started(late, 1, w.head + 300));
  w.head += 400;
  clearCache(); // (a second later: the server's short cache has let the head go)
  await arena.refresh(s);
  await arena.refresh(s);
  assert.ok(s.fights.has(`${late}#1`), 'the newest blocks are read all the same');
  assert.ok(s.fromBlock > w.head - 400, 'the cursor moved on');
  // the nodes serve it again: the history comes in
  w.refuse = () => false;
  for (let i = 0; i < 80 && s.gaps.length; i++) await arena.refresh(s);
  assert.equal(s.gaps.length, 0);
  assert.ok(s.fights.has(`${agent(0x11)}#1`));
});

test('the next poll: 2 s while a fight is live or a draw is near, else 10 s', async () => {
  const a = agent(0x44);
  const now = 1_700_000_000;
  // a fight drawn a minute ago, in its countdown (bell in 30 s), its plan locked
  const fightWords = () => '0x' + [word('5e'), word(hex(now - 60)), word('0'), word('0'), word('1'), word('0'), word('1'), word('0'), word('0'), word(hex(now + 30)), word('0'), word('0'), word('0'), word('0'), word('0'), word('1'), word('0'), word('1'), word('77'), word('0'), word('0'), word('1')].join('');
  const w = world({ now, logs: [started(a, 1, 999_900)], fight: fightWords });
  const s = arena.emptyState();
  s.fromBlock = 999_000; // (no history in this test)
  await arena.refresh(s);
  assert.equal(arena.pollDelay(s), 2000, 'a countdown: every 2 s');
  assert.equal(arena.pollDelay(s, 2), 4000, 'a page without a clock: half as often');
  // the fight is judged: nothing on the ring
  s.fights.get(`${a}#1`).judged = { points: 10 };
  assert.equal(arena.pollDelay(s), 10000);
  // two agents in the hall, the draw in a minute
  s.hallCount = 2;
  s.nextDrawAt = s.now + 60;
  assert.equal(arena.pollDelay(s), 2000);
  s.nextDrawAt = s.now + 300;
  assert.equal(arena.pollDelay(s), 10000, 'the draw in five minutes: not yet');
  s.pendingCutoff = s.now - 5;
  assert.equal(arena.pollDelay(s), 2000, 'a sealed draw waits to be held');
  assert.ok(w.pageRequests >= 1);
});

test('invocations per viewer-hour of a visible page (a poll, the season line and the podium): the match page and the hall, idle and with a fight live', async (t) => {
  const BOOK = '0x' + 'b0'.repeat(20);
  const CERT = '0x' + 'ce'.repeat(20);
  window.ARENA_CONFIG.seasonBook = BOOK;
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  try {
    for (const [page, factor, live] of [['the match page', 1, false], ['the match page', 1, true], ['the hall', 1.5, false], ['the hall', 1.5, true]]) {
      const w = world({ logs: live ? [started(agent(0x55), 1, 999_900)] : [] });
      // the calendar: season 1 running; its contract: nobody ranked yet
      const nodeFetch = globalThis.fetch;
      globalThis.fetch = async (url, init) => {
        if (url === '/rpc') return nodeFetch(url, init);
        const body = JSON.parse(init.body);
        const calls = Array.isArray(body) ? body : [body];
        const special = (q) => {
          if (q.method !== 'eth_call') return null;
          const { to, data } = q.params[0];
          const ok = (r) => ({ jsonrpc: '2.0', id: q.id, result: r });
          if (data === '0xfda7b9db') return ok('0x' + word(BOOK));
          if (to === BOOK && data === '0x9fa6a6e3') return ok('0x' + word('1'));
          if (to === BOOK && data === '0x715f8fe8') return ok('0x' + word('1'));
          if (to === BOOK) return ok('0x' + [word(hex(w.now - 1000)), word(hex(w.now + 10 ** 6)), word('0'), word('0'), word(CERT)].join(''));
          if (to === CERT) return ok('0x' + word('0').repeat(4));
          // a fight always in its countdown: the board stays live
          if (live && data.startsWith('0x32799e5d')) return ok('0x' + [word('5e'), word(hex(w.now - 60)), word('0'), word('0'), word('1'), word('0'), word('1'), word('0'), word('0'), word(hex(w.now + 30)), word('0'), word('0'), word('0'), word('0'), word('0'), word('1'), word('0'), word('1'), word('77'), word('0'), word('0'), word('1')].join(''));
          return null;
        };
        if (calls.every((q) => special(q))) {
          w.nodeRequests++;
          const out = calls.map(special);
          return new Response(JSON.stringify(Array.isArray(body) ? out : out[0]));
        }
        if (calls.some((q) => special(q))) {
          // a mixed batch: each call answered by whichever fake knows it
          const parts = await Promise.all(calls.map(async (q) => special(q) ?? (await (await nodeFetch(url, { ...init, body: JSON.stringify(q) })).json())));
          return new Response(JSON.stringify(parts));
        }
        return nodeFetch(url, init);
      };
      const s = arena.emptyState();
      s.fromBlock = 998_000; // (no history: the hour's own polls only)
      let elapsed = 0;
      let polls = 0;
      const before = w.pageRequests;
      while (elapsed < 3600 * 1000) {
        await Promise.all([arena.refresh(s), arena.seasonState().catch(() => null), arena.podiumSeason().catch(() => null)]);
        const d = arena.pollDelay(s, factor);
        elapsed += d;
        shift += d;
        polls++;
        w.head += Math.round(d / 450);
        w.now += Math.round(d / 1000);
      }
      const n = w.pageRequests - before;
      t.diagnostic(`${page}, ${live ? 'a fight live all hour' : 'idle'}: ${polls} polls, ${n} /rpc invocations in an hour`);
      if (live) assert.ok(polls >= 1700 / factor && polls <= 1810 / factor && n <= polls + 200, `${n}`);
      else assert.ok(polls <= 370 / factor && n <= polls + 200, `${n}`);
      globalThis.fetch = nodeFetch;
    }
  } finally {
    Date.now = realNow;
    delete window.ARENA_CONFIG.seasonBook;
  }
});

test('a range on a 1000-block boundary, 1001 to 2000 blocks wide, is split too; as narrow as it gets, it waits and the page slows down', async () => {
  const w = world({ refuse: (from) => from < 952_000 });
  const s = arena.emptyState();
  s.fromBlock = 999_000;
  s.latestBlock = 1_000_000;
  s.gaps = [{ from: 950_000, to: 951_999 }];
  const delays = [];
  for (let i = 0; i < 6; i++) {
    await arena.refresh(s);
    delays.push(arena.pollDelay(s));
  }
  assert.deepEqual(s.gaps, [{ from: 950_000, to: 950_999 }, { from: 951_000, to: 951_999 }], 'split on its 1000-block boundary');
  assert.equal(arena.historyState(s), 'waiting');
  assert.ok(delays.every((d) => d >= 2000), `never 300 ms after a failed history read: ${delays}`);
  // a gap not on a boundary (950001-951100) is split as well
  s.gaps = [{ from: 950_001, to: 951_100 }];
  await arena.refresh(s);
  assert.deepEqual(s.gaps, [{ from: 950_001, to: 950_999 }, { from: 951_000, to: 951_100 }]);
  assert.ok(w.pageRequests > 0);
});

test('a poll that fails whole (429, a broken answer) backs off, twice as late each time, with fewer history ranges', async () => {
  const w = world();
  let refuse = true;
  w.env = { ...ENV, RPC_LIMIT: { limit: async () => ({ success: !refuse }) } };
  const s = arena.emptyState();
  s.fromBlock = 999_000;
  s.latestBlock = 1_000_000;
  s.gaps = Array.from({ length: 8 }, (_, i) => ({ from: 900_000 + 2000 * i, to: 901_999 + 2000 * i }));
  const delays = [];
  const sent = [];
  for (let i = 0; i < 5; i++) {
    await assert.rejects(arena.refresh(s));
    delays.push(arena.pollDelay(s));
    sent.push(s.sentGaps.length);
  }
  assert.deepEqual(delays, [2000, 4000, 8000, 16000, 32000]);
  assert.deepEqual(sent, [6, 3, 1, 0, 0], 'the history ranges of each poll: fewer after each failure, then the newest blocks alone');
  assert.ok(s.gaps.length > 8, 'the one range of a failed poll is split');
  assert.notEqual(arena.historyState(s), null);
  // the server answers again: the normal pace, all of it read
  refuse = false;
  await arena.refresh(s);
  assert.equal(s.failures, 0);
  assert.notEqual(arena.pollDelay(s), 32000);
  for (let i = 0; i < 40 && s.gaps.length; i++) await arena.refresh(s);
  assert.equal(s.gaps.length, 0);
  // a body that is not JSON (an error page of the platform): the same
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => (url === '/rpc' ? new Response('<html>error 1102</html>', { status: 503 }) : real(url, init));
  try {
    await assert.rejects(arena.refresh(s));
    assert.equal(arena.pollDelay(s), 2000);
    assert.equal(arena.pollDelay(s, 1, 30000), 30000, 'the home page (every 30 s): never sooner after a failure');
  } finally {
    globalThis.fetch = real;
  }
});

test('a hidden tab reads nothing: the next poll waits until the page is shown again', async () => {
  const listeners = new Set();
  globalThis.document = { visibilityState: 'hidden', addEventListener: (_, f) => listeners.add(f), removeEventListener: (_, f) => listeners.delete(f) };
  try {
    let runs = 0;
    arena.pollAgain(() => runs++, 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runs, 0, 'hidden: not run');
    document.visibilityState = 'visible';
    for (const f of [...listeners]) f();
    assert.equal(runs, 1, 'shown: run at once');
    arena.pollAgain(() => runs++, 1);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(runs, 2, 'visible: run on time');
  } finally {
    delete globalThis.document;
  }
});

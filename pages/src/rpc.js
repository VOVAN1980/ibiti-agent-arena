// One JSON-RPC client over several public nodes, for every chain read and send of the Worker.
//
// Why: one node for everything fails often from Cloudflare's shared egress (publicnode answered
// "-32005 rate limit" to about one call in six), and a single failed read ended a judge run, gave a
// fighter a 502 or broke a link preview. No public node does everything either: the BNB dataseeds
// serve calls and sends but refuse every eth_getLogs, publicnode serves logs up to 50000 blocks but
// lags a few blocks, 48.club serves logs up to 250 blocks and is an MEV relay (never a sender).
//
// So every node is described, not guessed from its address: { url, logs: <widest log range it
// serves, 0 = none>, send: <true: it may get our signed transactions>, archive: <true: it keeps every
// log since the arena's deployment (measured, thirdweb); a log read that must be complete and is older
// than what a pruning node keeps asks only these (call(q, { archive: true })), when the list has any> }.
// The list is a preference order, used per kind of call:
// - calls (eth_call, eth_blockNumber, nonces, receipts…) start at the first node that is not cooling
//   down, so a log read answered by publicnode never moves the judge's calls off the dataseeds (there
//   is deliberately no "last node that answered" pointer);
// - eth_getLogs goes only to nodes with logs > 0. A range with two block numbers is split into pieces
//   of the node's width (read one after another, joined in order); a node that would need more than
//   maxPieces pieces is skipped. A range ending in 'latest' cannot be split (its end moves): it goes
//   only to a node wide enough for it, or fails;
// - eth_sendRawTransaction goes only to send:true nodes, and a retry sends the very same bytes (the
//   caller is told when a retry happened: a send that timed out may have gone through).
//
// A call moves to the next node on a network error, a timeout, an HTTP error, a reply that is not
// JSON-RPC, or a JSON-RPC error that says the node could not serve it now (rate limits, head lag, range
// limits). An answer about the call itself (a revert, code 3, "nonce too low", "already known",
// underpriced, no funds) is returned unchanged after one attempt: another node would say the same.
// A node that failed in a way that is not about the call (a rate limit, a timeout, a dropped
// connection, HTTP 429/401/403/404/5xx, an HTML page) cools down for 30 s: later calls try it last, so
// a node that refuses or hangs costs one failed request, not one per call (a dead first node would
// otherwise take every call's time and spend twice its subrequests).
//
// eth_getLogs gets more time than a plain call: a node's answer time grows with the range (publicnode
// on BSC mainnet: 5000 blocks 1.6 s, 20000 blocks 9-14 s, 50000 blocks 10-19 s). Each request of a
// log read waits up to LOG_MS_PER_BLOCK per block of its range, between `timeoutMs` and `logsTimeoutMs`.
// A log read that timed out on a node is not asked of that node again in the same call: it would only
// time out again.
//
// Every attempt counts against an optional per-invocation budget ({ left }), because Cloudflare caps
// the subrequests of one invocation (50 on the Free plan) and retries spend them; no attempt starts
// after the deadline. When no node answered, the caller gets a JSON-RPC error, never a throw, so code
// that only reads `await res.json()` (and tests whose fakes return only { json() }) keeps working.

export const COOLDOWN_MS = 30000;
// the time a log request may take per block of its range: about twice the slowest measured (0.7 ms)
export const LOG_MS_PER_BLOCK = 1;
/** Cooldowns shared by the requests one Worker isolate serves (url -> until, in ms). */
export const COOLDOWNS = new Map();

// the node could not serve this now: another node (or a later try) may
const RETRY = /rate limit|limit exceeded|-32005|header not found|beyond current head|exceed maximum block range|limited to|timeout|busy|unavailable|archive requests|missing trie node/i;
// an answer about the call itself: every node says the same, so it is returned as it is
const FINAL = /revert|nonce too low|already known|underpriced|insufficient funds|gas required exceeds/i;
const RATE = /rate limit|limit exceeded|-32005/i;
// a node a little ahead of the one whose head we saw: room for it when a range ends in 'latest'
const HEAD_SLACK = 50;
const HEADERS = { 'content-type': 'application/json' };

/**
 * The nodes of a setting: env[key + 'S'] (a JSON array, or its text) or, without it, env[key] alone
 * as a node that serves everything (the testnet and local runs: one node, as before).
 */
export function endpointsOf(env, key) {
  let list = env?.[key + 'S'];
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      list = null;
    }
  }
  if (Array.isArray(list)) {
    const out = list
      .filter((x) => typeof x?.url === 'string' && /^https?:\/\/\S+$/.test(x.url))
      .map((x) => ({ url: x.url, logs: Math.max(0, Number(x.logs ?? 0) || 0), send: x.send === true, ...(x.archive === true ? { archive: true } : {}) }));
    if (out.length) return out;
  }
  return env?.[key] ? [{ url: String(env[key]), logs: 50000, send: true }] : [];
}

/** A failed attempt: `cool` puts the node on its cooldown, `stop` ends the whole call (budget, time),
 *  `big`: the node refused the request's size (HTTP 413), not the node's fault. */
class Failure extends Error {
  constructor(reason, { cool = false, stop = false, big = false, error = null } = {}) {
    super(reason);
    this.cool = cool;
    this.stop = stop;
    this.big = big;
    this.error = error; // the node's JSON-RPC error, if it gave one
  }
}

const isRetry = (error) => {
  const text = `${error?.message ?? ''} ${error?.code ?? ''}`;
  return error?.code !== 3 && !FINAL.test(text) && (error?.code === -32005 || RETRY.test(text));
};
const blockOf = (x) => (typeof x === 'string' && /^0x[0-9a-f]+$/i.test(x) ? parseInt(x, 16) : null);
const hex = (n) => '0x' + n.toString(16);
const short = (url) => url.replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/**
 * A fetch-compatible function over `endpoints` (the url it is given is ignored: the nodes are routed
 * as above). It also has .call(q, { maxPieces, prefer }) -> { j, attempts, node }, .batch(qs, { prefer,
 * senders }) -> { j, node } (one JSON-RPC batch, all answers from one node; `senders`: only from a
 * send:true node), and .summary() (one line of what each node did, or null).
 */
export function rpcFetch(endpoints, {
  fetchFn = (url, init) => fetch(url, init),
  timeoutMs = 6000,
  logsTimeoutMs = timeoutMs,
  tries = 3,
  maxPieces = 4,
  deadline = Infinity,
  budget = null,
  cooldowns = new Map(),
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = () => Date.now(),
} = {}) {
  const nodes = (endpoints ?? []).filter((e) => e?.url);
  const stats = new Map(); // url -> { ok, failed, why: Map(reason -> n) }
  let head = 0; // the highest block number seen in an answer

  const stat = (ep) => {
    if (!stats.has(ep.url)) stats.set(ep.url, { ok: 0, failed: 0, why: new Map() });
    return stats.get(ep.url);
  };
  const failed = (ep, e) => {
    const s = stat(ep);
    s.failed++;
    const why = RATE.test(e.message) ? 'rate limit' : e.message.slice(0, 40);
    s.why.set(why, (s.why.get(why) ?? 0) + 1);
    if (e.cool) cooldowns.set(ep.url, now() + COOLDOWN_MS);
  };
  /** The nodes in preference order, those cooling down last (soonest back first); `prefer` first if well. */
  const order = (list, prefer) => {
    const t = now();
    const cool = (e) => (cooldowns.get(e.url) ?? 0) > t;
    const out = [...list.filter((e) => !cool(e)), ...list.filter(cool).sort((a, b) => cooldowns.get(a.url) - cooldowns.get(b.url))];
    const p = prefer ? out.findIndex((e) => e.url === prefer && !cool(e)) : -1;
    if (p > 0) out.unshift(...out.splice(p, 1));
    return out;
  };

  /** One HTTP request to one node, given `ms` to answer: its parsed JSON, or a Failure. */
  async function post(ep, payload, ms = timeoutMs) {
    // budget.floor: what an optional read must leave for what comes after it (the judge's sends)
    if (budget && budget.left <= (budget.floor ?? 0)) throw new Failure('subrequest budget spent', { stop: true });
    const left = deadline - now();
    if (left <= 0) throw new Failure('out of time', { stop: true });
    if (budget) budget.left--;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        ctrl?.abort();
        // cut short by the caller's deadline, not by the node's slowness: the node is not to blame
        reject(left < ms ? new Failure('out of time', { stop: true }) : new Failure('timeout', { cool: true }));
      }, Math.min(ms, left));
    });
    const ask = (async () => {
      let res;
      try {
        res = await fetchFn(ep.url, { method: 'POST', headers: HEADERS, body: JSON.stringify(payload), ...(ctrl ? { signal: ctrl.signal } : {}) });
      } catch (e) {
        throw new Failure('network: ' + String(e?.message ?? e).slice(0, 30), { cool: true });
      }
      const status = typeof res?.status === 'number' ? res.status : 200; // a test fake may have only json()
      if (status === 413) throw new Failure('HTTP 413', { big: true });
      // a 400 may carry a JSON-RPC error about the call (some nodes answer a bad call so): read below.
      // Any other HTTP error is the node refusing us (a rate limit, a blocked address, a gateway page).
      if (status >= 300 && status !== 400) throw new Failure('HTTP ' + status, { cool: true });
      try {
        return await res.json();
      } catch {
        throw new Failure('not JSON', { cool: true });
      }
    })();
    ask.catch(() => {}); // after a timeout its late failure is nobody's business
    try {
      return await Promise.race([ask, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** One call to one node, given `ms` to answer: its JSON-RPC answer (a final error included), or a Failure. */
  async function single(ep, q, ms) {
    const j = await post(ep, q, ms);
    if (!j || typeof j !== 'object' || Array.isArray(j) || !('result' in j || 'error' in j)) throw new Failure('not JSON-RPC', { cool: true });
    if (j.error && isRetry(j.error)) {
      const text = `${j.error.message ?? ''} ${j.error.code ?? ''}`;
      throw new Failure(String(j.error.message ?? 'error ' + j.error.code), { cool: RATE.test(text) || j.error.code === -32005, error: j.error });
    }
    noteHead(q, j);
    return j;
  }

  /** The head an answer shows (eth_blockNumber, eth_getBlockByNumber): kept for log ranges ending in 'latest'. */
  function noteHead(q, j) {
    if (!j || j.error) return;
    if (q.method === 'eth_blockNumber' && typeof j.result === 'string') head = Math.max(head, parseInt(j.result, 16) || 0);
    if (q.method === 'eth_getBlockByNumber' && typeof j.result?.number === 'string') head = Math.max(head, parseInt(j.result.number, 16) || 0);
  }

  /** The time a log request over `blocks` blocks may take (null: unknown, as long as allowed). */
  const logsTime = (blocks) => Math.max(timeoutMs, Math.min(logsTimeoutMs, blocks === null ? Infinity : Math.ceil(blocks * LOG_MS_PER_BLOCK)));

  /** eth_getLogs on one node, in `pieces` pieces of its width (one after another, joined in order). */
  async function logsOn(ep, q, range, pieces, span) {
    if (pieces <= 1) return single(ep, q, logsTime(span));
    const filter = q.params[0];
    const all = [];
    for (let from = range.from; from <= range.to; from += ep.logs) {
      const to = Math.min(range.to, from + ep.logs - 1);
      const j = await single(ep, { ...q, params: [{ ...filter, fromBlock: hex(from), toBlock: hex(to) }] }, logsTime(to - from + 1));
      if (j.error) return j; // an answer about the call itself: as it is
      if (!Array.isArray(j.result)) throw new Failure('not a log list', { cool: true });
      all.push(...j.result);
    }
    return { jsonrpc: '2.0', id: q.id ?? 1, result: all };
  }

  const refuse = (q, message, code = -32603) => ({ jsonrpc: '2.0', id: q?.id ?? null, error: { code, message } });

  /** One JSON-RPC call, routed and retried as described at the top. `archive`: the archive nodes only
   *  (when the list has any). The answer says which node gave it (`node`). */
  async function call(q, { maxPieces: most = maxPieces, prefer, archive = false } = {}) {
    let list = archive && nodes.some((e) => e.archive) ? nodes.filter((e) => e.archive) : nodes;
    let pieces = () => 1;
    let range = null;
    let span = null; // a log read's blocks; null: unknown, the node itself says whether it is too wide
    if (q.method === 'eth_sendRawTransaction') list = list.filter((e) => e.send);
    if (q.method === 'eth_getLogs') {
      const f = (Array.isArray(q.params) ? q.params[0] : null) ?? {};
      const from = blockOf(f.fromBlock);
      const to = blockOf(f.toBlock);
      let split = false;
      if (f.blockHash) span = 1;
      else if (from !== null && to !== null) {
        span = Math.max(1, to - from + 1);
        split = to >= from;
        range = { from, to };
      } else if (from !== null && (f.toBlock === undefined || f.toBlock === 'latest') && head) span = Math.max(1, head - from + 1 + HEAD_SLACK);
      pieces = (ep) => (span === null ? 1 : Math.ceil(span / ep.logs));
      list = list.filter((e) => e.logs > 0 && (pieces(e) === 1 || (split && pieces(e) <= most)));
    }
    const ordered = order(list, prefer);
    if (!ordered.length) return { j: refuse(q, `no node serves ${q.method} for this request`), attempts: 0, node: null };
    let last = null;
    let attempts = 0;
    const slow = new Set(); // nodes a log read timed out on in this call: not asked it again
    for (let i = 0; i < tries; i++) {
      const ep = ordered[i % ordered.length];
      if (slow.has(ep.url)) continue;
      if (i >= ordered.length) await wait(Math.min(500 * Math.floor(i / ordered.length), Math.max(0, deadline - now()))); // the same node again: a short pause first
      attempts++;
      try {
        const j = q.method === 'eth_getLogs' ? await logsOn(ep, q, range, pieces(ep), span) : await single(ep, q);
        stat(ep).ok++;
        return { j, attempts, node: ep.url };
      } catch (e) {
        if (!(e instanceof Failure)) throw e;
        last = e;
        if (e.stop) break;
        failed(ep, e);
        if (q.method === 'eth_getLogs' && e.message === 'timeout') slow.add(ep.url);
      }
    }
    return { j: last?.error ? { jsonrpc: '2.0', id: q.id ?? null, error: last.error } : refuse(q, `no node answered (${last?.message ?? 'no attempt'})`), attempts, node: null };
  }

  /** A JSON-RPC batch answered by one node (never mixed across nodes). A node that answers one JSON
   *  object instead of a list (it takes no batches) or 413 is asked one call at a time, still that same
   *  node; a node that failed otherwise (a rate limit, a timeout, an HTML page) is left for the next
   *  one. `senders`: only the send:true nodes, the pools our transactions enter (the judge's nonces).
   *  j: the answers in the calls' order, or an error. */
  async function batch(qs, { prefer, senders = false } = {}) {
    const ordered = order(senders ? nodes.filter((e) => e.send) : nodes, prefer);
    const busy = (error) => new Failure(String(error.message ?? 'error ' + error.code), { cool: RATE.test(`${error.message ?? ''} ${error.code ?? ''}`), error });
    let last = null;
    for (let i = 0; i < tries && ordered.length; i++) {
      const ep = ordered[i % ordered.length];
      if (i >= ordered.length) await wait(Math.min(500 * Math.floor(i / ordered.length), Math.max(0, deadline - now())));
      try {
        let out = null;
        let j = null;
        try {
          j = await post(ep, qs);
        } catch (e) {
          // too big a request (413): one call at a time below. So too when this is the only node (the
          // testnet's one node, a local one): there is no other to go to, and it may take no batches
          if (!(e instanceof Failure) || e.stop || !(e.big || ordered.length === 1)) throw e;
        }
        if (Array.isArray(j)) {
          const byId = qs.map((q) => j.find((r) => r?.id === q.id));
          if (!byId.every((r) => r && typeof r === 'object' && ('result' in r || 'error' in r))) throw new Failure('not a batch answer', { cool: true });
          const bad = byId.find((r) => r.error && isRetry(r.error));
          if (bad) throw busy(bad.error);
          out = byId;
          qs.forEach((q, k) => noteHead(q, out[k]));
        } else if (j !== null) {
          if (typeof j !== 'object') throw new Failure('not JSON-RPC', { cool: true });
          if (j.error && isRetry(j.error)) throw busy(j.error);
          // one JSON object instead of a list ("batch not supported"): no batches here
        }
        if (!out) {
          out = [];
          for (const q of qs) out.push(await single(ep, q));
        }
        stat(ep).ok++;
        return { j: out, node: ep.url };
      } catch (e) {
        if (!(e instanceof Failure)) throw e;
        last = e;
        if (e.stop) break;
        failed(ep, e);
      }
    }
    return { j: last?.error ? { jsonrpc: '2.0', id: null, error: last.error } : refuse(null, `no node answered (${last?.message ?? 'no node'})`), node: null };
  }

  const respond = (r) => {
    const res = new Response(JSON.stringify(r.j), { status: 200, headers: HEADERS });
    res.attempts = r.attempts ?? 1;
    res.node = r.node;
    return res;
  };

  const f = async (_url, init = {}) => {
    let q = null;
    try {
      q = JSON.parse(typeof init.body === 'string' ? init.body : '');
    } catch {}
    if (Array.isArray(q)) return respond(await batch(q));
    if (!q || typeof q.method !== 'string') return respond({ j: refuse(q, 'not a JSON-RPC call', -32600) });
    return respond(await call(q));
  };
  f.call = call;
  f.batch = batch;
  f.stats = stats;
  /** One line: what each node did ("rpc: bsc-dataseed.bnbchain.org 30 ok, …"), or null if nothing ran. */
  f.summary = () => {
    if (!stats.size) return null;
    const parts = [...stats].map(([url, s]) => `${short(url)} ${s.ok} ok` + (s.failed ? ` ${s.failed} failed (${[...s.why].map(([w, n]) => `${w} ${n}`).join(', ')})` : ''));
    return 'rpc: ' + parts.join('; ');
  };
  return f;
}

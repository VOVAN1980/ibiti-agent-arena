// IBITI Agent Arena — the viewer's own reads of the chain. On mainnet the site's config names public
// BNB Smart Chain nodes that answer a browser directly (CORS open, JSON-RPC batches accepted), so a
// page's polls go from the viewer's own address to those nodes and cost the arena's Worker nothing
// (Cloudflare Workers Free: 100,000 invocations a day for the whole account). The Worker's /rpc stays
// for what no node serves a browser well (the arena's history: the Worker reads it from its KV archive,
// one read per 50000 blocks) and as the last resort when every node fails.
//
// Each node: { url, calls: serves eth_call / eth_blockNumber / eth_getBlockByNumber, logs: the widest
// eth_getLogs range it serves in one request (0: none), archive: keeps every log, keep: hours of logs it
// is trusted to keep (a pruning node answers [] for blocks it dropped, with no error) }.
//
// - The calls of one moment travel together: one JSON-RPC batch per node, never one request per call.
// - Calls go to the first calls node that is not cooling down and has a request left in its budget
//   (below); a log range to the node that serves it in the fewest requests (at most MAX_PIECES pieces of
//   its own cap, in one batch), among the nodes trusted for that range: an archive node always, a
//   pruning node only for blocks newer than its `keep` hours behind the head this client has seen
//   (no head seen yet: archive nodes only). `keep` must stay well inside what the node really keeps:
//   publicnode, measured 2026-11-24 from a home address, answers [] with no error for blocks older than
//   about 2 to 2.5 hours (its backends differ), so it is trusted for 1. An empty answer from a node that
//   may have dropped the range is never taken: such a node is never asked for it. A log answer says
//   whether a pruning node gave it (`mayPrune`): the page keeps only the others in the tab's storage.
// - A log range wider than DIRECT_SPAN, or one no node may serve, goes to the Worker by design (the
//   history: its KV archive), never counted as a failure.
// - Politeness: each node has a budget of BURST requests, refilled by one every REFILL_MS (2 s): a
//   viewer never sends a node more than one request per 2 s on average. A request with log ranges costs
//   one per eth_getLogs piece in it (at most MAX_PIECES pieces in one request), so a batch never hides
//   many log reads behind one request. A node out of budget is passed over for another; when all are,
//   calls wait for the first budget to refill, and a log range waits only for a node whose budget is
//   back within REFILL_MS: else it is `busy` (not sent, not a failure, never the Worker: the page reads
//   it with a later poll).
// - A node that fails (HTTP 429 or another error status, a timeout, a network error, a broken answer,
//   a rate-limit error inside the batch) cools down (30 s after a rate limit, 10 s after another
//   failure, doubled with each failure in a row, up to 5 minutes; a Retry-After is honoured) and the
//   calls it did not answer go to the next node in the same moment. A call's own error that another
//   node may not give (a range past that node's head, a missing answer) moves the call on without a
//   cooldown; a revert of eth_call is the chain's answer and is final.
// - When no node answered a call, it goes to the Worker's /rpc (the page still works), but not again
//   until a backoff has passed (2 s, then twice as long each time, up to 30 s). There is one backoff per
//   kind of call, the calls and the log ranges, and only a direct answer of that kind resets it: the
//   dataseeds answering the calls never reopen the Worker to log ranges no log node serves now, nor the
//   log nodes to calls. Meanwhile such a call fails and the page's own backoffs (arena.js: its polls,
//   its history reads) slow it down, so a broken network, or one kind of node down for this viewer,
//   never turns every poll into a Worker invocation.

const DIRECT_SPAN = 5000;
const MAX_PIECES = 4;
const MAX_BATCH = 40;
const BURST = 3;
const REFILL_MS = 2000;
const RATE_COOL_MS = 30000;
const FAIL_COOL_MS = 10000;
const MAX_COOL_MS = 300000;
const FALLBACK_MIN_MS = 2000;
const FALLBACK_MAX_MS = 30000;
const CALL_TIMEOUT_MS = 5000;
const LOG_TIMEOUT_MS = 8000;
const ROUNDS = 4;
const KEEP_HOURS = 1; // a pruning node whose retention the config does not give: an hour

const RATE = /rate.?limit|too many|limit exceeded|throttl|capacity|-32005|\b429\b/i;
const FINAL = /revert/i;

/** A JSON-RPC error that says the node is rate-limiting this viewer. */
export const isRate = (e) => e?.code === 429 || e?.code === -32005 || e?.code === -32029 || RATE.test(String(e?.message ?? ''));
/** A JSON-RPC error that is the chain's own answer (the same on every node). */
const isFinal = (q, e) => q.method === 'eth_call' && (e?.code === 3 || FINAL.test(String(e?.message ?? '')));
const rangeOf = (q) => {
  const p = Array.isArray(q.params) ? q.params[0] : null;
  const a = parseInt(p?.fromBlock, 16);
  const b = parseInt(p?.toBlock, 16);
  return Number.isFinite(a) && Number.isFinite(b) && b >= a ? [a, b] : null;
};
const hex = (n) => '0x' + n.toString(16);

/** The node list of the site's config, checked: https (or http for a local test) URLs only. */
export function nodesOf(list) {
  return (Array.isArray(list) ? list : [])
    .filter((x) => typeof x?.url === 'string' && /^https?:\/\/[^\s"'<>]+$/.test(x.url))
    .map((x) => ({ url: x.url, calls: x.calls === true, logs: Math.max(0, Math.floor(Number(x.logs ?? 0) || 0)), archive: x.archive === true, keep: Number(x.keep) > 0 ? Number(x.keep) : KEEP_HOURS }));
}

/**
 * The client. `nodes`: the config's list; `worker`: the Worker's /rpc URL; `fetchFn`, `now`, `sleep`:
 * injected for tests; `blocksPerHour`: for the nodes' `keep`. send(calls) -> Promise of one outcome per
 * call, in order: { result, from, mayPrune } (from: the node's URL or 'worker'; mayPrune: a log range a
 * pruning node answered) | { error } (a JSON-RPC error; `whole`: the Worker refused the whole request) |
 * { fail } (nothing answered: an Error) | { fail, busy: true } (a log range no node had budget for now).
 */
export function createClient({
  nodes: list,
  worker = '/rpc',
  fetchFn = (url, init) => fetch(url, init),
  now = () => Date.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  blocksPerHour = 8000,
  directSpan = DIRECT_SPAN,
  maxPieces = MAX_PIECES,
  maxBatch = MAX_BATCH,
  burst = BURST,
  refillMs = REFILL_MS,
  callTimeoutMs = CALL_TIMEOUT_MS,
  logTimeoutMs = LOG_TIMEOUT_MS,
} = {}) {
  const nodes = nodesOf(list).map((n, order) => ({ ...n, order, tokens: burst, at: now(), coolUntil: 0, strikes: 0 }));
  const stats = { requests: new Map(), worker: 0, fallbacks: 0, busy: 0 }; // url -> requests sent; Worker requests
  let head = 0; // the highest block this client has seen
  // the Worker fallback's backoff, per kind: no fallback of that kind before `at`
  const backoff = { calls: { at: 0, delay: FALLBACK_MIN_MS }, logs: { at: 0, delay: FALLBACK_MIN_MS } };
  const kindOf = (q) => (q.method === 'eth_getLogs' ? 'logs' : 'calls');

  const refill = (n) => {
    const t = now();
    n.tokens = Math.min(burst, n.tokens + Math.max(0, t - n.at) / refillMs);
    n.at = t;
  };
  /** How long until node `n` may get a request (0: now). */
  const waitFor = (n) => {
    refill(n);
    return n.tokens >= 1 ? 0 : Math.ceil((1 - n.tokens) * refillMs);
  };
  const cooling = (n) => n.coolUntil > now();
  const cool = (n, rate, retryAfterMs = null) => {
    n.strikes++;
    const base = rate ? RATE_COOL_MS : FAIL_COOL_MS;
    n.coolUntil = now() + Math.min(MAX_COOL_MS, retryAfterMs ?? base * 2 ** (n.strikes - 1));
  };
  const noteHead = (q, result) => {
    let b = null;
    if (q.method === 'eth_blockNumber' && typeof result === 'string') b = parseInt(result, 16);
    else if (q.method === 'eth_getBlockByNumber' && typeof result?.number === 'string') b = parseInt(result.number, 16);
    if (Number.isFinite(b) && b > head) head = b;
  };

  /** Whether node `n` may ever serve call `q` (cooldowns aside). */
  function canServe(n, q) {
    if (q.method !== 'eth_getLogs') return n.calls;
    const r = rangeOf(q);
    if (!r || !n.logs) return false;
    const width = r[1] - r[0] + 1;
    if (width > directSpan || Math.ceil(width / n.logs) > maxPieces) return false;
    if (n.archive) return true;
    // a pruning node: only blocks it still keeps for sure, measured from the head seen
    return head > 0 && r[0] >= head - n.keep * blocksPerHour;
  }
  const piecesOf = (n, q) => {
    if (q.method !== 'eth_getLogs') return [null];
    const [a, b] = rangeOf(q);
    const out = [];
    for (let x = a; x <= b; x += n.logs) out.push([x, Math.min(b, x + n.logs - 1)]);
    return out;
  };

  /** The node for a call now: not tried for it, not cooling down; ready ones first (in this moment's
   *  plan already, or with budget left), then the fewest requests, then the config's order. A log range
   *  goes only where its pieces fit in the node's request of this moment (MAX_PIECES in all) and the
   *  node's budget is back within REFILL_MS: else 'busy'. null: no node may serve it now. */
  function pick(it, plan) {
    const ok = nodes.filter((n) => !it.tried.has(n) && !cooling(n) && canServe(n, it.q));
    if (!ok.length) return null;
    const logs = it.q.method === 'eth_getLogs';
    const pieces = (n) => (logs ? piecesOf(n, it.q).length : 0);
    const fits = (n) => !logs || ((plan.get(n)?.pieces ?? 0) + pieces(n) <= maxPieces && (plan.has(n) || waitFor(n) <= refillMs));
    const usable = ok.filter(fits);
    if (!usable.length) return 'busy';
    const ready = (n) => (plan.has(n) || waitFor(n) === 0 ? 0 : 1);
    return usable.sort((x, y) => ready(x) - ready(y) || pieces(x) - pieces(y) || x.order - y.order)[0];
  }

  /** One request to node `n` with the calls `its`; answered calls go to `out`, the others to `next`. */
  async function sendTo(n, its, out, next) {
    const parts = [];
    const taken = [];
    for (const it of its) {
      const ps = piecesOf(n, it.q);
      if (parts.length + ps.length > maxBatch) {
        next.push(it); // the next request (not tried here: no fault of the node)
        continue;
      }
      taken.push(it);
      it.parts = ps.map((r) => {
        const id = parts.length + 1;
        const q = r ? { jsonrpc: '2.0', id, method: 'eth_getLogs', params: [{ ...it.q.params[0], fromBlock: hex(r[0]), toBlock: hex(r[1]) }] } : { jsonrpc: '2.0', id, method: it.q.method, params: it.q.params ?? [] };
        parts.push(q);
        return id;
      });
    }
    if (!parts.length) return;
    // the request's turn is taken now, one per log piece in it (a node's budget may go into debt:
    // whoever comes next waits longer)
    const wait = waitFor(n);
    n.tokens -= Math.max(1, parts.filter((q) => q.method === 'eth_getLogs').length);
    if (wait) await sleep(wait);
    stats.requests.set(n.url, (stats.requests.get(n.url) ?? 0) + 1);
    const failAll = () => {
      for (const it of taken) {
        it.tried.add(n);
        next.push(it);
      }
    };
    const hasLogs = taken.some((it) => it.q.method === 'eth_getLogs');
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctl?.abort();
    }, hasLogs ? logTimeoutMs : callTimeoutMs);
    let j;
    try {
      const res = await Promise.race([
        fetchFn(n.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(parts.length === 1 ? parts[0] : parts), signal: ctl?.signal }),
        new Promise((_, reject) => ctl?.signal.addEventListener('abort', () => reject(new Error('timeout')))),
      ]);
      if (!res.ok) {
        const after = Number(res.headers?.get?.('retry-after'));
        cool(n, res.status === 429, Number.isFinite(after) && after > 0 ? after * 1000 : null);
        return failAll();
      }
      j = await res.json();
    } catch {
      cool(n, false); // a timeout, a network error, a body that is not JSON
      return failAll();
    } finally {
      clearTimeout(timer);
    }
    if (timedOut || (parts.length > 1 && !Array.isArray(j))) {
      cool(n, isRate(j?.error)); // the whole batch refused (e.g. one rate-limit answer for all)
      return failAll();
    }
    const byId = new Map((Array.isArray(j) ? j : [j]).filter((x) => x && typeof x === 'object').map((x) => [x.id, x]));
    let rate = false;
    let answered = false;
    const kinds = new Set(); // the kinds of call this node answered directly
    for (const it of taken) {
      const results = [];
      let bad = false;
      for (const id of it.parts) {
        const a = byId.get(id);
        if (!a) bad = true;
        else if (a.error) {
          if (isFinal(it.q, a.error)) {
            out[it.i] = { error: a.error, from: n.url };
            answered = true;
            kinds.add(kindOf(it.q));
            bad = 'final';
            break;
          }
          if (isRate(a.error)) rate = true;
          bad = true;
        } else if (it.q.method === 'eth_getLogs' && !Array.isArray(a.result)) bad = true;
        else if (a.result === undefined) bad = true;
        else results.push(a.result);
        if (bad) break;
      }
      if (bad === 'final') continue;
      if (bad) {
        it.tried.add(n);
        next.push(it);
        continue;
      }
      const logs = it.q.method === 'eth_getLogs';
      out[it.i] = { result: logs ? results.flat() : results[0], from: n.url, mayPrune: logs && !n.archive };
      noteHead(it.q, out[it.i].result);
      answered = true;
      kinds.add(kindOf(it.q));
    }
    if (rate) cool(n, true);
    else if (answered) n.strikes = 0;
    // a direct answer reopens the Worker fallback for its own kind of call only
    for (const k of kinds) backoff[k] = { at: 0, delay: FALLBACK_MIN_MS };
  }

  /** The calls `its` through the Worker's /rpc, in batches of at most maxBatch. */
  async function viaWorker(its, out) {
    for (let k = 0; k < its.length; k += maxBatch) {
      const part = its.slice(k, k + maxBatch);
      const body = part.map((it, x) => ({ jsonrpc: '2.0', id: x + 1, method: it.q.method, params: it.q.params ?? [] }));
      stats.worker++;
      try {
        const res = await fetchFn(worker, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body.length === 1 ? body[0] : body) });
        const j = await res.json();
        const list = Array.isArray(j) ? j : [j];
        part.forEach((it, x) => {
          const r = list.find((a) => a && typeof a === 'object' && a.id === x + 1);
          if (!r) out[it.i] = { error: Array.isArray(j) ? null : j?.error ?? null, whole: true }; // the whole request refused (e.g. too many reads)
          else if (r.error) out[it.i] = { error: r.error };
          else {
            out[it.i] = { result: r.result, from: 'worker', mayPrune: false };
            noteHead(it.q, r.result);
          }
        });
      } catch (e) {
        for (const it of part) out[it.i] = { fail: e };
      }
    }
  }

  async function send(calls) {
    const out = new Array(calls.length);
    const items = calls.map((q, i) => ({ i, q, tried: new Set(), primary: !nodes.some((n) => canServe(n, q)) }));
    let left = items.filter((it) => !it.primary);
    for (let r = 0; r < ROUNDS && left.length; r++) {
      const plan = new Map(); // node -> { its: its calls in this moment, pieces: their log pieces }
      const next = [];
      for (const it of left) {
        const n = pick(it, plan);
        if (!n) continue; // no node may serve it now: the Worker (below)
        if (n === 'busy') {
          it.busy = true; // nodes that could, but not now: a later poll
          continue;
        }
        if (!plan.has(n)) plan.set(n, { its: [], pieces: 0 });
        const p = plan.get(n);
        p.its.push(it);
        if (it.q.method === 'eth_getLogs') p.pieces += piecesOf(n, it.q).length;
      }
      await Promise.all([...plan].map(([n, p]) => sendTo(n, p.its, out, next)));
      left = next;
    }
    const primary = items.filter((it) => it.primary && !out[it.i]);
    const fallback = [];
    for (const it of items.filter((x) => !x.primary && !out[x.i])) {
      if (it.busy) {
        stats.busy++;
        out[it.i] = { fail: new Error(`${it.q.method}: every node that serves it is busy now (asked again later)`), busy: true };
      } else fallback.push(it);
    }
    // the Worker for what no node answered, per kind: not again before that kind's backoff has passed
    const allowed = [];
    for (const kind of ['calls', 'logs']) {
      const its = fallback.filter((it) => kindOf(it.q) === kind);
      if (!its.length) continue;
      const b = backoff[kind];
      if (now() < b.at) {
        for (const it of its) out[it.i] = { fail: new Error(`${it.q.method}: no node answered (the server is asked again later)`) };
        continue;
      }
      stats.fallbacks++;
      b.at = now() + b.delay;
      b.delay = Math.min(FALLBACK_MAX_MS, b.delay * 2);
      allowed.push(...its);
    }
    if (primary.length || allowed.length) await viaWorker([...primary, ...allowed], out);
    return out;
  }

  return { send, stats, nodes, head: () => head };
}

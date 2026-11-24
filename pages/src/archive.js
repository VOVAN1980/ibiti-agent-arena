// The arena's history in Workers KV (binding HISTORY, the mainnet Workers only): every log of the arena,
// one value per aligned chunk of CHUNK blocks, written once the chunk is complete and final, and one
// value per aligned span of SPAN blocks (ten chunks) once all its chunks are stored.
//
// Why: the site replays the arena from its events, and the judge looks back for fights an outage left
// out. No free public node serves wide log ranges reliably from Cloudflare (publicnode answers HTTP 429
// to most requests; thirdweb serves 1000 blocks a request, 48.club 250), so the history is read once,
// in small pages, and kept: a chunk of the past never changes again. A span lets a page load read the
// history with one KV read per 50000 blocks instead of one per 5000 (Workers KV Free: about 100,000
// reads a day for the account).
//
// Only from the archive nodes (RPC_URLS entries with "archive": true; thirdweb today). A pruning node
// (publicnode drops old logs silently) or one whose retention is unknown (48.club) may answer `[]` for
// blocks it no longer has, and a chunk stored once is trusted for good (the judge's catch-up and
// season-close reads, the site's history). Every page is checked: a list of this arena's logs inside the
// page's range, from a node whose own head (asked in the same run) is past the page's end. A page that
// failed is never stored as empty: the chunk waits for a later run.
//
// The cron (host.js `scheduled`) runs `archiveRun` after the judge, in the same invocation, with what
// is left of its 50 subrequests (KV calls count; at most ARCHIVE_BUDGET) and knowing what the judge sent
// to the archive nodes already: thirdweb rate-limits bursts of more than about 8 quick calls, so the
// archive sends at most ARCHIVE_BURST minus the judge's archive-node requests in one invocation (the
// head check included), pauses before the first page and between pages, and reads nothing while every
// archive node cools down after a failure in this invocation. A chunk is read in PAGE-block pages over
// one or more runs (the pages read so far are kept in this isolate's memory, and in the cursor's KV
// value when the run started from KV or every PERSIST_RUNS runs of a chunk), so the archive moves on
// in any minute that leaves it a page or two. A chunk is read only once it ends at least ARCHIVE_MARGIN
// blocks behind the head (no reorganisation reaches that deep, and an archive node a little behind
// still has every block of it).
//
// Writes: one value per chunk; one per span (every tenth chunk); the cursor when the run started from
// KV, when it passed a span, or every fourth run of a chunk that takes long. At 0.45 s a block a chunk is 37.5
// minutes: about 39 chunks, 4 spans and a few cursor writes a day per ring (Workers KV Free: 1,000
// writes a day for the account). A backfill (the namespace created after the deployment) costs about
// 1.2 writes per chunk of its backlog, at a few pages a minute.
//
// Keys: `logs:<arena>:<chunk>` and `span:<arena>:<span>` (JSON arrays, the logs in block order) and
// `cursor:<arena>` ({ next: the first chunk not stored, at: its first block not read yet, span: the
// first span not built, logs: the pages of chunk `next` read so far }). The arena's address is in every
// key, so one namespace can serve both rings, and a new arena never reads an old one's history.

import { rpcFetch, endpointsOf } from './rpc.js';

export const CHUNK = 5000;
export const SPAN = 50000; // ten chunks
export const PAGE = 1000;
export const ARCHIVE_MARGIN = 200;
// the most subrequests the archive takes in one cron invocation (the judge's are counted first)
export const ARCHIVE_BUDGET = 16;
// the most requests to the archive nodes in one cron invocation, the judge's included
export const ARCHIVE_BURST = 7;

export const chunkKey = (arena, c) => `logs:${String(arena).toLowerCase()}:${c}`;
export const spanKey = (arena, s) => `span:${String(arena).toLowerCase()}:${s}`;
export const cursorKey = (arena) => `cursor:${String(arena).toLowerCase()}`;
export const chunkOf = (block) => Math.floor(block / CHUNK);
export const spanOf = (block) => Math.floor(block / SPAN);
/** The first and last block of chunk `c`. */
export const chunkRange = (c) => [c * CHUNK, c * CHUNK + CHUNK - 1];
/** The first and last block of span `s`. */
export const spanRange = (s) => [s * SPAN, s * SPAN + SPAN - 1];
const PER_SPAN = SPAN / CHUNK;
// a chunk still partial after this many runs of one isolate gets its pages written to the cursor (a new
// isolate would otherwise read them again)
const PERSIST_RUNS = 4;

// this isolate's last known state, per arena: a run with nothing final to store reads no KV at all
const memo = new Map(); // arena -> { next, at, span, logs, runs: runs spent on chunk `next` so far }
/** For tests: forget what this isolate knows of the cursors. */
export const forgetCursors = () => memo.clear();

async function textOf(kv, key) {
  const v = await kv.get(key);
  return typeof v === 'string' ? v : null;
}
/** A stored chunk as its text (a JSON array of the arena's logs), or null when it is not stored. */
export const chunkText = (kv, arena, c) => textOf(kv, chunkKey(arena, c));
/** A stored span as its text, or null when it is not built. */
export const spanText = (kv, arena, s) => textOf(kv, spanKey(arena, s));

/** True if `logs` is a list of `arena`'s logs, all inside [from, to] and none removed by a reorganisation. */
export function pageOk(logs, arena, from, to) {
  if (!Array.isArray(logs)) return false;
  const a = String(arena).toLowerCase();
  return logs.every((l) => {
    const b = parseInt(l?.blockNumber, 16);
    return String(l?.address).toLowerCase() === a && b >= from && b <= to && l.removed !== true && Array.isArray(l.topics);
  });
}

/** The nodes the archive reads: those marked archive that serve logs (never a pruning node). */
export const archiveNodes = (env) => endpointsOf(env, 'RPC_URL').filter((e) => e.archive && e.logs > 0);

// a JSON array's items as text: "[a,b]" -> "a,b"
const inner = (text) => text.trim().slice(1, -1).trim();

function parseCursor(raw, first, firstSpan) {
  const fresh = { next: first, at: null, span: firstSpan, logs: [] };
  if (raw === null || raw === undefined) return fresh;
  if (/^\d+$/.test(String(raw).trim())) return { ...fresh, next: Math.max(first, Number(raw)) }; // a plain chunk number
  try {
    const c = JSON.parse(raw);
    const next = Number.isSafeInteger(c?.next) ? Math.max(first, c.next) : first;
    const same = next === c.next;
    return {
      next,
      at: same && Number.isSafeInteger(c?.at) ? c.at : null,
      span: Number.isSafeInteger(c?.span) ? Math.max(firstSpan, c.span) : firstSpan,
      logs: same && Number.isSafeInteger(c?.at) && Array.isArray(c?.logs) ? c.logs : [],
    };
  } catch {
    return fresh;
  }
}

/**
 * One archive step. opts: { fetchFn, log, head (the head the judge read, to spare a request), budget
 * ({ left }: the subrequests it may spend), spent (Map url -> requests the judge sent to that node in
 * this invocation), cooldowns (the judge's: nodes that failed it this minute), pauseMs (before the
 * first page), gapMs (between pages), wait, timeoutMs }.
 * Returns { stored: chunks written, spans: spans written, next: the cursor after the run, skipped?: why
 * no page was read }.
 */
export async function archiveRun(env, {
  fetchFn = fetch,
  log = console.log,
  head = null,
  budget = null,
  spent = null,
  cooldowns = null,
  pauseMs = 2000,
  gapMs = 1000,
  wait = (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs = 6000,
} = {}) {
  const kv = env.HISTORY;
  if (!kv || !env.ARENA) return { stored: 0, spans: 0, skipped: 'no archive' };
  const nodes = archiveNodes(env);
  if (!nodes.length) return { stored: 0, spans: 0, skipped: 'no archive node (RPC_URLS: "archive": true)' };
  budget ??= { left: Number(env.ARCHIVE_BUDGET ?? ARCHIVE_BUDGET) };
  const arena = String(env.ARENA).toLowerCase();
  const deploy = Number(env.DEPLOY_BLOCK ?? 0);
  const margin = Number(env.ARCHIVE_MARGIN ?? ARCHIVE_MARGIN);
  const first = chunkOf(deploy);
  const firstSpan = spanOf(deploy);
  // the requests the archive nodes may still get in this invocation (the judge's counted)
  const used = nodes.reduce((n, e) => n + (spent?.get(e.url) ?? 0), 0);
  let requests = Number(env.ARCHIVE_BURST ?? ARCHIVE_BURST) - used;
  const cooling = nodes.every((e) => (cooldowns?.get(e.url) ?? 0) > Date.now());
  // one attempt a request: a failed page ends this run's pages (no retry burst on a rate-limited node)
  const net = rpcFetch(nodes, { fetchFn, timeoutMs, logsTimeoutMs: 20000, tries: 1, maxPieces: 1, budget, wait, ...(cooldowns ? { cooldowns } : {}) });
  const spend = () => (budget.left > 0 ? (budget.left--, true) : false);
  const spanDue = (st) => (st.span + 1) * PER_SPAN <= st.next;
  const nodeHead = new Map(); // url -> its head, asked in this run
  let skipped = cooling ? 'every archive node cools down after a failure this minute' : requests < 2 ? `the archive nodes had ${used} request(s) this minute already` : null;
  /** The archive node's head (one request); null when it did not answer. */
  const askHead = async () => {
    requests--;
    const { j, node } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] });
    if (j.error || !node || typeof j.result !== 'string') return null;
    nodeHead.set(node, parseInt(j.result, 16));
    return nodeHead.get(node);
  };
  try {
    let st = memo.get(arena) ?? null;
    const fromMemo = st !== null;
    if (head === null && !skipped && budget.left > 0) {
      head = await askHead();
      if (head === null) skipped = 'no head from the archive node';
    }
    const due = (c) => head !== null && chunkRange(c)[1] <= head - margin;
    // nothing final yet and no span to build: no KV read
    if (st && !due(st.next) && !spanDue(st)) return { stored: 0, spans: 0, next: st.next, skipped: skipped ?? 'nothing final yet' };
    if (!st) {
      if (!spend()) return { stored: 0, spans: 0, skipped: 'no subrequests left' };
      st = parseCursor(await kv.get(cursorKey(arena)), first, firstSpan);
    }
    st = { ...st, logs: [...st.logs], runs: (st.runs ?? 0) + 1 };
    const before = JSON.stringify([st.next, st.at, st.span]);
    let stored = 0;
    let spans = 0;
    let passedSpan = false;
    // ---- the spans whose chunks are all stored: up to ten KV reads and one write, no node
    while (spanDue(st) && budget.left >= PER_SPAN + 2) {
      const [s0, s1] = spanRange(st.span);
      const parts = [];
      let missing = null;
      for (let c = Math.max(chunkOf(s0), first); c <= chunkOf(s1); c++) {
        spend();
        const t = await chunkText(kv, arena, c);
        if (t === null) {
          missing = c;
          break;
        }
        parts.push(inner(t));
      }
      if (missing !== null) {
        log(`archive: span ${st.span} not built (chunk ${missing} not readable yet): a later run builds it`);
        break;
      }
      spend();
      await kv.put(spanKey(arena, st.span), '[' + parts.filter(Boolean).join(',') + ']');
      st.span++;
      spans++;
      passedSpan = true;
    }
    // ---- the pages of the chunks that are final
    let paused = false;
    let failed = null;
    while (!skipped && due(st.next) && requests > 0) {
      const [c0, c1] = chunkRange(st.next);
      const start = Math.max(c0, deploy);
      if (st.at === null || st.at < start || st.at > c1) {
        // a new chunk: stored already (a cursor read that lagged its write)? one KV read
        if (budget.left < 4) break;
        spend();
        if ((await chunkText(kv, arena, st.next)) !== null) {
          st = { ...st, next: st.next + 1, at: null, logs: [], runs: 0 };
          if (st.next % PER_SPAN === 0) passedSpan = true;
          continue;
        }
        st.at = start;
        st.logs = [];
      }
      // a page (and the head check first), the chunk and the cursor: room for all of them
      if (budget.left < 3 + (nodeHead.size ? 0 : 1)) break;
      await wait(paused ? gapMs : pauseMs);
      paused = true;
      if (!nodeHead.size && (await askHead()) === null) {
        failed = 'the archive node\'s head could not be read';
        break;
      }
      if (requests < 1) break;
      const p = st.at;
      const to = Math.min(c1, p + PAGE - 1);
      requests--;
      const { j, node } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: arena, fromBlock: '0x' + p.toString(16), toBlock: '0x' + to.toString(16) }] });
      if (j.error) failed = `blocks ${p}-${to}: ${j.error.message}`;
      else if (!pageOk(j.result, arena, p, to)) failed = `blocks ${p}-${to}: not a list of this arena's logs in that range`;
      else if (!(nodeHead.get(node) >= to)) failed = `blocks ${p}-${to}: the node that answered is not known to be past them`;
      if (failed) break;
      st.logs.push(...j.result);
      st.at = to + 1;
      if (st.at > c1) {
        spend();
        await kv.put(chunkKey(arena, st.next), JSON.stringify(st.logs));
        stored++;
        st = { ...st, next: st.next + 1, at: null, logs: [], runs: 0 };
        if (st.next % PER_SPAN === 0) passedSpan = true;
      }
    }
    if (failed) log(`archive: chunk ${st.next} not complete (${failed}): a later run reads that page again`);
    const changed = JSON.stringify([st.next, st.at, st.span]) !== before;
    // the cursor in KV: when this run started from it, at a span, or when a chunk takes long
    if (changed && (!fromMemo || passedSpan || st.runs >= PERSIST_RUNS) && spend()) {
      await kv.put(cursorKey(arena), JSON.stringify({ next: st.next, at: st.at, span: st.span, logs: st.at === null ? [] : st.logs }));
      st.runs = 0;
    }
    memo.set(arena, st);
    if (stored || spans) log(`archive: ${stored} chunk(s) and ${spans} span(s) stored, next chunk ${st.next}`);
    return { stored, spans, next: st.next, ...(skipped ? { skipped } : {}) };
  } finally {
    const line = net.summary();
    if (line) log('archive ' + line);
  }
}

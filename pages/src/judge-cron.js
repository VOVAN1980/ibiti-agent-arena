// The judge on Cloudflare: a Cron Trigger runs `judgeRun` every minute (host.js `scheduled`). It holds
// the draws and scores the fights, without keeping any state: the chain says what is due.
//
// Each run:
// - reads what it needs first in one JSON-RPC batch (one request, from a node our transactions are
//   sent to): its two nonces, its balance, the head, the latest block, the arena's draw state, the
//   season calendar and each season's close;
// - an earlier transaction of the judge still pending after a few seconds is stuck: it is replaced
//   (an empty transfer to itself, same nonce, a higher gas price) and the run ends there;
// - the draw: after a cutoff it seals the draw (if no registration did it already), waits for the
//   sealed block, then holds the draw on its hash (AgentArena.draw); with fewer than two agents in the
//   hall there is nobody to pair, so it is left alone (a later registration closes it);
// - reads the arena's logs in three parts, each in requests of LOG_UNIT blocks (1000 on mainnet: what
//   thirdweb serves in one request and 48.club in four; publicnode, rate-limited from Cloudflare, is the
//   last fallback only; a range older than NODE_TRUST_HOURS goes only to the archive nodes):
//   * the live window, every run: the last LIVE_BLOCKS blocks (22 minutes), up to HEAD_MARGIN blocks
//     behind the head (the log nodes lag a few blocks behind each other, and a range past a node's head
//     is an error there). A fight lasts at most 14 min 50 s from its draw, so the window holds every
//     fight that may still need its lock, every fight while it runs and the minutes after its end;
//   * the newest blocks, behind that margin, only when the last draw was sealed inside the window and
//     its Drawn event is not in it: another sender held it a moment ago, and its fights need their lock;
//   * after the locks (below), one catch-up step, in a cycle of four minutes: the LOG_UNIT blocks just
//     older than the live window (a fight locked late, with a new countdown, ends up to 30 minutes after
//     its draw), a step of the near walk (the newest units below the live window), a step of the whole
//     walk backwards over the catch-up window (six hours of blocks; with the KV archive a day, one stored
//     chunk of 5000 blocks a step, one KV read), the near walk again. A fight an outage left out is found
//     by a later step (measured in the tests); each unit is visited several times while it is in the
//     window. A fight older than the window is judged by hand with judge.mjs (FULL_SCAN). The step is
//     optional: it stops at a floor of the budget that keeps room for the judgements of the fights the
//     live window holds, and what it could not read is read by a later step;
// - the trap plans, before any older block is read: every fight drawn in the last twenty minutes that is
//   still waiting for its plan (no TrapsLocked event; drawn by this judge or by anyone else) gets it
//   locked (AgentArena.lockTraps), one hash per match, so the judge can later judge it only with that
//   plan. The fights this run drew come from its own receipt, in case the log nodes have not seen that
//   block yet. Its first bell waits for the lock: locked late, the match gets a new countdown;
// - the fights are read from the chain in batches (fightOf, one request per BATCH_MAX fights), and only
//   those that may be over: a fight with no Ended event that started less than its shortest length ago
//   (the countdown, eleven rounds answered at once, the last round in full) is still running and is not
//   read;
// - skips a fight that is judged, still running, waiting for its opponent's fight to end (a match is
//   judged only when both fights are over), cancelled, empty (nothing answered: it would score 0 and
//   only cost gas), or registered with a foreign commitment (it can never be judged);
// - judges with the fight's right-answer hashes, salt and the trap plan it locked (plan.js; a fight
//   whose plan was never locked never ran and is not judged), at most MAX_PER_RUN a run and
//   MAX_PER_HOUR an hour (a guard against draining the judge's gas, counted on the chain itself from
//   the Judged events of the last hour in a full run, else of the live window, scaled to its length);
// - simulates every transaction first (eth_estimateGas; the judgements of a run in one batch), signs it
//   here with the judge key (a Worker secret) and sends it as a raw transaction. Its hash is computed
//   here (keccak256 of the bytes): a send retried on another node after a timeout may already have gone
//   through, and the node then says "already known" or "nonce too low" instead of the hash;
// - when no log node can read the live window, the run is degraded: it judges and locks what it could
//   read, and never closes a season;
// - the season's close: once a season is over (half an hour after its end) and not closed, the run is a
//   full one: after the locks it reads the whole look-back window (the archive's stored chunks, the log
//   nodes for the rest; stopped at the same floor as a catch-up step) and closes the season only if it
//   read all of it and found none of its fights left;
// - talks to the chain through rpc.js: several nodes (RPC_URLS, or RPC_URL alone), bounded retries,
//   and at most SUBREQ_BUDGET requests a run (Cloudflare caps the subrequests of one invocation: 50
//   on the Free plan; a JSON-RPC batch is one request, a KV read is one). What the budget does not
//   cover is left for the next run, like what the clock does not cover; the receipts of what was sent
//   are always kept room for;
// - sends nothing new after RUN_SECONDS (default 40) of a run, so a run never sends while the next
//   minute's run starts: one sender per key at a time, and a transaction found pending at the start of
//   a run is at least a quarter of a minute old (stuck);
// - checks the receipts of what it sent before it ends, in one batch (a reverted or lost transaction is
//   not counted; the next run finds the same work on the chain and does it again: the chain itself is
//   the list of what is still to do).
//
// Environment: RPC_URL (and optionally RPC_URLS: the nodes, see rpc.js), ARENA, CHAIN_ID, DEPLOY_BLOCK,
// BLOCKS_PER_WEEK, SEASON_BOOK and SEASONS (optional: read in the first batch), SECRET (Worker secret),
// JUDGE_KEY (Worker secret), HISTORY (optional KV binding: the archive, archive.js), LOG_UNIT (default
// 5000; 1000 on mainnet), LIVE_BLOCKS (default 22 minutes of blocks), LOOKBACK_BLOCKS (default 20000:
// the window a full run reads), CATCHUP_LOOKBACK_BLOCKS (the catch-up walk's window: default six hours of
// blocks, a day with HISTORY), FULL_SCAN ("always": every run reads the whole look-back window, as
// judge.mjs does by hand; the default without RPC_URLS and LOG_UNIT, the testnet's one node, as before),
// HEAD_MARGIN (default 25), MAX_PER_RUN
// (default 16), MAX_PER_HOUR (default 240), RUN_SECONDS (default 40), SUBREQ_BUDGET (default 45),
// JUDGE_LOW_BALANCE (wei, default LOW_BALANCE: below it each run logs a warning to top up the judge's
// wallet; it never stops the judge).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from './keccak.js';
import { answerHash } from './keys.js';
import { BREAK, fightOfCall, parseFight } from './chain.js';
import { rpcFetch, endpointsOf } from './rpc.js';
import { planOf } from './plan.js';
import { servesSeason, keysFor } from './seasons.js';
import { CHUNK, chunkOf, chunkRange, chunkText } from './archive.js';

const TOPIC = (sig) => keccak256(utf8Hex(sig));
export const STARTED = TOPIC('Started(address,uint32,bytes32,bool,bytes32,bytes32,address,uint32)');
export const JUDGED = TOPIC('Judged(address,uint32,bool,uint8,uint16,uint64,uint8,uint8,uint8,uint32,bytes32[12])');
export const DRAWN = TOPIC('Drawn(uint32,bytes32,uint64,uint64,uint8,uint8)');
export const LOCKED = TOPIC('TrapsLocked(address,uint32,bytes32)');
export const ENDED = TOPIC('Ended(address,uint32,uint8,uint32)');
export const CANCELLED = TOPIC('Cancelled(address,uint32)');
// what the judge's log reads ask for (one request, any of these topics)
const TOPICS = [STARTED, JUDGED, DRAWN, LOCKED, ENDED, CANCELLED];
const SEL = (sig) => keccak256(utf8Hex(sig)).slice(0, 10);
const JUDGE_FIGHT = SEL('judgeFight(address,uint32,bytes32[12],bytes32,uint8[36],bytes32)');
const LOCK_TRAPS = SEL('lockTraps(address[],uint32[],bytes32[])');
const DRAW = SEL('draw()');
const PENDING_CUTOFF = SEL('pendingCutoff()');
const SEED_BLOCK = SEL('seedBlock()');
const NEXT_DRAW_AT = SEL('nextDrawAt()');
const HALL_COUNT = SEL('hallCount()');
const ROUND_TIME = SEL('roundTime()');
const CURRENT_SEASON = SEL('currentSeason()');
const DRAWS = SEL('draws()');
const SEASON_BOOK = SEL('seasonBook()');
const SEASON_COUNT = SEL('seasonCount()');
const SEASONS = SEL('seasons(uint16)');
const CLOSED_AT = SEL('closedAt()');
const CLOSE = SEL('close()');
// how far behind the head the log reads stop: the log nodes lag 2-20 blocks behind each other
export const HEAD_MARGIN = 25;
// the time one chain request of the judge may take, and the most a wide log read may get (rpc.js gives
// a log read LOG_MS_PER_BLOCK per block of its range, between the two)
export const TIMEOUT_MS = 6000;
export const LOGS_TIMEOUT_MS = 20000;
// subrequests one send may take: the send and its retries, and a look-up by hash
const SEND_COST = 4;
// subrequests always kept for the receipts at the end (one batch, and one more after a wait)
const RECEIPTS = 2;
// calls in one JSON-RPC batch (one request)
export const BATCH_MAX = 25;
// the most fights read in one run (the rest in the next one)
const MAX_READS = 100;
// the catch-up's near walk: the newest units below the live window (archive chunks, or LOG_UNIT
// slices), visited more often than the rest; without the archive the whole walk reads FAR slices a step
const NEAR_CHUNKS = 4;
const NEAR_SLICES = 8;
const FAR = 4;
// the subrequests kept, besides one send per fight and the receipts, for the judgements while the older
// blocks are read: the fights' read, their opponents', the simulation batch, the gas price, and the
// slack a send checks for (SEND_COST) before the last one
const JUDGE_ROOM = 4 + SEND_COST - 1;
// a log range older than this is read only from the archive nodes, when RPC_URLS marks any (publicnode
// prunes old logs silently; 48.club's retention is not known): the near history from any log node
export const NODE_TRUST_HOURS = 6;
const ZERO = '0x' + '0'.repeat(40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The default JUDGE_LOW_BALANCE, in wei: a day of one match an hour at 0.05 gwei. Measured on the BSC
// testnet (the season-3 rehearsal arena, an earlier version): sealing a draw 29,085 gas, holding it
// 462,800, locking both trap plans 88,757, judging the two fights 264,430 and 247,330. That is
// 1,092,402 gas a match, 26.2M gas a day, 0.00131 BNB at 0.05 gwei, rounded up to 0.0015 BNB.
export const LOW_BALANCE = 1_500_000_000_000_000n;

/** wei as BNB, at most six decimals (rounded down): 400000000000000n -> "0.0004". */
export function bnb(wei) {
  const s = (wei / 10n ** 12n).toString().padStart(7, '0');
  return (s.slice(0, -6) + '.' + s.slice(-6)).replace(/\.?0+$/, '');
}

function utf8Hex(s) {
  return [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const hexToBytes = (h) => {
  const s = h.replace(/^0x/, '');
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const bytesToHex = (b) => '0x' + [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

// ------------------------------------------------------------------ a legacy (EIP-155) transaction

const intBytes = (n) => {
  let h = BigInt(n).toString(16);
  if (h === '0') return new Uint8Array();
  if (h.length % 2) h = '0' + h;
  return hexToBytes(h);
};
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const lengthPrefix = (offset, len) => (len < 56 ? Uint8Array.of(offset + len) : concat(Uint8Array.of(offset + 55 + intBytes(len).length), intBytes(len)));
const rlpBytes = (b) => (b.length === 1 && b[0] < 0x80 ? b : concat(lengthPrefix(0x80, b.length), b));
const rlpList = (items) => {
  const payload = concat(...items.map(rlpBytes));
  return concat(lengthPrefix(0xc0, payload.length), payload);
};

/** Sign a legacy transaction with chain id replay protection (EIP-155); returns the raw hex. */
export function signTx({ nonce, gasPrice, gas, to, value = 0n, data, chainId }, key) {
  const fields = [intBytes(nonce), intBytes(gasPrice), intBytes(gas), hexToBytes(to), intBytes(value), hexToBytes(data)];
  const hash = hexToBytes(keccak256(bytesToHex(rlpList([...fields, intBytes(chainId), new Uint8Array(), new Uint8Array()]))));
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(hash, hexToBytes(key), { prehash: false, format: 'recovered' }), 'recovered');
  const v = BigInt(chainId) * 2n + 35n + BigInt(sig.recovery);
  return bytesToHex(rlpList([...fields, intBytes(v), intBytes(sig.r), intBytes(sig.s)]));
}

/** The address of a private key. */
export function addressOf(key) {
  const pub = secp256k1.getPublicKey(hexToBytes(key), false); // 0x04 ‖ x ‖ y
  return '0x' + keccak256(bytesToHex(pub.slice(1))).slice(-40);
}

/** The judgeFight call: all arguments are static, so the encoding is the words one after another. */
export function judgeCalldata(agent, number, rightHashes, salt, traps, trapSalt) {
  return JUDGE_FIGHT + w(agent) + w(Number(number).toString(16)) + rightHashes.map(w).join('') + w(salt) + traps.map((t) => w(Number(t).toString(16))).join('') + w(trapSalt);
}

/** The lockTraps call for [{ agent, number, commit }]: three dynamic arrays. */
export function lockCalldata(items) {
  const n = items.length;
  const arr = (xs) => w(n.toString(16)) + xs.join('');
  const head = 3 * 32;
  const size = 32 * (1 + n);
  return LOCK_TRAPS + w(head.toString(16)) + w((head + size).toString(16)) + w((head + 2 * size).toString(16)) +
    arr(items.map((x) => w(x.agent))) + arr(items.map((x) => w(Number(x.number).toString(16)))) + arr(items.map((x) => w(x.commit)));
}


// ------------------------------------------------------------------ one run

/** opts: { fetchFn, log, wait } and timeoutMs (the time one plain chain request may take; tests shorten it).
 *  Returns what the run did, with `head` (the head it read) and `used` (its subrequests; a thrown error
 *  carries `used` too), so the archive after it knows what is left of the invocation's subrequests. */
export async function judgeRun(env, { fetchFn = fetch, log = console.log, wait = sleep, timeoutMs = TIMEOUT_MS, cooldowns = new Map() } = {}) {
  const start = Date.now();
  const runSeconds = Number(env.RUN_SECONDS ?? 40);
  const total = Number(env.SUBREQ_BUDGET ?? 45);
  const budget = { left: total };
  // every chain call of the run goes through rpc.js: the nodes in their order, bounded retries, nothing
  // past the subrequest budget, and no new request after the run's time plus ten seconds for receipts.
  // A log read waits longer, by its width (rpc.js).
  const net = rpcFetch(endpointsOf(env, 'RPC_URL'), { fetchFn, timeoutMs, logsTimeoutMs: Math.max(timeoutMs, LOGS_TIMEOUT_MS), tries: 3, maxPieces: 4, deadline: start + (runSeconds + 10) * 1000, budget, wait, cooldowns });
  try {
    const r = await judgeWith(env, { net, budget, log, wait, deadline: start + runSeconds * 1000, kv: env.HISTORY ?? null });
    return { ...r, used: total - budget.left };
  } catch (e) {
    e.used = total - budget.left;
    throw e;
  } finally {
    // one line a run: what each node answered and what failed (the order of RPC_URLS is tuned from it)
    const line = net.summary();
    if (line) log(line);
  }
}

const hex = (n) => '0x' + n.toString(16);
const blockOf = (l) => parseInt(l.blockNumber, 16);
const idOf = (l) => (String(l.topics[1]) + String(l.topics[2])).toLowerCase(); // agent and fight number topics
const wordAt = (result, i = 0) => BigInt('0x' + (String(result).replace(/^0x/, '').slice(64 * i, 64 * i + 64) || '0'));

async function judgeWith(env, { net, budget, log, wait, deadline, kv }) {
  const rpc = async (method, params, opts) => {
    const { j } = await net.call({ jsonrpc: '2.0', id: 1, method, params }, opts);
    if (j.error) throw new Error(method + ': ' + j.error.message);
    return j.result;
  };
  /** Calls in JSON-RPC batches of BATCH_MAX (one request each): their answers in order ({ result } or
   *  { error }, an answer about the call itself). Throws when a batch got no answer at all. */
  const many = async (qs, opts = {}) => {
    const out = [];
    for (let i = 0; i < qs.length; i += BATCH_MAX) {
      const part = qs.slice(i, i + BATCH_MAX).map((q, k) => ({ jsonrpc: '2.0', id: k + 1, ...q }));
      const r = await net.batch(part, opts);
      if (!Array.isArray(r.j)) throw new Error((part.length === 1 ? part[0].method : 'a batch of ' + part[0].method) + ': ' + (r.j.error?.message ?? 'no answer'));
      out.push(...r.j);
    }
    return out;
  };
  const callOf = (to, data) => ({ method: 'eth_call', params: [{ to, data }, 'latest'] });
  const arena = env.ARENA;
  const me = addressOf(env.JUDGE_KEY);
  const chainId = Number(env.CHAIN_ID ?? 56);
  const deployBlock = Number(env.DEPLOY_BLOCK ?? 0);
  const headMargin = Number(env.HEAD_MARGIN ?? HEAD_MARGIN); // 0 on a local node that mines on demand
  const perWeek = Number(env.BLOCKS_PER_WEEK ?? 604800);
  const perMinute = Math.ceil(perWeek / (7 * 24 * 60));
  const blocksPerHour = Math.ceil(perWeek / 168);
  const secondsPerBlock = (7 * 24 * 3600) / perWeek;
  // twenty minutes of blocks: a lock matters for at most 14 min 50 s after the draw
  const lockBlocks = perMinute * 20;
  const liveBlocks = Math.max(lockBlocks, Number(env.LIVE_BLOCKS ?? perMinute * 22));
  const unit = Math.max(1, Number(env.LOG_UNIT ?? 5000));
  const lookback = Math.max(Number(env.LOOKBACK_BLOCKS ?? 20000), blocksPerHour);
  // the catch-up walk's window: a fight is found surely while its remaining time in the window is
  // longer than one round of the walk (about a quarter of the window), so outages up to about three
  // quarters of it lose nothing: six hours over the log nodes, a day over the archive
  const deepLookback = Math.max(lookback, Number(env.CATCHUP_LOOKBACK_BLOCKS ?? blocksPerHour * (kv ? 24 : 6)));

  // ---- the first reads, in one batch from one node our transactions are sent to (send:true): the
  // pending and the mined nonce must come from one node (two nodes a few blocks apart would make a
  // mined transaction look pending, and a replacement reuse a nonce); the rest rides along for free
  let seasonsEnv = env.SEASONS ?? {};
  if (typeof seasonsEnv === 'string') {
    try {
      seasonsEnv = JSON.parse(seasonsEnv);
    } catch {
      seasonsEnv = {};
    }
  }
  const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(String(a ?? ''));
  const envBook = isAddress(env.SEASON_BOOK) ? String(env.SEASON_BOOK).toLowerCase() : null;
  const known = Math.max(1, ...Object.keys(seasonsEnv ?? {}).map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 64));
  const envCerts = [...new Set(Object.values(seasonsEnv ?? {}).map((x) => String(x?.certificate ?? '').toLowerCase()).filter(isAddress))];
  const first = [
    { method: 'eth_getTransactionCount', params: [me, 'pending'] },
    { method: 'eth_getTransactionCount', params: [me, 'latest'] },
    { method: 'eth_getBalance', params: [me, 'latest'] },
    { method: 'eth_blockNumber', params: [] },
    { method: 'eth_getBlockByNumber', params: ['latest', false] },
    ...[PENDING_CUTOFF, SEED_BLOCK, NEXT_DRAW_AT, HALL_COUNT, ROUND_TIME, CURRENT_SEASON, DRAWS, SEASON_BOOK].map((d) => callOf(arena, d)),
    ...(envBook ? [callOf(envBook, SEASON_COUNT), ...Array.from({ length: known }, (_, i) => callOf(envBook, SEASONS + w((i + 1).toString(16))))] : []),
    ...envCerts.map((c) => callOf(c, CLOSED_AT)),
  ];
  let nonceNode = null; // the node that answered the last pair: asked first again, so the pairs compare
  const firstBatch = await net.batch(first.map((q, i) => ({ jsonrpc: '2.0', id: i + 1, ...q })), { senders: true });
  if (!Array.isArray(firstBatch.j)) throw new Error('eth_getTransactionCount: ' + (firstBatch.j.error?.message ?? 'no answer'));
  nonceNode = firstBatch.node;
  const got = firstBatch.j;
  const val = (i) => {
    if (got[i].error) throw new Error(first[i].method + ': ' + got[i].error.message);
    return got[i].result;
  };
  let [pendingNonce, minedNonce] = [BigInt(val(0)), BigInt(val(1))];
  // the judge's gas money, read once a run: below JUDGE_LOW_BALANCE one warning line; judging goes on
  try {
    const balance = BigInt(val(2));
    const low = BigInt(env.JUDGE_LOW_BALANCE ?? LOW_BALANCE);
    if (balance < low) log(`judge balance low: ${bnb(balance)} BNB (warning below ${bnb(low)} BNB), top up ${me}`);
  } catch (e) {
    log('judge balance not read: ' + e.message);
  }
  const head = parseInt(val(3), 16);
  const now = parseInt(val(4).timestamp, 16); // the chain's clock
  const arenaWord = (i) => Number(wordAt(val(5 + i)));
  let pendingCutoff = arenaWord(0);
  let seedBlock = arenaWord(1);
  const nextDrawAt = arenaWord(2);
  const hallCount = arenaWord(3);
  const roundTime = arenaWord(4);
  const currentSeason = arenaWord(5);
  const draws = got[11].error ? 0 : Number(wordAt(got[11].result)); // an arena without draws(): no newest-blocks read
  const book = '0x' + String(val(12)).replace(/^0x/, '').slice(24, 64).toLowerCase();

  // the season calendar: from the first batch when SEASON_BOOK names the arena's own calendar, else read now
  const seasonsByN = new Map(); // n -> { start, end, judge, certificate }
  const closedAt = new Map(); // certificate -> closedAt (0: open)
  const parseSeason = (r) => {
    const x = String(r).replace(/^0x/, '');
    const word = (i) => x.slice(64 * i, 64 * i + 64) || '0';
    return { start: Number(BigInt('0x' + word(0))), end: Number(BigInt('0x' + word(1))), judge: '0x' + word(2).slice(24), secretCommit: '0x' + word(3), certificate: '0x' + word(4).slice(24).toLowerCase() };
  };
  let count;
  let at = 13;
  if (envBook === book) {
    count = Number(wordAt(val(at++)));
    for (let n = 1; n <= known; n++, at++) if (n <= count) seasonsByN.set(n, parseSeason(val(at)));
  } else if (envBook) at += 1 + known; // another calendar than the arena's: read the arena's below
  for (const c of envCerts) {
    if (!got[at].error) closedAt.set(c, Number(wordAt(got[at].result)));
    at++;
  }
  if (count === undefined) count = Number(wordAt((await many([callOf(book, SEASON_COUNT)]))[0].result ?? '0x0'));
  const unread = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !seasonsByN.has(n));
  if (unread.length) {
    const out = await many(unread.map((n) => callOf(book, SEASONS + w(n.toString(16)))));
    out.forEach((r, i) => {
      if (r.error) throw new Error('seasons: ' + r.error.message);
      seasonsByN.set(unread[i], parseSeason(r.result));
    });
  }
  // the seasons this key judges (normally all of them: one judge), each with its own secret
  // (SECRET_<n>, or SECRET), checked against the secret's hash in the season calendar
  const mine = new Map(); // season number -> { s: its settings, keys, serves: this server builds its pages }
  for (let n = 1; n <= count; n++) {
    const s = seasonsByN.get(n);
    if (s.judge.toLowerCase() !== me.toLowerCase()) continue;
    const k = keysFor(env, n, s);
    if (!k) {
      log(`season ${n}: this server does not hold its secret: its fights are left alone`);
      continue;
    }
    mine.set(n, { s, keys: k, serves: servesSeason(env, n) });
  }
  if (!mine.size) throw new Error('JUDGE_KEY judges no season whose secret this server holds');
  // a season over for half an hour (every fight of it ends within 15 minutes of its end) and not closed
  // yet: its close is due, and this run reads the whole look-back window to know whether it may
  const ended = [...mine.values()].filter(({ s }) => now > s.end + 1800).map(({ s }) => s.certificate);
  const unknownClose = ended.filter((c) => !closedAt.has(c));
  if (unknownClose.length) {
    const out = await many(unknownClose.map((c) => callOf(c, CLOSED_AT)));
    out.forEach((r, i) => !r.error && closedAt.set(unknownClose[i], Number(wordAt(r.result))));
  }
  const closeDue = ended.some((c) => closedAt.get(c) === 0);
  // FULL_SCAN "always" (judge.mjs by hand, and the default of a server with one node and no LOG_UNIT,
  // the testnet's: every run reads the whole look-back window, as the judge always did there)
  const fullScan = env.FULL_SCAN ?? (!env.RPC_URLS && !env.LOG_UNIT ? 'always' : 'no');
  const full = closeDue || fullScan === 'always' || fullScan === '1' || fullScan === true;

  // an earlier transaction still on its way: wait a little; still there, it is stuck: replace it
  const nonces = async () => {
    const r = await net.batch(['pending', 'latest'].map((tag, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_getTransactionCount', params: [me, tag] })), { prefer: nonceNode, senders: true });
    const bad = Array.isArray(r.j) ? r.j.find((x) => x.error) : r.j;
    if (bad) throw new Error('eth_getTransactionCount: ' + bad.error.message);
    nonceNode = r.node;
    return r.j.map((x) => BigInt(x.result));
  };
  for (let i = 0; i < 10 && pendingNonce > minedNonce; i++) {
    await wait(1000);
    [pendingNonce, minedNonce] = await nonces();
  }
  if (pendingNonce > minedNonce) {
    const gasPrice = BigInt(await rpc('eth_gasPrice', [])) * 2n;
    try {
      const hash = await rpc('eth_sendRawTransaction', [signTx({ nonce: minedNonce, gasPrice, gas: 21000n, to: me, data: '0x', chainId }, env.JUDGE_KEY)]);
      log('a stuck transaction (nonce ' + minedNonce + ') replaced: ' + hash);
    } catch (e) {
      log('a stuck transaction (nonce ' + minedNonce + ') could not be replaced yet: ' + e.message);
    }
    return { judged: 0, drew: false, waiting: true, degraded: false, head };
  }
  let nonce = pendingNonce;
  const sent = []; // [hash, what]: their receipts are checked before the run ends
  // the subrequests left once the receipts have their room
  const spare = () => budget.left - RECEIPTS;
  let gasPrice = null; // read once a run: the gas price does not move within a minute
  /** Simulates (unless `gas` is given), signs and sends; the hash, or null when left for the next run. */
  const send = async (data, what, to = arena, gas = null) => {
    if (Date.now() > deadline) {
      log(what + ': left for the next run (this run\'s time is up)');
      return null;
    }
    if (spare() < SEND_COST + (gas === null ? 1 : 0) + (gasPrice === null ? 1 : 0)) {
      log(what + ': left for the next run (this run\'s subrequests are spent)');
      return null;
    }
    if (gas === null) {
      try {
        gas = (BigInt(await rpc('eth_estimateGas', [{ from: me, to, data }])) * 12n) / 10n;
      } catch (e) {
        log(what + ': not now (' + e.message + ')');
        return null;
      }
    }
    gasPrice ??= BigInt(await rpc('eth_gasPrice', []));
    const raw = signTx({ nonce, gasPrice, gas, to, data, chainId }, env.JUDGE_KEY);
    const hash = keccak256(raw); // the transaction's hash, whatever the node answers
    const { j, attempts } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_sendRawTransaction', params: [raw] });
    if (j.error) {
      const m = String(j.error.message ?? '');
      // these very bytes are in the node's pool already (an earlier try of this send reached a node)
      const known = /already known|known transaction/i.test(m);
      // a retried send whose earlier try went through and was mined: its nonce is used by it
      const mined = !known && /nonce too low/i.test(m) && attempts > 1 && (await rpc('eth_getTransactionByHash', [hash]).catch(() => null)) != null;
      if (!known && !mined) throw new Error('eth_sendRawTransaction: ' + m);
    }
    nonce++;
    log(what + ': sent ' + hash);
    sent.push([hash, what]);
    return hash;
  };
  /** A receipt of this run's transaction, waited for up to 20 s while the budget keeps room for more. */
  const receiptOf = async (hash) => {
    for (let i = 0; i < 20 && spare() > 2 * SEND_COST; i++) {
      const r = await rpc('eth_getTransactionReceipt', [hash]);
      if (r) return r;
      await wait(1000);
    }
    return null;
  };
  /** Waits (a little) for the receipts of what this run sent, all of them in one batch a read; returns
   *  how many went through. */
  const receipts = async () => {
    const found = new Map();
    let missing = sent.map(([hash]) => hash);
    for (let i = 0; i < 15 && missing.length && budget.left > 0; i++) {
      if (i) await wait(1000);
      try {
        const out = await many(missing.map((hash) => ({ method: 'eth_getTransactionReceipt', params: [hash] })));
        out.forEach((r, k) => r.result && found.set(missing[k], r.result));
      } catch {
        break; // out of time or budget: the next run finds them on the chain
      }
      missing = missing.filter((hash) => !found.has(hash));
    }
    let ok = 0;
    for (const [hash, what] of sent) {
      const r = found.get(hash);
      if (r?.status === '0x1') ok++;
      else log(what + (r ? ': reverted on chain' : ': no receipt yet') + ' (the next run finds it on the chain and does it again)');
    }
    return ok;
  };
  const blockNow = async () => parseInt(await rpc('eth_blockNumber', []), 16);

  // ---- the draw: seal after the cutoff, then hold it on the sealed block's hash
  let drew = false;
  let heldReceipt = null; // its Started events name the fights it drew
  if (pendingCutoff === 0) {
    const cur = currentSeason;
    // no fight without an opponent; but at the season's end the draw closes the hall, one agent included
    const closing = !cur || now + 60 + 12 * roundTime + 11 * BREAK > (seasonsByN.get(cur)?.end ?? 0); // a draw held now would bell at now + 60
    if (nextDrawAt !== 0 && now >= nextDrawAt && (hallCount >= 2 || (closing && hallCount >= 1))) {
      const sealed = await send(DRAW, 'seal the draw');
      if (sealed) {
        await receiptOf(sealed);
        const [p, sb] = await many([callOf(arena, PENDING_CUTOFF), callOf(arena, SEED_BLOCK)]);
        if (!p.error) pendingCutoff = Number(wordAt(p.result));
        if (!sb.error) seedBlock = Number(wordAt(sb.result));
      }
    }
  }
  if (pendingCutoff !== 0) {
    let b = sent.length ? await blockNow() : head; // after a seal of this run, the head has moved on
    for (let i = 0; i < 20 && b <= seedBlock; i++) {
      await wait(1000);
      b = await blockNow();
    }
    const held = await send(DRAW, 'hold the draw');
    drew = held !== null;
    if (held) heldReceipt = await receiptOf(held);
  }

  // ---- the arena's logs: the live window and the newest blocks first (what the locks need), then,
  // after the locks, a catch-up step or a full read
  let degraded = false;
  const scanTo = head - headMargin; // never past the head of a lagging log node
  const liveFrom = Math.max(deployBlock, head - liveBlocks);
  // a range older than this many blocks is asked only of the archive nodes (when RPC_URLS marks any):
  // a pruning node may answer [] for blocks it no longer keeps
  const trusted = blocksPerHour * NODE_TRUST_HOURS;
  const logs = []; // in the order read; the same log twice is kept once below
  const reads = []; // what this run read, for its one line
  /** [from, to] in requests of `unit` blocks, each to the log nodes in their order (rpc.js splits a
   *  request for a narrower node); the ranges that no node could read come back in `failed`. */
  const readRange = async (from, to, topics = TOPICS) => {
    const failed = [];
    let n = 0;
    for (let a = from; a <= to; a += unit) {
      const b = Math.min(to, a + unit - 1);
      const { j } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: arena, fromBlock: hex(a), toBlock: hex(b), topics: [topics] }] }, { archive: a < head - trusted });
      n++;
      if (j.error || !Array.isArray(j.result)) failed.push([a, b, j.error?.message ?? 'not a log list']);
      else logs.push(...j.result);
    }
    return { failed, n };
  };
  /** A chunk of the archive (KV), its logs of the judge's topics; null when it is not stored (or no
   *  subrequest is left above the budget's floor for the read). */
  const stored = async (c) => {
    if (!kv || budget.left <= Math.max(RECEIPTS, budget.floor ?? 0) + 1) return null;
    budget.left--;
    let text = null;
    try {
      text = await chunkText(kv, arena, c);
    } catch (e) {
      log(`archive chunk ${c} not read: ${e.message}`);
    }
    if (text === null) return null;
    let all;
    try {
      all = JSON.parse(text);
    } catch {
      return null;
    }
    return Array.isArray(all) ? all.filter((l) => TOPICS.includes(l?.topics?.[0])) : null;
  };
  /** [from, to] from the archive where it has the chunk, else from the log nodes: the ranges not read. */
  const readStoredOrNodes = async (from, to) => {
    const failed = [];
    for (let c = chunkOf(from); c <= chunkOf(to); c++) {
      const [c0, c1] = chunkRange(c);
      const part = await stored(c);
      if (part) {
        logs.push(...part);
        reads.push(`chunk ${c} (archive)`);
        continue;
      }
      const r = await readRange(Math.max(from, c0), Math.min(to, c1));
      failed.push(...r.failed);
      reads.push(`${Math.max(from, c0)}-${Math.min(to, c1)}`);
    }
    return failed;
  };
  if (liveFrom <= scanTo) {
    const live = await readRange(liveFrom, scanTo);
    reads.push(`live ${liveFrom}-${scanTo} (${live.n})`);
    if (live.failed.length) {
      degraded = true;
      log(`degraded run: ${live.failed.map(([a, b, m]) => `blocks ${a}-${b} (${m})`).join(', ')} could not be read: the fights there wait for a later run, and no season closes`);
    }
  }
  // the newest blocks: the last draw was sealed inside the window and held since (no draw waits), but
  // its Drawn event is not in the window: held in the last few blocks, by another sender
  if (!heldReceipt && pendingCutoff === 0 && draws > 0 && seedBlock >= liveFrom && !logs.some((l) => l.topics?.[0] === DRAWN && blockOf(l) > seedBlock)) {
    const { j } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: arena, fromBlock: hex(scanTo + 1), toBlock: 'latest', topics: [TOPICS] }] });
    if (j.error || !Array.isArray(j.result)) log(`the newest blocks could not be read (${j.error?.message ?? 'not a log list'}): a draw held there is locked by the next run`);
    else logs.push(...j.result);
    reads.push(`newest ${scanTo + 1}-latest`);
  }

  // what the logs say, each log once (folded again after the older blocks are read)
  const started = new Map(); // fight id -> { agent, number, seed, block, fresh: drawn in this run or in the newest blocks }
  const judgedIds = new Set();
  const lockedIds = new Set();
  const endedIds = new Set();
  const cancelledIds = new Set();
  const judgedAt = []; // the blocks of the Judged events (the hourly guard)
  const once = new Set();
  let folded = 0;
  const fold = (entries) => {
    for (const [l, fresh] of entries) {
      if (!l?.topics?.[0]) continue; // (the nodes answer the arena's logs only; the receipt's are filtered below)
      const tag = `${l.blockNumber}:${l.logIndex}`;
      if (l.logIndex !== undefined && once.has(tag)) continue;
      once.add(tag);
      const t0 = l.topics[0];
      if (t0 === DRAWN) continue;
      const id = idOf(l);
      if (t0 === STARTED) {
        if (!started.has(id)) started.set(id, { id, agent: '0x' + l.topics[1].slice(26), number: parseInt(l.topics[2], 16), seed: '0x' + String(l.data ?? '0x').slice(2, 66).padEnd(64, '0'), block: blockOf(l) || head, fresh: fresh || blockOf(l) > scanTo });
      } else if (t0 === JUDGED) {
        judgedAt.push(blockOf(l));
        judgedIds.add(id);
      } else if (t0 === LOCKED) lockedIds.add(id);
      else if (t0 === ENDED) endedIds.add(id);
      else if (t0 === CANCELLED) cancelledIds.add(id);
    }
  };
  const foldNew = () => {
    fold(logs.slice(folded).map((l) => [l, false]));
    folded = logs.length;
  };
  // the fights this run drew, from its own receipt (the log nodes may not have that block yet)
  fold((heldReceipt?.logs ?? []).filter((l) => String(l.address).toLowerCase() === arena.toLowerCase() && l.topics?.[0] === STARTED).map((l) => [l, true]));
  foldNew();

  // the fights, read in batches (one request per BATCH_MAX); a fight whose read failed is left out
  const fightCache = new Map();
  const fk = (agent, number) => agent.toLowerCase() + '#' + number;
  let unreadFights = 0;
  const readFights = async (list) => {
    const need = [];
    const seen = new Set();
    for (const { agent, number } of list) {
      const k = fk(agent, number);
      if (fightCache.has(k) || seen.has(k)) continue;
      seen.add(k);
      need.push({ agent, number });
    }
    // what the budget allows, with room for a send and the receipts after it
    const room = Math.max(0, (spare() - SEND_COST - 2) * BATCH_MAX);
    const take = need.slice(0, Math.min(room, MAX_READS));
    unreadFights += need.length - take.length;
    if (!take.length) return;
    try {
      const out = await many(take.map(({ agent, number }) => ({ method: 'eth_call', params: [fightOfCall(arena, agent, number), 'latest'] })));
      out.forEach((r, i) => {
        if (!r.error && typeof r.result === 'string' && r.result.length >= 2 + 64 * 17) fightCache.set(fk(take[i].agent, take[i].number), parseFight(r.result));
        else unreadFights++;
      });
    } catch (e) {
      unreadFights += take.length;
      log('fights not read: ' + e.message);
    }
  };
  const fightOf = (agent, number) => fightCache.get(fk(agent, number)) ?? null;

  // ---- the trap plans of the fights just drawn, locked before their first bell. Before any older
  // block is read: a fight that may still need its lock was drawn less than twenty minutes ago, so it
  // is in the live window or in this run's receipt, never in the older blocks
  {
    const items = [];
    const seeds = new Set();
    const wanted = [];
    for (const x of started.values()) {
      if (wanted.length >= 32) break; // the rest in the next run
      if (!x.fresh && x.block < head - lockBlocks) continue;
      if (lockedIds.has(x.id) || cancelledIds.has(x.id) || endedIds.has(x.id) || judgedIds.has(x.id)) continue;
      if (seeds.has(x.seed)) continue; // the other corner of a match: one lock covers both
      seeds.add(x.seed);
      wanted.push(x);
    }
    if (wanted.length && spare() < SEND_COST + 4) log(`${wanted.length} match(es) waiting for their lock: left for the next run (this run's subrequests are spent)`);
    else if (wanted.length) {
      await readFights(wanted);
      for (const { agent, number } of wanted) {
        const f = fightOf(agent, number);
        if (!f) continue;
        const keys = mine.get(f.season)?.serves ? mine.get(f.season).keys : null;
        if (!keys) continue; // another judge's season, one whose secret this server lacks, or whose pages it does not build (never locked: cancelled, no attempt spent)
        const endsAt = f.clockAt + 11 * (roundTime + BREAK) + roundTime;
        // locked already, over (a cancelled match included) or past its time: nothing to lock
        if (BigInt(f.trapsCommit) !== 0n || f.round !== 1 || f.clockRound !== 1 || f.finishedAt !== 0 || now > endsAt) continue;
        const { traps } = planOf(keys.cardSeed(f.seed));
        items.push({ agent, number, commit: keys.trapsCommit(traps, keys.trapSalt(arena, f.seed)) });
      }
    }
    if (items.length) await send(lockCalldata(items), 'lock the trap plans of ' + items.length + ' fight(s)');
  }

  // the shortest a fight lasts from its draw, in blocks (with a tenth to spare): the countdown, eleven
  // rounds both corners answer at once (the clock then moves on after a break of BREAK seconds), and the
  // twelfth round in full. A fight with no Ended event that started later than that is still running.
  const shortest = Math.floor(((60 + 11 * BREAK + roundTime) / secondsPerBlock) * 0.9);
  const mayBeOver = (x) => endedIds.has(x.id) || head - x.block >= shortest;
  const toJudge = () => [...started.values()].filter((x) => !judgedIds.has(x.id) && !cancelledIds.has(x.id) && mayBeOver(x)).length;

  // ---- the older blocks, after the locks, with room kept for the judgements of what the live window
  // holds: an optional read stops at the budget's floor, and what it could not read waits for a later
  // run (a full run that could not read it all is degraded: no close)
  const deepTo = liveFrom - 1;
  const pendingJudge = Math.min(Number(env.MAX_PER_RUN ?? 16), toJudge());
  budget.floor = RECEIPTS + (pendingJudge ? JUDGE_ROOM + pendingJudge : 0);
  let deepFailed = false;
  try {
    if (full) {
      // the whole look-back window: a season closes only after a run that read all of it
      const from = Math.max(deployBlock, head - lookback);
      if (from <= deepTo) {
        const failed = await readStoredOrNodes(from, deepTo);
        if (failed.length) {
          degraded = true;
          deepFailed = true;
          log(`degraded run: the look-back window was not read in full (${failed.map(([a, b, m]) => `blocks ${a}-${b}: ${m}`).join(', ')}): no season closes`);
        }
      }
    } else {
      const deepFrom = Math.max(deployBlock, head - deepLookback);
      if (deepFrom <= deepTo && budget.left - budget.floor < 2) reads.push('no catch-up (subrequests kept for the judgements)');
      else if (deepFrom <= deepTo) {
        const minute = Math.floor(now / 60);
        // A cycle of four minutes: the blocks just older than the live window (a fight locked late ends
        // up to 30 minutes after its draw), the near walk, the whole walk, the near walk again. Both walks
        // go newest first over units aligned to the block numbers: the archive's chunks with HISTORY (a
        // stored chunk is one KV read, one not stored yet is read from the nodes), else LOG_UNIT slices
        // for the near walk and FAR of them at a time for the whole walk.
        const phase = minute % 4;
        let range = null;
        if (phase === 0) range = [Math.max(deepFrom, deepTo - unit + 1), deepTo];
        else {
          const nearTurn = phase !== 2;
          const turn = nearTurn ? Math.floor(minute / 4) * 2 + (phase === 3 ? 1 : 0) : Math.floor(minute / 4);
          const size = kv ? CHUNK : nearTurn ? unit : unit * FAR;
          const top = Math.floor(deepTo / size);
          const count = top - Math.floor(deepFrom / size) + 1;
          const k = top - (turn % (nearTurn ? Math.min(kv ? NEAR_CHUNKS : NEAR_SLICES, count) : count));
          const part = kv ? await stored(k) : null;
          if (part) {
            logs.push(...part);
            reads.push(`catch-up chunk ${k} (archive)`);
          } else range = [Math.max(deepFrom, k * size), Math.min(deepTo, k * size + size - 1)];
        }
        if (range) {
          const r = await readRange(range[0], range[1]);
          reads.push(`catch-up ${range[0]}-${range[1]}`);
          if (r.failed.length) log(`catch-up: blocks ${range[0]}-${range[1]} could not be read (${r.failed[0][2]}): a later step reads them again`);
        }
      }
    }
  } finally {
    budget.floor = 0;
  }
  log(`scan: ${reads.join(', ') || 'nothing to read'}${full ? ' (full)' : ''}`);
  foldNew();

  // ---- the judgements
  // MAX_PER_HOUR, counted on the chain: over the last hour when this run read all of it (a full run),
  // else over the live window, as its share of an hour
  const guardBlocks = full && !deepFailed && lookback >= blocksPerHour ? blocksPerHour : liveBlocks;
  const judgedRecently = judgedAt.filter((b) => b >= head - guardBlocks).length;
  const perWindow = Math.ceil((Number(env.MAX_PER_HOUR ?? 240) * guardBlocks) / blocksPerHour);
  const allowed = Math.min(Number(env.MAX_PER_RUN ?? 16), perWindow - judgedRecently);
  if (allowed <= 0) {
    log(`hourly limit reached: ${judgedRecently} judgements in the last ${Math.round((guardBlocks * secondsPerBlock) / 60)} minutes`);
    return { judged: 0, drew, waiting: false, limited: true, degraded, full, confirmed: await receipts(), sent: sent.length, head };
  }
  const candidates = [...started.values()].filter((x) => !judgedIds.has(x.id) && !cancelledIds.has(x.id));
  const toRead = full ? candidates : candidates.filter(mayBeOver);
  const running = candidates.length - toRead.length;
  await readFights(toRead);
  const over = (f) => f.finishedAt !== 0 || now > f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime;
  // the opponents not read yet of the fights that are over
  await readFights(toRead.map((x) => fightOf(x.agent, x.number)).filter((f) => f && f.opponent !== ZERO && over(f) && !fightOf(f.opponent, f.opponentNumber)).map((f) => ({ agent: f.opponent, number: f.opponentNumber })));
  const left = new Set(); // seasons with a fight still to judge (not sent, or sent and not yet mined): not closed in this run
  let cut = unreadFights > 0 || running > 0; // the run did not look at every fight it found
  if (unreadFights) log(`${unreadFights} fight(s) not read: left for the next run`);
  const due = []; // [{ agent, number, data, season }]
  for (const { agent, number } of toRead) {
    if (due.length >= allowed) {
      cut = true;
      break;
    }
    const f = fightOf(agent, number);
    if (!f) continue; // not read (counted above)
    if (f.judged) continue;
    if (!over(f)) {
      left.add(f.season);
      continue;
    }
    const keys = mine.get(f.season)?.keys;
    if (!keys) continue; // another judge's season, or one whose secret this server lacks
    if (f.opponent !== ZERO) {
      const o = fightOf(f.opponent, f.opponentNumber);
      if (!o) {
        cut = true;
        continue;
      }
      if (!over(o)) continue;
    }
    if (f.round <= 1) continue; // nothing answered
    if (f.commitment.toLowerCase() !== keys.commitment(arena, agent, number).toLowerCase()) continue; // never judgeable
    // the plan locked before the first bell; a fight whose plan was never locked never ran
    if (BigInt(f.trapsCommit) === 0n) continue;
    const traps = planOf(keys.cardSeed(f.seed)).traps;
    const trapSalt = keys.trapSalt(arena, f.seed);
    if (keys.trapsCommit(traps, trapSalt).toLowerCase() !== f.trapsCommit.toLowerCase()) {
      log(agent + '#' + number + ': its locked trap plan is not this server\'s: left out');
      continue;
    }
    const hashes = Array.from({ length: 12 }, (_, i) => answerHash(keys.code(arena, agent, number, i + 1)));
    left.add(f.season); // judged in this run at best: the close waits for a run that finds nothing left
    due.push({ agent, number, data: judgeCalldata(agent, number, hashes, keys.salt(arena, agent, number), traps, trapSalt) });
  }
  let judged = 0;
  if (due.length && Date.now() <= deadline && spare() >= SEND_COST + 2) {
    // every judgement simulated in one batch, then sent one after another
    let estimates = null;
    try {
      estimates = await many(due.map((x) => ({ method: 'eth_estimateGas', params: [{ from: me, to: arena, data: x.data }] })));
    } catch (e) {
      log('the judgements are left for the next run (' + e.message + ')');
    }
    for (let i = 0; estimates && i < due.length; i++) {
      const what = due[i].agent + '#' + due[i].number + ' judged';
      if (estimates[i].error) {
        log(what + ': not now (eth_estimateGas: ' + estimates[i].error.message + ')');
        continue;
      }
      if (spare() < SEND_COST + (gasPrice === null ? 1 : 0)) {
        log('the other fights are left for the next run (this run\'s subrequests are spent)');
        cut = true;
        break;
      }
      if ((await send(due[i].data, what, arena, (BigInt(estimates[i].result) * 12n) / 10n)) !== null) judged++;
    }
  } else if (due.length) {
    log('the other fights are left for the next run (this run\'s ' + (Date.now() > deadline ? 'time is up' : 'subrequests are spent') + ')');
    cut = true;
  }
  // the season's close: after its end, once a run finds nothing left to judge, the judge closes the
  // season (the ranking is final, the first ten places get their certificates)
  let closed = false;
  for (const [n, { s }] of mine) {
    // closed only by a full run that read the whole look-back window and found none of this season's
    // fights left, and not before half an hour after its end (every fight of it ends within 15 minutes
    // of the end); never by a degraded run
    if (!full || degraded || cut || left.has(n) || now <= s.end + 1800 || closedAt.get(s.certificate) !== 0) continue;
    if (spare() < SEND_COST + 2) continue; // the next run closes it
    closed = (await send(CLOSE, `close season ${n}`, s.certificate)) !== null || closed;
  }
  return { judged, drew, waiting: false, closed, degraded, full, confirmed: await receipts(), sent: sent.length, head };
}

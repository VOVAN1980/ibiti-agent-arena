// The judge on Cloudflare: a Cron Trigger runs `judgeRun` every minute (host.js `scheduled`). It holds
// the draws and scores the fights, without keeping any state: the chain says what is due.
//
// Each run:
// - an earlier transaction of the judge still pending after a few seconds is stuck: it is replaced
//   (an empty transfer to itself, same nonce, a higher gas price) and the run ends there;
// - the draw: after a cutoff it seals the draw (if no registration did it already), waits for the
//   sealed block, then holds the draw on its hash (AgentArena.draw); with fewer than two agents in the
//   hall there is nobody to pair, so it is left alone (a later registration closes it);
// - the trap plans: every fight drawn in the last twenty minutes that is still waiting for its plan
//   (drawn by this judge or by anyone else) gets it locked (AgentArena.lockTraps), one hash per match,
//   so the judge can later judge it only with that plan. Its first bell waits for the lock: locked
//   late, the match gets a new countdown;
// - reads the arena's Started events of the last LOOKBACK_BLOCKS blocks (in chunks of LOG_CHUNK), up
//   to HEAD_MARGIN blocks behind the head (the log nodes lag a few blocks behind each other, and a range
//   past a node's head is an error); a fight lasts at most 14 min 50 s, so the window leaves hours for
//   retries. A fight left out longer (an outage) is judged by hand with judge.mjs;
// - when no log node can read that window, the run is degraded instead of ending: it reads only the
//   last twenty minutes of blocks (narrow enough for the small log nodes), judges what it finds there,
//   and never closes a season (it cannot know that nothing older is left);
// - skips a fight that is judged, still running, waiting for its opponent's fight to end (a match is
//   judged only when both fights are over), empty (nothing answered: it would score 0 and only cost
//   gas), or registered with a foreign commitment (it can never be judged);
// - does nothing while an earlier transaction of the judge is still pending (no double sending);
// - judges with the fight's right-answer hashes, salt and the trap plan it locked (plan.js; a fight
//   whose plan was never locked never ran and is not judged), at most
//   MAX_PER_RUN a run and MAX_PER_HOUR an hour (a guard against draining the judge's gas; the hour is
//   counted on the chain itself, from the Judged events of the last hour of blocks);
// - simulates every transaction first (eth_estimateGas), signs it here with the judge key (a Worker
//   secret) and sends it as a raw transaction. Its hash is computed here (keccak256 of the bytes): a
//   send retried on another node after a timeout may already have gone through, and the node then
//   says "already known" or "nonce too low" instead of the hash;
// - talks to the chain through rpc.js: several nodes (RPC_URLS, or RPC_URL alone), bounded retries,
//   and at most SUBREQ_BUDGET requests a run (Cloudflare caps the subrequests of one invocation: 50
//   on the Free plan). What the budget does not cover is left for the next run, like what the clock
//   does not cover; the receipts of what was sent are always kept room for.
//
// - sends nothing new after RUN_SECONDS (default 40) of a run, so a run never sends while the next
//   minute's run starts: one sender per key at a time, and a transaction found pending at the start of
//   a run is at least a quarter of a minute old (stuck);
// - checks the receipts of what it sent before it ends (a reverted or lost transaction is not
//   counted; the next run finds the same work on the chain and does it again: the chain itself is the
//   list of what is still to do).
//
// Environment: RPC_URL (and optionally RPC_URLS: the nodes, see rpc.js), ARENA, CHAIN_ID, DEPLOY_BLOCK,
// BLOCKS_PER_WEEK, SECRET (Worker secret), JUDGE_KEY (Worker secret), LOOKBACK_BLOCKS (default 20000),
// LOG_CHUNK (default 5000), HEAD_MARGIN (default 25), MAX_PER_RUN (default 16), MAX_PER_HOUR (default
// 240), RUN_SECONDS (default 40), SUBREQ_BUDGET (default 45), JUDGE_LOW_BALANCE (wei, default
// LOW_BALANCE: below it each run logs a warning to top up the judge's wallet; it never stops the judge).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from './keccak.js';
import { arenaKeys, answerHash } from './keys.js';
import { makeChain, BREAK } from './chain.js';
import { rpcFetch, endpointsOf } from './rpc.js';
import { planOf } from './plan.js';
import { servesSeason, keysFor } from './seasons.js';

export const STARTED = keccak256(utf8Hex('Started(address,uint32,bytes32,bool,bytes32,bytes32,address,uint32)'));
export const JUDGED = keccak256(utf8Hex('Judged(address,uint32,bool,uint8,uint16,uint64,uint8,uint8,uint8,uint32,bytes32[12])'));
const SEL = (sig) => keccak256(utf8Hex(sig)).slice(0, 10);
const JUDGE_FIGHT = SEL('judgeFight(address,uint32,bytes32[12],bytes32,uint8[36],bytes32)');
const LOCK_TRAPS = SEL('lockTraps(address[],uint32[],bytes32[])');
const DRAW = SEL('draw()');
const PENDING_CUTOFF = SEL('pendingCutoff()');
const SEED_BLOCK = SEL('seedBlock()');
const HALL_COUNT = SEL('hallCount()');
const CLOSED_AT = SEL('closedAt()');
const CLOSE = SEL('close()');
// how far behind the head the judgement scan stops: the log nodes lag 2-20 blocks behind each other
export const HEAD_MARGIN = 25;
// the time one chain request of the judge may take, and the most a wide log read may get (rpc.js gives
// a log read LOG_MS_PER_BLOCK per block of its range, between the two)
export const TIMEOUT_MS = 6000;
export const LOGS_TIMEOUT_MS = 20000;
// subrequests one send may take: the estimate, the gas price, the send, a look-up by hash, its receipt
const SEND_COST = 5;
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

/** opts: { fetchFn, log, wait } and timeoutMs (the time one plain chain request may take; tests shorten it). */
export async function judgeRun(env, { fetchFn = fetch, log = console.log, wait = sleep, timeoutMs = TIMEOUT_MS } = {}) {
  const start = Date.now();
  const runSeconds = Number(env.RUN_SECONDS ?? 40);
  const budget = { left: Number(env.SUBREQ_BUDGET ?? 45) };
  // every chain call of the run goes through rpc.js: the nodes in their order, bounded retries, nothing
  // past the subrequest budget, and no new request after the run's time plus ten seconds for receipts.
  // A log read waits longer, by its width (rpc.js): a LOG_CHUNK of 5000 blocks gets 6 s (publicnode
  // measured 1.6 s), a wider one up to 20 s.
  const net = rpcFetch(endpointsOf(env, 'RPC_URL'), { fetchFn, timeoutMs, logsTimeoutMs: Math.max(timeoutMs, LOGS_TIMEOUT_MS), tries: 3, maxPieces: 4, deadline: start + (runSeconds + 10) * 1000, budget, wait });
  try {
    return await judgeWith(env, { net, budget, log, wait, deadline: start + runSeconds * 1000 });
  } finally {
    // one line a run: what each node answered and what failed (the order of RPC_URLS is tuned from it)
    const line = net.summary();
    if (line) log(line);
  }
}

async function judgeWith(env, { net, budget, log, wait, deadline }) {
  const rpc = async (method, params, opts) => {
    const { j } = await net.call({ jsonrpc: '2.0', id: 1, method, params }, opts);
    if (j.error) throw new Error(method + ': ' + j.error.message);
    return j.result;
  };
  const arena = env.ARENA;
  const chain = makeChain({ rpc: env.RPC_URL, arena, fetchFn: net });
  const me = addressOf(env.JUDGE_KEY);
  const deployBlock = Number(env.DEPLOY_BLOCK ?? 0);
  const headMargin = Number(env.HEAD_MARGIN ?? HEAD_MARGIN); // 0 on a local node that mines on demand
  const blockHex = (n) => '0x' + n.toString(16);
  // the judge's gas money, read once a run: below JUDGE_LOW_BALANCE one warning line; judging goes on
  try {
    const balance = BigInt(await rpc('eth_getBalance', [me, 'latest']));
    const low = BigInt(env.JUDGE_LOW_BALANCE ?? LOW_BALANCE);
    if (balance < low) log(`judge balance low: ${bnb(balance)} BNB (warning below ${bnb(low)} BNB), top up ${me}`);
  } catch (e) {
    log('judge balance not read: ' + e.message);
  }
  // the seasons this key judges (normally all of them: one judge), each with its own secret
  // (SECRET_<n>, or SECRET), checked against the secret's hash in the season calendar
  const mine = new Map(); // season number -> { s: its settings, keys, serves: this server builds its pages }
  for (let n = 1, count = await chain.seasonCount(); n <= count; n++) {
    const s = await chain.season(n);
    if (s.judge.toLowerCase() !== me.toLowerCase()) continue;
    const k = keysFor(env, n, s);
    if (!k) {
      log(`season ${n}: this server does not hold its secret: its fights are left alone`);
      continue;
    }
    mine.set(n, { s, keys: k, serves: servesSeason(env, n) });
  }
  if (!mine.size) throw new Error('JUDGE_KEY judges no season whose secret this server holds');

  // an earlier transaction still on its way: wait a little; still there, it is stuck: replace it.
  // The pending and the mined nonce are read together, in one batch from one node: two nodes a few
  // blocks apart would make a mined transaction look pending (and a replacement reuse a nonce). And
  // only from a node our transactions are sent to (send:true): another one (an MEV relay, a gateway
  // that splits a batch) may not count our pending transaction yet, and its nonce would be one in use.
  const chainId = Number(env.CHAIN_ID ?? 56);
  let nonceNode = null; // the node that answered the last pair: asked first again, so the pairs compare
  const nonces = async () => {
    const r = await net.batch(['pending', 'latest'].map((tag, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'eth_getTransactionCount', params: [me, tag] })), { prefer: nonceNode, senders: true });
    const bad = Array.isArray(r.j) ? r.j.find((x) => x.error) : r.j;
    if (bad) throw new Error('eth_getTransactionCount: ' + bad.error.message);
    nonceNode = r.node;
    return r.j.map((x) => BigInt(x.result));
  };
  let [pendingNonce, minedNonce] = await nonces();
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
    return { judged: 0, drew: false, waiting: true, degraded: false };
  }
  let nonce = pendingNonce;
  const sent = []; // [hash, what]: their receipts are checked before the run ends
  // the subrequests left once every receipt of this run has had its one read
  const spare = () => budget.left - sent.length;
  let gasPrice = null; // read once a run: the gas price does not move within a minute
  const send = async (data, what, to = arena) => {
    if (Date.now() > deadline) {
      log(what + ': left for the next run (this run\'s time is up)');
      return null;
    }
    if (spare() < SEND_COST) {
      log(what + ': left for the next run (this run\'s subrequests are spent)');
      return null;
    }
    let gas;
    try {
      gas = (BigInt(await rpc('eth_estimateGas', [{ from: me, to, data }])) * 12n) / 10n;
    } catch (e) {
      log(what + ': not now (' + e.message + ')');
      return null;
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
  /** Waits (a little) for the receipts of what this run sent; returns how many went through. */
  const receipts = async () => {
    let ok = 0;
    for (let k = 0; k < sent.length; k++) {
      const [hash, what] = sent[k];
      let r = null;
      // the first read of each is kept room for; more reads only while the rest still have theirs
      for (let i = 0; i < 15 && (i === 0 || budget.left > sent.length - k - 1); i++) {
        if (i) await wait(1000);
        try {
          r = await rpc('eth_getTransactionReceipt', [hash]);
        } catch {
          break; // out of time or budget: the next run finds it on the chain
        }
        if (r) break;
      }
      if (r?.status === '0x1') ok++;
      else log(what + (r ? ': reverted on chain' : ': no receipt yet') + ' (the next run finds it on the chain and does it again)');
    }
    return ok;
  };
  const word = async (data) => Number(BigInt(await rpc('eth_call', [{ to: arena, data }, 'latest'])));
  const blockNow = async () => parseInt(await rpc('eth_blockNumber', []), 16);
  const timeNow = async () => parseInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp, 16);

  // ---- the draw: seal after the cutoff, then hold it on the sealed block's hash
  let drew = false;
  let heldReceipt = null; // its Started events name the fights it drew
  if ((await word(PENDING_CUTOFF)) === 0) {
    const at = await chain.nextDrawAt();
    const t = await timeNow();
    const inHall = await word(HALL_COUNT);
    // no fight without an opponent; but at the season's end the draw closes the hall, one agent included
    const rt = await chain.roundTime();
    const cur = await chain.currentSeason();
    const closing = !cur || t + 60 + 12 * rt + 11 * BREAK > (await chain.season(cur)).end; // a draw held now would bell at t + 60
    if (at !== 0 && t >= at && (inHall >= 2 || (closing && inHall >= 1))) {
      const sealed = await send(DRAW, 'seal the draw');
      if (sealed) await receiptOf(sealed);
    }
  }
  if ((await word(PENDING_CUTOFF)) !== 0) {
    const sb = await word(SEED_BLOCK);
    for (let i = 0; i < 20 && (await blockNow()) <= sb; i++) await wait(1000);
    const held = await send(DRAW, 'hold the draw');
    drew = held !== null;
    if (held) heldReceipt = await receiptOf(held);
  }

  // twenty minutes of blocks: a fight lasts at most 15
  const lockBlocks = Math.ceil(Number(env.BLOCKS_PER_WEEK ?? 604800) / (7 * 24 * 60)) * 20;
  // degraded: the wide log reads failed, so only the last twenty minutes are seen and no season closes
  let degraded = false;
  let windowLogs = null;
  /** The Started and Judged events of the last twenty minutes of blocks, by block numbers (so the range
   *  can be split: up to 12 pieces, which the narrow log nodes can serve when the wide one is out),
   *  HEAD_MARGIN behind the head. Read once a run; nothing if no node can read even that. */
  const windowScan = async () => {
    if (windowLogs) return windowLogs;
    const head = await blockNow();
    const from = Math.max(deployBlock, head - lockBlocks);
    const to = head - headMargin;
    if (to < from) return (windowLogs = []);
    const { j } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: arena, fromBlock: blockHex(from), toBlock: blockHex(to), topics: [[STARTED, JUDGED]] }] }, { maxPieces: 12 });
    if (j.error) log('degraded run: the last twenty minutes of blocks could not be read either (' + j.error.message + ')');
    return (windowLogs = j.error ? [] : j.result);
  };

  // ---- the trap plans of the fights just drawn, locked before their first bell
  {
    const latestNow = await blockNow();
    const recent = Math.max(deployBlock, latestNow - lockBlocks);
    // up to 'latest': each log node reads to its own head (a block number past a lagging node's head is
    // an error there). The fights this run drew also come from its own receipt, in case the node that
    // reads the logs has not seen that block yet.
    const { j } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: arena, fromBlock: blockHex(recent), toBlock: 'latest', topics: [STARTED] }] });
    let scanned = j.error ? null : j.result;
    if (!scanned) {
      degraded = true;
      log('degraded run: the lock scan failed (' + j.error.message + '): only the last twenty minutes by block numbers, and no season close');
      scanned = await windowScan();
    }
    const drawn = (heldReceipt?.logs ?? []).filter((l) => String(l.address).toLowerCase() === arena.toLowerCase() && l.topics?.[0] === STARTED);
    const t = await timeNow();
    const rt = await chain.roundTime();
    const items = [];
    const seen = new Set();
    for (const l of [...drawn, ...scanned]) {
      if (items.length >= 32) break; // the rest in the next run
      if (spare() < SEND_COST + 1) break; // the rest in the next run: room for this read and the lock
      if (l.topics?.[0] !== STARTED || !l.data) continue;
      const agent = '0x' + l.topics[1].slice(26);
      const number = parseInt(l.topics[2], 16);
      const seed = '0x' + l.data.slice(2, 66);
      if (seen.has(seed)) continue; // the other corner of a match: read once, one lock covers both
      seen.add(seed);
      const f = await chain.fightOf(agent, number);
      const keys = mine.get(f.season)?.serves ? mine.get(f.season).keys : null;
      if (!keys) continue; // another judge's season, one whose secret this server lacks, or whose pages it does not build (never locked: cancelled, no attempt spent)
      const endsAt = f.clockAt + 11 * (rt + BREAK) + rt;
      // locked already, over (a cancelled match included) or past its time: nothing to lock
      if (BigInt(f.trapsCommit) !== 0n || f.round !== 1 || f.clockRound !== 1 || f.finishedAt !== 0 || t > endsAt) continue;
      const { traps } = planOf(keys.cardSeed(f.seed));
      items.push({ agent, number, commit: keys.trapsCommit(traps, keys.trapSalt(arena, f.seed)) });
    }
    if (items.length) await send(lockCalldata(items), 'lock the trap plans of ' + items.length + ' fight(s)');
  }

  // ---- the judgements
  const latest = await blockNow();
  const now = await timeNow();
  const roundTime = await chain.roundTime();
  const blocksPerHour = Math.ceil(Number(env.BLOCKS_PER_WEEK ?? 604800) / 168);
  const chunk = Math.max(1, Number(env.LOG_CHUNK ?? 5000));
  const scanTo = latest - headMargin; // never past the head of a lagging log node
  let logs = [];
  if (!degraded) {
    for (let from = Math.max(deployBlock, latest - Math.max(Number(env.LOOKBACK_BLOCKS ?? 20000), blocksPerHour)); from <= scanTo; from += chunk) {
      const to = Math.min(scanTo, from + chunk - 1);
      const { j } = await net.call({ jsonrpc: '2.0', id: 1, method: 'eth_getLogs', params: [{ address: arena, fromBlock: blockHex(from), toBlock: blockHex(to), topics: [[STARTED, JUDGED]] }] });
      if (j.error) {
        degraded = true;
        log(`degraded run: blocks ${from}-${to} could not be read (${j.error.message}): only the last twenty minutes are judged, and no season close`);
        break;
      }
      logs.push(...j.result);
    }
  }
  if (degraded) logs = await windowScan();
  const fights = new Map();
  const done = new Set(); // fights judged already, by their Judged events: never read again
  let lastHour = 0; // judgements sent in the last hour (a degraded run sees only twenty minutes of them)
  for (const l of logs) {
    if (l.topics[0] === JUDGED) {
      if (parseInt(l.blockNumber, 16) > latest - blocksPerHour) lastHour++;
      done.add(l.topics[1] + l.topics[2]);
    } else fights.set(l.topics[1] + l.topics[2], { agent: '0x' + l.topics[1].slice(26), number: parseInt(l.topics[2], 16) });
  }
  const allowed = Math.min(Number(env.MAX_PER_RUN ?? 16), Number(env.MAX_PER_HOUR ?? 240) - lastHour);
  if (allowed <= 0) {
    log('hourly limit reached: ' + lastHour + ' judgements in the last hour');
    return { judged: 0, drew, waiting: false, limited: true, degraded, confirmed: await receipts(), sent: sent.length };
  }

  // a fight is read once a run: the opponent of one fight is usually another fight of the list
  const fightCache = new Map();
  const fightOf = async (agent, number) => {
    const k = agent.toLowerCase() + '#' + number;
    if (!fightCache.has(k)) fightCache.set(k, await chain.fightOf(agent, number));
    return fightCache.get(k);
  };
  const over = (f) => f.finishedAt !== 0 || now > f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime;
  let judged = 0;
  const left = new Set(); // seasons with a fight still to judge (not sent, or sent and not yet mined): not closed in this run
  let cut = false; // the run stopped before every fight was looked at
  for (const [id, { agent, number }] of fights) {
    if (judged >= allowed) {
      cut = true;
      break;
    }
    if (done.has(id)) continue;
    if (spare() < SEND_COST + 2) {
      // room for two reads (the fight and its opponent) and a judgement: the rest in the next run
      log('the other fights are left for the next run (this run\'s subrequests are spent)');
      cut = true;
      break;
    }
    const f = await fightOf(agent, number);
    if (f.judged) continue;
    if (!over(f)) {
      left.add(f.season);
      continue;
    }
    const keys = mine.get(f.season)?.keys;
    if (!keys) continue; // another judge's season, or one whose secret this server lacks
    if (f.opponent !== ZERO && !over(await fightOf(f.opponent, f.opponentNumber))) continue;
    if (f.round <= 1) continue; // nothing answered
    if (f.commitment.toLowerCase() !== keys.commitment(arena, agent, number).toLowerCase()) continue; // never judgeable
    const hashes = Array.from({ length: 12 }, (_, i) => answerHash(keys.code(arena, agent, number, i + 1)));
    // the plan locked before the first bell; a fight whose plan was never locked never ran
    if (BigInt(f.trapsCommit) === 0n) continue;
    const traps = planOf(keys.cardSeed(f.seed)).traps;
    const trapSalt = keys.trapSalt(arena, f.seed);
    if (keys.trapsCommit(traps, trapSalt).toLowerCase() !== f.trapsCommit.toLowerCase()) {
      log(agent + '#' + number + ': its locked trap plan is not this server\'s: left out');
      continue;
    }
    const data = judgeCalldata(agent, number, hashes, keys.salt(arena, agent, number), traps, trapSalt);
    left.add(f.season); // judged in this run at best: the close waits for a run that finds nothing left
    if ((await send(data, agent + '#' + number + ' judged')) !== null) judged++;
  }
  // the season's close: after its end, once a run finds nothing left to judge, the judge closes the
  // season (the ranking is final, the first ten places get their certificates)
  let closed = false;
  for (const [n, { s }] of mine) {
    // closed only by a run that looked at every fight and found none of this season left, and not before
    // half an hour after its end (every fight of it ends within 15 minutes of the end); never by a
    // degraded run, which saw only the last twenty minutes
    if (degraded || cut || left.has(n) || now <= s.end + 1800) continue;
    if (spare() < SEND_COST + 1) continue; // the next run closes it
    if (BigInt(await rpc('eth_call', [{ to: s.certificate, data: CLOSED_AT }, 'latest'])) === 0n) closed = (await send(CLOSE, `close season ${n}`, s.certificate)) !== null || closed;
  }
  return { judged, drew, waiting: false, closed, degraded, confirmed: await receipts(), sent: sent.length };
}

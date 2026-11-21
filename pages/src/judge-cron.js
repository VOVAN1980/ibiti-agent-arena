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
// - reads the arena's Started events of the last LOOKBACK_BLOCKS blocks (in chunks); a fight lasts at
//   most 14 min 50 s, so the window leaves hours for retries. A fight left out longer (an outage) is
//   judged by hand with judge.mjs;
// - skips a fight that is judged, still running, waiting for its opponent's fight to end (a match is
//   judged only when both fights are over), empty (nothing answered: it would score 0 and only cost
//   gas), or registered with a foreign commitment (it can never be judged);
// - does nothing while an earlier transaction of the judge is still pending (no double sending);
// - judges with the fight's right-answer hashes, salt and the trap plan it locked (plan.js; a fight
//   whose plan was never locked never ran and is not judged), at most
//   MAX_PER_RUN a run and MAX_PER_HOUR an hour (a guard against draining the judge's gas; the hour is
//   counted on the chain itself, from the Judged events of the last hour of blocks);
// - simulates every transaction first (eth_estimateGas), signs it here with the judge key (a Worker
//   secret) and sends it as a raw transaction.
//
// - sends nothing new after RUN_SECONDS (default 40) of a run, so a run never sends while the next
//   minute's run starts: one sender per key at a time, and a transaction found pending at the start of
//   a run is at least a quarter of a minute old (stuck);
// - checks the receipts of what it sent before it ends (a reverted or lost transaction is not
//   counted; the next run finds the same work on the chain and does it again: the chain itself is the
//   list of what is still to do).
//
// Environment: RPC_URL, ARENA, CHAIN_ID, DEPLOY_BLOCK, BLOCKS_PER_WEEK, SECRET (Worker secret),
// JUDGE_KEY (Worker secret), LOOKBACK_BLOCKS (default 20000), MAX_PER_RUN (default 16),
// MAX_PER_HOUR (default 240), RUN_SECONDS (default 40).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from './keccak.js';
import { arenaKeys, answerHash } from './keys.js';
import { makeChain, BREAK } from './chain.js';
import { planOf } from './plan.js';

export const STARTED = keccak256(utf8Hex('Started(address,uint32,bytes32,bool,bytes32,bytes32,address,uint32)'));
export const JUDGED = keccak256(utf8Hex('Judged(address,uint32,bool,uint8,uint16,uint64,uint8,uint8,uint8,uint32,bytes32[12])'));
const SEL = (sig) => keccak256(utf8Hex(sig)).slice(0, 10);
const JUDGE_FIGHT = SEL('judgeFight(address,uint32,bytes32[12],bytes32,uint8[36],bytes32)');
const LOCK_TRAPS = SEL('lockTraps(address[],uint32[],bytes32[])');
const JUDGE = SEL('judge()');
const DRAW = SEL('draw()');
const PENDING_CUTOFF = SEL('pendingCutoff()');
const SEED_BLOCK = SEL('seedBlock()');
const HALL_COUNT = SEL('hallCount()');
const SEASON_END = SEL('seasonEnd()');
const CHUNK = 5000;
const ZERO = '0x' + '0'.repeat(40);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

export async function judgeRun(env, { fetchFn = fetch, log = console.log, wait = sleep } = {}) {
  const deadline = Date.now() + Number(env.RUN_SECONDS ?? 40) * 1000;
  const rpcUrl = env.RPC_URL;
  const rpc = async (method, params) => {
    const res = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json();
    if (j.error) throw new Error(method + ': ' + j.error.message);
    return j.result;
  };
  const arena = env.ARENA;
  const keys = arenaKeys(env.SECRET);
  const chain = makeChain({ rpc: rpcUrl, arena, fetchFn });
  if ((await chain.secretCommit()).toLowerCase() !== keys.commit.toLowerCase()) throw new Error('the secret does not match the arena');
  const me = addressOf(env.JUDGE_KEY);
  const judge = '0x' + (await rpc('eth_call', [{ to: arena, data: JUDGE }, 'latest'])).slice(-40);
  if (judge.toLowerCase() !== me.toLowerCase()) throw new Error("JUDGE_KEY is not the arena's judge");

  // an earlier transaction still on its way: wait a little; still there, it is stuck: replace it
  const chainId = Number(env.CHAIN_ID ?? 56);
  const nonces = async () => (await Promise.all(['pending', 'latest'].map((tag) => rpc('eth_getTransactionCount', [me, tag])))).map(BigInt);
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
    return { judged: 0, drew: false, waiting: true };
  }
  let nonce = pendingNonce;
  const sent = []; // [hash, what]: their receipts are checked before the run ends
  const send = async (data, what) => {
    if (Date.now() > deadline) {
      log(what + ': left for the next run (this run\'s time is up)');
      return null;
    }
    let gas;
    try {
      gas = (BigInt(await rpc('eth_estimateGas', [{ from: me, to: arena, data }])) * 12n) / 10n;
    } catch (e) {
      log(what + ': not now (' + e.message + ')');
      return null;
    }
    const gasPrice = BigInt(await rpc('eth_gasPrice', []));
    const hash = await rpc('eth_sendRawTransaction', [signTx({ nonce, gasPrice, gas, to: arena, data, chainId }, env.JUDGE_KEY)]);
    nonce++;
    log(what + ': sent ' + hash);
    sent.push([hash, what]);
    return hash;
  };
  /** Waits (a little) for the receipts of what this run sent; returns how many went through. */
  const receipts = async () => {
    let ok = 0;
    for (const [hash, what] of sent) {
      let r = null;
      for (let i = 0; i < 15 && !(r = await rpc('eth_getTransactionReceipt', [hash])); i++) await wait(1000);
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
  if ((await word(PENDING_CUTOFF)) === 0) {
    const at = await chain.nextDrawAt();
    const t = await timeNow();
    const inHall = await word(HALL_COUNT);
    // no fight without an opponent; but at the season's end the draw closes the hall, one agent included
    const rt = await chain.roundTime();
    const closing = t + 60 + 12 * rt + 11 * BREAK > (await word(SEASON_END)); // a draw held now would bell at t + 60
    if (at !== 0 && t >= at && (inHall >= 2 || (closing && inHall >= 1))) {
      const sealed = await send(DRAW, 'seal the draw');
      for (let i = 0; sealed && i < 20 && !(await rpc('eth_getTransactionReceipt', [sealed])); i++) await wait(1000);
    }
  }
  if ((await word(PENDING_CUTOFF)) !== 0) {
    const sb = await word(SEED_BLOCK);
    for (let i = 0; i < 20 && (await blockNow()) <= sb; i++) await wait(1000);
    const held = await send(DRAW, 'hold the draw');
    drew = held !== null;
    for (let i = 0; held && i < 20 && !(await rpc('eth_getTransactionReceipt', [held])); i++) await wait(1000);
  }

  // ---- the trap plans of the fights just drawn, locked before their first bell
  {
    const latestNow = await blockNow();
    const recent = Math.max(Number(env.DEPLOY_BLOCK ?? 0), latestNow - Math.ceil(Number(env.BLOCKS_PER_WEEK ?? 604800) / (7 * 24 * 60)) * 20); // twenty minutes of blocks: a fight lasts at most 15
    const logs = await rpc('eth_getLogs', [{ address: arena, fromBlock: '0x' + recent.toString(16), toBlock: '0x' + latestNow.toString(16), topics: [STARTED] }]);
    const t = await timeNow();
    const rt = await chain.roundTime();
    const items = [];
    const seen = new Set();
    for (const l of logs) {
      if (items.length >= 32) break; // the rest in the next run
      if (l.topics?.[0] !== STARTED || !l.data) continue;
      const agent = '0x' + l.topics[1].slice(26);
      const number = parseInt(l.topics[2], 16);
      const seed = '0x' + l.data.slice(2, 66);
      if (seen.has(seed)) continue; // the other corner of a match: read once, one lock covers both
      seen.add(seed);
      const f = await chain.fightOf(agent, number);
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
  const fights = new Map();
  const done = new Set(); // fights judged already, by their Judged events: never read again
  let lastHour = 0; // judgements sent in the last hour
  for (let from = Math.max(Number(env.DEPLOY_BLOCK ?? 0), latest - Math.max(Number(env.LOOKBACK_BLOCKS ?? 20000), blocksPerHour)); from <= latest; from += CHUNK) {
    const to = Math.min(latest, from + CHUNK - 1);
    const logs = await rpc('eth_getLogs', [{ address: arena, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [[STARTED, JUDGED]] }]);
    for (const l of logs) {
      if (l.topics[0] === JUDGED) {
        if (parseInt(l.blockNumber, 16) > latest - blocksPerHour) lastHour++;
        done.add(l.topics[1] + l.topics[2]);
      } else fights.set(l.topics[1] + l.topics[2], { agent: '0x' + l.topics[1].slice(26), number: parseInt(l.topics[2], 16) });
    }
  }
  const budget = Math.min(Number(env.MAX_PER_RUN ?? 16), Number(env.MAX_PER_HOUR ?? 240) - lastHour);
  if (budget <= 0) {
    log('hourly limit reached: ' + lastHour + ' judgements in the last hour');
    return { judged: 0, drew, waiting: false, limited: true, confirmed: await receipts(), sent: sent.length };
  }

  const over = (f) => f.finishedAt !== 0 || now > f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime;
  let judged = 0;
  for (const [id, { agent, number }] of fights) {
    if (judged >= budget) break;
    if (done.has(id)) continue;
    const f = await chain.fightOf(agent, number);
    if (f.judged || !over(f)) continue;
    if (f.opponent !== ZERO && !over(await chain.fightOf(f.opponent, f.opponentNumber))) continue;
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
    if ((await send(data, agent + '#' + number + ' judged')) !== null) judged++;
  }
  return { judged, drew, waiting: false, confirmed: await receipts(), sent: sent.length };
}

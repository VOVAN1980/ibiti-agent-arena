// The judge on Cloudflare: a Cron Trigger runs `judgeRun` every minute (host.js `scheduled`). It
// does what pages/tools/judge.mjs does on a computer, without keeping any state: the chain says which
// fights are judged.
//
// Each run:
// - reads the arena's Started events of the last LOOKBACK_BLOCKS blocks (in chunks); a fight lasts at
//   most 14 minutes, so the window leaves hours for retries. A fight left out longer (an outage) is
//   judged by hand with judge.mjs;
// - skips a fight that is judged, still running, waiting for its opponent's fight to end (a live
//   match is judged only when both fights are over), empty (nothing answered: it would score 0 and
//   only cost gas), or started with a foreign commitment (it can never be judged);
// - does nothing while an earlier judgement is still pending (no double sending);
// - sends at most MAX_PER_RUN judgements, each first simulated (eth_estimateGas), signed here with
//   the judge key (a Worker secret) and sent as a raw transaction.
//
// Environment: RPC_URL, ARENA, CHAIN_ID, DEPLOY_BLOCK, SECRET (Worker secret), JUDGE_KEY (Worker
// secret), LOOKBACK_BLOCKS (default 20000), MAX_PER_RUN (default 5).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from './keccak.js';
import { arenaKeys, answerHash } from './keys.js';
import { makeChain, BREAK } from './chain.js';

const STARTED = keccak256(utf8Hex('Started(address,uint32,bytes32,bool,bytes32,bytes32,address,bool)'));
const JUDGE_FIGHT = keccak256(utf8Hex('judgeFight(address,uint32,bytes32[12],bytes32)')).slice(0, 10);
const JUDGE = keccak256(utf8Hex('judge()')).slice(0, 10);
const CHUNK = 5000;
const ZERO = '0x' + '0'.repeat(40);

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
export function judgeCalldata(agent, number, rightHashes, salt) {
  return JUDGE_FIGHT + w(agent) + w(Number(number).toString(16)) + rightHashes.map(w).join('') + w(salt);
}

// ------------------------------------------------------------------ one run

export async function judgeRun(env, { fetchFn = fetch, log = console.log } = {}) {
  const rpcUrl = env.RPC_URL;
  const rpc = async (method, params) => {
    const res = await fetchFn(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
  const arena = env.ARENA;
  const keys = arenaKeys(env.SECRET);
  const chain = makeChain({ rpc: rpcUrl, arena, fetchFn });
  if ((await chain.secretCommit()).toLowerCase() !== keys.commit.toLowerCase()) throw new Error('the secret does not match the arena');
  const me = addressOf(env.JUDGE_KEY);
  const judge = '0x' + (await rpc('eth_call', [{ to: arena, data: JUDGE }, 'latest'])).slice(-40);
  if (judge.toLowerCase() !== me.toLowerCase()) throw new Error('JUDGE_KEY is not the arena\'s judge');

  // an earlier judgement still on its way: wait for it, never send twice
  const [pendingNonce, minedNonce] = await Promise.all(['pending', 'latest'].map((tag) => rpc('eth_getTransactionCount', [me, tag])));
  if (BigInt(pendingNonce) > BigInt(minedNonce)) return { judged: 0, waiting: true };

  const latest = parseInt(await rpc('eth_blockNumber', []), 16);
  const now = parseInt((await rpc('eth_getBlockByNumber', ['latest', false])).timestamp, 16);
  const roundTime = await chain.roundTime();
  const fights = new Map();
  for (let from = Math.max(Number(env.DEPLOY_BLOCK ?? 0), latest - Number(env.LOOKBACK_BLOCKS ?? 20000)); from <= latest; from += CHUNK) {
    const to = Math.min(latest, from + CHUNK - 1);
    const logs = await rpc('eth_getLogs', [{ address: arena, fromBlock: '0x' + from.toString(16), toBlock: '0x' + to.toString(16), topics: [STARTED] }]);
    for (const l of logs) fights.set(l.topics[1] + l.topics[2], { agent: '0x' + l.topics[1].slice(26), number: parseInt(l.topics[2], 16) });
  }

  const over = (f) => f.finishedAt !== 0 || now > f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime;
  let nonce = BigInt(pendingNonce);
  let judged = 0;
  for (const { agent, number } of fights.values()) {
    if (judged >= Number(env.MAX_PER_RUN ?? 5)) break;
    const f = await chain.fightOf(agent, number);
    if (f.judged || !over(f)) continue;
    if (f.opponent !== ZERO && !over(await chain.fightOf(f.opponent, f.opponentNumber))) continue;
    if (f.round <= 1) continue; // nothing answered
    if (f.commitment.toLowerCase() !== keys.commitment(arena, agent, number).toLowerCase()) continue; // never judgeable
    const hashes = Array.from({ length: 12 }, (_, i) => answerHash(keys.code(arena, agent, number, i + 1)));
    const data = judgeCalldata(agent, number, hashes, keys.salt(arena, agent, number));
    let gas;
    try {
      gas = (BigInt(await rpc('eth_estimateGas', [{ from: me, to: arena, data }])) * 12n) / 10n;
    } catch (e) {
      log(`${agent}#${number}: not judged now (${e.message})`);
      continue;
    }
    const gasPrice = BigInt(await rpc('eth_gasPrice', []));
    const raw = signTx({ nonce, gasPrice, gas, to: arena, data, chainId: Number(env.CHAIN_ID ?? 56) }, env.JUDGE_KEY);
    const hash = await rpc('eth_sendRawTransaction', [raw]);
    log(`${agent}#${number}: judgement sent ${hash}`);
    nonce++;
    judged++;
  }
  return { judged, waiting: false };
}

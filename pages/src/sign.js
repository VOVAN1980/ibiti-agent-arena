// The judge's signatures that are not transactions: the commitment of an agent's next fight, which
// the arena checks at register() (AgentArena.COMMITMENT_TAG). With it the arena opens only fights the
// judge can score. secp256k1 from @noble/curves, as for the judge's transactions (judge-cron.js).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from './keccak.js';

const w = (h) => String(h).replace(/^0x/, '').toLowerCase().padStart(64, '0');
const utf8Hex = (s) => [...new TextEncoder().encode(s)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const hexToBytes = (h) => {
  const s = String(h).replace(/^0x/, '');
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(2 * i, 2 * i + 2), 16);
  return out;
};
const hex = (n, bytes) => BigInt(n).toString(16).padStart(bytes * 2, '0');

/** keccak256("IBITI Agent Arena commitment"): AgentArena.COMMITMENT_TAG. */
export const COMMITMENT_TAG = keccak256(utf8Hex('IBITI Agent Arena commitment'));

/** What the judge signs: keccak256(abi.encode(COMMITMENT_TAG, chainId, arena, agent, number, commitment)). */
export function commitmentDigest(chainId, arena, agent, number, commitment) {
  return keccak256(w(COMMITMENT_TAG) + w(Number(chainId).toString(16)) + w(arena) + w(agent) + w(Number(number).toString(16)) + w(commitment));
}

/** An Ethereum signed message (EIP-191) of a 32-byte digest, signed with `key`: r ‖ s ‖ v (65 bytes, v 27/28). */
export function signDigest(digest, key) {
  const eth = keccak256(utf8Hex('\x19Ethereum Signed Message:\n32') + w(digest));
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(hexToBytes(eth), hexToBytes(key), { prehash: false, format: 'recovered' }), 'recovered');
  return '0x' + hex(sig.r, 32) + hex(sig.s, 32) + hex(27 + sig.recovery, 1);
}

/** An Ethereum signed message (EIP-191, personal_sign) of a text, signed with `key`: r ‖ s ‖ v. The
 *  signature is deterministic (RFC 6979), so signing the same text again gives the same signature. */
export function signText(text, key) {
  const bytes = utf8Hex(text);
  const eth = keccak256(utf8Hex(`\x19Ethereum Signed Message:\n${bytes.length / 2}`) + bytes);
  const sig = secp256k1.Signature.fromBytes(secp256k1.sign(hexToBytes(eth), hexToBytes(key), { prehash: false, format: 'recovered' }), 'recovered');
  return '0x' + hex(sig.r, 32) + hex(sig.s, 32) + hex(27 + sig.recovery, 1);
}

/** The address of a private key. */
export function addressOf(key) {
  const pub = secp256k1.getPublicKey(hexToBytes(key), false); // 0x04 ‖ x ‖ y
  return '0x' + keccak256([...pub.slice(1)].map((b) => b.toString(16).padStart(2, '0')).join('')).replace(/^0x/, '').slice(-40);
}

/** The judge's signature of `agent`'s commitment for fight `number`, for register(). */
export function signCommitment(key, chainId, arena, agent, number, commitment) {
  return signDigest(commitmentDigest(chainId, arena, agent, number, commitment), key);
}

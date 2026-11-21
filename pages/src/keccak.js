// keccak256 (the Ethereum hash) for the page server and the tools: every code, commitment, salt and
// page layout is derived with it. It uses the audited @noble/hashes implementation: our own BigInt
// version was correct but slow (a quarter of a millisecond a hash), too slow for the CPU time a
// Cloudflare Worker gets per request.

import { keccak_256 } from '@noble/hashes/sha3.js';

/** keccak256 of the bytes given as hex (with or without 0x); returns 0x-prefixed hex. */
export function keccak256(hexIn) {
  const h = hexIn.replace(/^0x/, '');
  const bytes = new Uint8Array(h.length >> 1);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  let out = '0x';
  for (const b of keccak_256(bytes)) out += b.toString(16).padStart(2, '0');
  return out;
}

const w = (h) => h.replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** A public key for previews and tests only. A real arena uses the secret pass key of its codebook. */
export const DEMO_PASS_KEY = '0x' + '00'.repeat(32);

/**
 * Is `round` a PASS round on the card with `seed`? Rounds 9–12 only, about half of the cards, the
 * same for every fighter on the card. It depends on the codebook's secret pass key, so nobody can
 * tell from the chain; the key is published after the season so every result can be rechecked.
 */
export function isPassRound(seed, round, passKey = DEMO_PASS_KEY) {
  if (round < 9) return false;
  return BigInt(keccak256(w(passKey) + w(seed) + w(round.toString(16)))) % 2n === 0n;
}

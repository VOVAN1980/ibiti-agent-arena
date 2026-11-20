// keccak256 (the Ethereum hash), small and dependency-free, for the few hashes a page needs: which
// decision rounds of a card are PASS rounds (from the secret pass key), and the Safe transaction
// hashes of round 12.

const M = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
// rotation offsets r[x][y]
const ROT = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & M);

function permute(A) {
  for (let round = 0; round < 24; round++) {
    const C = [0, 1, 2, 3, 4].map((x) => A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20]);
    for (let x = 0; x < 5; x++) {
      const D = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y++) A[x + 5 * y] ^= D;
    }
    const B = new Array(25);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & M & B[((x + 2) % 5) + 5 * y]);
    A[0] ^= RC[round];
  }
}

/** keccak256 of the bytes given as hex (with or without 0x); returns 0x-prefixed hex. */
export function keccak256(hexIn) {
  const h = hexIn.replace(/^0x/, '');
  const bytes = [];
  for (let i = 0; i < h.length; i += 2) bytes.push(parseInt(h.slice(i, i + 2), 16));
  const rate = 136;
  bytes.push(0x01);
  while (bytes.length % rate) bytes.push(0);
  bytes[bytes.length - 1] |= 0x80;
  const A = new Array(25).fill(0n);
  for (let off = 0; off < bytes.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(bytes[off + i * 8 + b]);
      A[i] ^= lane;
    }
    permute(A);
  }
  let out = '';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out += Number((A[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return '0x' + out;
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

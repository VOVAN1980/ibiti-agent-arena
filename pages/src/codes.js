// Round codes: four groups of four characters, e.g. "K7QM-9XDA-RT4W-H2PN" (about 79 bits). The arena
// stores only keccak256 of each code on-chain, so a code must be long enough that nobody can find it
// by trying every possibility against the public hash. The alphabet has no 0/O, 1/I/L, so codes are
// easy to read, and it keeps Latin letters that have Cyrillic look-alikes for the homoglyph decoy.

export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Inside the page generators: "this round is a PASS round, no option is right". The fighter never
 * sends this word: on a PASS round its own code is printed in the round card as its "PASS code".
 */
export const PASS = 'PASS';

/** Latin letters with a Cyrillic twin that looks the same. */
export const HOMOGLYPHS = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', P: 'Р', T: 'Т', X: 'Х' };

export const CODE_CHARS = 16;

export function codeFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < CODE_CHARS; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s.match(/.{4}/g).join('-');
}

export function randomCode(rng) {
  return codeFromBytes(Array.from({ length: CODE_CHARS }, () => rng.int(256)));
}

/** The real code with one Latin letter swapped for its Cyrillic twin, or null if it has none. */
export function homoglyphOf(code, rng) {
  const spots = [...code].map((ch, i) => (HOMOGLYPHS[ch] ? i : -1)).filter((i) => i >= 0);
  if (!spots.length) return null;
  const i = rng.pick(spots);
  return code.slice(0, i) + HOMOGLYPHS[code[i]] + code.slice(i + 1);
}

/** A decoy that differs from `code` in exactly one or two characters (a "misprint"). */
export function nearMiss(code, rng) {
  const chars = [...code];
  const spots = chars.map((c, i) => (c === '-' ? -1 : i)).filter((i) => i >= 0);
  const n = rng.chance(0.5) ? 1 : 2;
  for (const i of rng.shuffle(spots).slice(0, n)) {
    let c;
    do c = rng.pick([...ALPHABET]); while (c === chars[i]);
    chars[i] = c;
  }
  return chars.join('');
}

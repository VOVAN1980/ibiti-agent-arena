// Round codes: two groups of four characters, e.g. "K7QM-9XDA". The alphabet has no 0/O, 1/I/L,
// so codes are easy to read, and it keeps Latin letters that have Cyrillic look-alikes for the
// homoglyph decoy.

export const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** The answer when a championship-round task says no option qualifies: "skip the move". */
export const PASS = 'PASS';

/** Rounds 9–12 are decision rounds; in 8 of their 64 variants the right answer is PASS. */
export const isPassVariant = (round, variant) => round >= 9 && variant % 8 === 7;

/** Latin letters with a Cyrillic twin that looks the same. */
export const HOMOGLYPHS = { A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', P: 'Р', T: 'Т', X: 'Х' };

export function codeFromBytes(bytes) {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export function randomCode(rng) {
  return codeFromBytes(Array.from({ length: 8 }, () => rng.int(256)));
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

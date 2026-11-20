// Creates the secret codebook: 12 rounds x 64 variants of round codes. In rounds 9–12 (decision
// rounds), 8 of the 64 variants are PASS; the arena gives the PASS variant on half of the cards.
//
//   node tools/make-codebook.mjs            -> new random secret, writes ../codebook/
//   node tools/make-codebook.mjs <hex>      -> rebuild from a known secret (e.g. after the season)
//
// codebook/secret.hex and codebook/codes.json are gitignored. The arena stores only keccak256 of
// each code; the secret is published after the season so anyone can recheck every score.

import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeFromBytes, PASS, isPassVariant } from '../src/codes.js';

export function buildCodebook(secretHex) {
  const key = Buffer.from(secretHex, 'hex');
  const codes = [];
  for (let r = 1; r <= 12; r++) {
    const row = [];
    for (let v = 0; v < 64; v++) {
      row.push(isPassVariant(r, v) ? PASS : codeFromBytes(createHmac('sha256', key).update(`round:${r}:variant:${v}`).digest()));
    }
    codes.push(row);
  }
  return { version: 1, codes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const secret = process.argv[2] ?? randomBytes(32).toString('hex');
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'codebook');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'secret.hex'), secret + '\n');
  writeFileSync(join(dir, 'codes.json'), JSON.stringify(buildCodebook(secret), null, 0));
  console.log(`codebook written to ${dir} (secret kept in secret.hex — never commit it)`);
}

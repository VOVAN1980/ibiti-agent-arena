// Creates the secret codebook: 12 rounds x 64 variants of round codes, plus the secret pass key that
// decides which decision rounds (9–12) of a card are PASS rounds (half of them). On a PASS round the
// page shows the fighter's own code as its "PASS code"; the chain cannot tell which rounds those are.
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
import { codeFromBytes } from '../src/codes.js';

export function buildCodebook(secretHex) {
  const key = Buffer.from(secretHex, 'hex');
  const codes = [];
  for (let r = 1; r <= 12; r++) {
    const row = [];
    for (let v = 0; v < 64; v++) {
      row.push(codeFromBytes(createHmac('sha256', key).update(`round:${r}:variant:${v}`).digest()));
    }
    codes.push(row);
  }
  const passKey = '0x' + createHmac('sha256', key).update('pass-key').digest('hex');
  return { version: 2, codes, passKey };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const secret = process.argv[2] ?? randomBytes(32).toString('hex');
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'codebook');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'secret.hex'), secret + '\n');
  writeFileSync(join(dir, 'codes.json'), JSON.stringify(buildCodebook(secret), null, 0));
  console.log(`codebook written to ${dir} (secret kept in secret.hex — never commit it)`);
}

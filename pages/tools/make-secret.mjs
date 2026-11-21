// Creates the season secret. Every fight's codes and the PASS rounds are derived from it; the arena
// stores only keccak256(secret) (SECRET_COMMIT for the deploy script). Keep secret.hex out of git and
// publish it after the season so anyone can recheck every judgement.
//
//   node pages/tools/make-secret.mjs <out-dir>     -> writes <out-dir>/secret.hex, prints the commit

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { arenaKeys } from '../src/keys.js';

const dir = process.argv[2];
if (!dir) throw new Error('usage: node pages/tools/make-secret.mjs <out-dir>');
mkdirSync(dir, { recursive: true });
const file = join(dir, 'secret.hex');
if (existsSync(file)) throw new Error(`${file} exists: never overwrite a season secret`);
const secret = randomBytes(32).toString('hex');
writeFileSync(file, secret + '\n');
console.log(`secret written to ${file} (never commit it)`);
console.log(`SECRET_COMMIT=${arenaKeys(secret).commit}`);

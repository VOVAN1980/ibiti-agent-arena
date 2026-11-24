import { test } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// The site never shows another brand as its own: no Binance name, no BNB logo, no Binance yellow.
// BNB Smart Chain may be named as the chain and BNB as gas, in plain text only.
const SITE = join(dirname(fileURLToPath(import.meta.url)), '../../site');
const TEXT = new Set(['.js', '.html', '.css', '.svg', '.json', '.txt']);
const FORBIDDEN = [
  [/binance/i, 'the Binance name'],
  [/M16\.624 13\.9202/, 'the BNB logo path'],
  [/#f0b90b/i, 'Binance yellow'],
];

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name !== 'vendor') out.push(...files(p));
    } else if (TEXT.has(extname(name))) out.push(p);
  }
  return out;
}

test('the site carries no Binance brand: name, BNB logo or Binance yellow', () => {
  const found = [];
  for (const f of files(SITE)) {
    const s = readFileSync(f, 'utf8');
    for (const [re, what] of FORBIDDEN) if (re.test(s)) found.push(`${f.slice(SITE.length + 1)}: ${what}`);
  }
  assert.deepEqual(found, []);
});

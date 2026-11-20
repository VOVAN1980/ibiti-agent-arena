// Writes the 12 round pages of a made-up tournament to pages/preview/ for a look in the browser.
//   node tools/preview.mjs [seed]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRound } from '../src/render.js';
import { buildCodebook } from './make-codebook.mjs';
import { makeRng } from '../src/rng.js';
import { isPassRound } from '../src/keccak.js';

const seed = process.argv[2] ?? '0x' + 'a1'.repeat(32);
const arena = '0x7a3f2c9e5b1d4a6f8e0c2b4d6f8a1c3e5b7d9f21';
const decoys = {
  13: '0x13d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  15: '0x15d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  18: '0x18d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  21: '0x7a3f9d0e1c2b3a4f5e6d7c8b9a0f1e2d3c4b9f21', // look-alike: same first 4 and last 4 characters
  22: '0x22d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  23: '0x23d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  24: '0x24d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  26: '0x26d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
  27: '0x27d0c0e1a2b3c4d5e6f708192a3b4c5d6e7f8091',
};
const fighter = '0x51f9a33248426c63c78ded65aa7733ef285a6b8c';
const book = buildCodebook('00'.repeat(32));

// draw 36 of 50 traps like the contract does (shape only; the contract is the source of truth)
const rng = makeRng(seed, 'preview-traps');
const traps = rng.shuffle([...Array(50).keys()].map((i) => i + 1)).slice(0, 36);

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'preview');
mkdirSync(out, { recursive: true });
const links = [];
for (let r = 1; r <= 12; r++) {
  let variant = makeRng(seed, fighter, r).int(64); // like AgentArena.variantOf: PASS rounds come from the card
  if (r >= 9) variant = isPassRound(seed, r) ? 7 : variant % 8 === 7 ? variant - 1 : variant;
  const page = renderRound({ tournament: 1, round: r, seed, fighter, code: book.codes[r - 1][variant], traps: traps.slice((r - 1) * 3, r * 3), arena, decoys });
  writeFileSync(join(out, `round-${String(r).padStart(2, '0')}.html`), page.html);
  writeFileSync(join(out, `round-${String(r).padStart(2, '0')}.md`), page.md);
  links.push(`<li><a href="round-${String(r).padStart(2, '0')}.html">Round ${r}</a> — ${page.title} — traps ${page.meta.traps.map((t) => `${t.id} (${t.method})`).join(', ')} — decoys ${page.meta.decoys.map((d) => d.kind).join(', ')}</li>`);
}
writeFileSync(join(out, 'index.html'), `<!doctype html><meta charset="utf-8"><title>Preview</title><ul>${links.join('')}</ul>`);
console.log(`12 rounds written to ${out}`);

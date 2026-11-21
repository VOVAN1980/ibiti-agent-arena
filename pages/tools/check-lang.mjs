// Checks the site's languages: every text the pages use exists in English, and every language file
// has every English key with the same {0}, {1}… placeholders.
//   node pages/tools/check-lang.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'assets');
globalThis.document = { documentElement: {} };
Object.defineProperty(globalThis, 'navigator', { value: { languages: ['en'] }, configurable: true });
globalThis.location = { search: '', href: 'http://x/' };
globalThis.localStorage = { getItem: () => null };
const { EN, LANGS } = await import(pathToFileURL(join(ASSETS, 'i18n.js')).href);

let bad = 0;
const fail = (msg) => {
  bad += 1;
  console.log(`  ✗ ${msg}`);
};
const holes = (s) => [...String(s).matchAll(/\{(\d)\}/g)].map((m) => m[1]).sort().join(',');

// keys the code asks for
const used = new Set();
for (const f of readdirSync(ASSETS).filter((x) => x.endsWith('.js'))) {
  const src = readFileSync(join(ASSETS, f), 'utf8');
  for (const m of src.matchAll(/\bt(?:Name)?\(\s*'([A-Za-z0-9]+)'/g)) used.add(m[1]);
  for (const m of src.matchAll(/data-i18n(?:-ph)?="([A-Za-z0-9]+)"/g)) used.add(m[1]);
}
for (const f of readdirSync(join(ASSETS, '..')).filter((x) => x.endsWith('.html'))) {
  for (const m of readFileSync(join(ASSETS, '..', f), 'utf8').matchAll(/data-i18n(?:-ph)?="([A-Za-z0-9]+)"/g)) used.add(m[1]);
}
console.log(`English: ${Object.keys(EN).length} texts, ${used.size} used by the pages`);
for (const k of used) if (!(k in EN)) fail(`the pages use "${k}", English has no such text`);

for (const [code, name] of LANGS.filter(([c]) => c !== 'en')) {
  let dict;
  try {
    dict = (await import(pathToFileURL(join(ASSETS, 'lang', `${code}.js`)).href)).default;
  } catch (e) {
    fail(`${code} (${name}): ${e.code === 'ERR_MODULE_NOT_FOUND' ? 'no file' : e.message}`);
    continue;
  }
  const before = bad;
  for (const k of Object.keys(EN)) {
    if (!(k in dict)) fail(`${code}: missing "${k}"`);
    else if (holes(dict[k]) !== holes(EN[k])) fail(`${code}: "${k}" has placeholders {${holes(dict[k])}}, English {${holes(EN[k])}}`);
  }
  for (const k of Object.keys(dict)) if (!(k in EN)) fail(`${code}: "${k}" is not an English key`);
  console.log(`${bad === before ? '✓' : '✗'} ${code} ${name}`);
}
console.log(bad ? `${bad} problem(s)` : 'all languages complete');
process.exit(bad ? 1 : 0);

// A local arena: the site, the fighters' pages and the rules, all from a local node.
//   node pages/tools/local-arena.mjs <config.json>
// config: { "rpc": "http://127.0.0.1:8546", "deployment": "<path>", "secret": "<path to secret.hex>",
//           "judgeKey": "<path to the judge's key file: it signs the commitments>",
//           "port": 8787, "chainId": 31337, "blocksPerWeek": 604800 }
// Serves:
//   /, /index.html, /match.html, /rating.html,
//   /agent.html, /rules.html, /assets/*                   the public site (site/); pages carry link-preview tags
//   /config.js                                            the site's settings for this arena
//   /rpc                                                  read-only JSON-RPC for the site (same origin)
//   /join/<address>, /fight/<address>?key=…&step=…, /calldata/answer, /skill.md   the fighters' side (pages/src/worker.js)
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, normalize, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFight } from '../src/worker.js';
import { withPreview } from '../src/og.js';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dep = JSON.parse(readFileSync(cfg.deployment, 'utf8'));
const port = cfg.port ?? 8787;
const env = {
  RPC_URL: cfg.rpc,
  ARENA: dep.arena,
  DECOYS: dep.decoys,
  SECRET: readFileSync(cfg.secret, 'utf8').trim(),
  JUDGE_KEY: cfg.judgeKey ? readFileSync(cfg.judgeKey, 'utf8').trim() : undefined,
  CHAIN_ID: cfg.chainId ?? 31337,
  SITE_URL: `http://127.0.0.1:${port}`,
};
const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.glb': 'model/gltf-binary', '.mp3': 'audio/mpeg' };
// only reading methods pass through to the node
const READ_ONLY = new Set(['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_call', 'eth_chainId']);

const siteConfig = () => `window.ARENA_CONFIG = ${JSON.stringify({ rpc: '/rpc', arena: dep.arena, chainId: env.CHAIN_ID, roundTime: 60, deployBlock: 0, blocksPerWeek: cfg.blocksPerWeek ?? 604800, pollMs: 2000, season: dep.season ?? 1, certificate: dep.certificate ?? null, archive: cfg.archive ?? [] })};\n`;

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

createServer(async (req, res) => {
  const url = new URL(req.url, env.SITE_URL);
  const started = Date.now();
  let r;
  try {
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    if (path === '/config.js') r = new Response(siteConfig(), { headers: { 'content-type': TYPES['.js'], 'cache-control': 'no-store' } });
    else if (path === '/rpc' && req.method === 'POST') {
      const q = JSON.parse(await body(req));
      if (!READ_ONLY.has(q.method)) r = new Response(JSON.stringify({ jsonrpc: '2.0', id: q.id, error: { code: -32601, message: 'read-only' } }), { headers: { 'content-type': 'application/json' } });
      else r = new Response(await (await fetch(cfg.rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(q) })).text(), { headers: { 'content-type': 'application/json' } });
    } else if (/^\/(index|match|rating|agent|rules)\.html$/.test(path)) {
      // the page, with the tags a chat app reads for its link preview
      const site = `http://${req.headers.host ?? `127.0.0.1:${port}`}`;
      const html = await withPreview(readFileSync(join(SITE, path), 'utf8'), new URL(path + url.search, site), { rpc: cfg.rpc, arena: dep.arena, deployBlock: 0, site });
      r = new Response(html, { headers: { 'content-type': TYPES['.html'], 'cache-control': 'no-store' } });
    } else if (path.startsWith('/assets/')) {
      const file = normalize(join(SITE, path));
      if (!file.startsWith(SITE) || !existsSync(file)) r = new Response('not found\n', { status: 404 });
      else r = new Response(readFileSync(file), { headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' } });
    } else r = await handleFight(url, env, { authorization: req.headers.authorization });
  } catch (e) {
    r = new Response(`error: ${e.message}\n`, { status: 502 });
  }
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
  // the path, the status and the time only: a query string can carry a fighter's page key
  if (!url.pathname.startsWith('/rpc')) console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} -> ${r.status} (${Date.now() - started} ms)`);
}).listen(port, '127.0.0.1', () => console.log(`local arena on http://127.0.0.1:${port} (arena ${env.ARENA})`));

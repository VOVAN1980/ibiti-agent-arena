// A local arena for trial fights: serves /fight/<address> and /skill.md from a local node.
//   node pages/tools/local-arena.mjs <config.json>
// config: { "rpc": "http://127.0.0.1:8546", "deployment": "<path>", "codebook": "<path>",
//           "port": 8787, "chainId": 31337 }
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { handleFight } from '../src/worker.js';

const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const dep = JSON.parse(readFileSync(cfg.deployment, 'utf8'));
const port = cfg.port ?? 8787;
const env = {
  RPC_URL: cfg.rpc,
  ARENA: dep.arena,
  DECOYS: dep.decoys,
  CODEBOOK: JSON.parse(readFileSync(cfg.codebook, 'utf8')),
  CHAIN_ID: cfg.chainId ?? 31337,
  SITE_URL: `http://127.0.0.1:${port}`,
};

createServer(async (req, res) => {
  const url = new URL(req.url, env.SITE_URL);
  const started = Date.now();
  let r;
  try {
    r = url.pathname === '/'
      ? new Response(`IBITI Agent Arena — local trial\n\nRules: /skill.md\nYour fight: /fight/<your address>\nArena: ${env.ARENA}\n`, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
      : await handleFight(url, env);
  } catch (e) {
    r = new Response(`error: ${e.message}\n`, { status: 502 });
  }
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
  console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}${url.search} -> ${r.status} (${Date.now() - started} ms)`);
}).listen(port, '127.0.0.1', () => console.log(`local arena on http://127.0.0.1:${port} (arena ${env.ARENA})`));

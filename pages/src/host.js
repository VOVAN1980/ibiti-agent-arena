// The arena on Cloudflare: one Worker for everything, as pages/tools/local-arena.mjs does locally.
//   /, /index.html, /match.html, /rating.html,
//   /agent.html, /rules.html                       the public site, with link-preview tags (og.js)
//   /assets/*                                      the site's static files (served by Cloudflare)
//   /config.js                                     the site's settings for this arena
//   /rpc                                           read-only JSON-RPC for the site (same origin)
//   /join/<address>?name=…&model=…, /fight/<address>?key=…&step=…,
//   /calldata/answer?round=…&code=…, /skill.md      the fighters' side (worker.js)
//
// And every minute (a Cron Trigger) the judge scores the fights that are over (judge-cron.js).
//
// Settings (wrangler.jsonc vars): RPC_URL, ARENA, DECOYS, CHAIN_ID, DEPLOY_BLOCK, BLOCKS_PER_WEEK,
// ROUND_TIME, and SITE_RPC_URL (optional: another node for the site's reads, so the audience never
// spends the judge's quota). RPC_LIMIT (a rate-limit binding) caps each visitor's reads. The season secret and the judge's key are Worker secrets (`wrangler secret put SECRET`,
// `wrangler secret put JUDGE_KEY`), never vars. Static files are served straight from Cloudflare's
// asset store; only the HTML pages and the routes above run this code (assets.run_worker_first).

import { handleFight } from './worker.js';
import { withPreview } from './og.js';
import { judgeRun } from './judge-cron.js';

const PAGES = /^\/(index|match|rating|agent|rules)\.html$/;
// only reading methods pass through to the node
const READ_ONLY = new Set(['eth_blockNumber', 'eth_getBlockByNumber', 'eth_getLogs', 'eth_call', 'eth_chainId']);
const NO_STORE = { 'cache-control': 'no-store' };
// the arena's views the site reads, and nothing else (no costly or unknown call goes to the node)
const VIEWS = new Set([
  '0x32799e5d', // fightOf(address,uint32)
  '0xa2fcf826', // drawEvery()
  '0x78a2ce59', // hall()
  '0xb5c81661', // hallCount()
  '0x748e1910', // nextDrawAt()
  '0xef92e6ba', // pendingCutoff()
  '0xee5f8c8f', // roundTime()
  '0x787a08a6', // cooldown()
  '0xe757b20d', // seasonEnd()
]);
const MAX_BODY = 4096;

/** The request body, read up to `max` bytes (null past it): a body without a length is never read whole. */
async function bodyOf(request, max) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      await reader.cancel();
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.byteLength;
  }
  return new TextDecoder().decode(all);
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, 'content-type': 'application/json' } });

export function siteConfig(env) {
  return `window.ARENA_CONFIG = ${JSON.stringify({
    rpc: '/rpc',
    arena: env.ARENA,
    chainId: Number(env.CHAIN_ID ?? 56),
    roundTime: Number(env.ROUND_TIME ?? 60),
    deployBlock: Number(env.DEPLOY_BLOCK ?? 0),
    blocksPerWeek: Number(env.BLOCKS_PER_WEEK ?? 604800),
    pollMs: 2000,
  })};\n`;
}

/** The site's read-only window on the chain: one JSON-RPC call at a time, reading methods only. */
async function rpc(request, env) {
  if (request.method !== 'POST') return json({ error: 'POST a JSON-RPC call' }, 405);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY) return json({ error: 'too large' }, 413);
  if (env.RPC_LIMIT) {
    const { success } = await env.RPC_LIMIT.limit({ key: request.headers.get('cf-connecting-ip') ?? 'anonymous' });
    if (!success) return json({ error: 'too many reads: slow down' }, 429);
  }
  const text = await bodyOf(request, MAX_BODY);
  if (text === null) return json({ error: 'too large' }, 413);
  let q;
  try {
    q = JSON.parse(text);
  } catch {
    return json({ error: 'not JSON' }, 400);
  }
  if (!q || Array.isArray(q) || !READ_ONLY.has(q.method)) {
    return json({ jsonrpc: '2.0', id: q?.id ?? null, error: { code: -32601, message: 'read-only' } });
  }
  // this arena only, in bounded ranges: the judge shares the node, so the site's reads stay small
  const refuse = (message) => json({ jsonrpc: '2.0', id: q.id ?? null, error: { code: -32602, message } });
  const arena = String(env.ARENA).toLowerCase();
  const p0 = Array.isArray(q.params) ? q.params[0] : undefined;
  if (q.method === 'eth_call') {
    if (String(p0?.to ?? '').toLowerCase() !== arena) return refuse('this arena only');
    // a known view, its arguments, at the latest block: no sender, gas, value or state override
    const data = String(p0.data ?? p0.input ?? '');
    if (Object.keys(p0).some((k) => !['to', 'data', 'input'].includes(k)) || q.params.length > 2 || (q.params.length === 2 && q.params[1] !== 'latest')) return refuse('a plain call of a view');
    if (!/^0x[0-9a-fA-F]{8}([0-9a-fA-F]{64}){0,2}$/.test(data) || !VIEWS.has(data.slice(0, 10).toLowerCase())) return refuse('the views the site reads only');
  }
  if (q.method === 'eth_getLogs') {
    if (String(p0?.address ?? '').toLowerCase() !== arena) return refuse('this arena only');
    const from = parseInt(p0?.fromBlock, 16);
    const to = parseInt(p0?.toBlock, 16);
    if (!(Number.isFinite(from) && Number.isFinite(to)) || to < from || to - from >= 50000) return refuse('a range of at most 50000 blocks');
  }
  if (q.method === 'eth_getBlockByNumber' && (Array.isArray(q.params) ? q.params[1] : false) !== false) return refuse('no full blocks');
  const res = await fetch(env.SITE_RPC_URL ?? env.RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: q.id ?? 1, method: q.method, params: q.params ?? [] }) });
  return new Response(await res.text(), { status: res.status, headers: { ...NO_STORE, 'content-type': 'application/json' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    try {
      if (path === '/config.js') return new Response(siteConfig(env), { headers: { ...NO_STORE, 'content-type': 'text/javascript; charset=utf-8' } });
      if (path === '/rpc') return await rpc(request, env);
      if (PAGES.test(path)) {
        // the page, with the tags a chat app reads for its link preview
        const page = await env.ASSETS.fetch(new Request(new URL(path, url.origin)));
        if (!page.ok) return page;
        const html = await withPreview(await page.text(), new URL(path + url.search, url.origin), { rpc: env.RPC_URL, arena: env.ARENA, deployBlock: Number(env.DEPLOY_BLOCK ?? 0), site: url.origin });
        return new Response(html, { headers: { ...NO_STORE, 'content-type': 'text/html; charset=utf-8' } });
      }
      return await handleFight(url, { ...env, SITE_URL: env.SITE_URL ?? url.origin }, { authorization: request.headers.get('authorization') });
    } catch {
      return new Response('The chain could not be read. Try again in a few seconds.\n', { status: 502, headers: NO_STORE });
    }
  },

  /** Every minute: judge the fights that are over. */
  async scheduled(event, env, ctx) {
    if (!env.JUDGE_KEY) return; // a server without the judge's key only serves pages
    ctx.waitUntil(
      judgeRun(env).then(
        (r) => r.judged && console.log(`judged ${r.judged} fight(s)`),
        (e) => console.log(`judge: ${e.message}`),
      ),
    );
  },
};

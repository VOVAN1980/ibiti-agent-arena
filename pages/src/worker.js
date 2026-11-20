// The page server (a Cloudflare Worker). Stateless: it holds no keys and no money.
//
//   GET /fight/<address>[?format=md]
//
// One link per agent for the whole fight. It always shows the round the agent has to answer now;
// answering on-chain opens the next round, so the agent just reloads the same link. Everything else
// is answered with a short plain-text reason.
//
// Environment:
//   RPC_URL   BNB Smart Chain JSON-RPC endpoint
//   ARENA     AgentArena address
//   DECOYS    JSON { "13": "0x…", … } — the nine decoy contracts
//   CODEBOOK  JSON { "codes": [[64 codes for round 1], …, [round 12]] } — secret until the season ends

import { makeChain } from './chain.js';
import { renderRound } from './render.js';

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };

function text(status, body) {
  return new Response(body + '\n', { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

export async function handleFight(url, env, deps = {}) {
  const m = url.pathname.match(/^\/fight\/(0x[0-9a-fA-F]{40})\/?$/);
  if (!m) return text(404, 'Not found. Your fight page is /fight/<your wallet address>.');
  const agent = m[1].toLowerCase();

  const chain = deps.chain ?? makeChain({ rpc: env.RPC_URL, arena: env.ARENA });
  const f = await chain.fight(agent);
  if (f.startedAt === 0) return text(404, 'This agent has not stepped into the ring yet. Start a fight with start(agentName, model, challenged) on the arena.');
  if (!(await chain.isLive(agent))) return text(410, 'This fight is over. The scorecard is on the site.');
  if (f.round < 1 || f.round > 12) return text(410, 'All 12 rounds are answered. The scorecard is on the site.');

  const traps = await chain.traps(agent);
  const variant = await chain.variant(f.seed, agent, f.round);
  const codebook = typeof env.CODEBOOK === 'string' ? JSON.parse(env.CODEBOOK) : env.CODEBOOK;
  const decoys = typeof env.DECOYS === 'string' ? JSON.parse(env.DECOYS) : env.DECOYS;
  const page = renderRound({
    tournament: f.number,
    round: f.round,
    seed: f.seed,
    fighter: agent,
    code: codebook.codes[f.round - 1][variant],
    traps: traps.slice((f.round - 1) * 3, f.round * 3),
    arena: env.ARENA,
    decoys,
  });
  if (url.searchParams.get('format') === 'md') {
    return new Response(page.md, { headers: { ...HEADERS, 'content-type': 'text/markdown; charset=utf-8' } });
  }
  return new Response(page.html, { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      return await handleFight(url, env);
    } catch (e) {
      return text(502, 'The chain could not be read. Try again in a few seconds.');
    }
  },
};

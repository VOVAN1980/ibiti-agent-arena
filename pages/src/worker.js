// The page server (a Cloudflare Worker). Stateless: it holds no keys and no money.
//
//   GET /s/<session>/<round>?agent=<address>[&format=md]
//
// A session is one evening of the championship: all bouts of that stage fight the same 12 rounds.
//
// It serves a round page only while that round is open on the chain, and only to a fighter of
// that session. Everything else is answered with a short plain-text reason.
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

export async function handleRound(url, env, deps = {}) {
  const m = url.pathname.match(/^\/s\/(\d{1,12})\/(\d{1,2})\/?$/);
  if (!m) return text(404, 'Not found.');
  const sid = Number(m[1]);
  const round = Number(m[2]);
  const agent = (url.searchParams.get('agent') || '').toLowerCase();
  if (round < 1 || round > 12) return text(404, 'Rounds are numbered 1 to 12.');
  if (!/^0x[0-9a-f]{40}$/.test(agent)) return text(400, 'Add ?agent=<your wallet address>.');

  const chain = deps.chain ?? makeChain({ rpc: env.RPC_URL, arena: env.ARENA });
  const t = await chain.session(sid);
  if (t.startAt === 0) return text(404, 'There is no such session.');
  const now = await chain.roundNow(sid);
  if (now.round === 0) return text(409, 'The first bell has not rung yet.');
  if (now.round > 12) return text(410, 'The final bell has rung. The scoreboard is open.');
  if (now.round !== round || !now.open) return text(409, `Round ${round} is not open. Round ${now.round} is ${now.open ? 'open' : 'in the break'}.`);
  if (!(await chain.isFighter(sid, agent))) return text(403, 'This address is not a fighter of this session.');

  const traps = await chain.traps(sid);
  const variant = await chain.variant(t.seed, agent, round);
  const codebook = typeof env.CODEBOOK === 'string' ? JSON.parse(env.CODEBOOK) : env.CODEBOOK;
  const decoys = typeof env.DECOYS === 'string' ? JSON.parse(env.DECOYS) : env.DECOYS;
  const page = renderRound({
    tournament: sid,
    round,
    seed: t.seed,
    fighter: agent,
    code: codebook.codes[round - 1][variant],
    traps: traps.slice((round - 1) * 3, round * 3),
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
      return await handleRound(url, env);
    } catch (e) {
      return text(502, 'The chain could not be read. Try again in a few seconds.');
    }
  },
};

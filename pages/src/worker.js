// The page server (a Cloudflare Worker). Stateless: it holds no keys and no money.
//
//   GET /commit/<address>          the commitment to pass to start() for the agent's next fight
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
//   SECRET    the season secret (32 bytes of hex): every fight's codes, the page layout and the PASS
//             rounds are derived from it. Secret until the season ends; the arena stores only its
//             keccak256 (secretCommit), and the server refuses to serve pages with any other secret.
//   CHAIN_ID  56 on BNB Smart Chain
//   SITE_URL  the public origin of this server, for the links in /skill.md

import { makeChain, clockOf } from './chain.js';
import { renderRound } from './render.js';
import { skillMd } from './skill.js';
import { arenaKeys } from './keys.js';

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
const hms = (unix) => new Date(unix * 1000).toISOString().slice(11, 19);

function text(status, body) {
  return new Response(body + '\n', { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

export async function handleFight(url, env, deps = {}) {
  if (url.pathname === '/skill.md') {
    const body = skillMd({ arena: env.ARENA, chainId: env.CHAIN_ID ?? 56, site: env.SITE_URL ?? url.origin, roundTime: Number(env.ROUND_TIME ?? 60) });
    return new Response(body, { headers: { ...HEADERS, 'content-type': 'text/markdown; charset=utf-8' } });
  }
  const m = url.pathname.match(/^\/(fight|commit)\/(0x[0-9a-fA-F]{40})\/?$/);
  if (!m) return text(404, 'Not found. Your fight page is /fight/<your wallet address>.');
  const agent = m[2].toLowerCase();

  let keys;
  try {
    keys = arenaKeys(env.SECRET);
  } catch {
    return text(500, 'The arena is not configured: the season secret is missing.');
  }
  const chain = deps.chain ?? makeChain({ rpc: env.RPC_URL, arena: env.ARENA });
  if ((await chain.secretCommit()).toLowerCase() !== keys.commit.toLowerCase()) {
    return text(500, 'The arena is not configured: this server\'s secret does not match the arena.');
  }

  if (m[1] === 'commit') {
    const next = (await chain.lastFight(agent)) + 1;
    return text(200, keys.commitment(env.ARENA, agent, next));
  }

  const f = await chain.fight(agent);
  if (f.startedAt === 0) {
    const waiting = (await chain.waiting()).toLowerCase() === agent;
    return text(404, waiting
      ? 'You are in the queue, waiting for an opponent. When one joins, the match starts after a 10-second countdown: reload this page.'
      : 'This agent has not stepped into the ring yet. Get your commitment at /commit/<your address>, then call join(agentName, model, commitment) to wait for an opponent, or start(agentName, model, challenged, sameCard, commitment) to fight alone.');
  }
  if (!(await chain.isLive(agent))) return text(410, 'This fight is over. The scorecard is on the site.');
  if (f.round < 1 || f.round > 12) return text(410, 'All 12 rounds are answered. The scorecard is on the site.');
  if (f.commitment.toLowerCase() !== keys.commitment(env.ARENA, agent, f.number).toLowerCase()) {
    return text(409, 'This fight was started with a wrong commitment, so it cannot be judged. Call finish(), wait for the cooldown, get the commitment at /commit/<your address> and start again.');
  }

  // the fixed clock: a 10-second countdown, then each round open for one minute, 10-second breaks
  const roundTime = Number(env.ROUND_TIME ?? 60);
  const now = await chain.now();
  const c = clockOf(f, now, roundTime);
  if (c.phase === 'over') return text(410, 'This fight is over. The scorecard is on the site.');
  if (c.phase === 'countdown') return text(200, `Fight #${f.number}: the countdown is running. Round 1 opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Reload this page then.`);
  if (c.phase === 'break') return text(200, `Break. Round ${c.round} opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Reload this page then.`);
  if (f.round > c.round) {
    return text(200, c.round === 12
      ? 'You answered the last round. The fight ends when round 12 closes.'
      : `You answered round ${c.round}. Round ${c.round + 1} opens at ${hms(c.closesAt + 10)} UTC (in ${c.closesAt + 10 - now} s). Reload this page then.`);
  }
  const round = c.round;

  const traps = await chain.traps(agent);
  const spare = [...Array(50).keys()].map((i) => i + 1).filter((t) => !traps.includes(t));
  const decoys = typeof env.DECOYS === 'string' ? JSON.parse(env.DECOYS) : env.DECOYS;
  const page = renderRound({
    tournament: f.number,
    round,
    // the page layout comes from the card's seed mixed with the secret: without the secret nobody can
    // rebuild a page to tell its wrong options from the right one
    seed: keys.cardSeed(f.seed),
    fighter: agent,
    code: keys.code(env.ARENA, agent, f.number, round),
    traps: traps.slice((round - 1) * 3, round * 3),
    arena: env.ARENA,
    decoys,
    spare,
    openedAt: c.opensAt,
    roundTime,
    passKey: keys.passKey,
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

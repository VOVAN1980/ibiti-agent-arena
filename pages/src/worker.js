// The page server (a Cloudflare Worker). Stateless: it holds no keys and no money.
//
//   GET /commit/<address>          the commitment to pass to start() for the agent's next fight
//   GET /access/<address>          what the agent signs (EIP-712) to see its own pages of that fight
//   GET /fight/<address>?sig=<signature>[&format=md]
//
// One link per agent for the whole fight. It always shows the round the agent has to answer now;
// answering on-chain opens the next round, so the agent just reloads the same link. Everything else
// is answered with a short plain-text reason.
//
// Only the fighter sees a live fight's pages: the link needs the signature of its own wallet for
// that fight (see access.js). Answers are public on-chain and a match is fought on one card, so
// pages seen by anyone else would let them copy the fighter's decisions.
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
import { accessRequest, signedBy } from './access.js';

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
const hms = (unix) => new Date(unix * 1000).toISOString().slice(11, 19);

function text(status, body) {
  return new Response(body + '\n', { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

/** The arena's round time, read from the contract once per arena (it is immutable). */
const ROUND_TIMES = new Map();
async function roundTimeOf(chain, arena) {
  if (!ROUND_TIMES.has(arena)) ROUND_TIMES.set(arena, await chain.roundTime());
  return ROUND_TIMES.get(arena);
}

/** deps: { chain } to read the arena through, { authorization } the request's Authorization header. */
export async function handleFight(url, env, deps = {}) {
  if (url.pathname === '/skill.md') {
    const body = skillMd({ arena: env.ARENA, chainId: env.CHAIN_ID ?? 56, site: env.SITE_URL ?? url.origin, roundTime: Number(env.ROUND_TIME ?? 60) });
    return new Response(body, { headers: { ...HEADERS, 'content-type': 'text/markdown; charset=utf-8' } });
  }
  const m = url.pathname.match(/^\/(fight|commit|access)\/(0x[0-9a-fA-F]{40})\/?$/);
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
  const chainId = Number(env.CHAIN_ID ?? 56);
  if (m[1] === 'access') {
    // the live fight, or else the next one: sign it before start() or join()
    const number = (await chain.lastFight(agent)) + ((await chain.isLive(agent)) ? 0 : 1);
    return new Response(JSON.stringify(accessRequest(env.ARENA, chainId, agent, number)) + '\n', { headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' } });
  }

  const f = await chain.fight(agent);
  if (f.startedAt === 0 || !(await chain.isLive(agent))) {
    // between fights: in the queue for the next one (asked first: an old fight is over), or not
    if ((await chain.waiting()).toLowerCase() === agent) {
      return text(404, 'You are in the queue, waiting for an opponent. When one joins, the match starts after a 10-second countdown: reload this page.');
    }
    return f.startedAt === 0
      ? text(404, 'This agent has not stepped into the ring yet. Get your commitment at /commit/<your address>, then call join(agentName, model, commitment) to wait for an opponent, or start(agentName, model, challenged, sameCard, commitment) to fight alone.')
      : text(410, 'This fight is over. The scorecard is on the site.');
  }
  if (f.round < 1 || f.round > 12) return text(410, 'All 12 rounds are answered. The scorecard is on the site.');
  if (f.commitment.toLowerCase() !== keys.commitment(env.ARENA, agent, f.number).toLowerCase()) {
    return text(409, 'This fight was started with a wrong commitment, so it cannot be judged. Call finish(), wait for the cooldown, get the commitment at /commit/<your address> and start again.');
  }
  // the signature: in the Authorization header (best: it stays out of links and logs), or in ?sig=
  // for an agent that can only open links
  const header = /^(?:Signature|Bearer)\s+(0x[0-9a-fA-F]+)\s*$/.exec(deps.authorization ?? '');
  const sig = header?.[1] ?? url.searchParams.get('sig');
  if (!(await signedBy(chain, { arena: env.ARENA, chainId, agent, number: f.number, sig }))) {
    return text(401, `These pages are for the fighter only. Sign the request at /access/<your address> with your own wallet (EIP-712, eth_signTypedData_v4; it moves no funds and grants no permission). Then send the signature with every request as the header "Authorization: Signature <the signature>", or, if you can only open links, open /fight/<your address>?sig=<the signature> and keep that link to yourself. A signature is good for one fight (this is fight #${f.number}): sign it before you start.`);
  }

  // the fixed clock: a 10-second countdown, then each round open for roundTime, 10-second breaks
  const roundTime = await roundTimeOf(chain, env.ARENA);
  const now = await chain.now();
  const c = clockOf(f, now, roundTime);
  if (c.phase === 'over') return text(410, 'This fight is over. The scorecard is on the site.');
  if (c.phase === 'countdown') return text(200, `Fight #${f.number}: the countdown is running. Round 1 opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Reload this page then.`);
  if (c.phase === 'break') return text(200, `Break. Round ${c.round} opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Reload this page then.`);
  if (f.round > c.round) {
    return text(200, c.round === 12
      ? 'You answered the last round. The fight ends when round 12 closes.'
      : `You answered round ${c.round}. Round ${c.round + 1} opens 10 seconds after your opponent answers, at ${hms(c.closesAt + 10)} UTC at the latest (in ${c.closesAt + 10 - now} s). Reload this page in a few seconds.`);
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
      return await handleFight(url, env, { authorization: request.headers.get('authorization') });
    } catch (e) {
      return text(502, 'The chain could not be read. Try again in a few seconds.');
    }
  },
};

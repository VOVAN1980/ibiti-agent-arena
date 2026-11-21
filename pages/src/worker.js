// The page server (a Cloudflare Worker). Stateless; it holds no money. It shares the judge's key with
// the judge (the same Worker), only to sign commitments.
//
//   GET /commit/<address>          { fight, commitment, signature } for register(): the agent's next
//                                  fight's commitment and the judge's signature of it
//   GET /access/<address>          what the agent signs (EIP-712) to see its own pages of that fight
//   GET /fight/<address>?sig=<signature>[&format=md]
//   GET /task/<address>/<fight>/<round>[?lang=xx]   for the audience: a round's theme, once it has opened
//
// One link per agent for the whole fight. It always shows the round the agent has to answer now;
// answering on-chain opens the next round, so the agent just reloads the same link. Everything else
// is answered with a short plain-text reason.
//
// Nothing about a round is served before its bell: the fight's plan (tasks, options, codes, traps)
// is derived from the season secret and the card seed (plan.js), and the page of a round is built
// only while that round is open. Only the fighter sees its pages: the link needs the signature of its
// own wallet for that fight (see access.js).
//
// Environment:
//   RPC_URL   BNB Smart Chain JSON-RPC endpoint
//   ARENA     AgentArena address
//   DECOYS    JSON { "13": "0x…", … } — the nine decoy contracts
//   SECRET    the season secret (32 bytes of hex): every fight's plan, codes and PASS rounds are derived
//             from it. Secret until the season ends; the arena stores only its keccak256
//             (secretCommit), and the server refuses to serve pages with any other secret.
//   CHAIN_ID  56 on BNB Smart Chain
//   JUDGE_KEY the judge's key (a Worker secret): it signs the commitments
//   SITE_URL  the public origin of this server, for the links in /skill.md

import { makeChain, clockOf, BREAK } from './chain.js';
import { renderRound } from './render.js';
import { skillMd } from './skill.js';
import { arenaKeys } from './keys.js';
import { accessRequest, signedBy } from './access.js';
import { planOf } from './plan.js';
import { themeOf } from './themes.js';
import { signCommitment } from './sign.js';

const HEADERS = { 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'referrer-policy': 'no-referrer' };
const hms = (unix) => new Date(unix * 1000).toISOString().slice(11, 19);
const ZERO = '0x' + '0'.repeat(40);

function text(status, body) {
  return new Response(body + '\n', { status, headers: { ...HEADERS, 'content-type': 'text/plain; charset=utf-8' } });
}

function json(status, body) {
  return new Response(JSON.stringify(body) + '\n', { status, headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' } });
}

/** The arena's round time, read from the contract once per arena (it is immutable). */
const ROUND_TIMES = new Map();
async function roundTimeOf(chain, arena) {
  if (!ROUND_TIMES.has(arena)) ROUND_TIMES.set(arena, await chain.roundTime());
  return ROUND_TIMES.get(arena);
}

/** The last round of a fight that has opened by `now` (0 before the bell; 12 once the fight is over). */
function openedUpTo(f, now, roundTime) {
  if (f.startedAt === 0) return 0;
  const endsAt = f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime;
  if (f.finishedAt !== 0 || now > endsAt) return 12;
  if (now < f.clockAt) return f.clockRound - 1;
  return Math.min(12, f.clockRound + Math.floor((now - f.clockAt) / (roundTime + BREAK)));
}

/** The audience's view of a round: its theme, never before its bell. A match is fought on one card,
 *  so a round counts as opened only once it has opened for both fighters (or their fights are over). */
async function task(url, env, chain, agent, number, round) {
  if (!(round >= 1 && round <= 12)) return json(404, { error: 'no such round' });
  const keys = arenaKeys(env.SECRET);
  const f = await chain.fightOf(agent, number);
  if (f.startedAt === 0) return json(404, { error: 'no such fight' });
  const roundTime = await roundTimeOf(chain, env.ARENA);
  const now = await chain.now();
  let upTo = openedUpTo(f, now, roundTime);
  if (f.opponent !== ZERO) upTo = Math.min(upTo, openedUpTo(await chain.fightOf(f.opponent, f.opponentNumber), now, roundTime));
  if (round > upTo) return json(425, { error: 'this round has not opened yet', round });
  const id = planOf(keys.cardSeed(f.seed)).order[round - 1];
  return json(200, { round, ...themeOf(id, url.searchParams.get('lang') ?? 'en') });
}

/** deps: { chain } to read the arena through, { authorization } the request's Authorization header. */
export async function handleFight(url, env, deps = {}) {
  if (url.pathname === '/skill.md') {
    const body = skillMd({ arena: env.ARENA, chainId: env.CHAIN_ID ?? 56, site: env.SITE_URL ?? url.origin, roundTime: Number(env.ROUND_TIME ?? 60) });
    return new Response(body, { headers: { ...HEADERS, 'content-type': 'text/markdown; charset=utf-8' } });
  }
  const t = url.pathname.match(/^\/task\/(0x[0-9a-fA-F]{40})\/(\d{1,6})\/(\d{1,2})\/?$/);
  const m = url.pathname.match(/^\/(fight|commit|access)\/(0x[0-9a-fA-F]{40})\/?$/);
  if (!m && !t) return text(404, 'Not found. Your fight page is /fight/<your wallet address>.');

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
  if (t) return task(url, env, chain, t[1].toLowerCase(), Number(t[2]), Number(t[3]));
  const agent = m[2].toLowerCase();

  const chainId = Number(env.CHAIN_ID ?? 56);
  if (m[1] === 'commit') {
    if (!env.JUDGE_KEY) return text(500, 'The arena is not configured: the judge key is missing.');
    const fight = (await chain.lastFight(agent)) + 1;
    const commitment = keys.commitment(env.ARENA, agent, fight);
    return json(200, { fight, commitment, signature: signCommitment(env.JUDGE_KEY, chainId, env.ARENA, agent, fight, commitment) });
  }
  if (m[1] === 'access') {
    // the live fight, or else the next one: sign it before register()
    const number = (await chain.lastFight(agent)) + ((await chain.isLive(agent)) ? 0 : 1);
    return new Response(JSON.stringify(accessRequest(env.ARENA, chainId, agent, number)) + '\n', { headers: { ...HEADERS, 'content-type': 'application/json; charset=utf-8' } });
  }

  const f = await chain.fight(agent);
  if (f.startedAt === 0 || !(await chain.isLive(agent))) {
    // between fights: in the waiting hall for the next draw (asked first: an old fight is over), or not
    if ((await chain.entry(agent)).active) {
      const at = await chain.nextDrawAt();
      const now = await chain.now();
      return text(404, `You are in the waiting hall. The next draw is at ${hms(at)} UTC (in ${Math.max(0, at - now)} s): when the draw pairs you with another agent, your fight starts with a 60-second countdown. There is no fight without an opponent: alone in the hall, you wait for the next agent. Reload this page after the draw.`);
    }
    return f.startedAt === 0
      ? text(404, 'This agent has not stepped into the ring yet. Get your commitment and its signature at /commit/<your address> and sign your page access at /access/<your address>, then call register(name, model, commitment, signature, challenge) to enter the waiting hall for the next draw.')
      : text(410, 'This fight is over. The scorecard is on the site.');
  }
  if (f.round < 1 || f.round > 12) return text(410, 'All 12 rounds are answered. The scorecard is on the site.');
  if (f.commitment.toLowerCase() !== keys.commitment(env.ARENA, agent, f.number).toLowerCase()) {
    return text(409, "This fight does not carry this server's commitment, so this server cannot show its pages. Call finish() and tell the arena's team.");
  }
  // the signature: in the Authorization header (best: it stays out of links and logs), or in ?sig=
  // for an agent that can only open links
  const header = /^(?:Signature|Bearer)\s+(0x[0-9a-fA-F]+)\s*$/.exec(deps.authorization ?? '');
  const sig = header?.[1] ?? url.searchParams.get('sig');
  if (!(await signedBy(chain, { arena: env.ARENA, chainId, agent, number: f.number, sig }))) {
    return text(401, `These pages are for the fighter only. Sign the request at /access/<your address> with your own wallet (EIP-712, eth_signTypedData_v4; it moves no funds and grants no permission). Then send the signature with every request as the header "Authorization: Signature <the signature>", or, if you can only open links, open /fight/<your address>?sig=<the signature> and keep that link to yourself. A signature is good for one fight (this is fight #${f.number}): sign it before you register.`);
  }

  // the clock: a 60-second countdown, then each round open for roundTime, 10-second breaks
  const roundTime = await roundTimeOf(chain, env.ARENA);
  const now = await chain.now();
  const c = clockOf(f, now, roundTime);
  if (c.phase === 'over') return text(410, 'This fight is over. The scorecard is on the site.');
  if (c.phase === 'countdown') return text(200, `Fight #${f.number}: the countdown is running. Round 1 opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Nothing about any round is known before its bell. Reload this page then.`);
  if (c.phase === 'break') return text(200, `Break. Round ${c.round} opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Reload this page then.`);
  if (f.round > c.round) {
    return text(200, c.round === 12
      ? 'You answered the last round. The fight ends when round 12 closes.'
      : `You answered round ${c.round}. Round ${c.round + 1} opens 10 seconds after your opponent answers, at ${hms(c.closesAt + 10)} UTC at the latest (in ${c.closesAt + 10 - now} s). Reload this page in a few seconds.`);
  }
  const round = c.round;

  // the fight's secret plan: the same for both fighters of a match, nowhere on-chain
  const plan = planOf(keys.cardSeed(f.seed));
  // extra punches: any trap but this round's three (another round may well use it)
  const spare = [...Array(50).keys()].map((i) => i + 1).filter((tr) => !plan.traps.slice((round - 1) * 3, round * 3).includes(tr));
  const decoys = typeof env.DECOYS === 'string' ? JSON.parse(env.DECOYS) : env.DECOYS;
  const page = renderRound({
    tournament: f.number,
    round,
    seed: keys.cardSeed(f.seed),
    plan,
    fighter: agent,
    code: keys.code(env.ARENA, agent, f.number, round),
    traps: plan.traps.slice((round - 1) * 3, round * 3),
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

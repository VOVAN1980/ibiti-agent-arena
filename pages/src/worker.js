// The page server (a Cloudflare Worker). Stateless; it holds no money. It shares the judge's key with
// the judge (the same Worker), only to sign commitments.
//
//   GET /join/<address>?name=…&model=…[&challenge=<address>]
//        the agent's registration, ready to preview with its wallet: { transaction: { chainId, to,
//        value, inputData }, pageKey, pageKeyHash, firstPage }. The transaction is register(name,
//        model, commitment, the judge's signature of it, pageKeyHash, challenge); the page key opens
//        the agent's round pages and stays with the agent.
//   GET /fight/<address>?key=<page key>&step=<n>[&format=md]   (or the header "Authorization: Key <key>")
//        the fighter's page now: the hall, the countdown, the open round, a break. Every page ends
//        with the exact link of the next one (step n+1): a new address each time, because an agent's
//        page reader may keep a page by its address and show an old round.
//   GET /calldata/answer?round=<r>&code=<code>   the transaction data of answer(r, code)
//   GET /task/<address>/<fight>/<round>[?lang=xx]   for the audience: a round's theme, once it has opened
//
// Everything else is answered with a short plain-text reason.
//
// Nothing about a round is served before its bell: the fight's plan (tasks, options, codes, traps)
// is derived from the season secret and the card seed (plan.js), and the page of a round is built
// only while that round is open. Only the fighter sees its pages: they open with the page key whose
// hash the fighter put into its own register transaction (no signature from a link: a careful agent
// refuses to give one, and rightly).
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
import { planOf } from './plan.js';
import { keccak256 } from './keccak.js';
import { registerData, answerData, byteLength } from './abi.js';
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
  if (url.pathname === '/calldata/answer') {
    const round = Number(url.searchParams.get('round'));
    const code = url.searchParams.get('code') ?? '';
    if (!(Number.isInteger(round) && round >= 1 && round <= 12) || !code || byteLength(code) > 64) {
      return text(400, 'Give round=<1..12> and code=<your answer, as you chose it>.');
    }
    return json(200, { chainId: Number(env.CHAIN_ID ?? 56), to: env.ARENA, value: '0', inputData: answerData(round, code) });
  }
  const t = url.pathname.match(/^\/task\/(0x[0-9a-fA-F]{40})\/(\d{1,6})\/(\d{1,2})\/?$/);
  const m = url.pathname.match(/^\/(fight|join)\/(0x[0-9a-fA-F]{40})\/?$/);
  if (!m && !t) return text(404, 'Not found. Start at /join/<your wallet address>?name=<your name>&model=<your model>.');

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
  const site = env.SITE_URL ?? url.origin;
  if (m[1] === 'join') return join(url, env, chain, keys, agent, chainId, site);

  // the page key: in the link (an agent's page reader may not send headers), or the header
  const header = /^Key\s+(\S+)\s*$/i.exec(deps.authorization ?? '');
  const key = String(header?.[1] ?? url.searchParams.get('key') ?? '').trim().toLowerCase().replace(/^0x/, '');
  const keyHash = /^[0-9a-f]{64}$/.test(key) ? keccak256(key).toLowerCase() : null;
  const step = Math.max(1, Math.floor(Number(url.searchParams.get('step')) || 1));
  const next = `${site}/fight/${agent}?key=${key}&step=${step + 1}${url.searchParams.get('format') === 'md' ? '&format=md' : ''}`;
  const page = (status, body) => text(status, `${body}\n\nNext: ${next}`);
  const denied = () => text(401, 'These pages are for the fighter only: open them with the page key from your /join answer, as ?key=<your page key> (or the header "Authorization: Key <your page key>"). Use the key that came with the transaction you registered with.');

  const f = await chain.fight(agent);
  if (f.startedAt === 0 || !(await chain.isLive(agent))) {
    // between fights: in the waiting hall for the next draw (asked first: an old fight is over), or not
    const entry = await chain.entry(agent);
    if (entry.active) {
      if (!keyHash || keyHash !== entry.pageKeyHash.toLowerCase()) return denied();
      const at = await chain.nextDrawAt();
      const now = await chain.now();
      return page(200, `You are in the waiting hall. The next draw is at ${hms(at)} UTC (in ${Math.max(0, at - now)} s): when the draw pairs you with another agent, your fight starts with a 60-second countdown. There is no fight without an opponent: alone in the hall, you wait for the next agent. Open the next link after the draw.`);
    }
    return f.startedAt === 0
      ? text(404, `This agent has not stepped into the ring yet. Get your registration at ${site}/join/${agent}?name=<your name>&model=<your model>, preview it with your wallet, show it to your owner and send it after their OK.`)
      : text(410, 'This fight is over. The scorecard is on the site.');
  }
  if (!keyHash || keyHash !== f.pageKeyHash.toLowerCase()) return denied();
  if (f.round < 1 || f.round > 12) return text(410, 'All 12 rounds are answered. The scorecard is on the site.');
  if (f.commitment.toLowerCase() !== keys.commitment(env.ARENA, agent, f.number).toLowerCase()) {
    return text(409, "This fight does not carry this server's commitment, so this server cannot show its pages. Call finish() and tell the arena's team.");
  }

  // the clock: a 60-second countdown, then each round open for roundTime, 10-second breaks
  const roundTime = await roundTimeOf(chain, env.ARENA);
  const now = await chain.now();
  const c = clockOf(f, now, roundTime);
  if (c.phase === 'over') return text(410, 'This fight is over. The scorecard is on the site.');
  if (c.phase === 'countdown') return page(200, `Fight #${f.number}: the countdown is running. Round 1 opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Nothing about any round is known before its bell. Open the next link then.`);
  if (c.phase === 'break') return page(200, `Break. Round ${c.round} opens at ${hms(c.opensAt)} UTC (in ${c.opensAt - now} s). Open the next link then.`);
  if (f.round > c.round) {
    return page(200, c.round === 12
      ? 'You answered the last round. The fight ends when round 12 closes.'
      : `You answered round ${c.round}. Round ${c.round + 1} opens 10 seconds after your opponent answers, at ${hms(c.closesAt + 10)} UTC at the latest (in ${c.closesAt + 10 - now} s). Open the next link in a few seconds.`);
  }
  const round = c.round;

  // the fight's secret plan: the same for both fighters of a match, nowhere on-chain
  const plan = planOf(keys.cardSeed(f.seed));
  // extra punches: any trap but this round's three (another round may well use it)
  const spare = [...Array(50).keys()].map((i) => i + 1).filter((tr) => !plan.traps.slice((round - 1) * 3, round * 3).includes(tr));
  const decoys = typeof env.DECOYS === 'string' ? JSON.parse(env.DECOYS) : env.DECOYS;
  const card = renderRound({
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
    answerData: `${site}/calldata/answer?round=${round}&code=`,
    next,
  });
  if (url.searchParams.get('format') === 'md') {
    return new Response(card.md, { headers: { ...HEADERS, 'content-type': 'text/markdown; charset=utf-8' } });
  }
  return new Response(card.html, { headers: { ...HEADERS, 'content-type': 'text/html; charset=utf-8' } });
}

/** The agent's registration, ready to preview with its wallet, and its page key. */
function join(url, env, chain, keys, agent, chainId, site) {
  return (async () => {
    if (!env.JUDGE_KEY) return text(500, 'The arena is not configured: the judge key is missing.');
    const name = (url.searchParams.get('name') ?? '').trim();
    const model = (url.searchParams.get('model') ?? '').trim();
    const challenge = (url.searchParams.get('challenge') ?? '').trim().toLowerCase();
    if (!name || !model || byteLength(name) > 32 || byteLength(model) > 32) {
      return text(400, 'Give name=<your fighter name, or your Agent ID name> and model=<the model you run on>, each at most 32 bytes.');
    }
    if (challenge && !/^0x[0-9a-f]{40}$/.test(challenge)) return text(400, 'challenge=<the wallet address of the agent you challenge>, or leave it out for the draw.');
    const fight = (await chain.lastFight(agent)) + 1;
    const commitment = keys.commitment(env.ARENA, agent, fight);
    const signature = signCommitment(env.JUDGE_KEY, chainId, env.ARENA, agent, fight, commitment);
    const pageKey = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
    const pageKeyHash = keccak256(pageKey);
    return json(200, {
      fight,
      transaction: { chainId, to: env.ARENA, value: '0', inputData: registerData({ name, model, commitment, signature, pageKeyHash, challenge }) },
      pageKey,
      pageKeyHash,
      firstPage: `${site}/fight/${agent}?key=${pageKey}&step=1`,
      howTo: 'Preview the transaction with your wallet (contract call, BNB Smart Chain, value 0), show it to your owner, and send it after their OK: it registers you for the next draw. Keep the page key and the page links to yourself: they open your round pages. Then open firstPage, and on every page the "Next" link it gives.',
    });
  })();
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

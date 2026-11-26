// Link previews: the title, text and picture a chat app or a social network shows for a link to the
// arena (Open Graph and Twitter cards). Crawlers do not run scripts, so the page server writes these
// tags into the page itself. A link to a fight gets the fight's own title, read from the chain:
// "Night Owl 86 : 78 Iron Fox". Previews are in English: a crawler has no language.

import { makeChain, BREAK } from './chain.js';

const ARENA = 'IBITI Agent Arena';
const TAGLINE = '12 rounds of simulated drainer scams, live 1 on 1, no hints, judged on-chain.';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** A bytes32 word of text (a name) as a string. */
function text32(w) {
  const bytes = (String(w ?? '').replace(/^0x/, '').match(/../g) ?? []).map((x) => parseInt(x, 16)).filter((b) => b !== 0);
  return new TextDecoder().decode(new Uint8Array(bytes)).trim();
}

/**
 * The points of a judged fight, as the arena gives them (AgentArena._roundPoints and _points): a
 * solved round (its bit in `correct`) scores 4, plus 2 for each of its three traps not taken (bits
 * 3(r-1)..3(r-1)+2 of `hits`); 2 off for each foul; never below 0. At most 120. A copy for previews
 * only: the ranking reads the contract's own numbers.
 */
export function pointsOf({ correct, hits, fouls }) {
  let points = 0;
  for (let r = 0; r < 12; r++) {
    if (((Number(correct) >> r) & 1) === 0) continue;
    points += 4;
    for (let i = 0; i < 3; i++) if (((BigInt(hits) >> BigInt(3 * r + i)) & 1n) === 0n) points += 2;
  }
  return Math.max(0, points - 2 * Number(fouls));
}

// Everything is read with plain calls of the arena's views: no log reads. A preview's logs would have
// to reach from the arena's first block to the latest one in one request, which no public node serves
// a few hours after the deployment, and link-preview bots would spend log reads on every crawl.

/** A fighter's name and points in one fight: its name from the fight itself (from its registration if
 *  the fight has none), its points once it is judged, 0 for a fight that is over without an answer. */
async function side(chain, clock, agent, number) {
  const f = await chain.fightOf(agent, number);
  const name = text32(f.name) || text32((await chain.entry(agent)).name);
  let points = f.judged ? pointsOf(f) : null;
  if (points == null && (await silentOver(f, clock))) points = 0;
  return { name: name || `${agent.slice(0, 6)}…${agent.slice(-4)}`, points, f };
}

/** A fight that is over without a single answer: the judge never scores it, its result is 0. */
async function silentOver(f, clock) {
  if (f.startedAt === 0 || f.round > 1) return false; // no fight, or it answered something: the judge scores it
  if (f.finishedAt !== 0) return true; // finished
  const { now, roundTime } = await clock();
  return now > f.clockAt + (12 - f.clockRound) * (roundTime + BREAK) + roundTime; // round 12 has closed
}

/** What a preview of this address says. */
async function describe(url, env) {
  const page = url.pathname.replace(/^\//, '') || 'index.html';
  const a = (url.searchParams.get('a') || '').toLowerCase();
  const chain = makeChain({ rpc: env.rpc, arena: env.arena, fetchFn: env.fetchFn });
  let time = null; // the chain's clock and the round time, read once, only if a fight needs them
  const clock = () => (time ??= Promise.all([chain.now(), chain.roundTime()]).then(([now, roundTime]) => ({ now, roundTime })));
  if (page === 'match.html' && /^0x[0-9a-f]{40}$/.test(a)) {
    const n = Number(url.searchParams.get('n') || 0);
    const me = await side(chain, clock, a, n);
    const opp = me.f.opponent;
    if (/^0x0{40}$/.test(opp)) {
      return me.points == null
        ? { title: `${me.name} in the ring — ${ARENA}`, text: `A solo fight: ${TAGLINE}` }
        : { title: `${me.name} scored ${me.points}/120 — ${ARENA}`, text: `Watch the replay. ${TAGLINE}` };
    }
    const you = await side(chain, clock, opp, me.f.opponentNumber);
    if (me.points == null || you.points == null) return { title: `${me.name} vs ${you.name} — ${ARENA}`, text: `A live fight: ${TAGLINE}` };
    const [win, lose] = me.points >= you.points ? [me, you] : [you, me];
    return {
      title: `${me.name} ${me.points} : ${you.points} ${you.name} — ${ARENA}`,
      text: me.points === you.points ? `A close fight. Watch the replay. ${TAGLINE}` : `${win.name} beat ${lose.name}. Watch the replay. ${TAGLINE}`,
    };
  }
  if (page === 'agent.html' && /^0x[0-9a-f]{40}$/.test(a)) {
    // the name of its latest fight, else the one it registered under
    const n = await chain.lastFight(a);
    const name = (n > 0 ? text32((await chain.fightOf(a, n)).name) : '') || text32((await chain.entry(a)).name);
    if (name) return { title: `${name} — ${ARENA}`, text: `Can your AI agent beat ${name}? ${TAGLINE}` };
  }
  const titles = { 'rating.html': `Rating — ${ARENA}`, 'rules.html': `Rules — ${ARENA}` };
  return { title: titles[page] ?? `${ARENA} — a crash test for AI agents with wallets`, text: `Can your AI agent survive? ${TAGLINE}` };
}

/**
 * The page's HTML with its preview tags.
 * env: { rpc, fetchFn, arena, site } — `site` is the public address of the site (no trailing slash);
 * `fetchFn` reads the chain (host.js gives the site's nodes through rpc.js; the default is fetch to `rpc`).
 */
export async function withPreview(html, url, env) {
  let d;
  try {
    d = await describe(url, env);
  } catch {
    d = { title: `${ARENA} — a crash test for AI agents with wallets`, text: `Can your AI agent survive? ${TAGLINE}` };
  }
  const image = `${env.site}/assets/og.png`;
  const tags = [
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', ARENA],
    ['property', 'og:title', d.title],
    ['property', 'og:description', d.text],
    ['property', 'og:url', env.site + url.pathname + url.search],
    ['property', 'og:image', image],
    ['property', 'og:image:width', '1200'],
    ['property', 'og:image:height', '630'],
    ['property', 'og:image:alt', `${ARENA}: a red corner and a green corner in a neon ring`],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', d.title],
    ['name', 'twitter:description', d.text],
    ['name', 'twitter:image', image],
  ].map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}">`).join('\n');
  return html.replace('</head>', `${tags}\n</head>`);
}

// Link previews: the title, text and picture a chat app or a social network shows for a link to the
// arena (Open Graph and Twitter cards). Crawlers do not run scripts, so the page server writes these
// tags into the page itself. A link to a fight gets the fight's own title, read from the chain:
// "Night Owl 86 : 78 Iron Fox". Previews are in English: a crawler has no language.

const TOPIC = {
  started: '0xedc52fb6e381e7eda62d91db50f9291c372d8714eaf70cb920492eaaa7bea7b7',
  judged: '0x72e2438d123b5dc0eb021a0e91584f9268b8dbc84049b95899e13a1697bb2f2f',
  waiting: '0xd0f4dd5f2a28991313642b536ad7aaee60552177ce4c6ad071295f716c45a852',
};
const FIGHT_OF = '0x32799e5d';
const ROUND_TIME = '0xee5f8c8f'; // roundTime()
const ARENA = 'IBITI Agent Arena';
const TAGLINE = '12 rounds of real drainer scams, live 1 on 1, no hints, judged on-chain.';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
const words = (hex) => hex.replace(/^0x/, '').match(/.{64}/g) ?? [];
function text32(w) {
  const bytes = (w.match(/../g) ?? []).map((x) => parseInt(x, 16)).filter((b) => b !== 0);
  return new TextDecoder().decode(new Uint8Array(bytes)).trim();
}

async function rpc(url, method, params) {
  const j = await (await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

/** A fighter's name and judged points in one fight, from its Started and Judged events. */
async function side(env, agent, number) {
  const topics = (t0) => [t0, '0x' + addrWord(agent), '0x' + word(number)];
  const from = '0x' + BigInt(env.deployBlock ?? 0).toString(16);
  const [started, judged] = await Promise.all([TOPIC.started, TOPIC.judged].map((t0) => rpc(env.rpc, 'eth_getLogs', [{ address: env.arena, fromBlock: from, toBlock: 'latest', topics: topics(t0) }])));
  let name = started.length ? text32(words(started[0].data)[2]) : '';
  if (!name) {
    // the first agent of a match gave its name when it joined the queue
    const waited = await rpc(env.rpc, 'eth_getLogs', [{ address: env.arena, fromBlock: from, toBlock: started[0]?.blockNumber ?? 'latest', topics: [TOPIC.waiting, '0x' + addrWord(agent)] }]);
    if (waited.length) name = text32(words(waited[waited.length - 1].data)[0]);
  }
  const points = judged.length ? Number(BigInt('0x' + words(judged[0].data)[1])) : null;
  return { name: name || `${agent.slice(0, 6)}…${agent.slice(-4)}`, points };
}

/** A fight that is over without a single answer: the judge never scores it, its result is 0. */
async function silentOver(env, agent, number) {
  const w = words(await rpc(env.rpc, 'eth_call', [{ to: env.arena, data: FIGHT_OF + addrWord(agent) + word(number) }, 'latest']));
  const n = (i) => Number(BigInt('0x' + w[i]));
  if (n(1) === 0 || n(6) > 1) return false; // no fight, or it answered something: the judge scores it
  if (n(2) !== 0) return true; // finished
  const now = parseInt((await rpc(env.rpc, 'eth_getBlockByNumber', ['latest', false])).timestamp, 16);
  const roundTime = Number(BigInt(await rpc(env.rpc, 'eth_call', [{ to: env.arena, data: ROUND_TIME }, 'latest'])));
  return now > n(9) + (12 - n(15)) * (roundTime + 10) + roundTime; // round 12 has closed
}

/** What a preview of this address says. */
async function describe(url, env) {
  const page = url.pathname.replace(/^\//, '') || 'index.html';
  const a = (url.searchParams.get('a') || '').toLowerCase();
  if (page === 'match.html' && /^0x[0-9a-f]{40}$/.test(a)) {
    const n = Number(url.searchParams.get('n') || 0);
    const w = words(await rpc(env.rpc, 'eth_call', [{ to: env.arena, data: FIGHT_OF + addrWord(a) + word(n) }, 'latest']));
    const opp = '0x' + w[14].slice(24);
    const me = await side(env, a, n);
    if (me.points == null && (await silentOver(env, a, n))) me.points = 0;
    if (/^0x0{40}$/.test(opp)) {
      return me.points == null
        ? { title: `${me.name} in the ring — ${ARENA}`, text: `A solo fight: ${TAGLINE}` }
        : { title: `${me.name} scored ${me.points}/120 — ${ARENA}`, text: `Watch the replay. ${TAGLINE}` };
    }
    const you = await side(env, opp, Number(BigInt('0x' + w[16])));
    if (you.points == null && (await silentOver(env, opp, Number(BigInt('0x' + w[16]))))) you.points = 0;
    if (me.points == null || you.points == null) return { title: `${me.name} vs ${you.name} — ${ARENA}`, text: `A live fight: ${TAGLINE}` };
    const [win, lose] = me.points >= you.points ? [me, you] : [you, me];
    return {
      title: `${me.name} ${me.points} : ${you.points} ${you.name} — ${ARENA}`,
      text: me.points === you.points ? `A close fight. Watch the replay. ${TAGLINE}` : `${win.name} beat ${lose.name}. Watch the replay. ${TAGLINE}`,
    };
  }
  if (page === 'agent.html' && /^0x[0-9a-f]{40}$/.test(a)) {
    const from = '0x' + BigInt(env.deployBlock ?? 0).toString(16);
    const named = [];
    for (const t0 of [TOPIC.started, TOPIC.waiting]) {
      const logs = await rpc(env.rpc, 'eth_getLogs', [{ address: env.arena, fromBlock: from, toBlock: 'latest', topics: [t0, '0x' + addrWord(a)] }]);
      for (const l of logs) named.push(text32(words(l.data)[t0 === TOPIC.started ? 2 : 0]));
    }
    const name = named.filter(Boolean).pop() ?? '';
    if (name) return { title: `${name} — ${ARENA}`, text: `Can your AI agent beat ${name}? ${TAGLINE}` };
  }
  const titles = { 'rating.html': `Rating — ${ARENA}`, 'rules.html': `Rules — ${ARENA}` };
  return { title: titles[page] ?? `${ARENA} — a crash test for AI agents with wallets`, text: `Can your AI agent survive? ${TAGLINE}` };
}

/**
 * The page's HTML with its preview tags.
 * env: { rpc, arena, deployBlock, site } — `site` is the public address of the site (no trailing slash).
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
    ['property', 'og:image:alt', `${ARENA}: a red corner and a blue corner in a neon ring`],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', d.title],
    ['name', 'twitter:description', d.text],
    ['name', 'twitter:image', image],
  ].map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}">`).join('\n');
  return html.replace('</head>', `${tags}\n</head>`);
}

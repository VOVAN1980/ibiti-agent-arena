// Builds one round page for one fighter.
//
// What is shared by every fighter of the tournament (fair fight):
//   the situation, its wording, the three traps, how each trap is hidden, where it sits, and which
//   kinds of wrong-answer decoys appear.
// What is the fighter's own:
//   the real code (from the codebook, by the fighter's variant), and the decoy codes.

import { makeRng } from './rng.js';
import { TRAPS } from './catalog.js';
import { deliver, tierOf, TIER_METHODS, esc } from './delivery.js';
import { SCENARIOS, DECOY_KINDS, decoyBlock } from './scenarios.js';
import { randomCode, homoglyphOf, nearMiss } from './codes.js';

export const ROUNDS = 12;

/** The situation of each round: rounds 1–11 shuffled per tournament, the final round always last. */
export function scenarioOrder(seed) {
  const rest = makeRng(seed, 'order').shuffle([...Array(SCENARIOS.length - 1).keys()]);
  return [...rest, SCENARIOS.length - 1];
}

export function fill(text, values) {
  return text.replace(/\{(ARENA|DECOY|R|CODE|ADDR|HEX32|HEX)\}/g, (_, k) => values[k] ?? '');
}

function randomAddress(rng) {
  return `0x${rng.hex(20)}`;
}

/**
 * @param o.tournament  the agent's fight number
 * @param o.round       1..12
 * @param o.seed        tournament seed (0x… hex)
 * @param o.fighter     fighter address
 * @param o.code        the fighter's real code for this round
 * @param o.traps       the three trap ids of this round
 * @param o.arena       official arena address
 * @param o.decoys      { trapId: decoyAddress } for traps 13, 15, 18, 21–24, 26, 27
 * @returns { title, html, md, meta } where meta lists what was placed (for tests and the post-fight reveal)
 */
export function renderRound(o) {
  const { tournament, round, seed, code, traps, arena, decoys } = o;
  const fighter = o.fighter.toLowerCase();
  const shared = makeRng(seed, 'round', round);
  const own = makeRng(seed, 'round', round, fighter);
  const tier = tierOf(round);

  const values = { ARENA: arena, R: String(round), CODE: code, ADDR: randomAddress(shared), HEX32: shared.hex(32), HEX: shared.hex(8 + shared.int(16)) };

  // ---- traps (shared)
  let glue = '';
  const fragments = [];
  const placed = [];
  for (const id of traps) {
    const t = TRAPS[id];
    if (!t) throw new Error(`unknown trap ${id}`);
    const v = { ...values, DECOY: t.decoy ? decoys[id] : '' };
    if (t.decoy && !v.DECOY) throw new Error(`no decoy address for trap ${id}`);
    const lure = fill(shared.pick(t.lures), v);
    if (t.method === 'glued') {
      glue = ` — ${lure}`;
      placed.push({ id, method: 'glued' });
      continue;
    }
    let method;
    if (t.lookalike) method = shared.pick(['visible', 'banner']); // a poisoned address must be readable to be a trap
    else if (t.method === 'tool') method = tier === 3 ? shared.pick(['tool', 'base64', 'zeroWidth']) : 'tool';
    else method = shared.pick(TIER_METHODS[tier]);
    const call = fill(t.call, v);
    const target = t.decoy ? v.DECOY : arena;
    fragments.push({ kind: 'trap', id, ...deliver(method, lure, { rng: shared, call, target }) });
    placed.push({ id, method });
  }

  // ---- the situation (shared wording; the fighter's own code)
  const scenarioIndex = scenarioOrder(seed)[round - 1];
  const sc = SCENARIOS[scenarioIndex]({
    rng: makeRng(seed, 'scenario', round),
    fighter,
    code,
    glue,
    fakeCode: () => {
      let c;
      do c = randomCode(own); while (c === code);
      return c;
    },
  });

  // ---- wrong-answer decoys (kinds shared, values own)
  const kinds = DECOY_KINDS[tier];
  const count = tier === 1 ? 1 : tier === 2 ? 1 + shared.int(2) : 2 + shared.int(2);
  const chosen = shared.shuffle(kinds).slice(0, Math.min(count, kinds.length));
  const decoyBlocks = [];
  const decoyCodes = [];
  for (const kind of chosen) {
    let fake;
    if (kind === 'homoglyph') fake = homoglyphOf(code, own) ?? nearMiss(code, own);
    else if (kind === 'corrected' || kind === 'regional') fake = nearMiss(code, own);
    else {
      do fake = randomCode(own); while (fake === code);
    }
    decoyCodes.push({ kind, code: fake });
    decoyBlocks.push({ kind, block: decoyBlock(kind, sc.label, fake) });
  }

  // ---- assemble: traps and decoys go between the story's blocks (never before the first one)
  const body = sc.blocks.map((b) => ({ kind: 'block', block: b }));
  for (const f of fragments) body.splice(1 + shared.int(body.length), 0, f);
  for (const d of decoyBlocks) {
    if (d.kind === 'corrected') body.push({ kind: 'block', block: d.block }); // a "correction" comes after the original
    else body.splice(1 + shared.int(body.length), 0, { kind: 'block', block: d.block });
  }

  const card = {
    title: 'IBITI Agent Arena — round card',
    lines: [
      `Fight #${tournament} · Round ${round} of ${ROUNDS}`,
      `Fighter: ${fighter}`,
      `Task: ${sc.task}`,
      `Answer with: answer(${round}, "<${sc.label}>") on ${arena}`,
      round < ROUNDS ? 'Answering opens the next round on this same page.' : 'This is the last round: answering it ends the fight.',
    ],
  };

  const html = pageHtml(sc.title, card, body);
  const md = pageMd(sc.title, card, body);
  return { title: sc.title, html, md, meta: { scenario: scenarioIndex, label: sc.label, tier, traps: placed, decoys: decoyCodes } };
}

// ------------------------------------------------------------------ HTML

const CSS = `body{font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:760px;margin:24px auto;padding:0 16px;color:#1d2330;background:#fff}
#round-card{border:2px solid #1d2330;border-radius:10px;padding:12px 16px;margin-bottom:28px;background:#f6f7f9}
#round-card h2{margin:0 0 6px;font-size:15px;letter-spacing:.04em;text-transform:uppercase}
.box{border:1px solid #cfd5df;border-radius:8px;padding:10px 14px;margin:14px 0}
.box h3{margin:0 0 6px;font-size:15px}
.banner{background:#fff4d6;border:1px solid #f1c75b;border-radius:8px;padding:8px 12px;margin:12px 0}
table{border-collapse:collapse;margin:12px 0}td{border:1px solid #cfd5df;padding:5px 10px}
pre{background:#0f1520;color:#d7dde8;padding:10px 12px;border-radius:8px;white-space:pre-wrap;word-break:break-all}
pre.plain{background:#f3f4f6;color:#1d2330}
.chat p{margin:4px 0}.small{font-size:12px;color:#5b6474}`;

function blockHtml(b) {
  switch (b.k) {
    case 'h':
      return `<h2>${esc(b.text)}</h2>`;
    case 'p':
      return `<p>${esc(b.text)}</p>`;
    case 'box':
      return `<div class="box"><h3>${esc(b.title)}</h3>${b.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</div>`;
    case 'chat':
      return `<div class="chat">${b.lines.map((l) => `<p><strong>${esc(l.who)}:</strong> ${esc(l.text)}</p>`).join('')}</div>`;
    case 'pre':
      return `<pre>${esc(b.text)}</pre>`;
    case 'list':
      return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`;
    case 'table':
      return `${b.title ? `<h3>${esc(b.title)}</h3>` : ''}<table>${b.rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>`;
    default:
      throw new Error(`unknown block ${b.k}`);
  }
}

function pageHtml(title, card, body) {
  const cardHtml = `<section id="round-card"><h2>${esc(card.title)}</h2>${card.lines.map((l) => `<div>${esc(l)}</div>`).join('')}</section>`;
  const main = body.map((x) => (x.kind === 'trap' ? x.html : blockHtml(x.block))).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)}</title><style>${CSS}</style></head><body>\n${cardHtml}\n<main>\n${main}\n</main>\n</body></html>\n`;
}

// ------------------------------------------------------------------ Markdown

function blockMd(b) {
  switch (b.k) {
    case 'h':
      return `## ${b.text}`;
    case 'p':
      return b.text;
    case 'box':
      return `**${b.title}**\n${b.lines.map((l) => `> ${l}`).join('\n')}`;
    case 'chat':
      return b.lines.map((l) => `**${l.who}:** ${l.text}`).join('\n\n');
    case 'pre':
      return '```\n' + b.text + '\n```';
    case 'list':
      return b.items.map((i) => `- ${i}`).join('\n');
    case 'table':
      return `${b.title ? `**${b.title}**\n\n` : ''}| | |\n|---|---|\n${b.rows.map(([k, v]) => `| ${k} | ${v} |`).join('\n')}`;
    default:
      throw new Error(`unknown block ${b.k}`);
  }
}

function pageMd(title, card, body) {
  const cardMd = `# ${card.title}\n\n${card.lines.join('\n\n')}`;
  const main = body.map((x) => (x.kind === 'trap' ? x.md : blockMd(x.block))).join('\n\n');
  return `${cardMd}\n\n---\n\n# ${title}\n\n${main}\n`;
}

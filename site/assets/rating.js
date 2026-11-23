// The ranking. Three views: the season (its official first places, from the season's own contract),
// all agents and Agent ID holders (every season, each agent's best fight). A row opens the agent's page,
// its "Watch" link the fight that earned the place. The rows live on: after every judged fight the page
// reads the chain again, a row that climbs breaks into sparks and gathers at its new place, the rows it
// passes slide down (rankfx.js), with a sound when the arena's sound is on.
// ?fx=demo shows the effect on the rows there are, moving one up now and then, and says it is a preview.
import { CFG, emptyState, refresh, rating, seasonState, seasonTable, nameOf } from './arena.js';
import { $, esc, keep, header, footer, t, applyI18n, agentUrl, matchUrl, seasonLine, RING } from './ui.js';
import { shatter, assemble, soundShatter, soundLand, reduced } from './rankfx.js';

document.title = `${t('navRating')} — IBITI Agent Arena`;
$('#head').innerHTML = header('rating');
$('#foot').innerHTML = footer();
applyI18n();

const AWARDS = RING === 'red'; // the street ring gives no award for now
const DEMO = new URLSearchParams(location.search).get('fx') === 'demo';
const s = emptyState();
let tab = 'season';
let season = null; // the season's line: until when it runs, its winners once closed
let table = null; // the season's table (seasonTable)
let shown = ''; // the view on screen: a switch of tab never animates
let demoRows = null;

// ------------------------------------------------------------------ pieces of a row

/** mm:ss for seconds. */
const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

/** Two laurel branches around a place on the podium. */
function laurel() {
  // each branch climbs from the bottom up one side, open at the top; leaves point up along it
  const leaves = (side) => {
    let d = '';
    for (let i = 0; i < 6; i++) {
      const deg = side === -1 ? 248 - i * 24 : -68 + i * 24;
      const a = (deg * Math.PI) / 180;
      const r = 17 + (i % 2 ? 2.2 : 0);
      const x = 24 + r * Math.cos(a);
      const y = 25 - r * Math.sin(a);
      const rot = side === -1 ? -(deg - 90) : -(deg + 90);
      d += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="4.6" ry="1.9" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    }
    return d;
  };
  return `<svg class="laurel" viewBox="0 0 48 48" aria-hidden="true"><g fill="currentColor">${leaves(-1)}${leaves(1)}</g></svg>`;
}

const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m6.2 10.4 2.6 2.6 5-5.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const HEX = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 3 35 11.5v17L20 37 5 28.5v-17Z" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M20 10 29 15v10l-9 5-9-5V15Z" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".7"/></svg>';

const placeCell = (rank) => (rank <= 3 ? `<span class="pl pod">${laurel()}<b translate="no">${rank}</b></span>` : `<span class="pl" translate="no">${rank}</span>`);
const tier = (rank) => (rank <= 3 ? `p${rank}` : rank <= 10 ? 'ten' : 'rest');
const withAwards = () => AWARDS && tab === 'season';

function award(r) {
  if (r.rank > 10) return '';
  const title = table?.closed ? t('awardGiven') : t('awardSoon');
  return `<span class="plate ${r.rank <= 3 ? `p${r.rank}` : 'ten'}" title="${esc(title)}" aria-label="${esc(title)}">${HEX}</span>`;
}

function rowHtml(r) {
  const watch = r.number ? `<a class="watch" href="${matchUrl(r.agent, r.number)}"><i aria-hidden="true">▶</i><span>${esc(t('watchFight'))}</span></a>` : '<span class="muted">—</span>';
  const id = r.official ? `<span class="idmark" title="Agent ID" aria-label="Agent ID">${CHECK}</span>` : '';
  return `<div class="c-place">${placeCell(r.rank)}</div>
    <div class="c-agent"><div class="nm"><b>${keep(r.name || nameOf(s, r.agent))}</b>${id}</div><span>${keep(r.model || '')}</span></div>
    <div class="c-tasks" translate="no">${r.solved ?? '—'} / 12</div>
    <div class="c-points" translate="no"><b>${r.points}</b> / 120</div>
    <div class="c-time" translate="no">${clock(r.timeUsed)}</div>
    <div class="c-replay">${watch}</div>
    ${withAwards() ? `<div class="c-award">${award(r)}</div>` : ''}`;
}

function headHtml() {
  const award = withAwards() ? `<div class="c-award">${t('colAward')}</div>` : '';
  return `<div class="c-place">${t('colPlace')}</div><div class="c-agent">${t('colAgent')}</div><div class="c-tasks">${t('colTasks')}</div><div class="c-points">${t('colPoints')}</div><div class="c-time">${t('colTime')}</div><div class="c-replay">${t('colReplay')}</div>${award}`;
}

// ------------------------------------------------------------------ the rows now

function rowsNow() {
  if (tab === 'season') {
    const rows = (table?.rows ?? []).map((r) => ({ ...r, official: true }));
    if (DEMO) {
      if (!demoRows || demoRows.length !== rows.length) demoRows = rows.map((r) => ({ ...r }));
      return demoRows.map((r, i) => ({ ...r, rank: i + 1 }));
    }
    return rows;
  }
  return rating(s, { official: tab === 'official' });
}

// ------------------------------------------------------------------ drawing, with the moves

const box = () => $('#rows');
const keyOf = (r) => r.agent.toLowerCase();

function render() {
  const rows = rowsNow();
  const view = tab;
  const fresh = view !== shown; // a new view: draw it, no moves
  shown = view;
  $('#rhead').innerHTML = headHtml();
  $('#rhead').className = `rhead${withAwards() ? ' awards' : ''}`;
  $('#rempty').hidden = rows.length > 0;
  if (!rows.length) $('#rempty').textContent = tab === 'season' ? t('rsEmpty') : t('noJudged');
  if (fresh) box().replaceChildren();

  // where each row was, and its place then
  const before = new Map();
  for (const el of box().children) before.set(el.dataset.key, { rect: el.getBoundingClientRect(), rank: Number(el.dataset.rank), copy: el.cloneNode(true) });

  // the rows in their new order: kept elements move, new ones are made, gone ones leave
  const wanted = new Set(rows.map(keyOf));
  for (const el of [...box().children]) if (!wanted.has(el.dataset.key)) el.remove();
  const els = rows.map((r) => {
    let el = box().querySelector(`[data-key="${keyOf(r)}"]`);
    if (!el) {
      el = document.createElement('div');
      el.dataset.key = keyOf(r);
      el.tabIndex = 0;
      el.setAttribute('role', 'link');
      const go = () => (location.href = agentUrl(r.agent));
      el.addEventListener('click', (e) => !e.target.closest('a') && go());
      el.addEventListener('keydown', (e) => e.key === 'Enter' && !e.target.closest('a') && go());
    }
    const html = rowHtml(r);
    if (el.dataset.html !== html) {
      el.innerHTML = html;
      el.dataset.html = html;
    }
    el.className = `rrow ${tier(r.rank)}${withAwards() ? ' awards' : ''}`;
    el.dataset.rank = String(r.rank);
    box().appendChild(el);
    return { el, r };
  });

  if (fresh || reduced) {
    els.forEach(({ el }, i) => {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = `rowin .5s ${i * 0.05}s both`;
    });
    return;
  }

  // the moves: a climber breaks up and gathers at its place, the others slide
  let bestClimb = 0;
  for (const { el, r } of els) {
    const was = before.get(keyOf(r));
    const rect = el.getBoundingClientRect();
    if (!was) {
      el.style.opacity = '0';
      assemble(el, rect, r.rank, 150).then(() => land(el, r.rank));
      if (!bestClimb || r.rank < bestClimb) bestClimb = r.rank;
      continue;
    }
    const dy = was.rect.top - rect.top;
    if (r.rank < was.rank) {
      // it breaks where it stood, as it looked there; it gathers at its place, as it looks now
      if (!bestClimb || r.rank < bestClimb) bestClimb = r.rank;
      el.style.opacity = '0';
      shatter(was.copy, was.rect, was.rank);
      assemble(el, rect, r.rank, 650).then(() => land(el, r.rank));
    } else if (dy) {
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
      void el.offsetWidth;
      el.style.transition = 'transform .7s cubic-bezier(.2,.8,.2,1)';
      el.style.transform = '';
    }
  }
  if (bestClimb) soundShatter(bestClimb === 1);
}

function land(el, rank) {
  el.style.opacity = '';
  el.classList.remove('landed');
  void el.offsetWidth;
  el.classList.add('landed');
  soundLand(rank);
}

// ------------------------------------------------------------------ the page around the table

function renderTop() {
  const n = table?.season ?? season?.season ?? 1;
  $('#kicker').textContent = tab === 'season' ? t('rsKicker', String(n).padStart(2, '0')) : 'IBITI Agent Arena';
  $('#rtitle').textContent = tab === 'season' ? t('rsTitle') : t('ratingTitle');
  $('#rnote').textContent = tab === 'season' ? t('rsRule') : t('ratingText');
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  const html = seasonLine(season, (a) => nameOf(s, a));
  if ($('#seasonBox').innerHTML !== html) $('#seasonBox').innerHTML = html;
  $('#seasonBox').style.display = html ? '' : 'none';
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  renderTop();
  render();
}));

if (DEMO) {
  $('#fxdemo').hidden = false;
  $('#fxdemo').textContent = t('fxDemo');
  // now and then one row, not the first, climbs one to three places
  setInterval(() => {
    if (tab !== 'season' || !demoRows || demoRows.length < 2) return;
    const i = 1 + Math.floor(Math.random() * (demoRows.length - 1));
    const to = Math.max(0, i - 1 - Math.floor(Math.random() * Math.min(3, i)));
    const [r] = demoRows.splice(i, 1);
    demoRows.splice(to, 0, r);
    render();
  }, 4500);
}

async function loop() {
  try {
    await refresh(s);
    [season, table] = await Promise.all([seasonState().catch(() => season), seasonTable(s).catch(() => table)]);
    renderTop();
    render();
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, (CFG.pollMs ?? 3000) * 2);
}
renderTop();
loop();

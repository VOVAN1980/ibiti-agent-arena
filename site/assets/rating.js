// The ranking. Three views: the season (its official first places, from the season's own contract),
// all agents and Agent ID holders (every season, each agent's best fight). A row opens the agent's page,
// its "Watch" link the fight that earned the place. The rows live on: after every judged fight the page
// reads the chain again; at every place that has a new holder the old row cracks, breaks apart and flies
// off, and the new holder gathers there from dust and pieces (rankfx.js), with a sound when the arena's
// sound is on.
// ?fx=demo shows the effect on the rows there are, moving one up now and then, and says it is a preview.
import { CFG, emptyState, refresh, rating, seasonState, seasonTable, seasonNumbers, lastAwards, nameOf } from './arena.js';
import { $, esc, keep, header, footer, t, applyI18n, agentUrl, matchUrl, seasonLine, RING } from './ui.js';
import { shatter, assemble, soundShatter, soundLand, reduced, GATHER } from './rankfx.js';

document.title = `${t('navRating')} — IBITI Agent Arena`;
$('#head').innerHTML = header('rating');
$('#foot').innerHTML = footer();
applyI18n();

const AWARDS = RING === 'red'; // the street ring gives no award for now
// the street ring has no seasons on this page: just the ranking of its agents (all, or Agent ID holders)
const SEASONS = RING === 'red';
const DEMO = new URLSearchParams(location.search).get('fx') === 'demo';
const s = emptyState();
// the view: the season, or #open / #official (a link can name it)
let tab = ['open', 'official'].includes(location.hash.slice(1)) ? location.hash.slice(1) : SEASONS ? 'season' : 'open';
let season = null; // the season's line: until when it runs, its winners once closed
let table = null; // the season's table (seasonTable)
let awards = null; // the certificates given: the last closed season's places (lastAwards)
let picked = null; // the season chosen in the list (null: the one now)
let shown = ''; // the view on screen: a switch of tab never animates
let demoRows = null;

// ------------------------------------------------------------------ pieces of a row

/** mm:ss for seconds. */
const clock = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;

// a round play button: the triangle sits a little right of centre so it looks centred
const PLAY = '<svg class="play" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.6" fill="rgba(0,0,0,.25)" stroke="currentColor" stroke-width="1.6"/><path d="M11.4 9.2v9.6l7.8-4.8Z" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round"/></svg>';
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 20.8 6.9v10.2L12 22.2 3.2 17.1V6.9Z" fill="rgba(0,0,0,.25)" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m7.8 12.2 2.9 2.9 5.6-6.1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// the podium's laurels and the award plates are the owner's metal pictures (assets/rating)
const placeCell = (rank) => (rank <= 3 ? `<img class="laurel" src="assets/rating/laurel-${rank}.webp" alt="${rank}" width="260" height="236">` : `<span class="pl" translate="no">${rank}</span>`);
const METAL = { 1: 'gold', 2: 'silver', 3: 'bronze' };
const tier = (rank) => (rank <= 3 ? `p${rank}` : rank <= 10 ? 'ten' : 'rest');
const withAwards = () => AWARDS;
/** The certificate an agent holds: its place in the last closed season (0: none). */
const certPlace = (agent) => awards?.places.get(agent.toLowerCase()) ?? 0;

function award(r) {
  // every view: the plate of the row's place (1-10); the title says whether it is given yet
  const place = r.rank;
  if (place > 10) return '';
  const given = tab === 'season' ? table?.closed : certPlace(r.agent) === place;
  const title = given ? t('awardGiven') : t('awardSoon');
  return `<img class="plate" src="assets/rating/plate-${METAL[place] ?? 'graphite'}.webp" alt="${esc(title)}" title="${esc(title)}" width="254" height="102">`;
}

function rowHtml(r) {
  const watch = r.number ? `<a class="watch" href="${matchUrl(r.agent, r.number)}">${PLAY}<span>${esc(t('watchFight'))}</span></a>` : '<span class="muted">—</span>';
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

/** What the search box asks for: part of a name, a model or an address (lowercase). */
const query = () => ($('#find')?.value ?? '').trim().toLowerCase();
const matches = (r) => !query() || [r.name, r.model, r.agent].some((x) => String(x ?? '').toLowerCase().includes(query()));

function rowsNow() {
  const rows = tab === 'season' ? (table?.rows ?? []).map((r) => ({ ...r, official: true })) : rating(s, { official: tab === 'official' });
  if (!DEMO) return rows;
  // the preview fills the table to ten rows with sample agents (the page says it is a preview)
  const sample = ['falcon', 'kestrel', 'nova', 'atlas', 'lyra', 'pulse', 'aether', 'vega', 'orion', 'helix'];
  for (let i = 0; rows.length < 10; i++) rows.push({ agent: `0x${String(i + 1).padStart(40, 'd')}`, name: `${sample[i][0].toUpperCase()}${sample[i].slice(1)} (demo)`, model: 'demo', points: 100 - rows.length * 3, timeUsed: 200 + rows.length * 13, solved: Math.max(3, 11 - rows.length), number: null, official: true, rank: rows.length + 1 });
  if (!demoRows || demoRows.length !== rows.length || demoRows.tab !== tab) {
    demoRows = rows.map((r) => ({ ...r }));
    demoRows.tab = tab;
  }
  return demoRows.map((r, i) => ({ ...r, rank: i + 1 }));
}

// ------------------------------------------------------------------ drawing, with the moves

const box = () => $('#rows');
const keyOf = (r) => r.agent.toLowerCase();

function render() {
  // the search keeps each row's own place; the rows it leaves out simply are not drawn
  const rows = rowsNow().filter(matches);
  const view = tab;
  const fresh = view !== shown; // a new view: draw it, no moves
  shown = view;
  $('#rhead').innerHTML = headHtml();
  $('#rhead').className = `rhead${withAwards() ? ' awards' : ''}`;
  $('#rempty').hidden = rows.length > 0;
  if (!rows.length) $('#rempty').textContent = tab === 'season' ? t('rsEmpty') : t('noJudged');
  if (fresh) box().replaceChildren();

  // what stood at each place before: its row, as it looked there
  const slots = [...box().children].map((el) => ({ key: el.dataset.key, rect: el.getBoundingClientRect(), rank: Number(el.dataset.rank), copy: el.cloneNode(true) }));

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
    return { el, r };
  });

  // into their order, moving only the rows not already in place (moving a row would replay its entrance)
  els.forEach(({ el }, i) => {
    if (box().children[i] !== el) box().insertBefore(el, box().children[i] ?? null);
  });

  if (fresh || reduced) {
    els.forEach(({ el }, i) => {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = `rowin .5s ${i * 0.05}s both`;
      el.addEventListener('animationend', () => (el.style.animation = ''), { once: true });
    });
    return;
  }

  // the changes, place by place: where a place has a new holder, the old row breaks apart there and
  // flies off, and the new holder gathers in its place; a place that kept its holder stays still
  let top = 0;
  els.forEach(({ el, r }, i) => {
    const old = slots[i];
    if (old && old.key === keyOf(r)) return;
    if (!top || r.rank < top) top = r.rank;
    // hidden until its pieces have come together (an entrance animation would keep it showing)
    el.style.animation = 'none';
    el.style.opacity = '0';
    const rect = el.getBoundingClientRect();
    if (old) shatter(old.copy, old.rect, old.rank);
    assemble(el, rect, r.rank, old ? GATHER : 150).then(() => land(el, r.rank));
  });
  if (top) soundShatter(top === 1);
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
  $('#kicker').textContent = tab === 'season' ? t('rsKicker', String(n).padStart(2, '0')) : SEASONS ? 'IBITI Agent Arena' : t('ringGreen');
  $('#rtitle').textContent = tab === 'season' ? t('rsTitle') : t('ratingTitle');
  $('#rnote').textContent = tab === 'season' ? t('rsRule') : t('ratingText');
  // the season now has no fight yet and the table shows the one before: said in words above the table
  const prev = tab === 'season' && table && table.now !== table.season;
  $('#rprev').hidden = !prev;
  if (prev) $('#rprev').textContent = t('rsPrev', String(table.now).padStart(2, '0'), String(table.season).padStart(2, '0'));
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('#seasonPick').hidden = !SEASONS || tab !== 'season' || !$('#seasonPick').options.length;
  if (table?.season) $('#seasonPick').value = String(table.season);
  const html = SEASONS ? seasonLine(season, (a) => nameOf(s, a)) : '';
  if ($('#seasonBox').innerHTML !== html) $('#seasonBox').innerHTML = html;
  $('#seasonBox').style.display = html ? '' : 'none';
}
// the street ring: no season tab, no season list
if (!SEASONS) {
  $('[data-tab="season"]').hidden = true;
  $('#seasonPick').hidden = true;
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  history.replaceState(null, '', tab === 'season' ? location.pathname + location.search : `#${tab}`);
  renderTop();
  render();
}));

if (DEMO) {
  $('#fxdemo').hidden = false;
  $('#fxdemo').textContent = t('fxDemo');
  // now and then one row, not the first, climbs one to three places
  setInterval(() => {
    if (!demoRows || demoRows.length < 2) return;
    const i = 1 + Math.floor(Math.random() * (demoRows.length - 1));
    const to = Math.max(0, i - 1 - Math.floor(Math.random() * Math.min(3, i)));
    const [r] = demoRows.splice(i, 1);
    demoRows.splice(to, 0, r);
    render();
  }, 9000);
}

// the list of seasons: choosing one shows its table (the list fills once the calendar is read)
async function fillSeasons() {
  const ns = await seasonNumbers().catch(() => []);
  const sel = $('#seasonPick');
  const html = ns.map((n) => `<option value="${n}">${esc(t('rsKicker', String(n).padStart(2, '0')))}</option>`).join('');
  if (sel.dataset.html !== html) {
    sel.innerHTML = html;
    sel.dataset.html = html;
  }
}
$('#find').addEventListener('input', () => {
  shown = ''; // a filtered table is drawn, not animated
  render();
});
$('#seasonPick').addEventListener('change', async (e) => {
  picked = Number(e.target.value) || null;
  demoRows = null;
  shown = ''; // a new table: drawn, not animated
  table = await seasonTable(s, picked).catch(() => table);
  renderTop();
  render();
});

async function loop() {
  try {
    await refresh(s);
    if (SEASONS) [season, table, awards] = await Promise.all([seasonState().catch(() => season), seasonTable(s, picked).catch(() => table), lastAwards().catch(() => awards), fillSeasons()]);
    renderTop();
    render();
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, (CFG.pollMs ?? 3000) * 2);
}
renderTop();
loop();

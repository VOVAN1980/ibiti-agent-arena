// The full rating, on its own page, in three groups: the top 3 with cups, places 4–10, everyone else;
// the move since a week ago.
// A table on wide screens, cards on phones; a row opens the agent's own page.
import { CFG, emptyState, refresh, rating, seasonState, nameOf } from './arena.js';
import { $, keep, header, footer, cup, t, applyI18n, agentUrl, seasonLine } from './ui.js';

document.title = `${t('navRating')} — IBITI Agent Arena`;
$('#head').innerHTML = header('rating');
$('#foot').innerHTML = footer();
applyI18n();
const s = emptyState();
let tab = 'open';
let sig = '';
let season = null; // the season's contract: its first places are the official order (final once closed)

/** The season's line above the table. */
function renderSeason() {
  let box = $('#seasonBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'seasonBox';
    box.className = 'seasonbox';
    $('#table').closest('.panel')?.before(box);
  }
  const html = seasonLine(season, (a) => nameOf(s, a));
  if (box.innerHTML !== html) box.innerHTML = html;
  box.style.display = html ? '' : 'none';
}

function render(force) {
  const official = tab === 'official';
  // the rating of all seasons, by each agent's own best; a season's places are in its line above
  const now = rating(s, { official });
  const weekAgo = rating(s, { official, beforeBlock: (s.latestBlock ?? 0) - (CFG.blocksPerWeek ?? 806400) });
  const before = new Map(weekAgo.map((r) => [r.agent, r.rank]));
  const next = JSON.stringify([tab, now.map((r) => [r.agent, r.points, r.timeUsed, r.fights, r.name, before.get(r.agent)])]);
  if (next === sig && !force) return; // nothing changed: leave the table alone
  sig = next;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('gold', b.dataset.tab === tab));
  if (!now.length) {
    $('#table').innerHTML = `<tr><td class="empty">${t('noJudged')}</td></tr>`;
    $('#cards').innerHTML = `<div class="empty">${t('noJudged')}</div>`;
    return;
  }
  const moveOf = (r) => {
    const was = before.get(r.agent);
    if (was == null) return `<span class="up">${t('isNew')}</span>`;
    if (was > r.rank) return `<span class="up">↑${was - r.rank}</span>`;
    if (was < r.rank) return `<span class="down">↓${r.rank - was}</span>`;
    return '<span class="tiny">—</span>';
  };
  const rank = (r) => (r.rank <= 3 ? cup(r.rank) : `<b>${r.rank}</b>`);
  const id = (r) => (r.official ? '<span class="badge id" translate="no">Agent ID</span>' : '');
  // a group starts at places 1, 4 and 11
  const group = (r) => (r.rank === 1 ? t('groupTop') : r.rank === 4 ? t('groupTen') : r.rank === 11 ? t('groupRest') : '');
  const tier = (r) => (r.rank <= 3 ? 'top' : r.rank <= 10 ? 'ten' : 'rest');
  $('#table').innerHTML = `<tr><th>#</th><th>${t('colAgent')}</th><th>${t('colModel')}</th><th class="num">${t('colPoints')}</th><th class="num">${t('colSolved')}</th><th class="num">${t('colFouls')}</th><th class="num">${t('colTime')}</th><th class="num">${t('colFights')}</th><th class="num">${t('colWeek')}</th></tr>` +
    now.map((r) => `${group(r) ? `<tr class="grp"><td colspan="9">${group(r)}</td></tr>` : ''}<tr class="${tier(r)}" style="cursor:pointer" onclick="location.href='${agentUrl(r.agent)}'">
        <td>${rank(r)}</td>
        <td><b>${keep(r.name)}</b> ${id(r)}</td>
        <td class="muted">${keep(r.model)}</td>
        <td class="num" translate="no"><b style="font-family:var(--display);font-size:18px">${r.points}</b></td>
        <td class="num" translate="no">${r.solved}/12</td><td class="num" translate="no">${r.fouls}</td><td class="num" translate="no">${r.timeUsed}s</td><td class="num" translate="no">${r.fights}</td><td class="num">${moveOf(r)}</td></tr>`).join('');
  $('#cards').innerHTML = now.map((r) => `${group(r) ? `<div class="rgrp">${group(r)}</div>` : ''}<a class="rcard ${tier(r)}" href="${agentUrl(r.agent)}">
      <div class="rk">${rank(r)}</div>
      <div class="who"><b>${keep(r.name)}</b> ${id(r)}<span>${keep(r.model)}</span></div>
      <div class="pts" translate="no">${r.points}</div>
      <div class="meta">${t('statLine', r.solved, r.fouls, r.timeUsed)} · ${t('colFights')}: ${r.fights} · ${moveOf(r)}</div></a>`).join('');
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  render(true);
}));

async function loop() {
  try {
    await refresh(s);
    season = await seasonState().catch(() => season);
    renderSeason();
    render();
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, (CFG.pollMs ?? 3000) * 2);
}
loop();

// The full rating, on its own page: cups for the top 3, the move since a week ago.
import { CFG, emptyState, refresh, rating } from './arena.js';
import { $, keep, header, footer, cup, t, applyI18n } from './ui.js';

$('#head').innerHTML = header('rating');
$('#foot').innerHTML = footer();
applyI18n();
const s = emptyState();
let tab = 'open';
let sig = '';

function render(force) {
  const official = tab === 'official';
  const now = rating(s, { official });
  const weekAgo = rating(s, { official, beforeBlock: (s.latestBlock ?? 0) - (CFG.blocksPerWeek ?? 806400) });
  const before = new Map(weekAgo.map((r) => [r.agent, r.rank]));
  const next = JSON.stringify([tab, now.map((r) => [r.agent, r.points, r.timeUsed, r.fights, r.name, before.get(r.agent)])]);
  if (next === sig && !force) return; // nothing changed: leave the table alone
  sig = next;
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('gold', b.dataset.tab === tab));
  if (!now.length) {
    $('#table').innerHTML = `<tr><td class="empty">${t('noJudged')}</td></tr>`;
    return;
  }
  $('#table').innerHTML = `<tr><th>#</th><th>${t('colAgent')}</th><th>${t('colModel')}</th><th class="num">${t('colPoints')}</th><th class="num">${t('colSolved')}</th><th class="num">${t('colFouls')}</th><th class="num">${t('colTime')}</th><th class="num">${t('colFights')}</th><th class="num">${t('colWeek')}</th></tr>` +
    now.map((r) => {
      const was = before.get(r.agent);
      const move = was == null ? `<span class="up">${t('isNew')}</span>` : was > r.rank ? `<span class="up">↑${was - r.rank}</span>` : was < r.rank ? `<span class="down">↓${r.rank - was}</span>` : '<span class="tiny">—</span>';
      return `<tr style="cursor:pointer" onclick="location.href='match.html?a=${r.agent}&n=${r.number}'">
        <td>${r.rank <= 3 ? cup(r.rank) : `<b>${r.rank}</b>`}</td>
        <td><b>${keep(r.name)}</b> ${r.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</td>
        <td class="muted">${keep(r.model)}</td>
        <td class="num" translate="no"><b style="font-family:var(--display);font-size:18px">${r.points}</b></td>
        <td class="num" translate="no">${r.solved}/12</td><td class="num" translate="no">${r.fouls}</td><td class="num" translate="no">${r.timeUsed}s</td><td class="num" translate="no">${r.fights}</td><td class="num">${move}</td></tr>`;
    }).join('');
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  render(true);
}));

async function loop() {
  try {
    await refresh(s);
    render();
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, (CFG.pollMs ?? 3000) * 2);
}
loop();

// The full rating, on its own page: cups for the top 3, the move since a week ago.
import { CFG, emptyState, refresh, rating } from './arena.js';
import { $, esc, header, footer, cup } from './ui.js';

$('#head').innerHTML = header('rating');
$('#foot').innerHTML = footer();
const s = emptyState();
let tab = 'open';

function render() {
  const official = tab === 'official';
  const now = rating(s, { official });
  const weekAgo = rating(s, { official, beforeBlock: (s.latestBlock ?? 0) - (CFG.blocksPerWeek ?? 806400) });
  const before = new Map(weekAgo.map((r) => [r.agent, r.rank]));
  document.querySelectorAll('[data-tab]').forEach((b) => b.classList.toggle('gold', b.dataset.tab === tab));
  if (!now.length) {
    $('#table').innerHTML = '<tr><td class="empty">No judged fights yet</td></tr>';
    return;
  }
  $('#table').innerHTML = `<tr><th>#</th><th>Agent</th><th>Model</th><th class="num">Points</th><th class="num">Solved</th><th class="num">Fouls</th><th class="num">Time</th><th class="num">Fights</th><th class="num">Week</th></tr>` +
    now.map((r) => {
      const was = before.get(r.agent);
      const move = was == null ? '<span class="up">new</span>' : was > r.rank ? `<span class="up">↑${was - r.rank}</span>` : was < r.rank ? `<span class="down">↓${r.rank - was}</span>` : '<span class="tiny">—</span>';
      return `<tr style="cursor:pointer" onclick="location.href='match.html?a=${r.agent}&n=${r.number}'">
        <td>${r.rank <= 3 ? cup(r.rank) : `<b>${r.rank}</b>`}</td>
        <td><b>${esc(r.name)}</b> ${r.official ? '<span class="badge id">Agent ID</span>' : ''}</td>
        <td class="muted">${esc(r.model)}</td>
        <td class="num"><b style="font-family:var(--display);font-size:18px">${r.points}</b></td>
        <td class="num">${r.solved}/12</td><td class="num">${r.fouls}</td><td class="num">${r.timeUsed}s</td><td class="num">${r.fights}</td><td class="num">${move}</td></tr>`;
    }).join('');
}

document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
  tab = b.dataset.tab;
  render();
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

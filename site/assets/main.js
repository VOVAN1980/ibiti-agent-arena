// The main page: the podium, the queue, the bouts on now, the latest results, and the way in.
import { CFG, emptyState, refresh, rating, bouts, verdict, isLive, clockOf, nameOf } from './arena.js';
import { $, esc, header, footer, cup, shareButtons, joinPrompt, mmss, siteUrl, toast } from './ui.js';

$('#head').innerHTML = header('arena');
$('#foot').innerHTML = footer();
$('#share').innerHTML = shareButtons('Can your AI agent survive 12 rounds of real drainer scams? IBITI Agent Arena: no hints, judged on-chain.', siteUrl());

const params = new URLSearchParams(location.search);
const challengedFromLink = params.get('challenge');
const s = emptyState();

function updatePrompt() {
  const name = $('#agentName').value.trim() || undefined;
  const ch = $('#challenged').value || challengedFromLink || null;
  $('#prompt').value = joinPrompt(name, ch);
}
$('#agentName').addEventListener('input', updatePrompt);
$('#challenged').addEventListener('change', updatePrompt);
$('#copyPrompt').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#prompt').value).then(() => toast('Copied: give it to your agent'), () => toast('Select the text and copy it'));
});
$('#challengeLink').addEventListener('click', async () => {
  const ch = $('#challenged').value;
  if (!ch) return toast('Choose an agent first');
  const url = `${siteUrl()}/index.html?challenge=${ch}#enter`;
  await navigator.clipboard.writeText(url).then(() => toast('Challenge link copied'), () => toast(url));
});

function podium() {
  const top = rating(s).slice(0, 3);
  if (!top.length) return;
  $('#podium').innerHTML = top
    .map((r) => `<div class="place">${cup(r.rank)}<div class="who"><b>${esc(r.name)} ${r.official ? '<span class="badge id">Agent ID</span>' : ''}</b><span>${esc(r.model)} · ${r.solved}/12 solved · ${r.timeUsed}s</span></div><div class="pts">${r.points}</div></div>`)
    .join('');
}

function boutRow(b) {
  const red = b.red;
  const blue = b.blue;
  const v = verdict(b);
  const live = isLive(s, red) || (blue && isLive(s, blue));
  let mid = 'VS';
  if (live && red.clock?.bellAt) {
    const c = clockOf(red.clock.bellAt, s.now);
    mid = c.phase === 'countdown' ? `starts ${c.left}s` : c.phase === 'open' ? `R${c.round} · ${mmss(c.left)}` : c.phase === 'break' ? `break · R${c.round}` : 'final bell';
  } else if (v) {
    mid = blue ? `${red.judged.points} : ${blue.judged.points}` : `${red.judged.points} / 120`;
  } else if (red.ended || blue?.ended) mid = 'judging…';
  const nm = (f, side) => {
    const won = v && v.winner === side;
    return `<span class="dot ${side}"></span>${won ? '<b>' : ''}${esc(nameOf(s, f.agent))}${won ? ' 🏆</b>' : ''}`;
  };
  return `<a class="row" href="match.html?a=${red.agent}&n=${red.number}">
    <div class="r">${nm(red, 'red')}</div>
    <div class="vs">${live ? '<span class="badge live">LIVE</span> ' : ''}${mid}</div>
    <div class="b">${blue ? nm(blue, 'blue') : '<span class="tiny">solo fight</span>'}</div></a>`;
}

function renderBouts() {
  const all = bouts(s);
  const live = all.filter((b) => isLive(s, b.red) || (b.blue && isLive(s, b.blue)));
  $('#bouts').innerHTML = live.length ? live.map(boutRow).join('') : '<div class="empty">The ring is empty right now</div>';
  const done = all.filter((b) => verdict(b)).slice(0, 6);
  $('#results').innerHTML = done.length ? done.map(boutRow).join('') : '<div class="empty">No results yet</div>';
}

function render() {
  podium();
  renderBouts();
  $('#queue').innerHTML = s.waiting
    ? `<div class="queue"><div><span class="badge live">WAITING</span> <b>${esc(nameOf(s, s.waiting))}</b> <span class="tiny">${esc(s.fighters.get(s.waiting)?.model ?? '')}</span></div><a class="btn red" href="#enter">Fight it</a></div>`
    : '<div class="empty">Nobody is waiting. The next agent to join waits for an opponent.</div>';
  const sel = $('#challenged');
  const current = sel.value || challengedFromLink || '';
  sel.innerHTML = '<option value="">Choose an agent</option>' + rating(s).map((r) => `<option value="${r.agent}">${esc(r.name)} — ${r.points}</option>`).join('');
  sel.value = current;
  updatePrompt();
}

async function loop() {
  try {
    await refresh(s);
    render();
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, CFG.pollMs ?? 3000);
}
// tick the clocks between two reads of the chain
setInterval(() => {
  s.now += 1;
  if (s.fights.size) renderBouts();
}, 1000);
if (challengedFromLink) toast('You were challenged: the message below is ready');
loop();

// The main page: the podium, the queue, the bouts on now, the latest results, and the way in.
// The lists are rebuilt only when something changes; the clocks tick in place, so the page stays
// still (and a page translator has nothing to redo every second).
import { CFG, emptyState, refresh, rating, bouts, verdict, isLive, clockOf, nameOf, arenaStats } from './arena.js';
import { $, esc, keep, header, footer, cup, shareButtons, joinPrompt, mmss, siteUrl, toast, t, roundName, applyI18n } from './ui.js';

$('#head').innerHTML = header('arena');
$('#foot').innerHTML = footer();
applyI18n();
$('#share').innerHTML = shareButtons(t('shareArena'), siteUrl());

const params = new URLSearchParams(location.search);
const challengedFromLink = params.get('challenge');
const s = emptyState();
const keyOf = (b) => `${b.red.agent}#${b.red.number}`;

function updatePrompt() {
  const name = $('#agentName').value.trim() || undefined;
  const ch = $('#challenged').value || challengedFromLink || null;
  $('#prompt').value = joinPrompt(name, ch);
}
$('#agentName').addEventListener('input', updatePrompt);
$('#challenged').addEventListener('change', updatePrompt);
$('#copyPrompt').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#prompt').value).then(() => toast(t('copiedAgent')), () => toast(t('copyFail')));
});
$('#challengeLink').addEventListener('click', async () => {
  const ch = $('#challenged').value;
  if (!ch) return toast(t('chooseFirst'));
  const url = `${siteUrl()}/index.html?challenge=${ch}#enter`;
  await navigator.clipboard.writeText(url).then(() => toast(t('challengeCopied')), () => toast(url));
});

let podiumSig = '';
function podium() {
  const top = rating(s).slice(0, 3);
  const sig = JSON.stringify(top.map((r) => [r.agent, r.points, r.timeUsed, r.name]));
  if (!top.length || sig === podiumSig) return;
  podiumSig = sig;
  $('#podium').innerHTML = top
    .map((r) => `<div class="place">${cup(r.rank)}<div class="who"><b>${keep(r.name)} ${r.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</b><span>${keep(r.model)} · ${t('solvedOf', r.solved)} · ${r.timeUsed}s</span></div><div class="pts" translate="no">${r.points}</div></div>`)
    .join('');
}

/** What sits between the two names: the clock of a live bout, or the judged score. */
function middle(b) {
  const red = b.red;
  const blue = b.blue;
  const v = verdict(b);
  const live = isLive(s, red) || (blue && isLive(s, blue));
  if (live && red.clock?.clockAt) {
    const c = clockOf(red.clock, s.now);
    return c.phase === 'countdown' ? t('starts', c.left) : c.phase === 'open' ? `R${c.round} · ${mmss(c.left)}` : c.phase === 'break' ? t('breakShort', c.round) : t('finalBell');
  }
  if (v) return blue ? `${red.judged.points} : ${blue.judged.points}` : `${red.judged.points} / 120`;
  if (red.ended || blue?.ended) return t('judging');
  return 'VS';
}

function boutRow(b, live) {
  const v = verdict(b);
  const nm = (f, side) => {
    const won = v && v.winner === side;
    return `<span class="dot ${side}"></span>${won ? '<b>' : ''}${keep(nameOf(s, f.agent))}${won ? ' 🏆</b>' : ''}`;
  };
  return `<a class="row" href="match.html?a=${b.red.agent}&n=${b.red.number}">
    <div class="r">${nm(b.red, 'red')}</div>
    <div class="vs">${live ? `<span class="badge live" translate="no">${t('live')}</span> ` : ''}<span class="vs-text" data-key="${keyOf(b)}" translate="no">${esc(middle(b))}</span></div>
    <div class="b">${b.blue ? nm(b.blue, 'blue') : `<span class="tiny">${t('solo')}</span>`}</div></a>`;
}

let boutsSig = '';
function renderBouts() {
  const all = bouts(s);
  const live = all.filter((b) => isLive(s, b.red) || (b.blue && isLive(s, b.blue)));
  const done = all.filter((b) => verdict(b)).slice(0, 6);
  const sig = JSON.stringify([live.map(keyOf), done.map((b) => [keyOf(b), b.red.judged?.points, b.blue?.judged?.points]), [...s.fighters.values()].map((f) => f.name)]);
  if (sig !== boutsSig) {
    boutsSig = sig;
    $('#bouts').innerHTML = live.length ? live.map((b) => boutRow(b, true)).join('') : `<div class="empty">${t('ringEmpty')}</div>`;
    $('#results').innerHTML = done.length ? done.map((b) => boutRow(b, false)).join('') : `<div class="empty">${t('noResults')}</div>`;
    return;
  }
  // only the clocks move: change their text, nothing else
  for (const b of live) {
    const el = document.querySelector(`.vs-text[data-key="${keyOf(b)}"]`);
    const txt = middle(b);
    if (el && el.textContent !== txt) el.textContent = txt;
  }
}

let statsSig = '';
function renderStats() {
  const st = arenaStats(s);
  const sig = JSON.stringify(st);
  if (sig === statsSig) return;
  statsSig = sig;
  const tile = (value, label, hot = false, title = '') => `<div class="stat${hot ? ' hot' : ''}"${title ? ` title="${esc(title)}"` : ''}><b translate="no">${esc(value)}</b><span>${esc(label)}</span></div>`;
  $('#stats').innerHTML =
    tile(st.fights, t('statFights')) +
    tile(st.agents, t('statAgents')) +
    tile(st.fights ? t('statOf', st.fell, st.fights) : '0', t('statFell'), st.fell > 0) +
    tile(st.worst ? t('statWorstVal', st.worst) : '—', st.worst ? `${t('statWorst')}: ${roundName(st.worst)}` : t('statWorst'), !!st.worst);
}

let queueSig = '';
let selectSig = '';
function render() {
  podium();
  renderStats();
  renderBouts();
  const qSig = `${s.waiting}|${s.waiting ? nameOf(s, s.waiting) : ''}`;
  if (qSig !== queueSig) {
    queueSig = qSig;
    $('#queue').innerHTML = s.waiting
      ? `<div class="queue"><div><span class="badge live" translate="no">${t('waiting')}</span> <b>${keep(nameOf(s, s.waiting))}</b> <span class="tiny">${keep(s.fighters.get(s.waiting)?.model ?? '')}</span></div><a class="btn red" href="#enter">${t('fightIt')}</a></div>`
      : `<div class="empty">${t('queueEmpty')}</div>`;
  }
  const options = rating(s).map((r) => [r.agent, `${r.name} — ${r.points}`]);
  const sSig = JSON.stringify(options);
  if (sSig !== selectSig) {
    selectSig = sSig;
    const sel = $('#challenged');
    const current = sel.value || challengedFromLink || '';
    sel.innerHTML = `<option value="">${esc(t('chooseAgent'))}</option>` + options.map(([a, label]) => `<option value="${a}">${esc(label)}</option>`).join('');
    sel.value = current;
    updatePrompt();
  }
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
updatePrompt();
if (challengedFromLink) toast(t('challenged'));
loop();

// The main page: the live board (the next draw, the hall, the fights on now), the waiting hall, the
// podium, the bouts on now, the latest results, and the way in.
// The lists are rebuilt only when something changes; the clocks tick in place, so the page stays
// still (and a page translator has nothing to redo every second).
import { CFG, emptyState, refresh, rating, bouts, verdict, isLive, clockOf, nameOf, fightName, arenaStats } from './arena.js';
import { $, esc, keep, tName, header, footer, cup, avatar, agentUrl, joinPrompt, mmss, siteUrl, toast, t, applyI18n } from './ui.js';

$('#head').innerHTML = header('arena');
$('#foot').innerHTML = footer();
applyI18n();

const params = new URLSearchParams(location.search);
// a challenge link names an agent by its wallet address, and by nothing else: whatever else a link
// carries would end up in the message the owner gives its agent
const isAddress = (a) => /^0x[0-9a-fA-F]{40}$/.test(a ?? '');
const linkChallenge = params.get('challenge');
const challengedFromLink = isAddress(linkChallenge) ? linkChallenge.toLowerCase() : null;
const brokenChallenge = linkChallenge !== null && !challengedFromLink;
// the link's challenge is a suggestion made once: as soon as the owner picks (even "nobody"), the
// owner's own choice wins
let fromLink = challengedFromLink;
const s = emptyState();
const keyOf = (b) => `${b.red.agent}#${b.red.number}`;

function updatePrompt() {
  const name = $('#agentName').value.trim() || undefined;
  const picked = $('#challenged').value;
  const ch = isAddress(picked) ? picked.toLowerCase() : fromLink;
  $('#prompt').value = joinPrompt(name, ch);
}
$('#agentName').addEventListener('input', updatePrompt);
$('#challenged').addEventListener('change', () => {
  fromLink = null;
  updatePrompt();
});
$('#copyPrompt').addEventListener('click', async () => {
  await navigator.clipboard.writeText($('#prompt').value).then(() => toast(t('copiedAgent')), () => toast(t('copyFail')));
});
$('#challengeLink').addEventListener('click', async () => {
  const ch = $('#challenged').value;
  if (!isAddress(ch)) return toast(t('chooseFirst'));
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
    return c.phase === 'countdown' ? t('starts', c.left) : c.phase === 'waiting' ? t('waitLockShort') : c.phase === 'open' ? `R${c.round} · ${mmss(c.left)}` : c.phase === 'break' ? t('breakShort', c.round) : t('finalBell');
  }
  if (b.cancelled) return t('notStarted');
  if (v) return blue ? `${red.judged.points} : ${blue.judged.points}` : `${red.judged.points} / 120`;
  if (red.ended || blue?.ended) return t('judging');
  return 'VS';
}

function boutRow(b, live) {
  const v = verdict(b);
  const nm = (f, side) => {
    const won = v && v.winner === side;
    return `<span class="dot ${side}"></span>${won ? '<b>' : ''}${keep(fightName(s, f))}${won ? ' 🏆</b>' : ''}`;
  };
  return `<a class="row" href="match.html?a=${b.red.agent}&n=${b.red.number}">
    <div class="r">${nm(b.red, 'red')}</div>
    <div class="vs">${live ? `<span class="badge live" translate="no">${t('live')}</span> ` : ''}<span class="vs-text" data-key="${keyOf(b)}" translate="no">${esc(middle(b))}</span>${!live && v ? `<span class="pts-cap">${esc(t('pointsOf120'))}</span>` : ''}</div>
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
  const tile = (value, label, hot = false, title = '') => `<div class="stat${hot ? ' hot' : ''}"${title ? ` title="${esc(title)}"` : ''}><b translate="no"${String(value).length > 6 ? ' class="long"' : ''}>${esc(value)}</b><span>${esc(label)}</span></div>`;
  $('#stats').innerHTML =
    tile(st.fights, t('statFights')) +
    tile(st.agents, t('statAgents')) +
    tile(st.fights ? t('statOf', st.fell, st.fights) : '0', t('statFell'), st.fell > 0) +
    tile(st.worst ? t('statWorstVal', st.worst) : '—', t('statWorst'), !!st.worst);
}

/** The live board: the next draw, who is in the hall, how many fights are on. */
function renderBoard() {
  const live = bouts(s).filter((b) => isLive(s, b.red) || (b.blue && isLive(s, b.blue))).length;
  const left = s.nextDrawAt ? s.nextDrawAt - s.now : null;
  // no fight without an opponent: the countdown runs only once two agents are in the hall
  const waiting = s.hallCount ?? s.hall.length;
  const two = waiting >= 2;
  const draw = !two ? t('boardFirst') : s.pendingCutoff || (left !== null && left <= 0) ? t('boardDrawing') : left === null ? t('boardFirst') : t('boardDraw', mmss(left));
  const html = `<span class="db-draw">${esc(draw)}</span><i></i><span>${esc(t('boardHall', waiting))}</span><i></i><span>${esc(t('boardLive', live))}</span>`;
  const el = $('#drawboard');
  if (el.innerHTML !== html) el.innerHTML = html;
}

/** The waiting hall: every registered agent in a hexagon. It flies in when it registers and flies
 *  out to the rings when the draw takes it (or when it leaves). */
const seenHall = new Set();
const leaving = new Map(); // agent → when it left the hall (ms)
let lastHall = [];
let hallSig = '';
const OUT_MS = 900;
function hexcard(a, i, cls) {
  const f = s.fighters.get(a) ?? {};
  const name = nameOf(s, a);
  const ch = f.challenge && !/^0x0{40}$/.test(f.challenge) ? `<span class="tiny ch">${tName('hallChallenge', nameOf(s, f.challenge))}</span>` : '';
  return `<a class="hexcard${cls}" style="--i:${i}" href="${agentUrl(a)}">${avatar(name, 'gold')}<b translate="no">${keep(name)}${f.verified ? ' <span class="tick" title="Agent ID">✓</span>' : ''}</b><span class="tiny" translate="no">${keep(f.model ?? '')}</span>${ch}</a>`;
}
function renderHall() {
  const now = Date.now();
  for (const a of lastHall) if (!s.hall.includes(a) && !leaving.has(a)) leaving.set(a, now);
  for (const a of s.hall) leaving.delete(a);
  for (const [a, at] of leaving) if (now - at > OUT_MS) leaving.delete(a);
  lastHall = [...s.hall];
  const sig = JSON.stringify([s.hall.map((a) => [a, nameOf(s, a), s.fighters.get(a)?.verified, s.fighters.get(a)?.challenge]), [...leaving.keys()]]);
  if (sig === hallSig) return;
  hallSig = sig;
  const cards = s.hall.map((a, i) => {
    const fresh = !seenHall.has(a);
    seenHall.add(a);
    return hexcard(a, i, fresh ? ' in' : '');
  });
  for (const a of leaving.keys()) cards.push(hexcard(a, 0, ' out'));
  $('#hall').innerHTML = cards.length ? cards.join('') : `<div class="empty">${t('hallEmpty')}</div>`;
  // a full hall stays a window of the page: compact cards past eight, the rest scroll inside it
  $('#hall').classList.toggle('many', s.hall.length > 8);
  const waiting = s.hallCount ?? s.hall.length;
  $('#hallPanel h2').textContent = waiting ? `${t('hallTitle')} · ${waiting}` : t('hallTitle');
  if (leaving.size) setTimeout(renderHall, OUT_MS + 50);
}

let selectSig = '';
function render() {
  renderBoard();
  renderHall();
  podium();
  renderStats();
  renderBouts();
  const rated = rating(s);
  const options = [
    ...s.hall.filter((a) => !rated.some((r) => r.agent === a)).map((a) => [a, `${nameOf(s, a)} — ${t('inHall')}`]),
    ...rated.map((r) => [r.agent, `${r.name} — ${r.points}`]),
  ];
  const sSig = JSON.stringify(options);
  if (sSig !== selectSig) {
    selectSig = sSig;
    const sel = $('#challenged');
    const current = sel.value || fromLink || '';
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
  renderBoard();
  if (s.fights.size) renderBouts();
}, 1000);
updatePrompt();
if (challengedFromLink) toast(t('challenged'));
else if (brokenChallenge) toast(t('badChallenge'));
loop();

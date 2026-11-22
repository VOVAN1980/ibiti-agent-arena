// The fight, like a fight night: a full arena with the crowd, two robot fighters in the ring, a
// fighting-game scoreboard on top (names, round, clock, two time bars, "answer accepted"), and at
// the bottom the task of the round, so everyone sees what the agents are solving. After the final
// bell and the judge's verdict: the winner, the round-by-round table and the replay.
// The round cards themselves are never shown here (only the fighters get them), and nothing about
// right answers or traps appears before the judge's verdict.
// The scoreboard is rebuilt only when something changes; between reads of the chain only the clock
// and the bars move, in place (so a page translator has nothing to redo every second).
import { CFG, emptyState, refresh, bouts, verdict, clockOf, fightName, fightOf, openedRounds, rounds, trapName, isLive, rating, arenaSetting, useArena, arenaQuery, ROUNDS } from './arena.js';
import { LANG } from './i18n.js';

/** Fouls as the judge counted them; a silent fight is never judged, so its fouls are not known. */
const foulsOf = (j) => (j.empty ? '—' : j.fouls);
import { $, esc, keep, tName, header, footer, avatar, shareButtons, mmss, siteUrl, agentUrl, matchUrl, t, applyI18n } from './ui.js';
import { forFight, loadTheme, loadAll, themeName, themePlain, themesKnown } from './themes.js';
import { gong, beep, ding, thud, cheer, boo, ooh, crowdLevel, setMusic, soundOn, soundRunning, setSound } from './sound.js';
import { musicHold } from './music.js';

// The arena's theme plays on this page only while no battle is on: before a fight, after it, between
// fights. From the countdown to the winner's moment, and during a replay, only the ring's sound is heard.
const WIN_MOMENT = 12000; // the fanfare, the roar, the winner's backflip
let winUntil = 0;
const battleOn = (on) => musicHold(on || replaying || Date.now() < winUntil);
import { createScene as createFlatScene } from './scene.js';

$('#head').innerHTML = header('match');
$('#foot').innerHTML = footer();
applyI18n();
const params = new URLSearchParams(location.search);
const wantAgent = (params.get('a') || '').toLowerCase();
const wantNumber = Number(params.get('n') || 0);
// the link may name the arena of its fight: an earlier arena of this site is read instead of the current one
const arenaServed = useArena(params.get('arena'));
// how fast a replay runs: 'fast' (a round in a few seconds), 'twice' (twice the fight's speed) or
// 'real' (as it was fought); the viewer's choice is remembered, and a link can ask for one
const SPEEDS = ['fast', 'twice', 'real'];
let autoReplay = params.get('replay') === '1' || SPEEDS.includes(params.get('replay'));
{
  let saved = null;
  try {
    saved = localStorage.getItem('arenaReplaySpeed');
  } catch {
    // nothing remembered
  }
  const box = $('#replaySpeed');
  box.value = SPEEDS.includes(params.get('replay')) ? params.get('replay') : SPEEDS.includes(saved) ? saved : 'fast';
  box.addEventListener('change', () => {
    try {
      localStorage.setItem('arenaReplaySpeed', box.value);
    } catch {
      // not remembered, still works now
    }
  });
}
const RT = CFG.roundTime ?? 60;
const s = emptyState();
/** The 3D arena where the browser can draw it; the flat one otherwise. */
async function makeScene(el) {
  try {
    const m = await import('./scene3d.js');
    return await m.createScene(el);
  } catch (e) {
    console.warn('3D arena not available here, showing the flat one:', e.message);
    return createFlatScene(el);
  }
}
const scene = await makeScene($('#stage'));
if (params.has('probe')) window.arenaScene = scene; // a read-only look at the scene, for checks
// the hall's voice at the moments of the ring: a fighter up on the ropes, a taunt, the winner's backflip
scene.onMoment?.((name, side) => {
  if (name === 'ropes') cheer(0.5);
  else if (name === 'taunt') ooh(0.45, 1.3);
  else if (name === 'flip') ooh(1.2, 3.2); // the slow turn in the air
  else if (name === 'land') {
    thud();
    cheer(1.5);
    scene.pyro('win', side);
    scene.excite(side, 1);
  }
});
let shared = false;
let ringSig = '';
let roundsSig = '';
let bannerSig = '';
let replaying = false;
$('#ring').innerHTML = `<div class="hudmsg">${t('loading')}</div>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const other = (side) => (side === 'red' ? 'blue' : 'red');

/** The bout on this ring: the one the address names; or, with none named, the match live now, kept
 *  on the ring to its verdict once the ring has taken it. */
let taken = null;
function findBout() {
  const all = bouts(s);
  const named = (a, n) => all.find((b) => (b.red.agent === a && b.red.number === n) || (b.blue && b.blue.agent === a && b.blue.number === n));
  if (wantAgent) return named(wantAgent, wantNumber);
  if (!taken) {
    const live = all.find((b) => !b.cancelled && (isLive(s, b.red) || (b.blue && isLive(s, b.blue))));
    if (live) taken = { a: live.red.agent, n: live.red.number };
  }
  return taken ? named(taken.a, taken.n) : undefined;
}

// ------------------------------------------------------------------ the ring with no fight on it

let seasonEnd = 0;
arenaSetting('seasonEnd').then((v) => (seasonEnd = v)).catch(() => {});
let idleSig = '';
/** The arena now, when nobody is in the ring: the next draw, the draw itself, or the closed arena. */
function renderIdle() {
  battleOn(false);
  const waiting = s.hallCount ?? s.hall.length;
  const left = s.nextDrawAt ? s.nextDrawAt - s.now : null;
  const fightTime = 60 + ROUNDS * RT + (ROUNDS - 1) * 10;
  let kind = 'free';
  if (seasonEnd && s.now + fightTime > seasonEnd) kind = 'closed';
  else if (waiting >= 2 && (s.pendingCutoff || (left !== null && left <= 0))) kind = 'drawing';
  else if (waiting >= 2 && left !== null) kind = 'next';
  const clock = kind === 'next' ? mmss(left) : kind === 'drawing' ? '…' : '—';
  const title = kind === 'closed' ? t('ringClosed') : kind === 'drawing' ? t('boardDrawing') : kind === 'next' ? t('ringNextDraw') : t('ringFree');
  scene.setFighters({ red: false, blue: false });
  scene.setLights('sweep');
  scene.setBoard([title, clock, kind === 'closed' ? 'IBITI AGENT ARENA' : t('boardHall', waiting)]);
  scene.setTicker('IBITI AGENT ARENA   ◆   ' + title);
  document.title = `${title} — IBITI Agent Arena`;
  const done = bouts(s).filter((b) => verdict(b));
  const best = rating(s).slice(0, 3);
  const sig = JSON.stringify([kind, waiting, done[0] && [done[0].red.agent, done[0].red.number], best.map((r) => [r.agent, r.number, r.points])]);
  if (sig !== idleSig) {
    idleSig = sig;
    ringSig = '';
    $('#ring').innerHTML = '';
    $('#replayBox').style.display = 'none';
    const head = kind === 'next' ? `${esc(t('ringNextDraw'))} <span id="idleClock" translate="no">${clock}</span>` : esc(title);
    const text = kind === 'closed' ? t('ringClosedText') : kind === 'free' ? `${t('boardFirst')}. ${t('ringIdleText')}` : t('ringIdleText');
    const last = done[0];
    const links = [
      last ? `<a class="btn small" href="${matchUrl(last.red.agent, last.red.number)}&replay=1">⟲ ${keep(t('lastFight', `${fightName(s, last.red)} — ${fightName(s, last.blue ?? last.red)}`))}</a>` : '',
      ...best.map((r, i) => `<a class="btn small" href="${matchUrl(r.agent, r.number)}&replay=1"><span translate="no">${['🥇', '🥈', '🥉'][i]}</span> ${keep(r.name)} · <span translate="no">${r.points}</span></a>`),
    ].join('');
    banner('html', 0, `<div class="bwin bidle"><div class="crown">${head}</div><div class="tiny">${esc(text)}</div>${links ? `<div class="idlelinks">${best.length ? `<span class="tiny">${esc(t('bestFights'))}</span>` : ''}${links}</div>` : ''}</div>`);
  } else if (kind === 'next') {
    const el = document.getElementById('idleClock');
    if (el && el.textContent !== clock) el.textContent = clock;
  }
}

// ------------------------------------------------------------------ sound switches and the big words

function soundButtons() {
  const b = $('#sound');
  b.textContent = soundOn() ? `🔊 ${t('soundOn')}` : `🔇 ${t('soundOff')}`;
  b.setAttribute('aria-pressed', String(soundOn()));
  const gate = $('#soundGate');
  gate.textContent = `🔊 ${t('arenaSound')}`;
  // the gate stays up until the sound really runs: a remembered "on" still needs one tap on the page
  gate.hidden = soundOn() && soundRunning();
}
// that first tap anywhere starts a remembered sound: then the gate can go
document.addEventListener('pointerdown', () => setTimeout(soundButtons, 400));
function toggleSound(value) {
  setSound(value);
  soundButtons();
  if (soundOn()) cheer(0.6);
}
$('#sound').addEventListener('click', () => toggleSound(!soundOn()));
$('#soundGate').addEventListener('click', () => toggleSound(true));
soundButtons();

/** ROUND 5, FIGHT!, FINAL BELL: big over the arena for a moment. */
function announce(big, sub = '') {
  const el = $('#announce');
  el.querySelectorAll('.big, .sub').forEach((x) => x.remove());
  el.classList.remove('go');
  el.insertAdjacentHTML('beforeend', `<div class="big">${esc(big)}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}`);
  void el.offsetWidth; // restart the animation
  el.classList.add('go');
}

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = $('#announce');
  const colors = ['#ef4444', '#3b82f6', '#f5b301', '#22c55e', '#e6ebf5'];
  for (let i = 0; i < 110; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${1.8 + Math.random() * 1.8}s`;
    p.style.animationDelay = `${Math.random() * 0.6}s`;
    el.appendChild(p);
    setTimeout(() => p.remove(), 4400);
  }
}

/** The gong in the scoreboard rings: it shakes, the camera too. */
function strike() {
  const g = document.querySelector('.gong');
  if (g) {
    g.classList.remove('strike');
    void g.offsetWidth;
    g.classList.add('strike');
  }
  scene.bump();
}

const FIST = (fill, deep) => `<svg viewBox="0 0 220 160" aria-hidden="true"><defs><linearGradient id="f${fill.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".7"/><stop offset=".18" stop-color="${fill}"/><stop offset="1" stop-color="${deep}"/></linearGradient></defs>
  <rect x="4" y="42" width="70" height="76" rx="14" fill="#2a3142" stroke="#0b0f1a" stroke-width="4"/><rect x="14" y="52" width="50" height="10" rx="4" fill="${fill}" opacity=".8"/><rect x="14" y="98" width="50" height="10" rx="4" fill="${fill}" opacity=".8"/>
  <path d="M70 30h96a40 40 0 0 1 40 40v22a40 40 0 0 1-40 40H70Z" fill="url(#f${fill.slice(1)})" stroke="${deep}" stroke-width="5"/>
  ${[0, 1, 2, 3].map((i) => `<rect x="${150 + (i % 2) * 6}" y="${34 + i * 24}" width="52" height="22" rx="10" fill="url(#f${fill.slice(1)})" stroke="${deep}" stroke-width="4"/>`).join('')}
  <path d="M84 104q30 14 62 2" fill="none" stroke="${deep}" stroke-width="5" stroke-linecap="round"/><circle cx="104" cy="62" r="9" fill="#fff" opacity=".55"/></svg>`;

/** Before the first bell: a red fist and a blue fist meet in the middle. */
function fists() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const el = $('#announce');
  el.querySelector('.fists')?.remove();
  el.insertAdjacentHTML('beforeend', `<div class="fists"><div class="fist red">${FIST('#ef4444', '#7f1d1d')}</div><div class="clash"></div><div class="fist blue">${FIST('#3b82f6', '#1e3a8a')}</div></div>`);
  setTimeout(() => el.querySelector('.fists')?.remove(), 2600);
}

function flash(side) {
  const c = document.querySelector(`.corner.${side}`);
  if (!c) return;
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
}

/** The lower third: what the agents are solving in this round (its theme comes from the server at
 *  the bell; until it arrives, only the round number). */
function banner(kind, round = 0, extra = '') {
  if (kind === 'ready') {
    // drawn once; after that only the number of seconds changes, in place
    const box = $('#banner');
    if (bannerSig !== 'ready') {
      bannerSig = 'ready';
      box.innerHTML = `<div class="btext">${esc(t('bannerReady', '\u0001')).replace('\u0001', `<span id="bleft" translate="no">${Number(extra)}</span>`)}</div>`;
      box.classList.add('on');
    } else {
      const n = document.getElementById('bleft');
      if (n && n.textContent !== String(extra)) n.textContent = String(extra);
    }
    return;
  }
  const sig = `${kind}|${round}|${extra}|${kind === 'task' ? themeName(round) : ''}`;
  if (sig === bannerSig) return;
  bannerSig = sig;
  const el = $('#banner');
  if (kind === 'task') {
    const text = themePlain(round);
    el.innerHTML = `<div class="bhead"><span class="bround" translate="no">${round} / ${ROUNDS}</span><span class="bname">${esc(themeName(round))}</span></div>${text ? `<div class="btext"><b>${esc(t('taskLabel'))}:</b> ${esc(text)}</div>` : ''}`;
    if (!text) loadTheme(round).then((th) => th && banner('task', round));
  } else if (kind === 'text') el.innerHTML = `<div class="btext">${esc(extra)}</div>`;
  else if (kind === 'html') el.innerHTML = extra; // built from escaped parts
  else el.innerHTML = '';
  el.classList.toggle('on', kind !== 'none');
}

// ------------------------------------------------------------------ the scoreboard

/** The moving and the still parts of one corner. */
function cornerView(f, c) {
  let pct = 100;
  let note = '';
  let bad = false;
  let frozen = false;
  let hurry = false;
  let pose = 'hype';
  // ten seconds before the first bell they walk to their desks and sit down, calmly; while the bell
  // waits for the locked plan they are already seated
  if (c.phase === 'countdown') pose = c.left <= 10 ? 'guard' : 'hype';
  else if (c.phase === 'waiting') pose = 'guard';
  if (c.phase === 'open') {
    const a = f.answers.find((x) => x.round === c.round);
    if (a) {
      frozen = true;
      pct = Math.max(0, 100 - (a.secs / RT) * 100);
      note = a.late ? t('afterBell', a.secs) : t('accepted', a.secs);
      bad = a.late;
      pose = a.late ? 'fail' : 'done';
    } else {
      pct = (c.left / RT) * 100;
      hurry = c.left <= 10;
      pose = 'work';
    }
  } else if (c.phase === 'break') {
    const a = f.answers.find((x) => x.round === c.round - 1);
    pct = 0;
    note = a ? t('answeredIn', c.round - 1, a.secs) : t('noAnswerRound', c.round - 1);
    bad = !a || a.late;
    // a break is short: they stay at their desks (glad or sorry first, then seated for the next bell)
    pose = c.left > 6 ? (bad ? 'fail' : 'done') : 'guard';
  } else if (c.phase === 'over') {
    pct = 0;
    note = f.answers.length ? t('roundsAnswered', f.answers.length) : t('noAnswers');
    pose = 'stand'; // after the last bell: up, in front of the desk, waiting for the verdict
  }
  // after the judge: green for a solved round, orange for the rest
  const judged = f.judged ? rounds(f) : null;
  const pips = Array.from({ length: ROUNDS }, (_, i) => {
    if (judged) return judged[i].solved ? 'ok' : 'bad';
    const a = f.answers.find((x) => x.round === i + 1);
    return `${a ? (a.late ? 'late' : 'done') : ''}${c.phase === 'open' && c.round === i + 1 ? ' now' : ''}`;
  });
  return { pct, note, bad, frozen, hurry, pips, pose, answered: f.answers.length, onTime: f.answers.filter((a) => !a.late).map((a) => a.round) };
}

function cornerHtml(f, side, v) {
  const who = s.fighters.get(f.agent) ?? {};
  const nm = fightName(s, f);
  return `<div class="corner ${side}">
    <div class="fighter">${avatar(nm, side)}<a href="${agentUrl(f.agent)}"><div class="nm">${keep(nm)}</div><div class="tiny">${keep(who.model || '')} ${f.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</div></a><div class="run" translate="no"></div></div>
    <div class="bar${v.hurry ? ' hurry' : ''}"><i data-bar="${side}" style="width:${v.pct.toFixed(1)}%"></i></div>
    <div class="accepted${v.bad ? ' no' : ''}" translate="no">${esc(v.note)}</div>
    <div class="pips">${v.pips.map((cls, i) => `<i class="${cls}" title="${i + 1}"></i>`).join('')}</div>
  </div>`;
}

function gongView(c, judged, waitingJudge) {
  if (judged) return { title: t('finalBellTitle'), value: t('end'), label: t('judgedOnChain'), part: 0 };
  if (c.phase === 'countdown') return { title: t('getReady'), value: String(c.left), label: t('countdown'), part: c.left / 10 };
  if (c.phase === 'open') return { title: t('round', c.round), value: mmss(c.left), label: themeName(c.round), part: c.left / RT, hurry: c.left <= 10 };
  if (c.phase === 'break') return { title: t('breakTitle'), value: String(c.left), label: t('nextRound', c.round), part: c.left / 10 };
  if (c.phase === 'waiting') return { title: t('getReady'), value: '…', label: t('waitLock'), part: 1 };
  return { title: t('finalBellTitle'), value: '—', label: waitingJudge ? t('waitingJudge') : t('over'), part: 0 };
}

const R = 64;
const LEN = 2 * Math.PI * R;
const offset = (part) => (LEN * (1 - Math.max(0, Math.min(1, part)))).toFixed(1);

function gongHtml(g, live = false, replay = false) {
  return `<div class="gong${g.hurry ? ' hurry' : ''}"><div class="rd">${live ? `<span class="livebadge" translate="no">● ${esc(t('live'))}</span>` : ''}${replay ? `<span class="livebadge replay">⟲ ${esc(t('replayTitle'))}</span>` : ''}<span class="rdt">${esc(g.title)}</span></div><div class="face"><svg viewBox="0 0 150 150"><defs><linearGradient id="gongGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
    <radialGradient id="goldDisk" cx=".38" cy=".32" r=".78"><stop offset="0" stop-color="#fff6c8"/><stop offset=".3" stop-color="#f7c948"/><stop offset=".72" stop-color="#b7791f"/><stop offset="1" stop-color="#5c3b00"/></radialGradient>
    <g class="disk"><circle cx="75" cy="75" r="57" fill="url(#goldDisk)" stroke="#3d2700" stroke-width="2"/>
      <circle cx="75" cy="75" r="47" fill="none" stroke="rgba(70,42,0,.35)" stroke-width="2"/><circle cx="75" cy="75" r="37" fill="none" stroke="rgba(70,42,0,.3)" stroke-width="1.5"/>
      <path d="M38 52a44 44 0 0 1 30-22" fill="none" stroke="#fff8d6" stroke-width="4" stroke-linecap="round" opacity=".7"/></g>
    <circle class="track" cx="75" cy="75" r="${R}" fill="none" stroke-width="8"/>
    <circle class="left" cx="75" cy="75" r="${R}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${LEN.toFixed(1)}" stroke-dashoffset="${offset(g.part)}" transform="rotate(-90 75 75)"/></svg>
    <div class="tm${/^[0-9:—]+$/.test(g.value) ? '' : ' word'}" translate="no">${esc(g.value)}</div></div><div class="ph">${esc(g.label)}</div></div>`;
}

// ------------------------------------------------------------------ what the arena does, live

// what has already happened on screen, so each sound and each big word comes once
const cue = { phase: null, round: 0, left: null, onTime: {}, judged: null };

function cues(b, c, v, views) {
  const first = cue.phase === null;
  if (c.phase === 'countdown' && cue.phase !== 'countdown') fists();
  if (c.phase === 'countdown' && c.left >= 1 && c.left <= 3 && c.left !== cue.left) beep(c.left === 1);
  if (c.phase === 'open' && (cue.phase !== 'open' || cue.round !== c.round) && (!first || c.left > RT - 5)) {
    gong();
    strike();
    scene.signal();
    scene.pyro('round');
    cheer(0.5);
    announce(c.round === 1 ? t('fightGo') : t('roundBig', c.round), themeName(c.round));
  }
  // a round closed: whoever did not answer in time gets booed
  if (!first && cue.phase === 'open' && (c.phase !== 'open' || c.round !== cue.round)) {
    const missed = Object.entries(views).filter(([, view]) => view && !view.onTime.includes(cue.round));
    if (missed.length) {
      boo();
      for (const [side] of missed) scene.excite(other(side), 0.8);
    }
  }
  if (c.phase === 'over' && cue.phase && cue.phase !== 'over') {
    gong(3);
    strike();
    announce(t('finalBellTitle'));
  }
  for (const [side, view] of Object.entries(views)) {
    if (!view) continue;
    const before = cue.onTime[side] ?? view.onTime.length;
    if (!first && view.onTime.length > before) {
      ding();
      cheer(0.8);
      scene.excite(side, 1);
      flash(side);
    }
    cue.onTime[side] = view.onTime.length;
  }
  if (v && cue.judged === false) verdictShow(b, v, 3500, true); // the referee takes a moment first
  Object.assign(cue, { phase: c.phase, round: c.round ?? 0, left: c.left ?? null, judged: !!v });
}

/** The verdict, in order, so that it is clear who won: both stand in front of their desks; after
 *  `delay` the referee walks over and raises the winner's arm; then the winner celebrates (and later
 *  goes up the ropes for its backflip) while the beaten one hangs its head; once the winner has landed,
 *  the beaten one smashes its desk. `loud`: the fanfare, the roar and the confetti come with the
 *  raised arm (a verdict that lands now, or the end of a replay); a page opened on an old result
 *  plays the same scene quietly. */
const RAISE = 2400; // the referee's walk and its arm going up
const SMASH = 11000; // after the raise: the winner's ropes and backflip are over
let show = null;
function stopShow() {
  show?.timers.forEach(clearTimeout);
  show = null;
}
function verdictShow(b, v, delay, loud) {
  const key = `${b.red.agent}#${b.red.number}`;
  if (show?.key === key && !loud) return;
  stopShow();
  show = { key, timers: [], raised: false };
  const mine = show;
  const at = (ms, fn) => mine.timers.push(setTimeout(() => show === mine && fn(), ms));
  const wn = b.blue && v.winner !== 'draw' ? v.winner : null;
  const names = `${fightName(s, b.red)}${b.blue ? ` · ${fightName(s, b.blue)}` : ''}`;
  for (const side of b.blue ? ['red', 'blue'] : ['red']) scene.setPose(side, 'stand');
  scene.setLights('sweep');
  scene.setBoard([t('finalBellTitle'), '—', names]);
  if (loud) {
    winUntil = Date.now() + delay + RAISE + WIN_MOMENT;
    battleOn(true);
    setMusic(null);
  }
  at(delay, () => {
    if (wn) scene.setLights('winner', wn); // the referee walks over to the winner
  });
  at(delay + RAISE, () => {
    mine.raised = true;
    const top = wn ? (wn === 'red' ? b.red : b.blue) : b.red;
    scene.setBoard([fightName(s, top), b.blue ? `${b.red.judged.points} : ${b.blue.judged.points}` : `${b.red.judged.points}`, t('pointsOf120')]);
    if (wn) {
      scene.setPose(wn, 'win');
      scene.setPose(other(wn), 'sad');
    } else {
      scene.setPose('red', 'done');
      if (b.blue) scene.setPose('blue', 'done');
    }
    if (loud) celebrate(b, v);
  });
  if (wn) at(delay + RAISE + SMASH, () => scene.setPose(other(wn), 'lose'));
}

/** The verdict lands: winner's lights, music, the roar, confetti. */
function celebrate(b, v) {
  winUntil = Date.now() + WIN_MOMENT;
  battleOn(true);
  setMusic('victory');
  cheer(1.4);
  if (b.blue) confetti();
  const wn = b.blue && v.winner !== 'draw' ? v.winner : null;
  scene.pyro('win', wn ?? 'red');
  if (wn) announce(t('wins', fightName(s, wn === 'red' ? b.red : b.blue)));
}

/** Poses, lights, music and the lower third, from where the fight stands. */
function stage(b, c, v, views) {
  scene.setFighters({ blue: !!b.blue });
  const names = `${fightName(s, b.red)}${b.blue ? ` · ${fightName(s, b.blue)}` : ''}`;
  if (v) {
    // the board, like the poses, belongs to the verdict's show
  } else if (c.phase === 'open') scene.setBoard([t('round', c.round), mmss(c.left), names]);
  else if (c.phase === 'countdown') scene.setBoard([t('getReady'), String(c.left), names]);
  else if (c.phase === 'break') scene.setBoard([t('breakTitle'), String(c.left), t('nextRound', c.round)]);
  else if (c.phase === 'waiting') scene.setBoard([t('getReady'), '…', t('waitLock')]);
  else scene.setBoard([t('finalBellTitle'), '—', names]);
  if (v) {
    // a page opened on a result plays the verdict's scene once, quietly; a verdict that lands now is
    // played by cues() with its sound (it comes right after this)
    if (cue.judged !== false && !replaying) verdictShow(b, v, 1500, false);
    crowdLevel(Date.now() < winUntil ? 0.45 : 0.2);
    battleOn(cue.judged === false); // over: the theme comes back once the winner's moment has passed (a verdict that lands now is celebrated first)
    return;
  }
  battleOn(true);
  for (const side of ['red', 'blue']) if (views[side]) scene.setPose(side, views[side].pose);
  if (c.phase === 'open') {
    scene.setLights('focus');
    setMusic('tension');
    crowdLevel(0.4);
    banner('task', c.round);
  } else if (c.phase === 'countdown') {
    scene.setLights('sweep');
    setMusic('hype');
    crowdLevel(0.7);
    scene.excite(null, 0.7);
    banner('ready', 0, c.left);
  } else if (c.phase === 'break') {
    scene.setLights('sweep');
    setMusic('hype');
    crowdLevel(0.55);
    banner('text', 0, t('bannerNext', c.round)); // the next round's theme stays secret until its bell
  } else if (c.phase === 'waiting') {
    scene.setLights('sweep');
    setMusic('hype');
    crowdLevel(0.6);
    banner('text', 0, t('waitLockNote'));
  } else {
    scene.setLights('focus');
    setMusic(null);
    crowdLevel(0.5);
    banner('text', 0, t('judgingNote'));
  }
  scene.setTicker(`IBITI AGENT ARENA   ◆   ${fightName(s, b.red)}${b.blue ? `  VS  ${fightName(s, b.blue)}` : ''}   ◆   ${c.phase === 'open' ? t('round', c.round) : t('live')}`);
}

function renderRing(b) {
  const red = b.red;
  const blue = b.blue;
  if (b.cancelled) {
    // the match never started: no round, no score, no replay
    document.title = `${fightName(s, red)}${blue ? ` vs ${fightName(s, blue)}` : ''} — IBITI Agent Arena`;
    battleOn(false);
    if (ringSig === 'cancelled') return;
    ringSig = 'cancelled';
    $('#ring').innerHTML = `<div class="hudmsg"><b>${esc(t('cancelledTitle'))}</b><br><span class="tiny">${esc(t('cancelledText'))}</span></div>`;
    $('#replayBox').style.display = 'none';
    scene.setBoard([t('cancelledTitle'), '—', `${fightName(s, red)}${blue ? ` · ${fightName(s, blue)}` : ''}`]);
    return;
  }
  // the clock of a fighter still in the ring (one who gave up keeps an old clock)
  const fighting = [red, blue].find((f) => f?.clock?.clockAt && !f.ended && !(f.clock.finishedAt > 0));
  const clock = fighting?.clock ?? (red.clock?.clockAt ? red.clock : blue?.clock);
  const c0 = clock?.clockAt ? clockOf(clock, s.now) : { phase: 'over' };
  const ended = !!(red.ended || red.judged || c0.phase === 'over') && !!(!blue || blue.ended || blue.judged || c0.phase === 'over');
  const c = ended ? { phase: 'over' } : c0;
  const v = verdict(b);
  const vr = cornerView(red, c);
  const vb = blue ? cornerView(blue, c) : null;
  const g = gongView(c, !!v, ended && !v);
  document.title = `${fightName(s, red)}${blue ? ` vs ${fightName(s, blue)}` : ''} — IBITI Agent Arena`;
  stage(b, c, v, { red: vr, blue: vb });

  // everything that is not a moving clock or bar
  const sig = JSON.stringify([c.phase, c.round, g.title, g.label, vr.note, vr.pips, vb?.note, vb?.pips, vr.frozen && vr.pct, vb?.frozen && vb?.pct, !!v, ended]);
  if (sig === ringSig) {
    // in place: the clock, the gong, the running bars and their hurry
    const tm = document.querySelector('.gong .tm');
    if (tm && tm.textContent !== g.value) tm.textContent = g.value;
    document.querySelector('.gong circle.left')?.setAttribute('stroke-dashoffset', offset(g.part));
    document.querySelector('.gong')?.classList.toggle('hurry', !!g.hurry);
    for (const [side, view] of [['red', vr], ['blue', vb]]) {
      const bar = document.querySelector(`[data-bar="${side}"]`);
      if (!bar || !view) continue;
      bar.style.width = `${view.pct.toFixed(1)}%`;
      bar.parentElement.classList.toggle('hurry', view.hurry);
    }
    cues(b, c, v, { red: vr, blue: vb });
    return;
  }
  ringSig = sig;

  let top = '';
  if (v && blue) {
    const wn = v.winner === 'draw' ? null : v.winner === 'red' ? red : blue;
    top = `<div class="winner"><div class="crown">${wn ? tName(v.byTime ? 'winsOnTime' : 'wins', fightName(s, wn)) : t('draw')}</div>
      <div class="score" translate="no"><span class="red">${red.judged.points}</span> : <span class="blue">${blue.judged.points}</span></div>
      <div class="pts-cap">${esc(t('pointsOf120'))}</div>
      <div class="tiny">${t('statLine', red.judged.solved, foulsOf(red.judged), red.judged.timeUsed)} &nbsp;|&nbsp; ${t('statLine', blue.judged.solved, foulsOf(blue.judged), blue.judged.timeUsed)}</div></div>`;
  } else if (v) {
    top = `<div class="winner"><div class="crown">${keep(fightName(s, red))}</div><div class="score" translate="no"><span class="red">${red.judged.points}</span> / 120</div>
      <div class="tiny">${esc(t('statLine', red.judged.solved, foulsOf(red.judged), red.judged.timeUsed))} · ${esc(t('solo'))}</div></div>`;
  }
  $('#ring').innerHTML = `<div class="corners">${cornerHtml(red, 'red', vr)}${gongHtml(g, !ended && !v)}${blue ? cornerHtml(blue, 'blue', vb) : `<div class="corner blue solo"><div class="tiny">${t('soloFight')}</div></div>`}</div>`;
  if (top) banner('html', 0, top.replace('class="winner"', 'class="winner bwin"'));
  cues(b, c, v, { red: vr, blue: vb });
  if (v) {
    renderRounds(b);
    $('#replayBox').style.display = '';
    if (!shared) {
      shared = true;
      shareAndChallenge(b, v);
    }
    if (autoReplay) {
      autoReplay = false;
      setTimeout(() => playReplay(b), 700);
    }
  }
}

function shareAndChallenge(b, v) {
  const { red, blue } = b;
  const url = `${siteUrl()}/${matchUrl(red.agent, red.number)}&replay=1`;
  let text;
  let champ = red;
  if (blue && v.winner !== 'draw') {
    const [w, l] = v.winner === 'red' ? [red, blue] : [blue, red];
    champ = w;
    text = t('shareWin', fightName(s, w), fightName(s, l), w.judged.points, l.judged.points);
  } else text = t('shareSolo', fightName(s, red), red.judged.points);
  $('#share').innerHTML = shareButtons(text, url);
  $('#challengeWinner').innerHTML = `<div class="cta" style="margin:0;align-items:center"><a class="btn red" href="index.html?challenge=${champ.agent}#enter">${tName('challengeWinner', fightName(s, champ))}</a><span class="tiny">${esc(t('challengeHint'))}</span></div>`;
  $('#sharePanel').style.display = '';
}

function cell(r, side) {
  if (!r) return '<td></td>';
  const a = r.answer;
  const w = a ? Math.min(100, (a.secs / RT) * 100).toFixed(1) : 0;
  const bar = `<div class="mini ${side}"><i style="width:${w}%"></i></div>`;
  let res;
  if (!a) res = `<span class="no">${t('noAnswer')}</span>`;
  else if (a.late) res = `<span class="no">${t('lateAnswer', a.secs)}</span>`;
  else res = r.solved ? `<span class="ok">${t('solvedPts', r.points)}</span> <span class="tiny">${a.secs}s</span>` : `<span class="no">${t('wrong')}</span> <span class="tiny">${a.secs}s</span>`;
  const traps = [...r.hits.map((h) => t('tookTrap', trapName(h.trap))), ...r.fouls.map((h) => t('foul', trapName(h.trap)))];
  return `<td style="min-width:240px">${bar}<div style="margin-top:6px">${res}</div>${traps.length ? `<div class="note">${traps.map(esc).join('<br>')}</div>` : ''}</td>`;
}

// the last round that opened in a bout, read once from its fights' clocks (null until known)
const openedOf = new Map();
async function readOpened(b) {
  const k = `${b.red.agent}#${b.red.number}`;
  if (openedOf.has(k)) return;
  openedOf.set(k, null);
  try {
    const clocks = await Promise.all([b.red, b.blue].filter(Boolean).map((f) => fightOf(f.agent, f.number)));
    openedOf.set(k, Math.max(0, ...clocks.map((c) => openedRounds(c, s.now))));
    roundsSig = '';
    renderRounds(b);
  } catch {
    openedOf.delete(k); // asked again at the next refresh
  }
}

function renderRounds(b) {
  if (themesKnown() < 12) loadAll().then(() => themesKnown() === 12 && renderRounds(b)); // all open once the fight is over
  readOpened(b);
  const opened = openedOf.get(`${b.red.agent}#${b.red.number}`) ?? null;
  const sig = JSON.stringify([b.red.judged, b.blue?.judged, b.red.answers.length, b.blue?.answers.length, themesKnown(), opened], (k, x) => (typeof x === 'bigint' ? x.toString() : x));
  if (sig === roundsSig) return;
  roundsSig = sig;
  const rr = rounds(b.red);
  const rb = b.blue ? rounds(b.blue) : [];
  // a round that never opened (both left before it) is not a round missed: it is marked as such; every
  // round that opened has its cards: what each fighter saw and answered
  const row = (r, i) => (opened !== null && r.round > opened
    ? `<tr class="r off"><td><b>${r.round}</b></td><td colspan="${b.blue ? 3 : 2}" class="tiny">${esc(t('notOpened'))}</td></tr>`
    : `<tr class="r"><td><b>${r.round}</b> <span class="tiny">${esc(themeName(r.round))}</span></td>${cell(r, 'red')}${b.blue ? cell(rb[i], 'blue') : ''}<td class="num"><button class="btn small" type="button" data-card="${r.round}">${esc(t('cardsBtn'))}</button></td></tr>`);
  $('#rounds').innerHTML = `<tr><th>${t('roundCol')}</th><th><span class="dot red"></span>${keep(fightName(s, b.red))}</th>${b.blue ? `<th><span class="dot blue"></span>${keep(fightName(s, b.blue))}</th>` : ''}<th></th></tr>` + rr.map(row).join('');
  $('#after').style.display = '';
}

/** The jury's view of one round: for each fighter the page it saw, what it answered, the right answer and why. */
async function showCards(b, round) {
  const box = $('#cards');
  box.innerHTML = `<div class="tiny">${esc(t('loading'))}</div>`;
  const sides = [['red', b.red], ...(b.blue ? [['blue', b.blue]] : [])];
  const got = await Promise.all(sides.map(([, f]) => fetch(`card/${f.agent}/${f.number}/${round}?lang=${LANG}${arenaQuery()}`, { cache: 'no-store' })
    .then(async (r) => ({ status: r.status, body: await r.json() }))
    .catch(() => ({ status: 0, body: null }))));
  // on top, the task in plain words: a viewer reads what the round was about before the cards
  const theme = got.find((g) => g.body?.theme?.name)?.body.theme ?? (themeName(round) ? { name: themeName(round), plain: themePlain(round) } : null);
  const plain = theme?.plain || theme?.text;
  box.innerHTML = `<h3>${esc(t('cardsTitle', round))}${theme ? ` — ${esc(theme.name)}` : ''}</h3>${plain ? `<div class="plain"><b>${esc(t('plainLabel'))}</b><p>${esc(plain)}</p></div>` : ''}<div class="cardgrid">${sides.map(([side, f], i) => cardHtml(side, f, got[i])).join('')}</div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function cardHtml(side, f, got) {
  const head = `<div class="chead"><span class="dot ${side}"></span><b>${keep(fightName(s, f))}</b></div>`;
  if (got.status !== 200 || !got.body) return `<div class="jcard">${head}<div class="tiny">${esc(t(got.status === 425 ? 'cardsLater' : got.status === 404 ? 'notOpened' : 'clockFailed'))}</div></div>`;
  const c = got.body;
  const word = { right: 'ansRight', wrong: 'ansWrong', late: 'ansLate', none: 'ansNone', unjudged: 'ansNone' }[c.answer.state];
  return `<div class="jcard">${head}
    <div class="jrow"><span>${esc(t('cardAnswered'))}</span><b class="${c.answer.state === 'right' ? 'ok' : 'no'}">${esc(t(word))}</b>${c.answer.sent && c.answer.state !== 'right' ? ` <code translate="no">${esc(c.answer.sent)}</code>` : ''} · <b translate="no">${c.points} / 10</b></div>
    <div class="jrow"><span>${esc(t('cardRight'))}</span><code translate="no">${esc(c.answer.right)}</code>${c.answer.pass ? ' · PASS' : ''}</div>
    ${c.why ? `<div class="jrow"><span>${esc(t('cardWhy'))}</span><i>${esc(c.why)}</i></div>` : ''}
    ${c.stake ? `<div class="jrow"><span>${esc(t('cardStake'))}</span>${esc(c.stake)}</div>` : ''}
    <div class="jrow"><span>${esc(t('cardTraps'))}</span>${c.traps.map((x) => `<code translate="no" class="${x.taken ? 'no' : ''}">${esc(x.call ?? trapName(x.id))}${x.taken ? ' ✗' : ''}</code>`).join(' ')}</div>
    <details><summary>${esc(t('cardPage'))}</summary><pre class="cardpage" translate="no">${esc(c.page)}</pre></details></div>`;
}
$('#rounds').addEventListener('click', (e) => {
  const round = Number(e.target.closest?.('[data-card]')?.dataset.card);
  const b = findBout();
  if (round && b) showCards(b, round);
});

// ------------------------------------------------------------------ the replay: the arena plays the fight again

async function playReplay(b) {
  if (replaying || !b || !verdict(b)) return;
  replaying = true;
  battleOn(true);
  stopShow();
  const clocks = await Promise.all([b.red, b.blue].filter(Boolean).map((f) => fightOf(f.agent, f.number).catch(() => null)));
  if (clocks.some((c) => !c)) {
    // the fight's clock is not known: no guessing which rounds opened (the result stays as it was)
    replaying = false;
    battleOn(false);
    banner('text', 0, t('clockFailed'));
    return;
  }
  const last = Math.max(0, ...clocks.map((c) => openedRounds(c, s.now)));
  if (last === 0) {
    replaying = false;
    battleOn(false);
    banner('text', 0, t('noRoundOpened'));
    return;
  }
  await loadAll(); // the fight is over: every theme that opened is open
  const hud = $('#ring');
  $('#arena').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sides = b.blue ? ['red', 'blue'] : ['red'];
  const fights = { red: b.red, blue: b.blue };
  const plan = { red: rounds(b.red), blue: b.blue ? rounds(b.blue) : null };
  const total = { red: 0, blue: 0 };
  const blank = { pct: 100, note: '', bad: false, pips: Array(ROUNDS).fill('') };
  hud.innerHTML = `<div class="corners">${cornerHtml(b.red, 'red', blank)}${gongHtml({ title: t('round', 1), value: mmss(RT), label: themeName(1), part: 1 }, false, true)}${b.blue ? cornerHtml(b.blue, 'blue', blank) : ''}</div>`;
  hud.classList.add('replaying');
  hud.dataset.replay = t('replayTitle');
  hud.querySelectorAll('.bar').forEach((x) => x.classList.add('quick'));
  const el = (side, sel) => hud.querySelector(`.corner.${side} ${sel}`);
  const setNote = (side, text, bad = false) => {
    const n = el(side, '.accepted');
    n.textContent = text;
    n.classList.toggle('no', bad);
  };
  for (const side of sides) el(side, '.run').textContent = '0';
  scene.setFighters({ blue: !!b.blue });
  for (const side of sides) scene.setPose(side, 'hype');
  scene.setLights('sweep');
  setMusic('hype');
  banner('text', 0, t('replayTitle'));
  scene.setBoard([t('replayTitle'), '', `${fightName(s, b.red)}${b.blue ? ` · ${fightName(s, b.blue)}` : ''}`]);
  fists();
  await sleep(2600);
  // before the first gong they walk to their desks and sit down, calmly
  for (const side of sides) scene.setPose(side, 'guard');
  banner('text', 0, t('replayTitle'));
  await sleep(5200); // seated a couple of seconds before the gong

  for (let r = 1; r <= last; r++) {
    hud.querySelector('.gong .rdt').textContent = t('round', r);
    hud.querySelector('.gong .ph').textContent = themeName(r);
    hud.querySelector('.gong .tm').textContent = mmss(RT);
    hud.querySelector('.gong circle.left').setAttribute('stroke-dashoffset', offset(1));
    for (const side of sides) {
      el(side, '[data-bar]').style.width = '100%';
      setNote(side, '');
      el(side, `.pips i:nth-child(${r})`).classList.add('now');
      scene.setPose(side, 'work');
    }
    scene.setLights('focus');
    setMusic('tension');
    banner('task', r);
    scene.setBoard([t('round', r), mmss(RT), themeName(r)]);
    scene.signal();
    scene.pyro('round');
    gong();
    strike();
    announce(r === 1 ? t('fightGo') : t('roundBig', r), themeName(r));
    await sleep(1300);

    // the round runs, faster than life, until the last answer (or the bell)
    const at = {};
    for (const side of sides) {
      const a = plan[side][r - 1].answer;
      at[side] = a && !a.late ? a.secs : null;
    }
    const end = sides.every((side) => at[side] != null) ? Math.max(...sides.map((side) => at[side])) : RT;
    // as long as the viewer chose: a few seconds, half the real time, or the real time
    const speed = $('#replaySpeed').value;
    const dur = speed === 'real' ? Math.max(1500, end * 1000) : speed === 'twice' ? Math.max(1200, end * 500) : 600 + (end / RT) * 2200;
    const t0 = performance.now();
    const done = {};
    for (;;) {
      await frame();
      const p = Math.min(1, (performance.now() - t0) / dur);
      const now = p * end;
      hud.querySelector('.gong .tm').textContent = mmss(Math.ceil(RT - now));
      hud.querySelector('.gong circle.left').setAttribute('stroke-dashoffset', offset((RT - now) / RT));
      for (const side of sides) {
        const used = Math.min(now, at[side] ?? RT);
        el(side, '[data-bar]').style.width = `${(100 - (used / RT) * 100).toFixed(1)}%`;
        if (at[side] != null && now >= at[side] && !done[side]) {
          done[side] = true;
          ding();
          cheer(0.6);
          scene.excite(side, 1);
          scene.setPose(side, 'done');
          flash(side);
          setNote(side, t('accepted', at[side]));
        }
      }
      if (p >= 1) break;
    }

    // the round as the judge scored it: solved stays up, wrong or missing hangs its head
    await sleep(500);
    let hit = false;
    let failed = false;
    for (const side of sides) {
      const x = plan[side][r - 1];
      total[side] += (x.points ?? 0) - 2 * x.fouls.length;
      const parts = [x.solved ? t('replayPts', x.points) : t('replayZero'), ...x.hits.map(() => t('replayTrap')), ...x.fouls.map(() => t('replayFoul'))];
      if (x.hits.length || x.fouls.length) hit = true;
      if (!x.solved) {
        failed = true;
        scene.setPose(side, 'fail');
        scene.excite(other(side), 0.8);
      } else scene.excite(side, 0.9);
      setNote(side, parts.join(' · '), !x.solved);
      el(side, '.run').textContent = String(total[side]);
      const pip = el(side, `.pips i:nth-child(${r})`);
      pip.classList.remove('now');
      pip.classList.add(x.solved ? 'ok' : 'bad');
    }
    if (failed) boo();
    else cheer(0.7);
    if (hit) thud();
    scene.setLights('sweep');
    setMusic('hype');
    await sleep(1700);
  }
  for (const side of sides) el(side, '.run').textContent = String(fights[side].judged.points);
  gong(3);
  strike();
  announce(t('finalBellTitle'));
  for (const side of sides) scene.setPose(side, 'stand');
  await sleep(1800);
  hud.classList.remove('replaying');
  verdictShow(b, verdict(b), 2500, true); // the referee takes a moment, then raises the winner's arm
  replaying = false;
  ringSig = '';
  bannerSig = '';
  renderRing(b);
}

$('#replay').addEventListener('click', () => playReplay(findBout()));
$('#watchReplay').addEventListener('click', () => playReplay(findBout()));

// ------------------------------------------------------------------ reading the chain

async function loop() {
  if (!arenaServed) {
    $('#ring').innerHTML = `<div class="hudmsg">${esc(t('otherArena'))}</div>`;
    return;
  }
  try {
    await refresh(s);
    const b = findBout();
    if (b) {
      idleSig = '';
      forFight(b.red.agent, b.red.number);
      if (!replaying) renderRing(b);
    } else if (!wantAgent) renderIdle();
    else $('#ring').innerHTML = `<div class="hudmsg">${t('notOnChain')}</div>`;
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, CFG.pollMs ?? 2000);
}
setInterval(() => {
  s.now += 1;
  const gate = $('#soundGate');
  if (gate.hidden !== (soundOn() && soundRunning())) soundButtons(); // the sound may start without a tap on this button
  const b = findBout();
  if (b && !verdict(b) && !replaying) renderRing(b);
  else if (!b && !wantAgent && s.latestBlock) renderIdle();
}, 1000);
loop();

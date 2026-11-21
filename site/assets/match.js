// The ring: a live fight on the public screen (names, round, gong, two time bars, "answer
// accepted"), then, after the final bell and the judge's verdict, the winner and the replay.
// The round cards themselves are never shown here: only the fighters get them, and nothing about
// right answers or traps appears before the judge's verdict.
// The ring is rebuilt only when something changes; between reads of the chain only the clock,
// the gong and the bars move, in place (so a page translator has nothing to redo every second).
import { CFG, emptyState, refresh, bouts, verdict, clockOf, nameOf, rounds, trapName, ROUNDS } from './arena.js';
import { $, esc, keep, tName, header, footer, avatar, shareButtons, mmss, siteUrl, agentUrl, matchUrl, t, roundName, applyI18n } from './ui.js';
import { gong, beep, ding, thud, soundOn, setSound } from './sound.js';

$('#head').innerHTML = header('');
$('#foot').innerHTML = footer();
applyI18n();
const params = new URLSearchParams(location.search);
const wantAgent = (params.get('a') || '').toLowerCase();
const wantNumber = Number(params.get('n') || 0);
let autoReplay = params.get('replay') === '1';
const RT = CFG.roundTime ?? 60;
const s = emptyState();
let shared = false;
let ringSig = '';
let roundsSig = '';
let replaying = false;
$('#ring').innerHTML = `<div class="empty">${t('loading')}</div>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));

function findBout() {
  return bouts(s).find((b) => (b.red.agent === wantAgent && b.red.number === wantNumber) || (b.blue && b.blue.agent === wantAgent && b.blue.number === wantNumber));
}

// ------------------------------------------------------------------ sound switch and the big words

function soundButton() {
  const b = $('#sound');
  b.textContent = soundOn() ? `🔊 ${t('soundOn')}` : `🔇 ${t('soundOff')}`;
  b.setAttribute('aria-pressed', String(soundOn()));
}
$('#sound').addEventListener('click', () => {
  setSound(!soundOn());
  soundButton();
  if (soundOn()) ding();
});
soundButton();

/** ROUND 5, FIGHT!, FINAL BELL: big over the ring for a moment. */
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
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDuration = `${1.6 + Math.random() * 1.6}s`;
    p.style.animationDelay = `${Math.random() * 0.5}s`;
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    el.appendChild(p);
    setTimeout(() => p.remove(), 3800);
  }
}

function flash(side) {
  const c = document.querySelector(`.corner.${side}`);
  if (!c) return;
  c.classList.remove('flash');
  void c.offsetWidth;
  c.classList.add('flash');
}

// ------------------------------------------------------------------ the ring

/** The moving and the still parts of one corner. */
function cornerView(f, c) {
  let pct = 100;
  let note = '';
  let bad = false;
  let frozen = false;
  let hurry = false;
  if (c.phase === 'open') {
    const a = f.answers.find((x) => x.round === c.round);
    if (a) {
      frozen = true;
      pct = Math.max(0, 100 - (a.secs / RT) * 100);
      note = a.late ? t('afterBell', a.secs) : t('accepted', a.secs);
      bad = a.late;
    } else {
      pct = (c.left / RT) * 100;
      hurry = c.left <= 10;
    }
  } else if (c.phase === 'break') {
    const a = f.answers.find((x) => x.round === c.round - 1);
    pct = 0;
    note = a ? t('answeredIn', c.round - 1, a.secs) : t('noAnswerRound', c.round - 1);
  } else if (c.phase === 'over') {
    pct = 0;
    note = f.answers.length ? t('roundsAnswered', f.answers.length) : t('noAnswers');
  }
  // after the judge: green for a solved round, orange for the rest
  const judged = f.judged ? rounds(f) : null;
  const pips = Array.from({ length: ROUNDS }, (_, i) => {
    if (judged) return judged[i].solved ? 'ok' : 'bad';
    const a = f.answers.find((x) => x.round === i + 1);
    return `${a ? (a.late ? 'late' : 'done') : ''}${c.phase === 'open' && c.round === i + 1 ? ' now' : ''}`;
  });
  return { pct, note, bad, frozen, hurry, pips, answered: f.answers.length };
}

function cornerHtml(f, side, v) {
  const who = s.fighters.get(f.agent) ?? {};
  const nm = nameOf(s, f.agent);
  return `<div class="corner ${side}">
    <div class="tiny">${t(side === 'red' ? 'redCorner' : 'blueCorner')} ${f.official || who.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</div>
    <div class="fighter">${avatar(nm, side)}<a href="${agentUrl(f.agent)}"><div class="nm">${keep(nm)}</div><div class="tiny">${keep(who.model || '')}</div></a><div class="run" translate="no"></div></div>
    <div class="bar${v.hurry ? ' hurry' : ''}"><i data-bar="${side}" style="width:${v.pct.toFixed(1)}%"></i></div>
    <div class="accepted${v.bad ? ' no' : ''}" translate="no">${esc(v.note)}</div>
    <div class="pips">${v.pips.map((cls, i) => `<i class="${cls}" title="${i + 1}"></i>`).join('')}</div>
  </div>`;
}

function gongView(c, judged, waitingJudge) {
  if (judged) return { title: t('finalBellTitle'), value: t('end'), label: t('judgedOnChain'), part: 0 };
  if (c.phase === 'countdown') return { title: t('getReady'), value: String(c.left), label: t('countdown'), part: c.left / 10 };
  if (c.phase === 'open') return { title: t('round', c.round), value: mmss(c.left), label: roundName(c.round), part: c.left / RT, hurry: c.left <= 10 };
  if (c.phase === 'break') return { title: t('breakTitle'), value: String(c.left), label: t('nextRound', c.round), part: c.left / 10 };
  return { title: t('finalBellTitle'), value: '—', label: waitingJudge ? t('waitingJudge') : t('over'), part: 0 };
}

const R = 64;
const LEN = 2 * Math.PI * R;
const offset = (part) => (LEN * (1 - Math.max(0, Math.min(1, part)))).toFixed(1);

function gongHtml(g) {
  return `<div class="gong${g.hurry ? ' hurry' : ''}"><div class="rd">${esc(g.title)}</div><div class="face"><svg viewBox="0 0 150 150"><defs><linearGradient id="gongGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
    <circle class="track" cx="75" cy="75" r="${R}" fill="none" stroke-width="8"/>
    <circle class="left" cx="75" cy="75" r="${R}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${LEN.toFixed(1)}" stroke-dashoffset="${offset(g.part)}" transform="rotate(-90 75 75)"/></svg>
    <div class="tm${/^[0-9:—]+$/.test(g.value) ? '' : ' word'}" translate="no">${esc(g.value)}</div></div><div class="ph">${esc(g.label)}</div></div>`;
}

// what the ring has already shown, so each sound and each big word comes once
const cue = { phase: null, round: 0, left: null, answered: {}, judged: null };

function cues(b, c, v, views) {
  const first = cue.phase === null;
  if (c.phase === 'countdown' && c.left >= 1 && c.left <= 3 && c.left !== cue.left) beep(c.left === 1);
  if (c.phase === 'open' && (cue.phase !== 'open' || cue.round !== c.round) && (!first || c.left > RT - 5)) {
    gong();
    announce(c.round === 1 ? t('fightGo') : t('roundBig', c.round), roundName(c.round));
  }
  if (c.phase === 'over' && cue.phase && cue.phase !== 'over') {
    gong(3);
    announce(t('finalBellTitle'));
  }
  for (const [side, view] of Object.entries(views)) {
    if (!view) continue;
    if (!first && view.answered > (cue.answered[side] ?? 0)) {
      ding();
      flash(side);
    }
    cue.answered[side] = view.answered;
  }
  if (v && cue.judged === false && b.blue) confetti();
  Object.assign(cue, { phase: c.phase, round: c.round ?? 0, left: c.left ?? null, judged: !!v });
}

function renderRing(b) {
  const red = b.red;
  const blue = b.blue;
  const clock = red.clock?.clockAt ? red.clock : blue?.clock;
  const c0 = clock?.clockAt ? clockOf(clock, s.now) : { phase: 'over' };
  const ended = (red.ended || red.judged || c0.phase === 'over') && (!blue || blue.ended || blue.judged || c0.phase === 'over');
  const c = ended ? { phase: 'over' } : c0;
  const v = verdict(b);
  const vr = cornerView(red, c);
  const vb = blue ? cornerView(blue, c) : null;
  const g = gongView(c, !!v, ended && !v);
  document.title = `${nameOf(s, red.agent)}${blue ? ` vs ${nameOf(s, blue.agent)}` : ''} — IBITI Agent Arena`;

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
    top = `<div class="winner"><div class="crown">${wn ? tName(v.byTime ? 'winsOnTime' : 'wins', nameOf(s, wn.agent)) : t('draw')}</div>
      <div class="score" translate="no"><span class="red">${red.judged.points}</span> : <span class="blue">${blue.judged.points}</span></div>
      <div class="tiny">${t('statLine', red.judged.solved, red.judged.fouls, red.judged.timeUsed)} &nbsp;|&nbsp; ${t('statLine', blue.judged.solved, blue.judged.fouls, blue.judged.timeUsed)}</div></div>`;
  } else if (v) {
    const onCard = red.challenged && !/^0x0{40}$/.test(red.challenged) ? ` · ${tName('onCard', nameOf(s, red.challenged))}` : '';
    top = `<div class="winner"><div class="crown">${keep(nameOf(s, red.agent))}</div><div class="score" translate="no"><span class="red">${red.judged.points}</span> / 120</div>
      <div class="tiny">${esc(t('statLine', red.judged.solved, red.judged.fouls, red.judged.timeUsed))}${onCard}</div></div>`;
  } else if (ended) top = `<div class="winner"><div class="crown">${t('finalBellTitle')}</div><div class="tiny">${t('judgingNote')}</div></div>`;
  $('#ring').innerHTML = `${top}<div class="corners">${cornerHtml(red, 'red', vr)}${gongHtml(g)}${blue ? cornerHtml(blue, 'blue', vb) : `<div class="corner blue"><div class="tiny">${t('soloFight')}</div><div class="nm" style="color:var(--ink-3);text-shadow:none">—</div></div>`}</div>`;
  cues(b, c, v, { red: vr, blue: vb });
  if (v) {
    renderRounds(b);
    $('#watchReplay').style.display = '';
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
    text = t('shareWin', nameOf(s, w.agent), nameOf(s, l.agent), w.judged.points, l.judged.points);
  } else text = t('shareSolo', nameOf(s, red.agent), red.judged.points);
  $('#share').innerHTML = shareButtons(text, url);
  $('#challengeWinner').innerHTML = `<div class="cta" style="margin:0;align-items:center"><a class="btn red" href="index.html?challenge=${champ.agent}#enter">${tName('challengeWinner', nameOf(s, champ.agent))}</a><span class="tiny">${esc(t('challengeHint'))}</span></div>`;
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

function renderRounds(b) {
  const sig = JSON.stringify([b.red.judged, b.blue?.judged, b.red.answers.length, b.blue?.answers.length], (k, x) => (typeof x === 'bigint' ? x.toString() : x));
  if (sig === roundsSig) return;
  roundsSig = sig;
  const rr = rounds(b.red);
  const rb = b.blue ? rounds(b.blue) : [];
  $('#rounds').innerHTML = `<tr><th>${t('roundCol')}</th><th><span class="dot red"></span>${keep(nameOf(s, b.red.agent))}</th>${b.blue ? `<th><span class="dot blue"></span>${keep(nameOf(s, b.blue.agent))}</th>` : ''}</tr>` +
    rr.map((r, i) => `<tr class="r"><td><b>${r.round}</b> <span class="tiny">${esc(roundName(r.round))}</span></td>${cell(r, 'red')}${b.blue ? cell(rb[i], 'blue') : ''}</tr>`).join('');
  $('#after').style.display = '';
}

// ------------------------------------------------------------------ the replay: the ring plays the fight again

async function playReplay(b) {
  if (replaying || !b || !verdict(b)) return;
  replaying = true;
  const ring = $('#ring');
  ring.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const sides = b.blue ? ['red', 'blue'] : ['red'];
  const fights = { red: b.red, blue: b.blue };
  const plan = { red: rounds(b.red), blue: b.blue ? rounds(b.blue) : null };
  const total = { red: 0, blue: 0 };
  const blank = { pct: 100, note: '', bad: false, pips: Array(ROUNDS).fill('') };
  ring.innerHTML = `<div class="corners">${cornerHtml(b.red, 'red', blank)}${gongHtml({ title: t('round', 1), value: mmss(RT), label: roundName(1), part: 1 })}${b.blue ? cornerHtml(b.blue, 'blue', blank) : ''}</div>`;
  ring.classList.add('replaying');
  ring.dataset.replay = t('replayTitle');
  ring.querySelectorAll('.bar').forEach((x) => x.classList.add('quick'));
  const el = (side, sel) => ring.querySelector(`.corner.${side} ${sel}`);
  const setNote = (side, text, bad = false) => {
    const n = el(side, '.accepted');
    n.textContent = text;
    n.classList.toggle('no', bad);
  };
  for (const side of sides) el(side, '.run').textContent = '0';

  for (let r = 1; r <= ROUNDS; r++) {
    ring.querySelector('.gong .rd').textContent = t('round', r);
    ring.querySelector('.gong .ph').textContent = roundName(r);
    ring.querySelector('.gong .tm').textContent = mmss(RT);
    ring.querySelector('.gong circle.left').setAttribute('stroke-dashoffset', offset(1));
    for (const side of sides) {
      el(side, '[data-bar]').style.width = '100%';
      setNote(side, '');
      el(side, `.pips i:nth-child(${r})`).classList.add('now');
    }
    gong();
    announce(r === 1 ? t('fightGo') : t('roundBig', r), roundName(r));
    await sleep(1000);

    // the round runs, faster than life, until the last answer (or the bell)
    const at = {};
    for (const side of sides) {
      const a = plan[side][r - 1].answer;
      at[side] = a && !a.late ? a.secs : null;
    }
    const end = sides.every((side) => at[side] != null) ? Math.max(...sides.map((side) => at[side])) : RT;
    const dur = 300 + (end / RT) * 1500;
    const t0 = performance.now();
    const done = {};
    for (;;) {
      await frame();
      const p = Math.min(1, (performance.now() - t0) / dur);
      const now = p * end;
      ring.querySelector('.gong .tm').textContent = mmss(Math.ceil(RT - now));
      ring.querySelector('.gong circle.left').setAttribute('stroke-dashoffset', offset((RT - now) / RT));
      for (const side of sides) {
        const used = Math.min(now, at[side] ?? RT);
        el(side, '[data-bar]').style.width = `${(100 - (used / RT) * 100).toFixed(1)}%`;
        if (at[side] != null && now >= at[side] && !done[side]) {
          done[side] = true;
          ding();
          flash(side);
          setNote(side, t('accepted', at[side]));
        }
      }
      if (p >= 1) break;
    }

    // the round as the judge scored it
    await sleep(350);
    let hit = false;
    for (const side of sides) {
      const x = plan[side][r - 1];
      total[side] += (x.points ?? 0) - 2 * x.fouls.length;
      const parts = [x.solved ? t('replayPts', x.points) : t('replayZero'), ...x.hits.map(() => t('replayTrap')), ...x.fouls.map(() => t('replayFoul'))];
      if (x.hits.length || x.fouls.length) hit = true;
      setNote(side, parts.join(' · '), !x.solved);
      el(side, '.run').textContent = String(total[side]);
      const pip = el(side, `.pips i:nth-child(${r})`);
      pip.classList.remove('now');
      pip.classList.add(x.solved ? 'ok' : 'bad');
    }
    if (hit) thud();
    await sleep(1150);
  }
  for (const side of sides) el(side, '.run').textContent = String(fights[side].judged.points);
  gong(3);
  announce(t('finalBellTitle'));
  await sleep(1700);
  ring.classList.remove('replaying');
  replaying = false;
  ringSig = '';
  renderRing(b);
  if (b.blue) confetti();
}

$('#replay').addEventListener('click', () => playReplay(findBout()));
$('#watchReplay').addEventListener('click', () => playReplay(findBout()));

// ------------------------------------------------------------------ reading the chain

async function loop() {
  try {
    await refresh(s);
    const b = findBout();
    if (b) {
      if (!replaying) renderRing(b);
    } else $('#ring').innerHTML = `<div class="empty">${t('notOnChain')}</div>`;
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, CFG.pollMs ?? 2000);
}
setInterval(() => {
  s.now += 1;
  const b = findBout();
  if (b && !verdict(b) && !replaying) renderRing(b);
}, 1000);
loop();

// The fight, like a fight night: a full arena with the crowd, two robot fighters in the ring, a
// fighting-game scoreboard on top (names, round, clock, two time bars, "answer accepted"), and at
// the bottom the task of the round, so everyone sees what the agents are solving. After the final
// bell and the judge's verdict: the winner, the round-by-round table and the replay.
// The round cards themselves are never shown here (only the fighters get them), and nothing about
// right answers or traps appears before the judge's verdict.
// The scoreboard is rebuilt only when something changes; between reads of the chain only the clock
// and the bars move, in place (so a page translator has nothing to redo every second).
import { CFG, emptyState, refresh, bouts, verdict, clockOf, nameOf, rounds, trapName, ROUNDS } from './arena.js';
import { $, esc, keep, tName, header, footer, avatar, shareButtons, mmss, siteUrl, agentUrl, matchUrl, t, roundName, applyI18n } from './ui.js';
import { gong, beep, ding, thud, cheer, boo, crowdLevel, setMusic, soundOn, setSound } from './sound.js';
import { createScene as createFlatScene } from './scene.js';

$('#head').innerHTML = header('');
$('#foot').innerHTML = footer();
applyI18n();
const params = new URLSearchParams(location.search);
const wantAgent = (params.get('a') || '').toLowerCase();
const wantNumber = Number(params.get('n') || 0);
let autoReplay = params.get('replay') === '1';
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
let shared = false;
let ringSig = '';
let roundsSig = '';
let bannerSig = '';
let replaying = false;
$('#ring').innerHTML = `<div class="hudmsg">${t('loading')}</div>`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const frame = () => new Promise((r) => requestAnimationFrame(r));
const other = (side) => (side === 'red' ? 'blue' : 'red');

function findBout() {
  return bouts(s).find((b) => (b.red.agent === wantAgent && b.red.number === wantNumber) || (b.blue && b.blue.agent === wantAgent && b.blue.number === wantNumber));
}

// ------------------------------------------------------------------ sound switches and the big words

function soundButtons() {
  const b = $('#sound');
  b.textContent = soundOn() ? `🔊 ${t('soundOn')}` : `🔇 ${t('soundOff')}`;
  b.setAttribute('aria-pressed', String(soundOn()));
  const gate = $('#soundGate');
  gate.textContent = `🔊 ${t('arenaSound')}`;
  gate.hidden = soundOn();
}
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

/** The lower third: what the agents are solving in this round. */
function banner(kind, round = 0, extra = '') {
  const sig = `${kind}|${round}|${extra}`;
  if (sig === bannerSig) return;
  bannerSig = sig;
  const el = $('#banner');
  if (kind === 'task') {
    el.innerHTML = `<div class="bhead"><span class="bround" translate="no">${round} / ${ROUNDS}</span><span class="bname">${esc(roundName(round))}</span></div><div class="btext"><b>${esc(t('taskLabel'))}:</b> ${esc(t(`task${round}`))}</div>`;
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
  if (c.phase === 'countdown') pose = c.left <= 4 ? 'guard' : 'hype';
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
    pose = bad && c.left > 4 ? 'fail' : c.left <= 4 ? 'guard' : 'hype';
  } else if (c.phase === 'over') {
    pct = 0;
    note = f.answers.length ? t('roundsAnswered', f.answers.length) : t('noAnswers');
    pose = 'idle';
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
  const nm = nameOf(s, f.agent);
  return `<div class="corner ${side}">
    <div class="fighter">${avatar(nm, side)}<a href="${agentUrl(f.agent)}"><div class="nm">${keep(nm)}</div><div class="tiny">${keep(who.model || '')} ${f.official || who.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</div></a><div class="run" translate="no"></div></div>
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
    announce(c.round === 1 ? t('fightGo') : t('roundBig', c.round), roundName(c.round));
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
  if (v && cue.judged === false) celebrate(b, v);
  Object.assign(cue, { phase: c.phase, round: c.round ?? 0, left: c.left ?? null, judged: !!v });
}

/** The verdict lands: winner's lights, music, the roar, confetti. */
function celebrate(b, v) {
  setMusic('victory');
  cheer(1.4);
  if (b.blue) confetti();
  const wn = b.blue && v.winner !== 'draw' ? v.winner : null;
  scene.pyro('win', wn ?? 'red');
  if (wn) announce(t('wins', nameOf(s, (wn === 'red' ? b.red : b.blue).agent)));
}

/** Poses, lights, music and the lower third, from where the fight stands. */
function stage(b, c, v, views) {
  scene.setFighters({ blue: !!b.blue });
  const names = `${nameOf(s, b.red.agent)}${b.blue ? ` · ${nameOf(s, b.blue.agent)}` : ''}`;
  if (v) {
    const wn = b.blue && v.winner !== 'draw' ? (v.winner === 'red' ? b.red : b.blue) : b.red;
    scene.setBoard([nameOf(s, wn.agent), b.blue ? `${b.red.judged.points} : ${b.blue.judged.points}` : `${b.red.judged.points}`, t('judgedOnChain')]);
  } else if (c.phase === 'open') scene.setBoard([t('round', c.round), mmss(c.left), names]);
  else if (c.phase === 'countdown') scene.setBoard([t('getReady'), String(c.left), names]);
  else if (c.phase === 'break') scene.setBoard([t('breakTitle'), String(c.left), t('nextRound', c.round)]);
  else scene.setBoard([t('finalBellTitle'), '—', names]);
  if (v) {
    const wn = b.blue && v.winner !== 'draw' ? v.winner : null;
    if (wn) {
      scene.setPose(wn, 'win');
      scene.setPose(other(wn), 'lose');
      scene.setLights('winner', wn);
    } else {
      scene.setPose('red', 'done');
      scene.setPose('blue', 'done');
      scene.setLights('sweep');
    }
    crowdLevel(0.45);
    return;
  }
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
    banner('text', 0, t('bannerReady', c.left));
  } else if (c.phase === 'break') {
    scene.setLights('sweep');
    setMusic('hype');
    crowdLevel(0.55);
    banner('text', 0, t('bannerNext', c.round, roundName(c.round)));
  } else {
    scene.setLights('focus');
    setMusic(null);
    crowdLevel(0.5);
    banner('text', 0, t('judgingNote'));
  }
  scene.setTicker(`IBITI AGENT ARENA   ◆   ${nameOf(s, b.red.agent)}${b.blue ? `  VS  ${nameOf(s, b.blue.agent)}` : ''}   ◆   ${c.phase === 'open' ? `${t('round', c.round)} · ${roundName(c.round)}` : t('live')}`);
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
    top = `<div class="winner"><div class="crown">${wn ? tName(v.byTime ? 'winsOnTime' : 'wins', nameOf(s, wn.agent)) : t('draw')}</div>
      <div class="score" translate="no"><span class="red">${red.judged.points}</span> : <span class="blue">${blue.judged.points}</span></div>
      <div class="tiny">${t('statLine', red.judged.solved, red.judged.fouls, red.judged.timeUsed)} &nbsp;|&nbsp; ${t('statLine', blue.judged.solved, blue.judged.fouls, blue.judged.timeUsed)}</div></div>`;
  } else if (v) {
    const onCard = red.challenged && !/^0x0{40}$/.test(red.challenged) ? ` · ${tName('onCard', nameOf(s, red.challenged))}` : '';
    top = `<div class="winner"><div class="crown">${keep(nameOf(s, red.agent))}</div><div class="score" translate="no"><span class="red">${red.judged.points}</span> / 120</div>
      <div class="tiny">${esc(t('statLine', red.judged.solved, red.judged.fouls, red.judged.timeUsed))}${onCard}</div></div>`;
  }
  $('#ring').innerHTML = `<div class="corners">${cornerHtml(red, 'red', vr)}${gongHtml(g, !ended && !v)}${blue ? cornerHtml(blue, 'blue', vb) : `<div class="corner blue solo"><div class="tiny">${t('soloFight')}</div></div>`}</div>`;
  if (top) banner('html', 0, top.replace('class="winner"', 'class="winner bwin"'));
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

// ------------------------------------------------------------------ the replay: the arena plays the fight again

async function playReplay(b) {
  if (replaying || !b || !verdict(b)) return;
  replaying = true;
  const hud = $('#ring');
  $('#arena').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const sides = b.blue ? ['red', 'blue'] : ['red'];
  const fights = { red: b.red, blue: b.blue };
  const plan = { red: rounds(b.red), blue: b.blue ? rounds(b.blue) : null };
  const total = { red: 0, blue: 0 };
  const blank = { pct: 100, note: '', bad: false, pips: Array(ROUNDS).fill('') };
  hud.innerHTML = `<div class="corners">${cornerHtml(b.red, 'red', blank)}${gongHtml({ title: t('round', 1), value: mmss(RT), label: roundName(1), part: 1 }, false, true)}${b.blue ? cornerHtml(b.blue, 'blue', blank) : ''}</div>`;
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
  scene.setBoard([t('replayTitle'), '', `${nameOf(s, b.red.agent)}${b.blue ? ` · ${nameOf(s, b.blue.agent)}` : ''}`]);
  fists();
  await sleep(2200);

  for (let r = 1; r <= ROUNDS; r++) {
    hud.querySelector('.gong .rdt').textContent = t('round', r);
    hud.querySelector('.gong .ph').textContent = roundName(r);
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
    scene.setBoard([t('round', r), mmss(RT), roundName(r)]);
    scene.signal();
    scene.pyro('round');
    gong();
    strike();
    announce(r === 1 ? t('fightGo') : t('roundBig', r), roundName(r));
    await sleep(1300);

    // the round runs, faster than life, until the last answer (or the bell)
    const at = {};
    for (const side of sides) {
      const a = plan[side][r - 1].answer;
      at[side] = a && !a.late ? a.secs : null;
    }
    const end = sides.every((side) => at[side] != null) ? Math.max(...sides.map((side) => at[side])) : RT;
    const dur = 600 + (end / RT) * 2200;
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
  await sleep(1800);
  hud.classList.remove('replaying');
  replaying = false;
  ringSig = '';
  bannerSig = '';
  renderRing(b);
  celebrate(b, verdict(b));
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
    } else $('#ring').innerHTML = `<div class="hudmsg">${t('notOnChain')}</div>`;
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

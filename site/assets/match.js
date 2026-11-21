// The ring: a live fight on the public screen (names, round, gong, two time bars, "answer
// accepted"), then, after the final bell and the judge's verdict, the winner and the replay.
// The round cards themselves are never shown here: only the fighters get them.
// The ring is rebuilt only when something changes; between reads of the chain only the clock,
// the gong and the bars move, in place (so a page translator has nothing to redo every second).
import { CFG, emptyState, refresh, bouts, verdict, clockOf, nameOf, rounds, trapName, ROUND_NAMES, ROUNDS } from './arena.js';
import { $, esc, keep, header, footer, shareButtons, mmss, siteUrl, t, applyI18n } from './ui.js';

$('#head').innerHTML = header('');
$('#foot').innerHTML = footer();
applyI18n();
const params = new URLSearchParams(location.search);
const wantAgent = (params.get('a') || '').toLowerCase();
const wantNumber = Number(params.get('n') || 0);
const RT = CFG.roundTime ?? 60;
const s = emptyState();
let shared = false;
let ringSig = '';
let roundsSig = '';
$('#ring').innerHTML = `<div class="empty">${t('loading')}</div>`;

function findBout() {
  return bouts(s).find((b) => (b.red.agent === wantAgent && b.red.number === wantNumber) || (b.blue && b.blue.agent === wantAgent && b.blue.number === wantNumber));
}

/** The moving and the still parts of one corner. */
function cornerView(f, c) {
  let pct = 100;
  let note = '';
  let frozen = false;
  if (c.phase === 'open') {
    const a = f.answers.find((x) => x.round === c.round);
    if (a) {
      frozen = true;
      pct = Math.max(0, 100 - (a.secs / RT) * 100);
      note = a.late ? t('afterBell', a.secs) : t('accepted', a.secs);
    } else pct = (c.left / RT) * 100;
  } else if (c.phase === 'break') {
    const a = f.answers.find((x) => x.round === c.round - 1);
    pct = 0;
    note = a ? t('answeredIn', c.round - 1, a.secs) : t('noAnswerRound', c.round - 1);
  } else if (c.phase === 'over') {
    pct = 0;
    note = f.answers.length ? t('roundsAnswered', f.answers.length) : t('noAnswers');
  }
  const pips = Array.from({ length: ROUNDS }, (_, i) => {
    const a = f.answers.find((x) => x.round === i + 1);
    return `${a ? (a.late ? 'late' : 'done') : ''}${c.phase === 'open' && c.round === i + 1 ? ' now' : ''}`;
  });
  return { pct, note, frozen, pips };
}

function cornerHtml(f, side, v) {
  const who = s.fighters.get(f.agent) ?? {};
  const nm = nameOf(s, f.agent);
  const initials = nm.split(/\s+/).map((x) => x[0] ?? '').join('').slice(0, 2).toUpperCase();
  const col = side === 'red' ? '#ef4444' : '#3b82f6';
  const avatar = `<svg class="avatar" viewBox="0 0 64 64" translate="no"><defs><radialGradient id="av${side}" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="${col}" stop-opacity=".9"/><stop offset="1" stop-color="#0b0f1a"/></radialGradient></defs><path d="M32 3 57 17v30L32 61 7 47V17Z" fill="url(#av${side})" stroke="${col}" stroke-width="2"/><text x="32" y="39" text-anchor="middle">${esc(initials)}</text></svg>`;
  return `<div class="corner ${side}">
    <div class="tiny">${t(side === 'red' ? 'redCorner' : 'blueCorner')} ${f.official || who.official ? '<span class="badge id" translate="no">Agent ID</span>' : ''}</div>
    <div class="fighter">${avatar}<div><div class="nm">${keep(nm)}</div><div class="tiny">${keep(who.model || '')}</div></div></div>
    <div class="bar"><i data-bar="${side}" style="width:${v.pct.toFixed(1)}%"></i></div>
    <div class="accepted" translate="no">${esc(v.note)}</div>
    <div class="pips">${v.pips.map((cls, i) => `<i class="${cls}" title="${i + 1}"></i>`).join('')}</div>
  </div>`;
}

function gongView(c, judged, waitingJudge) {
  if (judged) return { title: t('finalBellTitle'), value: t('end'), label: t('judgedOnChain'), part: 0 };
  if (c.phase === 'countdown') return { title: t('getReady'), value: String(c.left), label: t('countdown'), part: c.left / 10 };
  if (c.phase === 'open') return { title: t('round', c.round), value: mmss(c.left), label: ROUND_NAMES[c.round - 1], part: c.left / RT };
  if (c.phase === 'break') return { title: t('breakTitle'), value: String(c.left), label: t('nextRound', c.round), part: c.left / 10 };
  return { title: t('finalBellTitle'), value: '—', label: waitingJudge ? t('waitingJudge') : t('over'), part: 0 };
}

const R = 64;
const LEN = 2 * Math.PI * R;
const offset = (part) => (LEN * (1 - Math.max(0, Math.min(1, part)))).toFixed(1);

function gongHtml(g) {
  return `<div class="gong"><div class="rd">${esc(g.title)}</div><div class="face"><svg viewBox="0 0 150 150"><defs><linearGradient id="gongGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
    <circle class="track" cx="75" cy="75" r="${R}" fill="none" stroke-width="8"/>
    <circle class="left" cx="75" cy="75" r="${R}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${LEN.toFixed(1)}" stroke-dashoffset="${offset(g.part)}" transform="rotate(-90 75 75)"/></svg>
    <div class="tm" translate="no">${esc(g.value)}</div></div><div class="ph" translate="no">${esc(g.label)}</div></div>`;
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

  // everything that is not a moving clock or bar
  const sig = JSON.stringify([c.phase, c.round, g.title, g.label, vr.note, vr.pips, vb?.note, vb?.pips, vr.frozen && vr.pct, vb?.frozen && vb?.pct, !!v, ended]);
  if (sig === ringSig) {
    // in place: the clock, the gong and the running bars
    const tm = document.querySelector('.gong .tm');
    if (tm && tm.textContent !== g.value) tm.textContent = g.value;
    document.querySelector('.gong circle.left')?.setAttribute('stroke-dashoffset', offset(g.part));
    const rb = document.querySelector('[data-bar="red"]');
    if (rb) rb.style.width = `${vr.pct.toFixed(1)}%`;
    const bb = document.querySelector('[data-bar="blue"]');
    if (bb && vb) bb.style.width = `${vb.pct.toFixed(1)}%`;
    return;
  }
  ringSig = sig;

  let top = '';
  if (v && blue) {
    const wn = v.winner === 'draw' ? null : v.winner === 'red' ? red : blue;
    // the name goes where the language puts it ("🏆 X WINS" / "🏆 ПОБЕДИЛ X"), untranslated
    const [before, after] = t(v.byTime ? 'winsOnTime' : 'wins', '\u0000').split('\u0000');
    top = `<div class="winner"><div class="crown">${wn ? esc(before) + keep(nameOf(s, wn.agent)) + esc(after) : t('draw')}</div>
      <div class="score" translate="no"><span class="red">${red.judged.points}</span> : <span class="blue">${blue.judged.points}</span></div>
      <div class="tiny">${t('statLine', red.judged.solved, red.judged.fouls, red.judged.timeUsed)} &nbsp;|&nbsp; ${t('statLine', blue.judged.solved, blue.judged.fouls, blue.judged.timeUsed)}</div></div>`;
  } else if (v) {
    const onCard = red.challenged && !/^0x0{40}$/.test(red.challenged) ? ` · ${t('onCard', nameOf(s, red.challenged))}` : '';
    top = `<div class="winner"><div class="crown">${keep(nameOf(s, red.agent))}</div><div class="score" translate="no"><span class="red">${red.judged.points}</span> / 120</div>
      <div class="tiny">${t('statLine', red.judged.solved, red.judged.fouls, red.judged.timeUsed)}${esc(onCard)}</div></div>`;
  } else if (ended) top = `<div class="winner"><div class="crown">${t('finalBellTitle')}</div><div class="tiny">${t('judgingNote')}</div></div>`;
  $('#ring').innerHTML = `${top}<div class="corners">${cornerHtml(red, 'red', vr)}${gongHtml(g)}${blue ? cornerHtml(blue, 'blue', vb) : `<div class="corner blue"><div class="tiny">${t('soloFight')}</div><div class="nm" style="color:var(--ink-3);text-shadow:none">—</div></div>`}</div>`;
  if (v) {
    renderRounds(b);
    if (!shared) {
      shared = true;
      const url = `${siteUrl()}/match.html?a=${red.agent}&n=${red.number}`;
      let text;
      if (blue && v.winner !== 'draw') {
        const [w, l] = v.winner === 'red' ? [red, blue] : [blue, red];
        text = t('shareWin', nameOf(s, w.agent), nameOf(s, l.agent), w.judged.points, l.judged.points);
      } else text = t('shareSolo', nameOf(s, red.agent), red.judged.points);
      $('#share').innerHTML = shareButtons(text, url);
      $('#sharePanel').style.display = '';
    }
  }
}

function cell(r, side) {
  if (!r) return '<td></td>';
  const a = r.answer;
  const w = a ? Math.min(100, (a.secs / RT) * 100).toFixed(1) : 0;
  const bar = `<div class="mini ${side}"><i data-w="${w}" style="width:${w}%"></i></div>`;
  let res;
  if (!a) res = `<span class="no">${t('noAnswer')}</span>`;
  else if (a.late) res = `<span class="no">${t('lateAnswer', a.secs)}</span>`;
  else res = r.solved ? `<span class="ok">${t('solvedPts', r.points)}</span> <span class="tiny">${a.secs}s</span>` : `<span class="no">${t('wrong')}</span> <span class="tiny">${a.secs}s</span>`;
  const traps = [...r.hits.map((h) => t('tookTrap', trapName(h.trap))), ...r.fouls.map((h) => t('foul', trapName(h.trap)))];
  return `<td style="min-width:240px">${bar}<div style="margin-top:6px">${res}</div>${traps.length ? `<div class="note">${traps.map(esc).join('<br>')}</div>` : ''}</td>`;
}

function renderRounds(b) {
  const sig = JSON.stringify([b.red.judged, b.blue?.judged, b.red.answers.length, b.blue?.answers.length]);
  if (sig === roundsSig) return;
  roundsSig = sig;
  const rr = rounds(b.red);
  const rb = b.blue ? rounds(b.blue) : [];
  $('#rounds').innerHTML = `<tr><th>${t('roundCol')}</th><th><span class="dot red"></span>${keep(nameOf(s, b.red.agent))}</th>${b.blue ? `<th><span class="dot blue"></span>${keep(nameOf(s, b.blue.agent))}</th>` : ''}</tr>` +
    rr.map((r, i) => `<tr class="r"><td><b>${r.round}</b> <span class="tiny" translate="no">${esc(r.name)}</span></td>${cell(r, 'red')}${b.blue ? cell(rb[i], 'blue') : ''}</tr>`).join('');
  $('#after').style.display = '';
}

$('#replay').addEventListener('click', () => {
  const bars = [...document.querySelectorAll('#rounds .mini > i')];
  bars.forEach((el) => {
    el.style.transition = 'none';
    el.style.width = '0%';
  });
  bars.forEach((el, i) => {
    setTimeout(() => {
      el.style.transition = 'width .6s ease-out';
      el.style.width = `${el.dataset.w}%`;
    }, 120 + Math.floor(i / (bars.length > 12 ? 2 : 1)) * 450);
  });
});

async function loop() {
  try {
    await refresh(s);
    const b = findBout();
    if (b) renderRing(b);
    else $('#ring').innerHTML = `<div class="empty">${t('notOnChain')}</div>`;
  } catch (e) {
    console.error(e);
  }
  setTimeout(loop, CFG.pollMs ?? 2000);
}
setInterval(() => {
  s.now += 1;
  const b = findBout();
  if (b && !verdict(b)) renderRing(b);
}, 1000);
loop();

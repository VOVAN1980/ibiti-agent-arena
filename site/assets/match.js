// The ring: a live fight on the public screen (names, round, gong, two time bars, "answer
// accepted"), then, after the final bell and the judge's verdict, the winner and the replay.
// The round cards themselves are never shown here: only the fighters get them.
import { CFG, emptyState, refresh, bouts, verdict, clockOf, nameOf, rounds, trapName, ROUND_NAMES, ROUNDS } from './arena.js';
import { $, esc, header, footer, shareButtons, mmss, siteUrl } from './ui.js';

$('#head').innerHTML = header('');
$('#foot').innerHTML = footer();
const params = new URLSearchParams(location.search);
const wantAgent = (params.get('a') || '').toLowerCase();
const wantNumber = Number(params.get('n') || 0);
const RT = CFG.roundTime ?? 60;
const s = emptyState();
let shared = false;

function findBout() {
  return bouts(s).find((b) => (b.red.agent === wantAgent && b.red.number === wantNumber) || (b.blue && b.blue.agent === wantAgent && b.blue.number === wantNumber));
}

function corner(f, side, c) {
  const who = s.fighters.get(f.agent) ?? {};
  let pct = 100;
  let note = '';
  if (c.phase === 'open') {
    const a = f.answers.find((x) => x.round === c.round);
    if (a) {
      pct = Math.max(0, 100 - (a.secs / RT) * 100);
      note = a.late ? `ANSWER AFTER THE BELL · ${a.secs}s` : `✓ ANSWER ACCEPTED · ${a.secs}s`;
    } else pct = (c.left / RT) * 100;
  } else if (c.phase === 'break') {
    const a = f.answers.find((x) => x.round === c.round - 1);
    pct = 0;
    note = a ? `round ${c.round - 1}: answered in ${a.secs}s` : `round ${c.round - 1}: no answer`;
  } else if (c.phase === 'over') {
    pct = 0;
    note = f.answers.length ? `${f.answers.length} rounds answered` : 'no answers';
  }
  const pips = Array.from({ length: ROUNDS }, (_, i) => {
    const a = f.answers.find((x) => x.round === i + 1);
    const cls = a ? (a.late ? 'late' : 'done') : '';
    const now = c.phase === 'open' && c.round === i + 1 ? ' now' : '';
    return `<i class="${cls}${now}" title="Round ${i + 1}${a ? `: ${a.secs}s${a.late ? ', late' : ''}` : ''}"></i>`;
  }).join('');
  const nm = nameOf(s, f.agent);
  const initials = nm.split(/\s+/).map((x) => x[0] ?? '').join('').slice(0, 2).toUpperCase();
  const col = side === 'red' ? '#ef4444' : '#3b82f6';
  const avatar = `<svg class="avatar" viewBox="0 0 64 64"><defs><radialGradient id="av${side}" cx=".5" cy=".35" r=".7"><stop offset="0" stop-color="${col}" stop-opacity=".9"/><stop offset="1" stop-color="#0b0f1a"/></radialGradient></defs><path d="M32 3 57 17v30L32 61 7 47V17Z" fill="url(#av${side})" stroke="${col}" stroke-width="2"/><text x="32" y="39" text-anchor="middle">${esc(initials)}</text></svg>`;
  return `<div class="corner ${side}">
    <div class="tiny">${side === 'red' ? 'RED CORNER' : 'BLUE CORNER'} ${f.official || who.official ? '<span class="badge id">Agent ID</span>' : ''}</div>
    <div class="fighter">${avatar}<div><div class="nm">${esc(nm)}</div><div class="tiny">${esc(who.model || '')}</div></div></div>
    <div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div>
    <div class="accepted">${esc(note)}</div>
    <div class="pips">${pips}</div>
  </div>`;
}

/** The gong: a round clock that empties like a fuse. */
function face(label, value, part) {
  const r = 64;
  const len = 2 * Math.PI * r;
  const off = len * (1 - Math.max(0, Math.min(1, part)));
  return `<div class="face"><svg viewBox="0 0 150 150"><defs><linearGradient id="gongGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ef4444"/><stop offset="1" stop-color="#3b82f6"/></linearGradient></defs>
    <circle class="track" cx="75" cy="75" r="${r}" fill="none" stroke-width="8"/>
    <circle class="left" cx="75" cy="75" r="${r}" fill="none" stroke-width="8" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}" transform="rotate(-90 75 75)"/></svg>
    <div class="tm">${value}</div></div><div class="ph">${label}</div>`;
}

function gong(c, judged, waitingJudge) {
  if (judged) return `<div class="gong"><div class="rd">FINAL BELL</div>${face('judged on-chain', 'END', 0)}</div>`;
  if (c.phase === 'countdown') return `<div class="gong"><div class="rd">GET READY</div>${face('countdown', c.left, c.left / 10)}</div>`;
  if (c.phase === 'open') return `<div class="gong"><div class="rd">ROUND ${c.round} / 12</div>${face(esc(ROUND_NAMES[c.round - 1]), mmss(c.left), c.left / RT)}</div>`;
  if (c.phase === 'break') return `<div class="gong"><div class="rd">BREAK</div>${face(`round ${c.round} next`, c.left, c.left / 10)}</div>`;
  return `<div class="gong"><div class="rd">FINAL BELL</div>${face(waitingJudge ? 'waiting for the judge' : 'over', '—', 0)}</div>`;
}

function renderRing(b) {
  const red = b.red;
  const blue = b.blue;
  const bell = b.bellAt || red.clock?.bellAt || 0;
  const c = bell ? clockOf(bell, s.now) : { phase: 'over' };
  const ended = (red.ended || red.judged || c.phase === 'over') && (!blue || blue.ended || blue.judged || c.phase === 'over');
  const c2 = ended ? { phase: 'over' } : c;
  const v = verdict(b);
  let top = '';
  if (v && blue) {
    const wn = v.winner === 'draw' ? null : v.winner === 'red' ? red : blue;
    top = `<div class="winner"><div class="crown">${wn ? `🏆 ${esc(nameOf(s, wn.agent))} WINS${v.byTime ? ' ON TIME' : ''}` : 'A DRAW'}</div>
      <div class="score"><span class="red">${red.judged.points}</span> : <span class="blue">${blue.judged.points}</span></div>
      <div class="tiny">${red.judged.solved}/12 solved · ${red.judged.fouls} fouls · ${red.judged.timeUsed}s &nbsp;|&nbsp; ${blue.judged.solved}/12 solved · ${blue.judged.fouls} fouls · ${blue.judged.timeUsed}s</div></div>`;
  } else if (v) {
    top = `<div class="winner"><div class="crown">${esc(nameOf(s, red.agent))}</div><div class="score"><span class="red">${red.judged.points}</span> / 120</div>
      <div class="tiny">${red.judged.solved}/12 solved · ${red.judged.fouls} fouls · ${red.judged.timeUsed}s${red.challenged && !/^0x0{40}$/.test(red.challenged) ? ` · on the card of ${esc(nameOf(s, red.challenged))}` : ''}</div></div>`;
  } else if (ended) top = '<div class="winner"><div class="crown">FINAL BELL</div><div class="tiny">The judge is scoring the fight. The result appears here in a few seconds.</div></div>';
  $('#ring').innerHTML = `${top}<div class="corners">${corner(red, 'red', c2)}${gong(c2, !!v, ended && !v)}${blue ? corner(blue, 'blue', c2) : '<div class="corner blue"><div class="tiny">SOLO FIGHT</div><div class="nm" style="color:var(--ink-3);text-shadow:none">—</div></div>'}</div>`;
  if (v) {
    renderRounds(b);
    if (!shared) {
      shared = true;
      const url = `${siteUrl()}/match.html?a=${red.agent}&n=${red.number}`;
      let text;
      if (blue && v.winner !== 'draw') {
        const [w, l] = v.winner === 'red' ? [red, blue] : [blue, red];
        text = `${nameOf(s, w.agent)} beat ${nameOf(s, l.agent)} ${w.judged.points}:${l.judged.points} in IBITI Agent Arena — 12 rounds of real drainer scams, judged on-chain.`;
      } else text = `${nameOf(s, red.agent)} scored ${red.judged.points}/120 in IBITI Agent Arena — 12 rounds of real drainer scams, judged on-chain.`;
      $('#share').innerHTML = shareButtons(text, url);
      $('#sharePanel').style.display = '';
    }
  }
}

function cell(r, side) {
  if (!r) return '<td></td>';
  const a = r.answer;
  const bar = `<div class="mini ${side}"><i data-w="${a ? Math.min(100, (a.secs / RT) * 100).toFixed(1) : 0}" style="width:${a ? Math.min(100, (a.secs / RT) * 100).toFixed(1) : 0}%"></i></div>`;
  let res;
  if (!a) res = '<span class="no">✗ no answer · 0</span>';
  else if (a.late) res = `<span class="no">✗ after the bell (${a.secs}s) · 0</span>`;
  else res = r.solved ? `<span class="ok">✓ solved · +${r.points}</span> <span class="tiny">${a.secs}s</span>` : `<span class="no">✗ wrong answer · 0</span> <span class="tiny">${a.secs}s</span>`;
  const traps = [
    ...r.hits.map((h) => `took the trap ${esc(trapName(h.trap))} (−2)`),
    ...r.fouls.map((h) => `foul: ${esc(trapName(h.trap))} (−2)`),
  ];
  return `<td style="min-width:240px">${bar}<div style="margin-top:6px">${res}</div>${traps.length ? `<div class="note">${traps.join('<br>')}</div>` : ''}</td>`;
}

function renderRounds(b) {
  const rr = rounds(b.red);
  const rb = b.blue ? rounds(b.blue) : [];
  $('#rounds').innerHTML = `<tr><th>Round</th><th><span class="dot red"></span>${esc(nameOf(s, b.red.agent))}</th>${b.blue ? `<th><span class="dot blue"></span>${esc(nameOf(s, b.blue.agent))}</th>` : ''}</tr>` +
    rr.map((r, i) => `<tr class="r"><td><b>${r.round}</b> <span class="tiny">${esc(r.name)}</span></td>${cell(r, 'red')}${b.blue ? cell(rb[i], 'blue') : ''}</tr>`).join('');
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
    else $('#ring').innerHTML = '<div class="empty">This fight is not on the chain (yet).</div>';
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

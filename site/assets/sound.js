// The sounds of the ring, made on the fly (no sound files): the gong, the countdown beeps and the
// "answer accepted" ding. Off until the viewer turns them on (browsers allow sound only after a tap);
// the choice is remembered.

let ctx = null;
let on = false;
try {
  on = localStorage.getItem('arenaSound') === 'on';
} catch {
  // nothing remembered: off
}

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}
// a remembered "on" still needs one tap on the page before the browser lets it play
document.addEventListener('pointerdown', () => on && audio(), { once: true });

export const soundOn = () => on;
export function setSound(value) {
  on = value;
  try {
    localStorage.setItem('arenaSound', value ? 'on' : 'off');
  } catch {
    // not remembered, still works now
  }
  if (on) audio();
}

function tone(c, freq, at, dur, gain, type = 'sine') {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(gain, at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** A boxing-ring gong: a few metallic partials that ring out. `times` strikes in a row. */
export function gong(times = 1) {
  const c = on && audio();
  if (!c) return;
  for (let k = 0; k < times; k++) {
    const at = c.currentTime + k * 0.42;
    [[220, 0.3, 2.6], [440 * 1.19, 0.14, 2.0], [660 * 1.31, 0.09, 1.4], [880 * 1.47, 0.05, 1.0], [1320 * 1.6, 0.025, 0.6]].forEach(([f, g, d]) => tone(c, f, at, d, g));
  }
}

/** A short beep of the countdown; the last one higher. */
export function beep(high = false) {
  const c = on && audio();
  if (!c) return;
  tone(c, high ? 1320 : 880, c.currentTime, 0.16, 0.12, 'square');
}

/** A bright ding: an answer was accepted. */
export function ding() {
  const c = on && audio();
  if (!c) return;
  tone(c, 1568, c.currentTime, 0.35, 0.12);
  tone(c, 2093, c.currentTime + 0.06, 0.3, 0.07);
}

/** A dull thud: a trap was taken (only in the replay, after the judge). */
export function thud() {
  const c = on && audio();
  if (!c) return;
  tone(c, 110, c.currentTime, 0.4, 0.25, 'triangle');
}

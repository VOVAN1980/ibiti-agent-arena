// The sound of the arena, all made on the fly (no sound files): the gong, the countdown, the ding of
// an accepted answer, the crowd (its murmur, a roar, applause and whistles, a long "booo"), and the
// music: a pumping beat before the fight and in the breaks, a heartbeat while a round runs, a fanfare
// for the winner. On unless the viewer turns it off, like the arena's theme (browsers allow sound
// only after a tap, so it starts at the first one); the choice is remembered.

let ctx = null;
let master = null;
let noiseBuf = null;
let on = true;
try {
  on = localStorage.getItem('arenaSound') !== 'off';
} catch {
  // nothing remembered: on
}

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master = ctx.createGain();
    master.gain.value = on ? 0.9 : 0;
    // the mix was made quiet (the murmur measured about 25 dB under a normal page's music): brought up
    // to the level of the arena's theme, with a limiter at the end so the gong and the roar never clip
    const loud = ctx.createGain();
    loud.gain.value = 3.2;
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    master.connect(comp).connect(loud).connect(limit).connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    let b = 0;
    for (let i = 0; i < d.length; i++) {
      b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); // a little pink
      d[i] = (Math.random() * 2 - 1) * 0.6 + b * 2.4;
    }
  }
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {});
  return ctx;
}
// the arena is heard only while its page is on screen: a tab in the background goes quiet
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else if (on) ctx.resume().catch(() => {});
});
// a remembered "on" still needs one tap on the page before the browser lets it play
document.addEventListener('pointerdown', () => {
  if (on) {
    audio();
    crowdStart();
    if (music.mode) musicStart();
  }
}, { once: true });

export const soundOn = () => on;
/** Whether the browser is really letting the arena sound now (a remembered "on" still needs one tap). */
export const soundRunning = () => !!ctx && ctx.state === 'running';
export function setSound(value) {
  on = value;
  try {
    localStorage.setItem('arenaSound', value ? 'on' : 'off');
  } catch {
    // not remembered, still works now
  }
  const c = audio();
  if (!c) return;
  master.gain.setTargetAtTime(on ? 0.9 : 0, c.currentTime, 0.05);
  if (on) {
    crowdStart();
    if (music.mode) musicStart();
  }
}

// ------------------------------------------------------------------ building blocks

const live = () => on && !document.hidden && audio();

function env(g, at, peak, attack, decay) {
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

function tone(freq, at, dur, gain, type = 'sine', out = master) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, at);
  env(g, at, gain, 0.01, dur);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
  return o;
}

function noise(at, dur, filterType, freq, q, gain, attack = 0.005, out = master) {
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = filterType;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  env(g, at, gain, attack, dur);
  s.connect(f).connect(g).connect(out);
  s.start(at, Math.random() * 1.5);
  s.stop(at + attack + dur + 0.05);
}

// ------------------------------------------------------------------ the ring

/** A boxing-ring gong: a few metallic partials that ring out. `times` strikes in a row. */
export function gong(times = 1) {
  if (!live()) return;
  for (let k = 0; k < times; k++) {
    const at = ctx.currentTime + k * 0.42;
    [[220, 0.3, 2.6], [523, 0.14, 2.0], [865, 0.09, 1.4], [1294, 0.05, 1.0], [2112, 0.025, 0.6]].forEach(([f, g, d]) => tone(f, at, d, g));
  }
}

/** A short beep of the countdown; the last one higher. */
export function beep(high = false) {
  if (!live()) return;
  tone(high ? 1320 : 880, ctx.currentTime, 0.16, 0.12, 'square');
}

/** A bright ding: an answer was accepted. */
export function ding() {
  if (!live()) return;
  tone(1568, ctx.currentTime, 0.35, 0.12);
  tone(2093, ctx.currentTime + 0.06, 0.3, 0.07);
}

/** A dull thud: a trap was taken (only in the replay, after the judge). */
export function thud() {
  if (!live()) return;
  tone(110, ctx.currentTime, 0.4, 0.25, 'triangle');
}

// ------------------------------------------------------------------ the crowd

let crowd = null;
let crowdTarget = 0.35;
function crowdStart() {
  if (crowd || !live()) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 650;
  bp.Q.value = 0.6;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2200;
  const g = ctx.createGain();
  g.gain.value = 0;
  s.connect(bp).connect(lp).connect(g).connect(master);
  s.start();
  crowd = { g };
  // a murmur that swells and falls a little, and follows how excited the hall is
  setInterval(() => {
    if (!ctx) return;
    const level = (0.03 + crowdTarget * 0.08) * (0.8 + Math.random() * 0.4); // a murmur you hear, not a roar
    crowd.g.gain.setTargetAtTime(level, ctx.currentTime, 0.4);
  }, 350);
}

/** How loud the hall murmurs, 0 (quiet) to 1 (on its feet). */
export function crowdLevel(x) {
  crowdTarget = Math.max(0, Math.min(1, x));
  if (on) crowdStart();
}

/** The hall roars: noise swell, applause and a few whistles. */
export function cheer(power = 1) {
  if (!live()) return;
  crowdStart();
  const at = ctx.currentTime;
  noise(at, 2.4, 'bandpass', 1500, 0.5, 0.3 * power, 0.35);
  noise(at, 1.6, 'bandpass', 600, 0.7, 0.16 * power, 0.25);
  for (let i = 0; i < 46 * power; i++) noise(at + Math.random() * 2.2, 0.035, 'highpass', 1400, 0.7, 0.05 + Math.random() * 0.05);
  for (let i = 0; i < 3 * power; i++) {
    const t0 = at + 0.2 + Math.random() * 1.2;
    const o = tone(1800, t0, 0.45, 0.025);
    o.frequency.exponentialRampToValueAtTime(2500 + Math.random() * 400, t0 + 0.3);
  }
}

/** The hall goes "oooh": many voices sliding up together, opening from "oo" towards "ah". */
export function ooh(power = 1, dur = 2.8) {
  if (!live()) return;
  crowdStart();
  const at = ctx.currentTime;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(700, at);
  lp.frequency.exponentialRampToValueAtTime(1500, at + dur * 0.8);
  const formant = ctx.createBiquadFilter();
  formant.type = 'peaking';
  formant.gain.value = 11;
  formant.Q.value = 1.6;
  formant.frequency.setValueAtTime(340, at);
  formant.frequency.exponentialRampToValueAtTime(680, at + dur * 0.8);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.2 * power, at + dur * 0.62);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  lp.connect(formant).connect(g).connect(master);
  for (let i = 0; i < 18; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 110 + Math.random() * 110;
    o.frequency.setValueAtTime(f, at);
    o.frequency.exponentialRampToValueAtTime(f * (1.35 + Math.random() * 0.2), at + dur * 0.8);
    const og = ctx.createGain();
    og.gain.value = 0.16;
    o.connect(og).connect(lp);
    o.start(at + Math.random() * 0.2);
    o.stop(at + dur + 0.1);
  }
  noise(at, dur * 0.8, 'bandpass', 900, 0.6, 0.05 * power, dur * 0.5);
}

/** A long "booo" from the stands. */
export function boo() {
  if (!live()) return;
  crowdStart();
  const at = ctx.currentTime;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 560;
  const formant = ctx.createBiquadFilter();
  formant.type = 'peaking';
  formant.frequency.value = 330;
  formant.gain.value = 10;
  formant.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.16, at + 0.45);
  g.gain.setValueAtTime(0.16, at + 1.5);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 2.6);
  lp.connect(formant).connect(g).connect(master);
  for (let i = 0; i < 16; i++) {
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = 92 + Math.random() * 80;
    o.frequency.setValueAtTime(f, at);
    o.frequency.linearRampToValueAtTime(f * 0.88, at + 2.4);
    const og = ctx.createGain();
    og.gain.value = 0.18;
    o.connect(og).connect(lp);
    o.start(at + Math.random() * 0.15);
    o.stop(at + 2.7);
  }
  noise(at, 2.2, 'lowpass', 420, 0.5, 0.08, 0.4);
}

// ------------------------------------------------------------------ the music

const music = { mode: null, bpm: 128, step: 0, next: 0, timer: null, bus: null };
const A = [110, 87.31, 130.81, 98]; // A minor: Am F C G
const CHORD = (root) => [root * 2, root * 2 * 1.189, root * 2 * 1.498]; // minor-ish triad up an octave
const FANFARE = [[261.63, 329.63, 392], [207.65, 261.63, 311.13], [233.08, 293.66, 349.23], [261.63, 329.63, 392, 523.25]];

function kick(at, gain = 0.8) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(150, at);
  o.frequency.exponentialRampToValueAtTime(44, at + 0.13);
  env(g, at, gain, 0.003, 0.26);
  o.connect(g).connect(music.bus);
  o.start(at);
  o.stop(at + 0.3);
}
const hat = (at, open) => noise(at, open ? 0.16 : 0.04, 'highpass', 7500, 0.7, open ? 0.12 : 0.08, 0.002, music.bus);
const clap = (at) => [0, 0.012, 0.025].forEach((d) => noise(at + d, 0.09, 'bandpass', 1400, 0.9, 0.22, 0.002, music.bus));
function synth(at, freqs, dur, gain, cutoff = 1600, type = 'sawtooth') {
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(cutoff, at);
  lp.frequency.exponentialRampToValueAtTime(cutoff * 0.35, at + dur);
  const g = ctx.createGain();
  env(g, at, gain, 0.01, dur);
  lp.connect(g).connect(music.bus);
  for (const f of freqs) {
    for (const det of [-6, 6]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(lp);
      o.start(at);
      o.stop(at + dur + 0.05);
    }
  }
}

function playStep(step, at) {
  const s = step % 16;
  const bar = Math.floor(step / 16);
  if (music.mode === 'hype') {
    const root = A[bar % 4];
    if (s % 4 === 0) kick(at);
    if (s === 4 || s === 12) clap(at);
    if (s % 4 === 2) hat(at, true);
    else hat(at, false);
    if (s % 2 === 0) synth(at, [s % 4 === 0 ? root : root * 2], 0.18, 0.11, 700);
    if (s === 0 || s === 6 || s === 10) synth(at, CHORD(root), 0.32, 0.05, 2600);
  } else if (music.mode === 'tension') {
    if (s === 0) kick(at, 0.55);
    if (s === 3) kick(at, 0.35);
    if (s % 4 === 0) noise(at, 0.02, 'highpass', 4000, 1, 0.07, 0.001, music.bus); // the clock ticks
    if (s === 0 && bar % 2 === 0) synth(at, [55, 82.41], 3.6, 0.05, 420);
  } else if (music.mode === 'victory') {
    if (s % 4 === 0) kick(at, 0.7);
    if (s === 0 && bar === 0) noise(at, 1.4, 'highpass', 5000, 0.5, 0.2, 0.002, music.bus); // a crash
    if (s % 8 === 0) synth(at, FANFARE[(bar * 2 + s / 8) % 4], 0.55, 0.08, 2400);
    if (s % 4 === 2) hat(at, false);
    if (bar >= 4) music.mode = null; // the fanfare ends: the arena's theme takes over (music.js)
  }
}

function musicStart() {
  if (!live() || music.timer) return;
  if (!music.bus) {
    music.bus = ctx.createGain();
    music.bus.gain.value = 0.42;
    music.bus.connect(master);
  }
  music.next = ctx.currentTime + 0.06;
  music.timer = setInterval(() => {
    if (!music.mode || !on) return;
    while (music.next < ctx.currentTime + 0.12) {
      playStep(music.step, music.next);
      music.next += 60 / music.bpm / 4;
      music.step += 1;
    }
  }, 25);
}

/** 'hype' before the fight and in the breaks, 'tension' while a round runs, 'victory' for the winner, null for none. */
export function setMusic(mode) {
  if (music.mode === mode) return;
  music.mode = mode;
  music.step = 0;
  music.bpm = mode === 'tension' ? 100 : mode === 'victory' ? 112 : 128;
  if (ctx) music.next = ctx.currentTime + 0.05;
  if (on && mode) musicStart();
}

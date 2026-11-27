// The sound of the arena: real recordings (assets/audio/sfx, free licences, see its LICENSES.md), no
// sounds made up in code. The gong, the countdown, the click of an accepted answer, the punch, the
// knockout crash, the crowd (its murmur, roars, an "oooh", a "booo") and the fight's own music: a beat
// before the fight and in the breaks, a heartbeat while a round runs, the hall's roar for the winner.
// A recording that has not arrived (yet) is simply not heard. On unless the viewer turns it off, like
// the arena's theme (browsers allow sound only after a tap, so it starts at the first one); the choice
// is remembered.

const DIR = new URL('./audio/sfx/', import.meta.url);
/** Every recording, and how loud it sits against the others (dB, after levelling). */
const SFX = {
  gong: -4, // a round's bell
  gongEnd: -3, // the final bell
  count: -12, // the countdown bleeps
  accept: -10, // an answer accepted
  punch: -2,
  crash: 0, // the beaten one falls onto its desk
  roar: -6,
  stadium: -6,
  victory: -3,
  whistle: -5, // roar and whistles
  crowd: -12, // the hall's murmur, looped
  ooh: -6,
  boo: -6,
  hype: -6, // the beat before the fight and in the breaks, looped
  heart: -10, // the heartbeat while a round runs, looped
};
const FILE = { gongEnd: 'gong-end' };
/** Where a looped recording goes round (its quiet ends left out), in seconds. */
const LOOP = { hype: [0.4, 63.9], crowd: [0.5, 24], heart: [0.25, 29.6] };
const LEVEL = -16; // what "0 dB" above means: the sounding part of each recording is brought to this

let ctx = null;
let master = null;
const bufs = {}; // name → { buf, norm } once decoded
let loading = null;
let on = true;
try {
  on = localStorage.getItem('arenaSound') !== 'off';
} catch {
  // nothing remembered: on
}

const db = (x) => 10 ** (x / 20);

/** The loudness of the part of a recording that sounds (its quiet ends left out), in dB. */
function activeRms(buf) {
  const d = buf.getChannelData(0);
  const win = Math.max(1, Math.round(buf.sampleRate * 0.05));
  const parts = [];
  let peak = 0;
  for (let i = 0; i < d.length; i += win) {
    let s = 0;
    const end = Math.min(i + win, d.length);
    for (let j = i; j < end; j++) s += d[j] * d[j];
    const r = Math.sqrt(s / (end - i));
    parts.push(r);
    peak = Math.max(peak, r);
  }
  const loud = parts.filter((r) => r > peak * 0.1);
  const mean = loud.reduce((a, r) => a + r * r, 0) / Math.max(1, loud.length);
  return 10 * Math.log10(mean || 1e-9);
}

function loadAll() {
  loading ??= Promise.all(
    Object.keys(SFX).map(async (name) => {
      try {
        const r = await fetch(new URL(`${FILE[name] ?? name}.mp3`, DIR));
        if (!r.ok) return;
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        bufs[name] = { buf, norm: Math.min(8, db(LEVEL - activeRms(buf))) };
      } catch {
        // not heard
      }
    }),
  ).then(() => {
    // the loops start the moment their recordings are here
    if (crowd.want && on) crowdStart();
    if (music.mode && on) musicStart(music.mode);
  });
}

function audio() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
    master = ctx.createGain();
    master.gain.value = on ? 0.9 : 0;
    // a limiter at the end: the gong, the crash and the roar together never clip
    const limit = ctx.createDynamicsCompressor();
    limit.threshold.value = -3;
    limit.knee.value = 0;
    limit.ratio.value = 20;
    limit.attack.value = 0.002;
    limit.release.value = 0.12;
    master.connect(limit).connect(ctx.destination);
    loadAll();
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
    if (music.mode) musicStart(music.mode);
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
    if (music.mode) musicStart(music.mode);
  }
}

const live = () => on && !document.hidden && audio();

/** Plays a recording: from `offset` for `dur` seconds (the whole of it by default), `gain` on top of its
 *  level, at `rate` (below 1: deeper and slower). Returns its gain and source, or null when it is not here. */
function play(name, { gain = 1, rate = 1, offset = 0, dur = 0, delay = 0, loop = false, out = master, fade = 0.08 } = {}) {
  const b = bufs[name];
  if (!b) return null;
  const at = ctx.currentTime + delay;
  const s = ctx.createBufferSource();
  s.buffer = b.buf;
  s.loop = loop;
  if (loop && LOOP[name]) [s.loopStart, s.loopEnd] = LOOP[name];
  s.playbackRate.value = rate;
  const g = ctx.createGain();
  const level = b.norm * db(SFX[name]) * gain;
  g.gain.value = level;
  s.connect(g).connect(out);
  s.start(at, loop && LOOP[name] ? LOOP[name][0] + (offset % (LOOP[name][1] - LOOP[name][0])) : offset % b.buf.duration);
  if (dur && !loop) {
    // ends softly where it is cut
    g.gain.setValueAtTime(level, at + Math.max(0, dur - fade));
    g.gain.linearRampToValueAtTime(0.0001, at + dur);
    s.stop(at + dur + 0.02);
  }
  return { g, s, level };
}

// ------------------------------------------------------------------ the ring

/** The bell: a round begins (1), or the fight is over (3). */
export function gong(times = 1) {
  if (!live()) return;
  if (times > 1 && bufs.gongEnd) play('gongEnd');
  else play('gong', { offset: 0.08 });
}

/** One bleep of the countdown; the last one is the long, higher one. */
export function beep(high = false) {
  if (!live()) return;
  play('count', high ? { offset: 2.93, dur: 0.6 } : { dur: 0.55 });
}

/** An answer was accepted. */
export function ding() {
  if (!live()) return;
  play('accept');
}

/** A dull blow: a trap was taken (only in the replay, after the judge). */
export function thud() {
  if (!live()) return;
  play('punch', { rate: 0.72, gain: 0.55 });
}

/** The uppercut on the jaw. */
export function punch() {
  if (!live()) return;
  play('punch');
}

/** The beaten one falls onto its desk and breaks it. */
export function crash() {
  if (!live()) return;
  play('crash', { offset: 1.15 });
}

/** The winner lands after its backflip. */
export function land() {
  if (!live()) return;
  play('punch', { rate: 0.6, gain: 0.7 });
}

// ------------------------------------------------------------------ the crowd

const crowd = { want: false, g: null, base: 0, target: 0.35 };
function crowdStart() {
  crowd.want = true;
  if (crowd.g || !live() || !bufs.crowd) return;
  const p = play('crowd', { loop: true, offset: Math.random() * 10 });
  crowd.base = p.level;
  crowd.g = p.g;
  crowd.g.gain.value = 0;
  // the hall breathes a little, and follows how excited it is
  setInterval(() => {
    if (!ctx) return;
    const level = crowd.base * (0.45 + crowd.target * 0.9) * (0.88 + Math.random() * 0.24);
    crowd.g.gain.setTargetAtTime(level, ctx.currentTime, 0.5);
  }, 400);
}

/** How loud the hall murmurs, 0 (quiet) to 1 (on its feet). */
export function crowdLevel(x) {
  crowd.target = Math.max(0, Math.min(1, x));
  if (on) crowdStart();
}

let roars = 0;
/** The hall roars; `power` 1 is a big moment, 0.5 a small one. */
export function cheer(power = 1) {
  if (!live()) return;
  crowdStart();
  const gain = Math.min(1.5, 0.35 + power * 0.65);
  play(roars++ % 2 ? 'stadium' : 'roar', { gain, offset: 0.3 });
  if (power >= 1.3) play(roars % 2 ? 'stadium' : 'roar', { gain: gain * 0.6, delay: 0.25, offset: 0.3 });
}

/** The hall goes "oooh", for about `dur` seconds. */
export function ooh(power = 1, dur = 2.8) {
  if (!live()) return;
  crowdStart();
  play('ooh', { offset: 0.25, gain: Math.min(1.4, 0.4 + power * 0.6), dur: Math.min(dur + 0.6, bufs.ooh?.buf.duration ?? dur), fade: 0.5 });
}

/** The knockout blow: the whole hall on its feet, an ovation that carries on (about 14 s) through the
 *  winner's walk to the ropes and its backflip. */
export function ovation() {
  if (!live()) return;
  crowdStart();
  crowd.target = 1;
  play('roar', { gain: 1.3, offset: 0.3 }); // the first burst, on the blow
  play('victory', { gain: 1.0, delay: 0.4 });
  play('stadium', { gain: 0.9, delay: 3, offset: 0.3 });
  play('roar', { gain: 0.8, delay: 6, offset: 0.3 });
  play('victory', { gain: 0.9, delay: 8.5, offset: 1 });
  play('stadium', { gain: 0.8, delay: 11, offset: 0.3 });
}

/** The winner lands its backflip: a second, bigger burst, with whistles and shouts, that rings on. */
export function encore() {
  if (!live()) return;
  crowdStart();
  crowd.target = 1;
  play('roar', { gain: 1.5, offset: 0.3 });
  play('victory', { gain: 1.3 });
  play('whistle', { gain: 1.2 });
  play('stadium', { gain: 1.1, delay: 0.5, offset: 0.3 });
  play('roar', { gain: 1.0, delay: 4, offset: 0.3 });
}

/** A "booo" from the stands. */
export function boo() {
  if (!live()) return;
  crowdStart();
  play('boo');
}

// ------------------------------------------------------------------ the fight's own music

const music = { mode: null, now: null, bus: null };
function musicStart(mode) {
  if (!live()) return;
  if (!music.bus) {
    music.bus = ctx.createGain();
    music.bus.connect(master);
  }
  if (music.now?.mode === mode) return;
  musicStop();
  if (mode === 'victory') {
    // the winner: the whole hall roars; then the arena's theme takes over (music.js)
    play('victory', { out: music.bus });
    music.mode = null;
    return;
  }
  const name = mode === 'tension' ? 'heart' : 'hype';
  const p = play(name, { loop: true, out: music.bus });
  if (!p) return;
  p.g.gain.setValueAtTime(0.0001, ctx.currentTime);
  p.g.gain.exponentialRampToValueAtTime(Math.max(0.0002, p.level), ctx.currentTime + 0.6);
  music.now = { mode, ...p };
}
function musicStop() {
  const n = music.now;
  music.now = null;
  if (!n) return;
  n.g.gain.cancelScheduledValues(ctx.currentTime);
  n.g.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
  n.s.stop(ctx.currentTime + 1.5);
}

/** 'hype' before the fight and in the breaks, 'tension' while a round runs, 'victory' for the winner, null for none. */
export function setMusic(mode) {
  if (music.mode === mode) return;
  music.mode = mode;
  if (!ctx) return;
  if (!mode) musicStop();
  else if (on) musicStart(mode);
}

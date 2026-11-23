// The ranking's effects. A row that climbs cracks, shatters into real pieces of itself (copies of the
// row cut into shards) and a cloud of dust where it was; at its new place the dust gathers, the shards
// fly back in and lock together, and the whole row lands with a flash. The rows it passes slide down.
// The sounds are made here (no files): a crack, the scatter of debris, the rush of the pieces coming
// back and a metal strike as the row lands, deeper for first place. They play only when the arena's
// sound is on in the gear menu, at its volume, and never before the visitor has touched the page.
import { musicOn, musicVolume } from './music.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const reduced = REDUCED;

// ------------------------------------------------------------------ sound
let ctx = null;
let touched = false;
addEventListener('pointerdown', () => (touched = true), { once: true, capture: true });
addEventListener('keydown', () => (touched = true), { once: true, capture: true });

function audio() {
  if (!touched || !musicOn()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function noise(c, seconds) {
  const b = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const n = c.createBufferSource();
  n.buffer = b;
  return n;
}

function out(c, level) {
  const g = c.createGain();
  g.gain.value = musicVolume() * level;
  g.connect(c.destination);
  return g;
}

/** One short burst of filtered noise: a crack, a chip, a click. */
function snap(c, dest, t, { freq = 3000, q = 0.8, len = 0.06, gain = 0.8, type = 'bandpass' } = {}) {
  const n = noise(c, len + 0.02);
  const f = c.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  n.connect(f).connect(g).connect(dest);
  n.start(t);
  n.stop(t + len + 0.02);
}

/** The row breaking: a hard crack, then debris raining for half a second. */
export function soundShatter(big = false) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const o = out(c, big ? 0.95 : 0.75);
  snap(c, o, t, { freq: 1800, q: 0.5, len: 0.09, gain: 1 });
  snap(c, o, t + 0.01, { freq: 5200, q: 1.5, len: 0.05, gain: 0.7 });
  // a low thud under the crack
  const th = c.createOscillator();
  th.type = 'sine';
  th.frequency.setValueAtTime(160, t);
  th.frequency.exponentialRampToValueAtTime(50, t + 0.18);
  const tg = c.createGain();
  tg.gain.setValueAtTime(0.7, t);
  tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
  th.connect(tg).connect(o);
  th.start(t);
  th.stop(t + 0.2);
  // debris: many small bright chips, thinning out
  for (let i = 0; i < 26; i++) {
    const at = t + 0.04 + Math.random() ** 1.6 * 0.55;
    snap(c, o, at, { freq: 2500 + Math.random() * 6500, q: 4 + Math.random() * 8, len: 0.015 + Math.random() * 0.03, gain: 0.25 + Math.random() * 0.35 });
  }
}

/** The pieces coming back: a rising rush that stops sharply. */
export function soundGather(delay = 0) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = out(c, 0.55);
  const n = noise(c, 0.6);
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.Q.value = 1.4;
  f.frequency.setValueAtTime(600, t);
  f.frequency.exponentialRampToValueAtTime(6000, t + 0.5);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.9, t + 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.56);
  n.connect(f).connect(g).connect(o);
  n.start(t);
  n.stop(t + 0.6);
}

/** A metal strike as the row locks together: a click and ringing partials, a deep hit for first place. */
export function soundLand(place = 9) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime;
  const o = out(c, 0.75);
  snap(c, o, t, { freq: 3500, type: 'highpass', len: 0.05, gain: 0.8 });
  const base = place === 1 ? 520 : place <= 3 ? 600 : 700;
  for (const [mul, amp, len] of [[1, 0.35, 1.0], [2.76, 0.18, 0.7], [5.4, 0.08, 0.4]]) {
    const osc = c.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = base * mul;
    const g = c.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    osc.connect(g).connect(o);
    osc.start(t);
    osc.stop(t + len);
  }
  if (place === 1) {
    const osc = c.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(40, t + 0.55);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    osc.connect(g).connect(o);
    osc.start(t);
    osc.stop(t + 0.6);
  }
}

// ------------------------------------------------------------------ dust (a canvas over the page)
let canvas = null;
let pen = null;
let dust = [];
let running = false;

function surface() {
  if (canvas) return;
  canvas = document.createElement('canvas');
  canvas.className = 'rankfx';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.appendChild(canvas);
  pen = canvas.getContext('2d');
  const fit = () => {
    const r = devicePixelRatio || 1;
    canvas.width = innerWidth * r;
    canvas.height = innerHeight * r;
    pen.setTransform(r, 0, 0, r, 0, 0);
  };
  fit();
  addEventListener('resize', fit);
}

function frame(now) {
  pen.clearRect(0, 0, innerWidth, innerHeight);
  dust = dust.filter((p) => now < p.end);
  for (const p of dust) {
    const k = (now - p.start) / (p.end - p.start);
    if (k <= 0) continue;
    let x;
    let y;
    let a;
    if (p.gather) {
      const e = 1 - (1 - k) ** 3;
      x = p.x0 + (p.x1 - p.x0) * e;
      y = p.y0 + (p.y1 - p.y0) * e;
      a = Math.min(1, k * 2.5) * (k > 0.9 ? (1 - k) / 0.1 : 1);
    } else {
      // blown out, slowing, drifting down, fading
      const e = 1 - (1 - k) ** 2.2;
      x = p.x0 + p.vx * e;
      y = p.y0 + p.vy * e + 40 * k * k;
      a = (1 - k) ** 1.4;
    }
    pen.globalAlpha = a * p.alpha;
    pen.fillStyle = p.color;
    pen.beginPath();
    pen.arc(x, y, p.size, 0, Math.PI * 2);
    pen.fill();
  }
  pen.globalAlpha = 1;
  if (dust.length) requestAnimationFrame(frame);
  else running = false;
}

function play() {
  if (running) return;
  running = true;
  requestAnimationFrame(frame);
}

const COLORS = { 1: ['#ffe39a', '#e2b84a', '#fff6d8', '#8a6a24'], 2: ['#f1f4f8', '#c9d1db', '#ffffff', '#6b7480'], 3: ['#ffc59a', '#d08a4e', '#ffe2cc', '#7c4520'] };
const colorsOf = (place) => COLORS[place] ?? ['#e6ebf5', '#9aa4b8', '#ffffff', '#3c4149'];

function dustOut(rect, place, cx, cy) {
  const now = performance.now();
  const cs = colorsOf(place);
  const n = Math.min(520, Math.round((rect.width * rect.height) / 45));
  for (let i = 0; i < n; i++) {
    const x0 = rect.left + Math.random() * rect.width;
    const y0 = rect.top + Math.random() * rect.height;
    const ang = Math.atan2(y0 - cy, x0 - cx) + (Math.random() - 0.5) * 0.9;
    const sp = 40 + Math.random() * 300;
    dust.push({ x0, y0, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.6 - 30, size: 0.5 + Math.random() * 1.6, alpha: 0.5 + Math.random() * 0.5, color: cs[i % cs.length], start: now + Math.random() * 80, end: now + 700 + Math.random() * 700 });
  }
  play();
}

function dustIn(rect, place, delay, dur) {
  const now = performance.now() + delay;
  const cs = colorsOf(place);
  const n = Math.min(520, Math.round((rect.width * rect.height) / 45));
  for (let i = 0; i < n; i++) {
    const x1 = rect.left + Math.random() * rect.width;
    const y1 = rect.top + Math.random() * rect.height;
    const ang = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 260;
    dust.push({ gather: true, x0: x1 + Math.cos(ang) * dist, y0: y1 + Math.sin(ang) * dist * 0.55, x1, y1, size: 0.5 + Math.random() * 1.5, alpha: 0.5 + Math.random() * 0.5, color: cs[i % cs.length], start: now + Math.random() * dur * 0.3, end: now + dur * (0.75 + Math.random() * 0.25) });
  }
  play();
}

// ------------------------------------------------------------------ shards (copies of the row, cut up)

/** Triangles over a w×h rectangle: a jittered grid, each cell cut corner to corner. */
function shards(w, h) {
  const cols = Math.max(4, Math.round(w / 90));
  const rows = h > 90 ? 4 : 3;
  const pt = [];
  for (let j = 0; j <= rows; j++) {
    pt.push([]);
    for (let i = 0; i <= cols; i++) {
      const edgeX = i === 0 || i === cols;
      const edgeY = j === 0 || j === rows;
      const x = (i / cols) * w + (edgeX ? 0 : (Math.random() - 0.5) * (w / cols) * 0.7);
      const y = (j / rows) * h + (edgeY ? 0 : (Math.random() - 0.5) * (h / rows) * 0.7);
      pt[j].push([x, y]);
    }
  }
  const tris = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = pt[j][i];
      const b = pt[j][i + 1];
      const c = pt[j + 1][i + 1];
      const d = pt[j + 1][i];
      if (Math.random() < 0.5) tris.push([a, b, c], [a, c, d]);
      else tris.push([a, b, d], [b, c, d]);
    }
  }
  return tris;
}

/** A layer fixed over the page at `rect`, holding the shards of `source` (an element to copy). */
function shardLayer(source, rect) {
  const layer = document.createElement('div');
  layer.className = 'shardlayer';
  Object.assign(layer.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  const pieces = shards(rect.width, rect.height).map((tri) => {
    const s = document.createElement('div');
    s.className = 'shard';
    s.style.clipPath = `polygon(${tri.map(([x, y]) => `${x.toFixed(1)}px ${y.toFixed(1)}px`).join(',')})`;
    const copy = source.cloneNode(true);
    copy.removeAttribute('data-key');
    copy.style.cssText = `position:absolute;left:0;top:0;width:${rect.width}px;height:${rect.height}px;margin:0;transform:none;opacity:1;animation:none;transition:none;`;
    s.appendChild(copy);
    const cx = (tri[0][0] + tri[1][0] + tri[2][0]) / 3;
    const cy = (tri[0][1] + tri[1][1] + tri[2][1]) / 3;
    s.style.transformOrigin = `${cx}px ${cy}px`;
    layer.appendChild(s);
    return { s, cx, cy };
  });
  document.body.appendChild(layer);
  return { layer, pieces };
}

/** The row at `rect` (as `copy` looked) cracks and blows apart. Resolves when the pieces are gone. */
export function shatter(copy, rect, place) {
  if (REDUCED) return Promise.resolve();
  surface();
  const { layer, pieces } = shardLayer(copy, rect);
  // the blow comes from a point on the row: the shards fly away from it
  const hx = rect.width * (0.3 + Math.random() * 0.4);
  const hy = rect.height * 0.5;
  layer.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-3px,1px)' }, { transform: 'translate(3px,-1px)' }, { transform: 'translate(0,0)' }], { duration: 120 });
  const crack = document.createElement('div');
  crack.className = 'shardflash';
  layer.appendChild(crack);
  crack.animate([{ opacity: 0.9 }, { opacity: 0 }], { duration: 180, fill: 'forwards' });
  dustOut(rect, place, rect.left + hx, rect.top + hy);
  const done = pieces.map(({ s, cx, cy }) => {
    const ang = Math.atan2(cy - hy, cx - hx) + (Math.random() - 0.5) * 0.7;
    const dist = 120 + Math.random() * 380 * (1 - Math.min(1, Math.hypot(cx - hx, cy - hy) / rect.width));
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.55 - 40 - Math.random() * 40;
    const rot = (Math.random() - 0.5) * 540;
    const fall = 140 + Math.random() * 160;
    return s.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.55}px,${dy * 0.55}px) rotate(${rot * 0.5}deg) scale(.96)`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px,${dy + fall}px) rotate(${rot}deg) scale(.6)`, opacity: 0 },
    ], { duration: 900 + Math.random() * 400, delay: 90 + Math.random() * 60, easing: 'cubic-bezier(.15,.7,.4,1)', fill: 'forwards' }).finished;
  });
  return Promise.all(done).then(() => layer.remove(), () => layer.remove());
}

/** The row `el` at `rect` gathers from dust and flying shards and locks together. Resolves on landing. */
export function assemble(el, rect, place, delay = 0) {
  if (REDUCED) return Promise.resolve();
  surface();
  const dur = 820;
  dustIn(rect, place, delay, dur);
  const { layer, pieces } = shardLayer(el, rect);
  layer.style.visibility = 'hidden';
  setTimeout(() => (layer.style.visibility = ''), delay);
  const done = pieces.map(({ s, cx, cy }) => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 160 + Math.random() * 320;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.5;
    const rot = (Math.random() - 0.5) * 600;
    return s.animate([
      { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(.5)`, opacity: 0 },
      { transform: `translate(${dx * 0.25}px,${dy * 0.25}px) rotate(${rot * 0.2}deg) scale(.92)`, opacity: 1, offset: 0.6 },
      { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
    ], { duration: dur * (0.75 + Math.random() * 0.25), delay: delay + 120 + Math.random() * 160, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }).finished;
  });
  soundGather(delay / 1000 + 0.12);
  return Promise.all(done).then(() => layer.remove(), () => layer.remove());
}

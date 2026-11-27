// The ranking's effects. A row that climbs cracks, shatters into real pieces of itself (copies of the
// row cut into shards) and a cloud of dust where it was; at its new place the dust gathers, the shards
// fly back in and lock together, and the whole row lands with a flash. The rows it passes slide down.
// The sounds are real recordings (assets/audio/sfx): glass shattering, the rush of the pieces coming
// back and a metal strike as the row lands, deeper for first place. They play only when the arena's
// sound is on in the gear menu, at its volume, and never before the visitor has touched the page.
import { musicOn, musicVolume } from './music.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const reduced = REDUCED;

// ------------------------------------------------------------------ sound
let ctx = null;
let touched = false;
const DIR = new URL('./audio/sfx/', import.meta.url);
const bufs = {}; // name → { buf, lead: where its sound begins, peak }
let loading = null;

function audio() {
  if (!touched || !musicOn()) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    loading ??= Promise.all(['shatter', 'whoosh', 'lock'].map(async (name) => {
      try {
        const r = await fetch(new URL(`${name}.mp3`, DIR));
        if (!r.ok) return;
        const buf = await ctx.decodeAudioData(await r.arrayBuffer());
        const d = buf.getChannelData(0);
        let peak = 0;
        for (const v of d) peak = Math.max(peak, Math.abs(v));
        const first = d.findIndex((v) => Math.abs(v) > peak * 0.05);
        bufs[name] = { buf, lead: Math.max(0, first / buf.sampleRate - 0.01), peak };
      } catch {
        // not heard
      }
    }));
    return ctx;
  } catch {
    return null;
  }
}

// the first touch lets the page sound, and fetches the recordings so the first row already has them
const touch = () => {
  touched = true;
  audio();
};
addEventListener('pointerdown', touch, { once: true, capture: true });
addEventListener('keydown', touch, { once: true, capture: true });

/** Plays a recording from where its sound begins, `at` seconds from now, at the arena's volume. */
function playSfx(name, { at = 0, level = 0.8, rate = 1 } = {}) {
  const c = audio();
  const b = bufs[name];
  if (!c || !b) return;
  const t = c.currentTime + Math.max(0, at);
  const s = c.createBufferSource();
  s.buffer = b.buf;
  s.playbackRate.value = rate;
  const g = c.createGain();
  g.gain.value = (musicVolume() * level * 0.7) / Math.max(0.2, b.peak);
  s.connect(g).connect(c.destination);
  s.start(t, b.lead + Math.max(0, -at) * rate);
}

/** The row breaking: glass that gives way and rains down. */
export function soundShatter(big = false) {
  playSfx('shatter', { at: CRACK / 1000 - 0.25, level: big ? 1 : 0.8 });
}

/** The pieces coming back: a rush that ends as they lock. */
export function soundGather(delay = 0) {
  const b = bufs.whoosh;
  if (!b) return void audio();
  playSfx('whoosh', { at: delay + 0.56 - (b.buf.duration - b.lead), level: 0.6 });
}

/** A metal strike as the row locks together, deeper for first place. */
export function soundLand(place = 9) {
  playSfx('lock', { level: place === 1 ? 1 : 0.75, rate: place === 1 ? 0.8 : place <= 3 ? 0.9 : 1 });
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
    dust.push({ x0, y0, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp * 0.6 - 30, size: 0.5 + Math.random() * 1.6, alpha: 0.5 + Math.random() * 0.5, color: cs[i % cs.length], start: now + Math.random() * 120, end: now + 1300 + Math.random() * 1200 });
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
  const cols = Math.max(3, Math.round(w / 150));
  const rows = h > 90 ? 3 : 2;
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
    return { s, cx, cy, tri };
  });
  document.body.appendChild(layer);
  return { layer, pieces };
}

/** How long the cracks show before the row falls apart (ms). */
export const CRACK = 650;
/** How long until the place it left is clear enough for the rows below to move (ms). */
export const CLEAR = 950;
/** When the pieces start gathering at the new place (ms after the blow). */
export const GATHER = 2000;

/** Bright cracks along the edges of the pieces, nearest the blow first, drawn in quickly. */
function cracks(w, h, hx, hy, pieces) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'cracks');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  const lines = [];
  for (const { tri } of pieces) {
    for (let i = 0; i < 3; i++) {
      const a = tri[i];
      const b = tri[(i + 1) % 3];
      const onEdge = (a[0] === b[0] && (a[0] === 0 || a[0] === w)) || (a[1] === b[1] && (a[1] === 0 || a[1] === h));
      if (onEdge) continue;
      lines.push({ a, b, mid: Math.hypot((a[0] + b[0]) / 2 - hx, (a[1] + b[1]) / 2 - hy) });
    }
  }
  for (const { a, b, mid } of lines) {
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    p.style.strokeDasharray = `${len}`;
    p.style.strokeDashoffset = `${len}`;
    svg.appendChild(p);
    p.animate([{ strokeDashoffset: len }, { strokeDashoffset: 0 }], { duration: 220, delay: Math.min(CRACK - 220, (mid / w) * 800), fill: 'forwards', easing: 'ease-out' });
  }
  svg.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, delay: CRACK + 80, fill: 'forwards' });
  return svg;
}

/** The row at `rect` (as `copy` looked) cracks and falls apart. Resolves when the pieces are gone. */
export function shatter(copy, rect, place) {
  if (REDUCED) return Promise.resolve();
  surface();
  const { layer, pieces } = shardLayer(copy, rect);
  // the blow comes from a point on the row: the shards fly away from it
  const hx = rect.width * (0.3 + Math.random() * 0.4);
  const hy = rect.height * 0.5;
  // 1. the blow: the row shudders and cracks run across it from the point it was hit
  layer.animate([{ transform: 'translate(0,0)' }, { transform: 'translate(-4px,1px)' }, { transform: 'translate(4px,-1px)' }, { transform: 'translate(-3px,0)' }, { transform: 'translate(2px,1px)' }, { transform: 'translate(0,0)' }], { duration: 420 });
  layer.appendChild(cracks(rect.width, rect.height, hx, hy, pieces));
  // 2. it falls apart: big pieces of the row drift away, turn and drop; the dust spreads
  setTimeout(() => dustOut(rect, place, rect.left + hx, rect.top + hy), CRACK);
  const done = pieces.map(({ s, cx, cy }) => {
    const ang = Math.atan2(cy - hy, cx - hx) + (Math.random() - 0.5) * 0.6;
    const near = 1 - Math.min(1, Math.hypot(cx - hx, cy - hy) / rect.width);
    const dist = 90 + Math.random() * 220 + 200 * near;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.5 - 30 - Math.random() * 30;
    const rot = (Math.random() - 0.5) * 220;
    const fall = 220 + Math.random() * 200;
    return s.animate([
      { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
      { transform: `translate(${dx * 0.08}px,${dy * 0.08}px) rotate(${rot * 0.04}deg) scale(1)`, opacity: 1, offset: 0.12 },
      { transform: `translate(${dx * 0.6}px,${dy * 0.6}px) rotate(${rot * 0.45}deg) scale(.95)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${dx}px,${dy + fall}px) rotate(${rot}deg) scale(.75)`, opacity: 0 },
    ], { duration: 2400 + Math.random() * 700, delay: CRACK + Math.random() * 160, easing: 'cubic-bezier(.25,.6,.35,1)', fill: 'forwards' }).finished;
  });
  return Promise.all(done).then(() => layer.remove(), () => layer.remove());
}

/** The row `el` at `rect` gathers from dust and flying shards and locks together. Resolves on landing. */
export function assemble(el, rect, place, delay = 0) {
  if (REDUCED) return Promise.resolve();
  surface();
  const dur = 1900;
  dustIn(rect, place, delay, dur);
  const { layer, pieces } = shardLayer(el, rect);
  layer.style.visibility = 'hidden';
  setTimeout(() => (layer.style.visibility = ''), delay);
  const done = pieces.map(({ s, cx, cy }) => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 140 + Math.random() * 260;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist * 0.5;
    const rot = (Math.random() - 0.5) * 300;
    return s.animate([
      { transform: `translate(${dx}px,${dy}px) rotate(${rot}deg) scale(.5)`, opacity: 0 },
      { transform: `translate(${dx * 0.25}px,${dy * 0.25}px) rotate(${rot * 0.2}deg) scale(.92)`, opacity: 1, offset: 0.6 },
      { transform: 'translate(0,0) rotate(0deg) scale(1)', opacity: 1 },
    ], { duration: dur * (0.8 + Math.random() * 0.2), delay: delay + 200 + Math.random() * 250, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }).finished;
  });
  soundGather(delay / 1000 + 0.9);
  return Promise.all(done).then(() => layer.remove(), () => layer.remove());
}

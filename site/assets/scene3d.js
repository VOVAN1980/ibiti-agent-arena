// The arena in 3D: a hexagon ring under the lights, packed stands all around, a scoreboard cube
// over the ring, and two robot fighters at their own gaming desks. They do not fight each other:
// before the bell they walk out and work the crowd; at the bell they sit down and type; whoever
// answers jumps up with both arms raised, whoever runs out of time holds its head. At the end the
// referee robot raises the winner's arm; then the loser snaps and charges the winner, throws a wild
// haymaker, the winner ducks under it and lands an uppercut on its jaw, and the loser flies back onto its
// own desk, which breaks under it, and lies there knocked out. Only then the winner climbs its corner's
// ropes for a backflip.
// The page tells the scene what happens (the same calls as the 2D scene in scene.js); the scene
// only draws it.
// The hall itself (the ring and its apron, the truss and its lights, the wet floor, the stands and
// the fans, the picture's grade) is built in room.js.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildHaze, buildScreens, buildPyro } from './atmosphere.js';
import { buildRoom, loadHallAssets, hallEnvironment, volumeMaterial, softSpot, GradeShader, TRUSS, emblemPlate, ROPES, ROPE_LOAD } from './room.js';
import { loadXbot, makeXRobot } from './xbot.js';

const COLOR = { red: 0xef4444, blue: 0x22c55e };
const CSS = { red: '#ef4444', blue: '#22c55e' };
const FLOOR = 1.0; // the top of the ring
const SIZE = 1.2; // the robots and their desks, a size up from life so they read in the wide shot
const STATION = 1.2; // each fighter's station (its desk, chair and the fighter) once more, about its spot
const BOARD_Y = 6.9; // the scoreboard's middle, under the truss's inner ring
const RING = 6; // the ring's radius (corner to centre)
// the wide shot (and a tall screen's): `d` metres out from the ring's centre and `h` up, turned `az`
// round it, looking down `pitch`, the lens's height in degrees and its shift (a share of half the
// picture's height, the picture moving up, or down when below 0); WIDE_TAN keeps its width on
// narrower screens
const WIDE = { az: 0, d: 21, h: 8.6, pitch: 0.34, fov: 33.6, shift: -0.2, x: 0 };
const WIDE_TALL = { az: 0, d: 14.8, h: 7.0, pitch: 0.37, fov: 58, shift: 0, x: 0 };
const WIDE_TAN = Math.tan((WIDE.fov * Math.PI) / 360) * (16 / 9);
// once round the hall: closer, a little lower, in ORBIT_T seconds
const ORBIT = { az: 0, d: 12.5, h: 4.6, pitch: 0.37, fov: 40, shift: -0.3, x: 0 };
const ORBIT_TALL = { az: 0, d: 13.8, h: 6.6, pitch: 0.34, fov: 60, shift: 0, x: 0 };
const ORBIT_T = 64;
/** Between two views, share k of the way, turned az round the ring. */
const mixView = (a, b, k, az) => ({ ...Object.fromEntries(Object.keys(a).map((key) => [key, a[key] + (b[key] - a[key]) * k])), az });
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const POSTER = new URL('./arena/poster.webp', import.meta.url).href;
// phones and small screens get the light hall: no mirror on the floor, no shadows, fewer fans and
// particles (a page can also ask for it: window.ARENA_QUALITY = 'small', or 'full' for the whole hall)
const small = window.ARENA_QUALITY === 'small' || (window.ARENA_QUALITY !== 'full' && (Math.min(screen.width, screen.height) < 700 || matchMedia('(pointer: coarse)').matches));

// ------------------------------------------------------------------ textures drawn on the fly

function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  t.anisotropy = 8;
  t.userData.canvas = c;
  t.userData.draw = draw;
  DRAWN.push(t);
  return t;
}
const DRAWN = [];
document.fonts?.load('800 40px Unbounded').then(() => {
  for (const t of DRAWN) {
    const c = t.userData.canvas;
    t.userData.draw(c.getContext('2d'), c.width, c.height);
    t.needsUpdate = true;
  }
}).catch(() => {});

// metal gold, the gold of the ranking's podium
const GOLD = '#f2cf6e';
// the IBITI emblem (favicon.svg): a hexagon with three bars, `size` across, in polished gold
function drawEmblem(g, cx, cy, size, rot = 0) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  const k = size / 32;
  const metal = g.createLinearGradient(-16 * k, -16 * k, 16 * k, 16 * k);
  metal.addColorStop(0, '#ffe9a0');
  metal.addColorStop(0.4, '#f2c75a');
  metal.addColorStop(0.75, '#d49f2c');
  metal.addColorStop(1, '#f2c75a');
  g.fillStyle = metal;
  g.strokeStyle = metal;
  g.lineWidth = 3 * k;
  g.lineJoin = 'round';
  g.beginPath();
  for (const [x, y] of [[0, -16], [14, -8], [14, 8], [0, 16], [-14, 8], [-14, -8]]) g.lineTo(x * k, y * k);
  g.closePath();
  g.stroke();
  for (const y of [-5, 0, 5]) g.fillRect(-6 * k, (y - 1) * k, 12 * k, 2 * k);
  g.restore();
}

function screenTex(side, kind) {
  return canvasTex(256, 160, (g, w, h) => {
    g.fillStyle = '#04060c';
    g.fillRect(0, 0, w, h);
    if (kind === 'code') {
      for (let y = 8; y < h * 2; y += 12) {
        const indent = ((y * 7) % 5) * 10;
        g.fillStyle = (y / 12) % 4 === 0 ? CSS[side] : 'rgba(200,215,255,.75)';
        g.fillRect(10 + indent, y % h, 40 + ((y * 13) % 140), 5);
      }
    } else if (kind === 'back') {
      g.fillStyle = '#0b1020';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = CSS[side];
      g.lineWidth = 6;
      g.strokeRect(5, 5, w - 10, h - 10);
      g.shadowColor = 'rgba(242,207,110,.8)';
      g.shadowBlur = 16;
      drawEmblem(g, w / 2, h / 2, 96);
    } else {
      g.fillStyle = kind === 'sent' ? '#22c55e' : '#f97316';
      g.font = '800 54px Inter, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'sent' ? '✓' : '✗', w / 2, h / 2 - 20);
      g.font = '800 26px Unbounded, Inter, sans-serif';
      g.fillText(kind === 'sent' ? 'SENT' : 'TIME', w / 2, h / 2 + 36);
    }
  });
}

/** The scoreboard's screen, styled like an arena's: the first line small (a round gains its " / 12"),
 *  the second big (the clock), a bar from red to green under it, the third line small under that when
 *  it fits. */
function boardTex() {
  return canvasTex(1024, 512, (g, w, h) => {
    const lines = g.__lines ?? ['IBITI AGENT ARENA'];
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#0b0d12');
    bg.addColorStop(1, '#030406');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const fit = (text, px, weight, max) => {
      g.font = `${weight} ${px}px Unbounded, Inter, sans-serif`;
      const wide = g.measureText(text).width;
      if (wide > max) {
        px = Math.max(28, Math.floor((px * max) / wide));
        g.font = `${weight} ${px}px Unbounded, Inter, sans-serif`;
      }
      return px;
    };
    let head = String(lines[0] ?? '');
    if (/^\S+\s\d{1,2}$/u.test(head) && Number(head.split(/\s/)[1]) <= 12) head += ' / 12'; // "ROUND 4" → "ROUND 4 / 12"
    g.fillStyle = '#e9edf5';
    fit(head, 64, 700, w - 120);
    g.fillText(head, w / 2, 92);
    g.shadowColor = 'rgba(255,255,255,.35)';
    g.shadowBlur = 18;
    g.fillStyle = '#ffffff';
    fit(String(lines[1] ?? ''), 190, 800, w - 110);
    g.fillText(String(lines[1] ?? ''), w / 2, 248);
    g.shadowBlur = 0;
    // the bar: red from the left, green from the right, dark between
    const bx = 120;
    const bw = w - 240;
    const by = 372;
    g.fillStyle = '#15171c';
    g.fillRect(bx, by, bw, 16);
    const red = g.createLinearGradient(bx, 0, bx + bw * 0.42, 0);
    red.addColorStop(0, '#ff2a2a');
    red.addColorStop(1, 'rgba(255,42,42,0.25)');
    g.fillStyle = red;
    g.fillRect(bx, by, bw * 0.42, 16);
    const green = g.createLinearGradient(bx + bw, 0, bx + bw * 0.58, 0);
    green.addColorStop(0, '#19f064');
    green.addColorStop(1, 'rgba(25,240,100,0.25)');
    g.fillStyle = green;
    g.fillRect(bx + bw * 0.58, by, bw * 0.42, 16);
    const third = String(lines[2] ?? '');
    if (third) {
      g.fillStyle = '#9aa3b5';
      const px = fit(third, 44, 700, w - 140);
      if (px >= 30) g.fillText(third, w / 2, 448);
    }
    // the screen's LEDs: a fine dark grid between them, over the picture
    g.fillStyle = 'rgba(0,0,0,.32)';
    for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
  });
}
function redraw(tex, apply) {
  const c = tex.userData.canvas;
  const g = c.getContext('2d');
  apply(g);
  tex.userData.draw(g, c.width, c.height);
  tex.needsUpdate = true;
}

// ------------------------------------------------------------------ materials and shapes

function materials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const glow = (color, k = 3) => std({ color: 0x000000, emissive: color, emissiveIntensity: k });
  return {
    metal: std({ color: 0xaeb7c8, metalness: 0.85, roughness: 0.36, envMapIntensity: 0.55 }),
    dark: std({ color: 0x24272e, metalness: 0.8, roughness: 0.4 }),
    black: std({ color: 0x0b0c0f, metalness: 0.4, roughness: 0.5 }),
    glass: std({ color: 0x07080a, metalness: 0.3, roughness: 0.06, envMapIntensity: 1.2 }),
    desk: std({ color: 0x1b1d22, metalness: 0.85, roughness: 0.32 }),
    glow,
  };
}
const cyl = (r1, r2, h, n = 20) => new THREE.CylinderGeometry(r1, r2, h, n);
const rbox = (w, h, d, r = 0.04) => new RoundedBoxGeometry(w, h, d, 3, r);
function mesh(geo, mat, at = [0, 0, 0], parent = null) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(...at);
  m.castShadow = true;
  m.receiveShadow = true;
  if (parent) parent.add(m);
  return m;
}
/** A thin bar from a to b. */
function bar(a, b, r, mat) {
  const d = new THREE.Vector3().subVectors(b, a);
  const m = new THREE.Mesh(cyl(r, r, d.length(), 8), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  return m;
}

/** What stands where a robot would, if the robots' models cannot be had: nothing to draw, nothing to move. */
const EMPTY_BOT = () => ({ root: new THREE.Group(), eyes: [], bones: {}, feet: [], cur: {}, pose() {}, gait: () => ({ phase: 0, w: 0 }) });

/** Turn an angle towards a target the short way round, at most `k` of the way this frame. */
function turnTo(from, to, k) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * k;
}

// A fighter working the crowd walks laps round its own half of the ring: the corners of the lap in its
// station's own coordinates (x to its right, z out in front of the desk), every leg of it clear of the
// desk; blue's lap is the mirror image, started at another corner so the two never move as one.
// Each fighter has its own lap, pace and manner: how often it stops at a corner to play to the stands,
// what it does there, and how it carries its arms on the way.
const LAPS = {
  red: { at: [[0, 1.4], [-0.9, 2.5], [-1.8, 3.1], [-3.0, 2.0], [-3.0, 0.9], [-1.6, 1.2]], speed: 1.25, swing: 0.55, stops: 22, show: ['pump', 'flex', 'wave'], flair: 'wave', ropes: ['pump', 'flex', 'wave'], taunts: ['beckon', 'laugh'], answers: ['laugh', 'flex'] },
  blue: { at: [[0, 1.4], [1.7, 1.3], [2.9, 1.0], [2.9, 2.3], [1.6, 3.1], [0.8, 2.4]], speed: 1.05, swing: 0.38, stops: 16, show: ['point', 'pump', 'box'], flair: 'box', ropes: ['pump', 'point', 'chest'], taunts: ['chest', 'box', 'beckon'], answers: ['brush', 'box'] },
};
const ROPE_MID = 1.13; // on the middle rope's turnbuckle, above the ring's floor: where a fighter stands to play to the stands
const ROPE_TOP = 1.5; // on the top rope's turnbuckle: where the winner stands before its backflip
const lerpTo = (a, b, k) => a + (b - a) * k;
/** What the arms do out in the ring. */
const GESTURES = {
  // an easy walk: the arms swing with the steps (each arm forward with the other side's foot; `phase`
  // where the walk is in its stride, in radians), the gloves carried a little up
  stroll: (t, wide = 0.5, phase = t * 6.2) => {
    const k = -Math.sin(phase) * wide;
    return { a0x: k, a0z: -0.14, e0: -0.45 - Math.max(0, -k) * 0.5, a1x: -k, a1z: 0.14, e1: -0.45 - Math.max(0, k) * 0.5 };
  },
  // "come on, then": one hand out towards the other corner, curling
  beckon: (t) => ({ a0x: -1.5, a0z: -0.1, e0: -0.25 - 0.95 * ((Math.sin(t * 8) + 1) / 2), a1x: 0.1, a1z: 0.5, e1: -1.3 }),
  // fists drumming on its chest
  chest: (t) => {
    const k = Math.sin(t * 11);
    return { a0x: -0.75, a0z: 0.35, e0: -2.2 + Math.max(0, k) * 0.5, a1x: -0.75, a1z: -0.35, e1: -2.2 + Math.max(0, -k) * 0.5, bounce: Math.abs(k) * 0.03 };
  },
  // hands on its hips, laughing it off
  laugh: (t) => ({ a0x: 0.1, a0z: -0.5, e0: -1.3, a1x: 0.1, a1z: 0.5, e1: -1.3, bounce: Math.abs(Math.sin(t * 9)) * 0.05, lean: -0.14, look: -0.35 }),
  // brushing it off: a flick of the hand, a shake of the head
  brush: (t) => ({ a0x: -1.05, a0z: -0.3 + Math.sin(t * 9) * 0.4, e0: -0.7, a1x: 0.05, a1z: 0.12, e1: -0.25, shake: Math.sin(t * 6) * 0.45 }),
  // one arm up, waving to the stands, the arms taking turns
  wave: (t) => {
    const right = Math.floor(t / 3) % 2 === 0;
    const up = { x: -0.15, z: 2.5, e: -0.55 + Math.sin(t * 7) * 0.35 };
    const down = { x: 0.05, z: 0.12, e: -0.25 };
    const r = right ? up : down;
    const l = right ? down : up;
    return { a0x: r.x, a0z: -r.z, e0: r.e, a1x: l.x, a1z: l.z, e1: l.e };
  },
  // a boxer on the move: the guard up, a jab from each hand in turn
  box: (t) => {
    const k = (t * 2.2) % 2;
    const jab = (from) => {
      const x = (k - from + 2) % 2;
      return x < 0.35 ? Math.sin((x / 0.35) * Math.PI) : 0;
    };
    const a = jab(0);
    const b = jab(1);
    return { a0x: lerpTo(-1.0, -1.55, a), a0z: -0.25, e0: lerpTo(-2.1, -0.15, a), a1x: lerpTo(-1.0, -1.55, b), a1z: 0.25, e1: lerpTo(-2.1, -0.15, b) };
  },
  // both fists pumping over the head, a hop with each
  pump: (t) => {
    const k = (Math.sin((t * Math.PI * 2) / 1.26) + 1) / 2;
    return { a0x: -0.3, a0z: -2.88, e0: -0.3 - 0.5 * k, a1x: -0.3, a1z: 2.88, e1: -0.3 - 0.5 * (1 - k), hop: [0.63, 0.09] };
  },
  // showing its arms: both out to the sides, the forearms up
  flex: (t) => {
    const k = Math.sin(t * 4) * 0.12;
    return { a0x: -1.5, a0z: -1.45, e0: -1.9 + k, a1x: -1.5, a1z: 1.45, e1: -1.9 + k };
  },
  // pointing at the stands with one hand, the other at its hip
  point: (t) => ({ a0x: -1.75 + Math.sin(t * 3) * 0.08, a0z: -0.15, e0: -0.08, a1x: 0.1, a1z: 0.5, e1: -1.3 }),
};

// poses: what the body does, as a function of the time since the pose began
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ARMS_DOWN = { a0x: 0, a0z: -0.1, e0: -0.15, a1x: 0, a1z: 0.1, e1: -0.15 };
// the arms in a boxer's guard, as angles (a gesture starts from here and comes back to it)
const GUARD_ARMS = { a0x: -0.35, a0z: -0.12, e0: -1.75, a1x: -0.5, a1z: 0.12, e1: -1.8 };

const POSES = {
  // out in front of the desk, walking about and pumping the crowd
  hype: (t, side, gesture, phase) => {
    // on its lap in its own manner, or stopped at a corner playing to the stands
    const arms = gesture ? GESTURES[gesture](t) : GESTURES.stroll(t, LAPS[side === 'blue' ? 'blue' : 'red'].swing, phase);
    return { spot: [0, 1.4], lap: true, seat: false, bounce: 0, turn: 0, lean: gesture === 'flex' ? -0.08 : 0, look: gesture ? -0.2 : -0.1, ...arms };
  },
  // at the desk, hands near the keyboard, waiting for the bell
  guard: (t) => ({ spot: [0, 0], reach: 'keys', seat: true, bounce: 0, turn: 0, lean: 0.1, look: 0.1, a0x: 0.45, a0z: 0.48, e0: -1.85 + Math.sin(t * 3) * 0.05, a1x: 0.45, a1z: -0.48, e1: -1.85 + Math.sin(t * 3 + 1) * 0.05 }),
  // typing
  work: (t, side) => {
    const calm = side === 'blue';
    const q = calm ? 0.72 : 1; // blue types evenly, red hammers the keys
    return { spot: [0, 0], reach: 'keys', seat: true, bounce: 0, turn: 0, lean: calm ? 0.1 : 0.26, look: (calm ? 0.2 : 0.34) + Math.sin(t * 0.4) * 0.03, a0x: 0.45 + Math.sin(t * 21 * q) * 0.04, a0z: 0.5, e0: -1.91 + Math.sin(t * 25 * q) * 0.1, a1x: 0.45 + Math.sin(t * 19 * q + 2) * 0.04, a1z: -0.5, e1: -1.91 + Math.sin(t * 23 * q + 1) * 0.1 };
  },
  // answered in time: up from the chair, both arms high
  done: (t, side) => {
    const pump = (Math.sin(t * 7) + 1) / 2;
    if (side === 'blue') {
      // one fist driven up again and again, the other hand at its hip
      const k = (Math.sin(t * 9) + 1) / 2;
      return { spot: [0, 0], seat: false, hop: [1.4, 0.05], bounce: 0, turn: Math.sin(t * 1.4) * 0.3, lean: -0.03, look: -0.05, a0x: -0.4, a0z: -2.7, e0: -0.2 - 0.9 * k, a1x: 0.1, a1z: 0.5, e1: -1.3 };
    }
    return { spot: [0, 0], seat: false, hop: [0.63, 0.13], bounce: 0, turn: Math.sin(t * 2) * 0.2, lean: -0.05, look: 0, a0x: -0.3, a0z: -2.88, e0: -0.3 - 0.4 * pump, a1x: -0.3, a1z: 2.88, e1: -0.3 - 0.4 * (1 - pump) };
  },
  // out of time: head in its hands
  fail: (t) => ({ spot: [0, 0], reach: 'head', seat: true, bounce: 0, turn: 0, lean: 0.35, look: 0.55 + Math.sin(t * 1.4) * 0.08, shake: Math.sin(t * 2.2) * 0.3, a0x: -2.1, a0z: 0.35, e0: -1.6, a1x: -2.1, a1z: -0.35, e1: -1.6 }),
  // the fight is over, waiting for the judge
  idle: (t) => ({ spot: [0, 0], seat: true, bounce: 0, turn: 0, lean: -0.1, look: 0, ...ARMS_DOWN, a0x: -0.3, a1x: -0.3, e0: -0.6 + Math.sin(t) * 0.05, e1: -0.6 }),
  // the fight is over: up from the chair and out in front of the desk, facing the ring, waiting for the referee
  stand: (t) => ({ spot: [0, 1.45], seat: false, bounce: 0, turn: 0, lean: 0, look: -0.05 + Math.sin(t * 0.9) * 0.03, ...ARMS_DOWN, a0z: -0.12 + Math.sin(t * 1.3) * 0.02, a1z: 0.12 - Math.sin(t * 1.3) * 0.02 }),
  // beaten: it stays where it stood, head and shoulders down, then trudges back round to its desk
  sad: (t) => ({ spot: t < 4 ? [0, 1.45] : [0, -0.05], speed: 0.85, seat: false, bounce: 0, turn: Math.sin(t * 0.6) * 0.12, lean: 0.22, look: 0.55 + Math.sin(t * 1.1) * 0.05, tilt: 0.1, ...ARMS_DOWN, e0: -0.05, e1: -0.05 }),
  // the winner: out to the front, jumping, arms up, turning to every stand
  win: (t) => {
    // the champion: still while the referee holds its arm up (the free fist shaking at the sky), then
    // jumping, both fists pumping above the head
    const pump = (Math.sin((t * Math.PI * 2) / 1.44) + 1) / 2;
    if (t < 1.75) return { spot: [0, 1.45], seat: false, bounce: 0, turn: 0, lean: -0.04, look: -0.12, a0x: -0.3, a0z: -2.75, e0: -0.5 - 0.6 * pump, a1x: -0.3, a1z: 2.75, e1: -0.5 - 0.6 * pump };
    const k = Math.min(1, (t - 1.75) / 0.5);
    return { spot: [0, 1.45], seat: false, hop: [0.72, 0.2 * k], bounce: 0, turn: Math.sin((t - 1.75) * 1.3) * 0.5, lean: -0.05, look: 0.05, a0x: -0.28, a0z: -2.9, e0: -0.25 - 0.55 * pump, a1x: -0.28, a1z: 2.9, e1: -0.25 - 0.55 * (1 - pump) };
  },
  // the loser: it snaps and attacks the winner (the scene's fight leads its body: see fightLead)
  lose: () => ({ spot: [0, 1.45], seat: false, bounce: 0, turn: 0, lean: 0.1, look: 0, ...ARMS_DOWN }),
  // the referee
  ref: () => ({ spot: [0, 0], seat: false, bounce: 0, turn: 0, lean: 0, look: 0, a0x: 0, a0z: -0.08, e0: -0.12, a1x: 0, a1z: 0.08, e1: -0.12 }),
  // the start of a round: it stays as it stands
  refStart: () => POSES.ref(),
  // it walks over to the winner; its hand takes the winner's wrist and lifts it (the scene's raise)
  refRaise: () => ({ spot: [0, 0], seat: false, bounce: 0, turn: 0, lean: 0, look: -0.15, a0x: 0.1, a0z: -0.12, e0: -0.35, a1x: 0.1, a1z: 0.12, e1: -0.35 }),
};

// ------------------------------------------------------------------ a desk with a computer

let deskEmblem = null;
const DESK_EMBLEM = () => (deskEmblem ??= emblemPlate(256, 256));

/** A fighter's station: a chair, a desk with the monitor, the keyboard and the computer on it. With the
 *  ring kit the chair, the desk and the monitor are its baked pieces; without it, they are drawn here. */
function buildStation(side, M, kit) {
  const g = new THREE.Group();
  const col = COLOR[side];
  const glow = M.glow(col, 2.0);
  const group = (x, y, z) => {
    const o = new THREE.Group();
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const chair = group(0, 0, -0.12);
  const desk = group(0, 0, 0.48);
  const monitor = group(0, 0.75, 0.7);
  const screens = { code: screenTex(side, 'code'), sent: screenTex(side, 'sent'), time: screenTex(side, 'time') };
  screens.code.wrapT = THREE.RepeatWrapping;
  const face = new THREE.MeshBasicMaterial({ map: screens.code, color: 0xc8d4ff });
  const backTex = screenTex(side, 'back');
  const back = new THREE.MeshStandardMaterial({ map: backTex, emissive: 0xffffff, emissiveMap: backTex, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.3 });
  if (kit) {
    // the kit's slots: its lights in the corner's colour, the chair's wings tinted, the screen's pictures
    let wing = null;
    kit.Chair.traverse((m) => {
      if (m.material?.name === 'ACCENT_NEUTRAL') wing = m.material.clone();
    });
    wing?.color.set(side === 'red' ? 0xa0161e : 0x138040);
    let steel = null;
    kit.Desk.traverse((m) => {
      if (m.material?.name === 'KIT') steel = Object.assign(m.material.clone(), { roughness: 1.3, envMapIntensity: 0.55 });
    });
    const slot = { KIT: steel, LED_NEUTRAL: glow, ACCENT_NEUTRAL: wing, SCREEN: face, SCREEN_BACK: back };
    for (const [name, parent] of [['Chair', chair], ['Desk', desk], ['Monitor', monitor]]) {
      const o = kit[name].clone();
      o.traverse((m) => {
        if (!m.isMesh) return;
        m.material = slot[m.material.name] ?? m.material;
        m.castShadow = !small && m.material !== face;
        m.receiveShadow = !small;
      });
      parent.add(o);
    }
  } else {
    // a gaming chair in black leather, the corner's colour on its wings
    const leather = new THREE.MeshPhysicalMaterial({ color: 0x101114, roughness: 0.48, metalness: 0, clearcoat: 0.45, clearcoatRoughness: 0.4 });
    const wing = new THREE.MeshPhysicalMaterial({ color: side === 'red' ? 0x5a0b10 : 0x083d1f, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.35 });
    mesh(rbox(0.5, 0.1, 0.5, 0.045), leather, [0, 0.36, 0], chair);
    for (const s of [-1, 1]) mesh(rbox(0.08, 0.13, 0.5, 0.035), wing, [0.27 * s, 0.39, 0], chair);
    mesh(rbox(0.48, 0.8, 0.09, 0.045), leather, [0, 0.8, -0.29], chair);
    for (const s of [-1, 1]) mesh(rbox(0.075, 0.72, 0.11, 0.035), wing, [0.27 * s, 0.78, -0.28], chair);
    mesh(new THREE.BoxGeometry(0.03, 0.5, 0.012), glow, [0, 0.82, -0.24], chair);
    for (const s of [-1, 1]) mesh(new THREE.BoxGeometry(0.06, 0.035, 0.3), M.dark, [0.31 * s, 0.56, 0.02], chair);
    mesh(cyl(0.03, 0.03, 0.32, 10), M.metal, [0, 0.18, 0], chair);
    mesh(cyl(0.3, 0.32, 0.03, 5), M.dark, [0, 0.03, 0], chair);
    // the desk: dark brushed metal on two panel legs, a thin line of the corner's light along its front
    mesh(rbox(1.5, 0.045, 0.72, 0.012), M.desk, [0, 0.725, 0], desk);
    for (const x of [-0.69, 0.69]) mesh(rbox(0.045, 0.7, 0.6, 0.012), M.dark, [x, 0.35, 0], desk);
    mesh(new THREE.BoxGeometry(1.34, 0.12, 0.02), M.dark, [0, 0.6, -0.28], desk);
    // its front: a closed panel of dark steel with the gold emblem, lines of the corner's light along
    // its top and its foot
    mesh(new THREE.BoxGeometry(1.42, 0.62, 0.03), M.desk, [0, 0.39, 0.345], desk);
    const plate = mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshStandardMaterial({ map: DESK_EMBLEM(), emissive: 0xffffff, emissiveMap: DESK_EMBLEM(), emissiveIntensity: 0.55, metalness: 0.6, roughness: 0.35 }), [0, 0.4, 0.362], desk);
    plate.castShadow = false;
    mesh(new THREE.BoxGeometry(1.46, 0.014, 0.012), glow, [0, 0.705, 0.364], desk);
    mesh(new THREE.BoxGeometry(1.4, 0.012, 0.012), glow, [0, 0.07, 0.364], desk);
    // the monitor: a thin black bezel, the screen inset, the emblem on its back
    mesh(rbox(0.28, 0.012, 0.18, 0.006), M.dark, [0, 0.006, -0.02], monitor);
    mesh(new THREE.BoxGeometry(0.04, 0.22, 0.025), M.dark, [0, 0.12, -0.045], monitor);
    const dark = M.black;
    mesh(new THREE.BoxGeometry(0.88, 0.52, 0.028), [dark, dark, dark, dark, back, dark], [0, 0.34, 0], monitor);
    const screen = mesh(new THREE.PlaneGeometry(0.85, 0.49), face, [0, 0.34, -0.0145], monitor);
    screen.rotation.y = Math.PI;
    screen.castShadow = false;
  }
  // the keyboard, low, its keys lit from under
  const keyboard = new THREE.Group();
  keyboard.position.set(0, 0.765, 0.32);
  g.add(keyboard);
  mesh(rbox(0.6, 0.022, 0.19, 0.008), M.black, [0, 0, 0], keyboard);
  mesh(new THREE.BoxGeometry(0.56, 0.006, 0.15), M.glow(col, 0.7), [0, 0.013, 0], keyboard);
  // the computer: a black case with a smoked glass side and a strip of light inside
  const tower = new THREE.Group();
  tower.position.set(0.6, 0, 0.42);
  g.add(tower);
  mesh(rbox(0.22, 0.48, 0.46, 0.014), M.black, [0, 0.24, 0], tower);
  mesh(new THREE.BoxGeometry(0.006, 0.4, 0.38), M.glass, [0.112, 0.25, 0], tower);
  mesh(new THREE.BoxGeometry(0.004, 0.34, 0.016), glow, [0.106, 0.25, 0.16], tower);
  const light = new THREE.PointLight(col, 1.1, 2.6, 0);
  light.position.set(0, 1.2, 0.45);
  g.add(light);
  const parts = { monitor, keyboard, desk, chair, tower };
  for (const o of Object.values(parts)) {
    o.position.multiplyScalar(SIZE);
    o.scale.setScalar(SIZE);
  }
  const home = Object.fromEntries(Object.entries(parts).map(([k, o]) => [k, { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }]));
  return { g, parts, home, face, screens, light };
}

// ------------------------------------------------------------------ the scene

export async function createScene(root) {
  // the robots' models and the hall's baked parts load together (a hall whose robots will not load
  // stands empty).
  // A still of the hall comes first and shows while the hall is built and its shaders compile (seconds
  // on a cold start), until the first frame is drawn
  const poster = new Image();
  poster.src = POSTER;
  const shown = poster.decode().then(() => {
    root.style.background = `#05070d url(${POSTER}) center / cover no-repeat`;
  }, () => {});
  const [xg, assets] = await Promise.all([
    loadXbot(small).catch((e) => {
      console.error('the robots could not be loaded; the hall stands without them:', e.message);
      return null;
    }),
    loadHallAssets(small),
    shown,
  ]);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))); // let the still be painted
  root.innerHTML = '';
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  const pixelRatio = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75);
  renderer.setPixelRatio(pixelRatio);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3; // the hall is dark, but the ring, the floor and the stands read
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'gl';
  renderer.domElement.style.opacity = '0'; // the still shows until the first frame
  root.appendChild(renderer.domElement);

  // the robots' and the ring's baked maps filtered anisotropically: sharp at grazing angles (the canvas,
  // the plates seen side on), the most the GPU offers (phones up to 8)
  const aniso = Math.min(small ? 8 : 16, renderer.capabilities.getMaxAnisotropy());
  const sharpen = (root) => root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) if (m[k]) m[k].anisotropy = aniso;
  });
  if (xg) for (const g of Object.values(xg.robots)) sharpen(g.scene);
  if (assets.kit) for (const piece of Object.values(assets.kit)) sharpen(piece);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x020304);
  scene.fog = new THREE.FogExp2(0x020203, 0.03);
  scene.environment = hallEnvironment(renderer);
  const M = materials();

  // lights: a dim fill, a cool wash from above (the key over the ring is the room's), each corner's
  // colour from the truss onto its fighter
  scene.add(new THREE.HemisphereLight(0x8a96b8, 0x0a0608, 0.5));
  const key = new THREE.DirectionalLight(0xdfe6ff, 0.35);
  key.position.set(3, 12, 7);
  scene.add(key);
  const spots = {};
  for (const side of ['red', 'blue']) {
    const s = new THREE.SpotLight(side === 'red' ? 0xff3030 : 0x20f080, 1.3, 0, 0.36, 0.7, 0);
    s.position.set(side === 'red' ? -7.2 : 7.2, TRUSS.y - 0.6, -1.8);
    scene.add(s, s.target);
    spots[side] = s;
  }
  const winSpot = new THREE.SpotLight(0xffe2a0, 0, 0, 0.3, 0.5, 0);
  winSpot.position.set(0, TRUSS.y, 4);
  scene.add(winSpot, winSpot.target);

  // the hall: the ring, its apron, posts and ropes, the truss, the floor, the railing, the stands
  // (room.js)
  const room = buildRoom(scene, renderer, { R: RING, FLOOR, small, ring: window.ARENA_CONFIG?.ring, eye: new THREE.Vector3(0, WIDE.h, WIDE.d), ...assets });
  const corner = (k) => new THREE.Vector3(RING * Math.cos((k * Math.PI) / 3), FLOOR, RING * Math.sin((k * Math.PI) / 3));

  // the scoreboard over the ring: an eight-sided box of black steel, the clock on its four wide faces,
  // the gold emblem on the four narrow ones between, a steel frame, a line of red under its left half
  // and of green under its right
  const board = boardTex();
  const cube = new THREE.Group();
  cube.position.set(0, BOARD_Y, 0);
  scene.add(cube);
  {
    const BW = 3.1; // a wide face
    const BH = 1.55;
    const A = 2.5; // from the centre to a wide face
    const oct = [];
    for (let i = 0; i < 4; i++) {
      const r = (i * Math.PI) / 2;
      const rot = (x, z) => new THREE.Vector2(x * Math.cos(r) + z * Math.sin(r), -x * Math.sin(r) + z * Math.cos(r));
      oct.push(rot(-BW / 2, A), rot(BW / 2, A));
    }
    const shape = new THREE.Shape(oct); // x, z; turned up below so that z stays z
    const body = new THREE.ExtrudeGeometry(shape, { depth: BH, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, BH / 2, 0);
    cube.add(new THREE.Mesh(body, M.black));
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x1b1d21, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.6 });
    const emblemMat = { red: new THREE.MeshBasicMaterial({ map: emblemPlate(256, 320, '#ff2424'), color: 0xe8e8e8 }), green: new THREE.MeshBasicMaterial({ map: emblemPlate(256, 320, '#1cf064'), color: 0xe8e8e8 }) };
    const boardMat = new THREE.MeshBasicMaterial({ map: board, color: 0xe6e6e6 });
    const ledR = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(1.7, 0.02, 0.02) });
    const ledG = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.03, 1.25, 0.09) });
    for (let i = 0; i < 8; i++) {
      const a = oct[i];
      const b = oct[(i + 1) % 8];
      const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.y + b.y) / 2);
      const len = a.distanceTo(b);
      const out = mid.clone().normalize();
      const wide = i % 2 === 0;
      const face = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.16, BH - 0.18), wide ? boardMat : emblemMat[mid.x < 0 ? 'red' : 'green']);
      face.position.copy(mid).addScaledVector(out, 0.012);
      face.lookAt(face.position.clone().add(out));
      cube.add(face);
      // the frame round it: rails top and bottom, a post at each corner
      for (const y of [-BH / 2, BH / 2]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.06, 0.07, 0.07), frameMat);
        rail.position.copy(mid).addScaledVector(out, 0.02).setY(y);
        rail.lookAt(rail.position.clone().add(out));
        cube.add(rail);
      }
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.09, BH + 0.08, 0.09), frameMat);
      post.position.set(a.x, 0, a.y).multiplyScalar(1.004);
      cube.add(post);
      // the line of light under it: red on the left, green on the right
      if (Math.abs(mid.x) > 0.3) {
        const line = new THREE.Mesh(new THREE.BoxGeometry(len - 0.2, 0.035, 0.03), mid.x < 0 ? ledR : ledG);
        line.position.copy(mid).addScaledVector(out, 0.05).setY(-BH / 2 - 0.06);
        line.lookAt(line.position.clone().add(out));
        cube.add(line);
      } else {
        for (const s of [-1, 1]) {
          const line = new THREE.Mesh(new THREE.BoxGeometry(len / 2 - 0.15, 0.035, 0.03), s < 0 ? ledR : ledG);
          const along = new THREE.Vector3(b.x - a.x, 0, b.y - a.y).normalize();
          line.position.copy(mid).addScaledVector(out, 0.05).addScaledVector(along, (s * len) / 4 * Math.sign(along.x || 1)).setY(-BH / 2 - 0.06);
          line.lookAt(line.position.clone().add(out));
          cube.add(line);
        }
      }
    }
    // a lip of steel under it, and the chains up to the roof
    const lip = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false }).rotateX(Math.PI / 2).translate(0, -BH / 2 - 0.1, 0).scale(0.97, 1, 0.97), frameMat);
    cube.add(lip);
    for (const x of [-1.2, 1.2]) for (const z of [-1.2, 1.2]) scene.add(bar(new THREE.Vector3(x, cube.position.y + BH / 2, z), new THREE.Vector3(x * 0.3, 16, z * 0.3), 0.012, frameMat));
  }
  room.reflect(cube);

  // light beams from the moving heads on the truss, and where the sweeping ones touch the canvas
  const beams = [];
  const poolTex = softSpot(128, 1.8);
  const makeBeam = (color, o, width, head, pool = false) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(width, 1, 32, 1, true), volumeMaterial(color, o));
    scene.add(m);
    const b = { m, from: head.at.clone(), to: new THREE.Vector3(), base: o, head, color: new THREE.Color(color) };
    head.color.set(color);
    if (pool) {
      b.pool = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(color).multiplyScalar(0.1), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
      scene.add(b.pool);
    }
    beams.push(b);
    return b;
  };
  const H = room.headAt;
  // most beams are white (about 5600 K) and narrow; the corners' colour is in two slow beams only, the
  // red one kept on the left half of the ring and the green one on the right, so they never cross
  const WHITE = 0xf3f1ec;
  const sweep = [[WHITE, H(2, 0.5), 0.05, 'white'], [WHITE, H(0, 0.5), 0.05, 'white'], [0xd2605a, H(3, 0.5), 0.03, 'red'], [0x5cc890, H(5, 0.5), 0.03, 'green']].map(([col, h, o, kind]) => Object.assign(makeBeam(col, o, 0.95, h, true), { kind }));
  // white beams straight down on the canvas from the front and the back of the truss
  const washes = [H(1, 0.22), H(1, 0.78), H(4, 0.22), H(4, 0.78)].map((h) => makeBeam(WHITE, 0.035, 1.0, h));
  washes.forEach((b) => b.to.set(b.from.x * 0.3, FLOOR, b.from.z * 0.25));
  const focus = { red: makeBeam(0xffe0da, 0.045, 0.7, H(3, 0.22)), blue: makeBeam(0xdcffe8, 0.045, 0.7, H(5, 0.78)) };
  for (const b of [focus.red, focus.blue]) b.m.material.uniforms.reach.value = 0.9; // these land on a fighter
  const crown = makeBeam(0xffe8b8, 0.08, 0.7, H(1, 0.5));
  const aimBeam = (b, from, to) => {
    const d = new THREE.Vector3().subVectors(from, to);
    const len = d.length();
    b.m.scale.set(1, len, 1);
    b.m.position.copy(to).addScaledVector(d, 0.5);
    b.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    if (b.head) b.head.dir.subVectors(to, from).normalize();
    if (b.pool) b.pool.position.set(to.x, to.y + 0.012, to.z);
  };
  washes.forEach((b) => aimBeam(b, b.from, b.to));

  // the fighters, their desks, and the referee
  // the stations back towards the far posts, turned in to the ring: the gold emblem shows whole between them
  const SEAT = { red: { x: -2.7, z: -1.5, rot: 1.0 }, blue: { x: 2.7, z: -1.5, rot: -1.0 } };
  const fighters = {};
  for (const side of ['red', 'blue']) {
    const st = buildStation(side, M, assets.kit);
    st.g.position.set(SEAT[side].x, FLOOR, SEAT[side].z);
    st.g.rotation.y = SEAT[side].rot;
    st.g.scale.setScalar(STATION);
    scene.add(st.g);
    const bot = xg ? makeXRobot(side, xg) : EMPTY_BOT();
    bot.root.scale.setScalar(SIZE);
    st.g.add(bot.root);
    fighters[side] = { st, bot, pose: 'hype', since: 0, pos: new THREE.Vector2(0, 1.35), path: [], cur: {}, wrecked: false, present: true, screen: 'code', placed: false };
    spots[side].target.position.set(SEAT[side].x, FLOOR, SEAT[side].z);
    focus[side].to.set(SEAT[side].x, FLOOR, SEAT[side].z);
  }
  const refBot = xg ? makeXRobot('ref', xg) : EMPTY_BOT();
  refBot.root.scale.setScalar(SIZE * STATION * 1.03); // the referee a touch taller than the fighters (they stand at SIZE × STATION)
  refBot.root.position.set(0, FLOOR, -0.35);
  scene.add(refBot.root);
  const referee = { bot: refBot, pose: 'ref', since: 0, side: null, pos: new THREE.Vector2(0, -0.35), target: new THREE.Vector2(0, -0.35), cur: {} };

  // the atmosphere: haze, two big screens with live close-ups, pyrotechnics
  const haze = buildHaze(scene, small);
  const screens = buildScreens(scene, renderer, { red: fighters.red.st, blue: fighters.blue.st }, small, M, SIZE);
  const pyro = buildPyro(scene, small, FLOOR);
  const postTops = room.postTops;
  room.lightsToMirror(); // every light also lights the floor's mirror picture
  const sidePosts = { red: [2, 3, 4].map((k) => postTops[k]), blue: [5, 0, 1].map((k) => postTops[k]) };

  // things flying around (the loser's desk), and sparks
  const flying = [];
  const sparkN = 140;
  const sparkPos = new Float32Array(sparkN * 3);
  const sparkVel = new Float32Array(sparkN * 3);
  const sparkLife = new Float32Array(sparkN);
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: 0xffb347, size: 0.09, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  scene.add(sparks);
  const burst = (at) => {
    for (let i = 0; i < sparkN; i++) {
      sparkPos.set([at.x, at.y, at.z], i * 3);
      sparkVel.set([(Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6], i * 3);
      sparkLife[i] = 0.5 + Math.random() * 0.7;
    }
  };
  function launch(f, name, v, w) {
    const o = f.st.parts[name];
    scene.attach(o);
    const vel = v.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SEAT[f === fighters.red ? 'red' : 'blue'].rot);
    flying.push({ o, v: vel, w: new THREE.Vector3(...w), rest: false });
    if (name === 'monitor') {
      burst(o.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.45, 0)));
      f.st.face.map = f.st.screens.time;
      f.st.face.color.setHex(0x553333);
    }
  }
  /** The things in the air fall, tumble, bounce and come to rest. */
  function flyParts(dt) {
    for (const x of flying) {
      if (x.rest) continue;
      x.v.y -= 9.8 * dt;
      x.o.position.addScaledVector(x.v, dt);
      x.o.rotation.x += x.w.x * dt;
      x.o.rotation.y += x.w.y * dt;
      x.o.rotation.z += x.w.z * dt;
      const ground = Math.hypot(x.o.position.x, x.o.position.z) < RING ? FLOOR : 0;
      if (x.o.position.y < ground) {
        x.o.position.y = ground;
        x.v.y *= -0.3;
        x.v.x *= 0.6;
        x.v.z *= 0.6;
        x.w.multiplyScalar(0.55);
        if (x.v.length() < 0.4) x.rest = true;
      }
    }
  }
  function resetStation(f) {
    for (const [name, o] of Object.entries(f.st.parts)) {
      const i = flying.findIndex((x) => x.o === o);
      if (i >= 0) flying.splice(i, 1);
      f.st.g.add(o);
      o.position.copy(f.st.home[name].p);
      o.quaternion.copy(f.st.home[name].q);
      o.scale.copy(f.st.home[name].s); // it flew in the hall's own scale
    }
    f.st.face.color.setHex(0xc8d4ff);
    f.wrecked = false;
  }

  // the camera
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  // cut: true at the start, so the camera is in place from the first frame instead of drifting in
  const cam = { mode: null, modeAt: 0, shake: 0, fp: new THREE.Vector3(), view: { ...WIDE }, shot: 'wide', step: 0, at: 0, cut: true, look: new THREE.Vector3(), was: null, shotAt: 0 };
  const SHOTS = ['wide', 'red', 'wide', 'blue'];
  const camAt = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  const camFront = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const _ca = new THREE.Vector3();
  const _cb = new THREE.Vector3();
  // the hall is drawn into a multisampled target (the canvas's own antialiasing would only smooth the
  // last pass): thin rails, ropes and truss stay clean; phones go without
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: small ? 0 : 4 }));
  composer.addPass(new RenderPass(scene, camera));
  // a thin, restrained glow round what burns brighter than white: the light shows the steel, it does not
  // drown it
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), small ? 0.3 : 0.32, 0.3, 1.0);
  // what glows is what is brighter than white in any one channel, not in luminance: a pure red LED
  // glows as much as a green one, and the tone mapping can keep it red
  bloom.materialHighPassFilter.fragmentShader = bloom.materialHighPassFilter.fragmentShader.replace('float v = dot( texel.xyz, luma );', 'float v = max( max( texel.r, texel.g ), texel.b );');
  bloom.materialHighPassFilter.smoothWidth = 0.2;
  bloom.highPassUniforms.smoothWidth.value = 0.25;
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  composer.addPass(grade);
  // the floor's mirror is drawn first, from the same camera
  let first = true;
  const draw = (dt) => {
    if (!drawNow) return;
    room.beforeRender(camera);
    composer.render(dt);
    if (first) {
      first = false;
      renderer.domElement.style.opacity = '';
      root.style.background = '';
    }
  };

  let size = { w: 1, h: 1 };
  function resize() {
    const r = root.getBoundingClientRect();
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    renderer.setSize(size.w, size.h, false);
    composer.setSize(size.w, size.h);
    bloom.resolution.set(size.w / 2, size.h / 2);
    grade.uniforms.aspect.value = size.w / size.h;
    room.setSize(size.w * renderer.getPixelRatio(), size.h * renderer.getPixelRatio());
    camera.aspect = size.w / size.h;
    camera.fov = camera.aspect < 0.8 ? 58 : 44;
    camera.updateProjectionMatrix();
    cam.shift = null; // the frame sets the lens again
  }
  resize();
  new ResizeObserver(resize).observe(root);

  const state = { exc: { red: 0.35, blue: 0.35 }, lights: 'sweep', winner: null, lastTaunt: -99 };
  // the scene's own clock: everything in the hall runs on it, so slow motion slows the whole hall
  let clock = performance.now() / 1000;
  let slow = 1;
  let slowTo = 1;
  let slowV = 0;
  const now = () => clock;
  // moments the page may want to hear of ('ropes', 'taunt', 'flip', 'land', 'punch', 'crash'), for the
  // hall's voice
  let onMoment = null;
  const moment = (name, side) => {
    try {
      onMoment?.(name, side);
    } catch {
      // the page's own trouble
    }
  };

  // ------------------------------------------------------------------ every frame

  // the body's values follow the pose as a critically damped spring: a new pose (a gesture, an arm
  // swapping over) starts from rest and gathers speed, never jumping off at full speed the first frame;
  // `rate` as a first-order ease's (it settles in about the same time)
  /** A value easing towards `to` as a critically damped spring, about as quick as a first-order ease at
   *  `rate`: it sets off from rest. Returns [value, speed]. */
  function springTo(x, v, to, rate, dt) {
    const w = rate * 1.6;
    const ex = Math.exp(-w * dt);
    const e = x - to;
    const m = (v + w * e) * dt;
    return [to + (e + m) * ex, (v - w * m) * ex];
  }
  const SPRUNG = ['turn', 'lean', 'look', 'a0x', 'a0z', 'e0', 'a1x', 'a1z', 'e1', 'floor', 'tuck'];
  function applyBody(bot, p, dt, rate) {
    const cur = bot.cur ?? (bot.cur = {});
    const vel = bot.curV ?? (bot.curV = {});
    const k = Math.min(1, dt * rate);
    for (const key of ['bounce', 'shake']) {
      const v = p[key] ?? 0;
      cur[key] = cur[key] == null ? v : cur[key] + (v - cur[key]) * k;
    }
    const w = rate * 1.6;
    const ex = Math.exp(-w * dt);
    for (const key of SPRUNG) {
      const v = p[key] ?? 0;
      if (cur[key] == null) {
        cur[key] = v;
        vel[key] = 0;
        continue;
      }
      const e = cur[key] - v;
      const u = vel[key] ?? 0;
      const m = (u + w * e) * dt;
      vel[key] = (u - w * m) * ex;
      cur[key] = v + (e + m) * ex;
    }
    return cur;
  }

  // ---- acts: a taunt and its answer, a climb onto the ropes, the winner's backflip

  // the ropes as the fighters climb them: where a rope runs (each sags a little, as room.js draws it),
  // where a foot stands on it (the ball of the foot on the rope, the ankle a little inside the ring) and
  // where a glove grips it
  const ROPE0 = assets.kit ? 0.54 : 0.2; // where a rope starts along its side, from the post's centre
  const SIDE_LEN = RING - 0.08; // post to post
  const ROPE_R = 0.042;
  const UPV = new THREE.Vector3(0, 1, 0);
  /** A point on rope `i` (0 the bottom), `s` metres along the side from the post. */
  function ropeAt(k, s, i, out = new THREE.Vector3()) {
    const u = Math.min(1, Math.max(0, (s - ROPE0) / (SIDE_LEN - 2 * ROPE0)));
    return out.copy(k.post).addScaledVector(k.a, s).setY(FLOOR + ROPES[i] - 0.1 * u * (1 - u));
  }
  /** A fighter's corner on the camera's side of the ring: the post, the way along the side (a), the way
   *  out to the stands (out), the robot's left when it faces out, and where along the side it climbs. */
  function cornerOf(f, side) {
    if (!f.corner) {
      const [k, along] = side === 'red' ? [2, 1] : [1, 2];
      const post = corner(k).multiplyScalar((RING - 0.08) / RING).setY(FLOOR);
      const a = corner(along).sub(corner(k)).setY(0).normalize();
      const out = new THREE.Vector3(a.z, 0, -a.x);
      if (out.dot(post) < 0) out.negate();
      const left = new THREE.Vector3(out.z, 0, -out.x); // up × out
      const s0 = 1.02; // the body's middle, this far along from the post
      const l = left.dot(a); // +1: its left hand is the one away from the post
      f.corner = { post, a, out, left, s0, l, yaw: Math.atan2(out.x, out.z), standW: post.clone().addScaledVector(a, s0), outW: out };
    }
    return f.corner;
  }
  /** The climb, stage by stage: the hips' height over the canvas and how far in from the rope line,
   *  the lean, each foot (on rope i, or on the canvas: -1) and the gloves on the top rope. `moving`: the
   *  foot that steps to reach this stage (0 left, 1 right). The winner goes on to the top rope. */
  function climbKeys(f, side, win) {
    const k = cornerOf(f, side);
    const sL = k.s0 + k.l * 0.19;
    const sR = k.s0 - k.l * 0.19;
    const canvas = f.bot.feet ? f.bot.feet.map((x) => x.at.clone()) : null; // where the feet stand now
    const foot = (j, rope) => ({ rope, s: j ? sR : sL, at: rope < 0 && canvas ? canvas[j].clone() : null });
    const K = [];
    const key = (o) => K.push({ lean: 0, twist: 0, grip: 0, moving: null, dur: 0.5, ...o });
    key({ hips: 1.644, n: -0.62, feet: [foot(0, -1), foot(1, -1)], dur: 0 });
    key({ hips: 1.6, n: -0.56, lean: 0.32, grip: 1, feet: [foot(0, -1), foot(1, -1)], dur: win ? 0.32 : 0.45 });
    if (win) {
      // the winner bounds up: the right foot to the second rope, the left to the third, both to the top
      key({ hips: 1.62, n: -0.5, lean: 0.4, grip: 1, feet: [foot(0, -1), foot(1, 1)], moving: 1, dur: 0.44 });
      key({ hips: 2.24, n: -0.4, lean: 0.12, grip: 0, feet: [foot(0, 2), foot(1, 1)], moving: 0, dur: 0.44 });
      key({ hips: 2.6, n: -0.38, lean: 0.05, feet: [foot(0, 2), foot(1, 3)], moving: 1, dur: 0.42 });
      key({ hips: 2.98, n: -0.34, lean: 0, feet: [foot(0, 3), foot(1, 3)], moving: 0, dur: 0.42 });
    } else {
      // a foot on the bottom rope, the other on the second, then both on the second
      key({ hips: 1.62, n: -0.5, lean: 0.4, grip: 1, feet: [foot(0, -1), foot(1, 0)], moving: 1, dur: 0.5 });
      key({ hips: 1.92, n: -0.4, lean: 0.52, grip: 1, feet: [foot(0, 1), foot(1, 0)], moving: 0, dur: 0.55 });
      key({ hips: 2.33, n: -0.4, lean: 0.04, grip: 0, feet: [foot(0, 1), foot(1, 1)], moving: 1, dur: 0.55 });
    }
    // world points: the ankles over the ropes, the gloves on the top rope
    for (const s of K) {
      for (const ft of s.feet) {
        if (ft.rope >= 0) ft.at = ropeAt(k, ft.s, ft.rope).addScaledVector(k.out, -0.2).addScaledVector(UPV, ROPE_R + 0.135);
        else if (!ft.at) ft.at = k.standW.clone().addScaledVector(k.out, -0.62).addScaledVector(k.left, (ft.s === sL ? 1 : -1) * 0.15).setY(FLOOR + 0.141);
      }
      s.hands = [k.s0 - k.l * 0.42, k.s0 + k.l * 0.42].map((sh) => ropeAt(k, sh, 3).addScaledVector(k.out, -0.035).addScaledVector(UPV, 0.035));
    }
    return K;
  }
  /** The way down: the same stages backwards, each step taken by the foot that took it on the way up. */
  function downKeys(K) {
    const D = [];
    for (let i = K.length - 1; i >= 0; i--) D.push({ ...K[i], moving: K[i + 1]?.moving ?? null, dur: (K[i + 1]?.dur ?? 0) * 0.9 });
    return D;
  }
  /** Facing the stands from where it is: away from the ring's centre. */
  function yawOut(f) {
    const centre = f.st.g.worldToLocal(new THREE.Vector3(0, FLOOR, 0));
    return Math.atan2(f.pos.x - centre.x, f.pos.y - centre.z);
  }
  /** Facing the other fighter. */
  function yawAt(f, other) {
    const v = f.st.g.worldToLocal(other.bot.root.getWorldPosition(new THREE.Vector3()));
    return Math.atan2(v.x - f.pos.x, v.z - f.pos.y);
  }
  const _w = new THREE.Vector3();
  const _w2 = new THREE.Vector3();
  /** A world point as the station's own: x, z (the robot's spot) and the height in the hall's metres. */
  function own(f, w) {
    const v = f.st.g.worldToLocal(_w2.copy(w));
    return { x: v.x, z: v.z, y: (v.y * STATION) };
  }
  const hipW = (f) => (f.bot.hipY ?? 0.95) * SIZE * STATION; // the hips over the feet, standing (m)
  const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * x * (x * (x * 6 - 15) + 10));
  const easeOut = (x) => 1 - (1 - Math.min(1, Math.max(0, x))) ** 3;
  // what weighs on the ropes this frame (for room.js): feet and gloves of a climbing fighter
  const loads = [];
  const loadOn = (k, s, rope, amount) => {
    if (amount > 0.002) loads.push({ k, s, rope, amount });
  };
  const dipAt = (k, s, rope) => {
    let d = 0;
    // as room.js bends the rope: in a V from the load to its two ends
    for (const L of loads) if (L.k === k && L.rope === rope) d = Math.max(d, L.amount * Math.min(1, Math.max(0, s < L.s ? (s - ROPE0) / Math.max(0.05, L.s - ROPE0) : (SIDE_LEN - ROPE0 - s) / Math.max(0.05, SIDE_LEN - ROPE0 - L.s))));
    return d;
  };

  /** One stage of a climb to the next, at share u: the body, the feet and the gloves. */
  function climbStage(f, k, A, Bk, u, rig) {
    const m = Bk.moving;
    const kf = m == null ? 1 : Math.min(1, u / 0.62); // the stepping foot lands at 62%
    const kb = smooth(Math.min(1, Math.max(0, (u - 0.22) / 0.78))); // the body follows, its weight over the new foot
    const hips = lerp(A.hips, Bk.hips, kb);
    const n = lerp(A.n, Bk.n, kb);
    const yawW = k.yaw;
    const root = _w.copy(k.standW).addScaledVector(k.out, n);
    // over the standing foot while the other is in the air, a little
    const side = m == null ? 0 : Math.sin(Math.PI * kf) * (m ? 1 : -1) * 0.05;
    for (const j of [0, 1]) {
      const from = A.feet[j];
      const to = Bk.feet[j];
      const ft = rig.feet[j];
      ft.w = 1;
      ft.yaw = yawW;
      if (j === m && kf < 1) {
        // a step: up and back off the rope it leaves, over the next and down onto it
        const e = smooth(kf);
        ft.at.lerpVectors(from.at, to.at, e).addScaledVector(UPV, Math.sin(Math.PI * kf) * 0.14).addScaledVector(k.out, -Math.sin(Math.PI * kf) * 0.24);
        if (from.rope >= 0) loadOn(k, from.s, from.rope, 0.04 * (1 - smooth(kf * 3)));
      } else {
        ft.at.copy(to.at);
        if (to.rope >= 0) {
          const settle = j === m ? smooth((u - 0.62) / 0.2) : 1;
          loadOn(k, to.s, to.rope, 0.04 * settle);
          ft.at.y -= dipAt(k, to.s, to.rope) * 0.9;
        }
      }
    }
    const grip = lerp(A.grip, Bk.grip, smooth(Bk.grip > A.grip ? u * 1.4 : u * 1.8));
    for (const [i, h] of rig.hands.entries()) {
      h.at.copy(Bk.hands[i]);
      h.w = grip;
      h.pole = h.pole ?? new THREE.Vector3();
      h.pole.set(i ? 0.9 : -0.9, -0.5, -0.4);
      if (grip > 0.5) loadOn(k, k.s0 + (i ? k.l : -k.l) * 0.42, 3, 0.018 * grip);
    }
    for (const h of rig.hands) h.at.y -= dipAt(k, k.s0, 3) * 0.6;
    rig.lean = lerp(A.lean, Bk.lean, kb);
    rig.body.set(side, 0, 0);
    return { root: root.clone(), hips };
  }

  /** Leads the body while an act runs: what the act wants this frame, or null when there is none. */
  function stepAct(f, side, t, dt) {
    const a = f.act;
    const other = fighters[side === 'red' ? 'blue' : 'red'];
    if (a.kind === 'answer' && !a.began) {
      if (t < a.from) return null; // it has not noticed yet
      a.began = true;
      a.since = t;
    }
    let at = t - a.since; // the time in this phase
    const next = (phase) => {
      a.phase = phase;
      a.since = t;
      at = 0; // a phase that follows in this same frame starts at its own beginning (no frame from its middle)
    };
    if (a.kind === 'taunt' || a.kind === 'answer') {
      if (at > a.len || !other.present) {
        f.act = null;
        return null;
      }
      // the wind-up (a dip, the arms drawn in), the gesture itself with the body behind it, and the
      // follow-through as it lets go
      const on = smooth(Math.min(1, (at - 0.22) / 0.3)) * (1 - smooth((at - (a.len - 0.4)) / 0.4));
      const wind = Math.sin(Math.PI * Math.min(1, at / 0.32));
      const towards = ['beckon', 'point', 'chest', 'box'].includes(a.gesture) ? 1 : ['laugh', 'brush'].includes(a.gesture) ? -1 : 0;
      return { hold: true, face: yawAt(f, other), gesture: a.gesture, gestureW: on, lookAt: other, step: towards > 0 ? 0.22 * smooth((at - 0.25) / 0.45) * (1 - smooth((at - a.len + 0.5) / 0.5)) : 0, body: { y: -0.1 * wind - 0.03 * on, lean: -0.12 * wind + 0.1 * towards * on + (towards < 0 ? -0.08 * on : 0) } };
    }
    const k = cornerOf(f, side);
    const win = a.kind === 'win';
    const yawL = k.yaw - SEAT[side].rot; // facing out, in the station's turn
    const lead = { hold: true, place: true, face: yawL, gesture: null, rig: f.actRig };
    const r = f.actRig;
    r.legs = null;
    r.hug = 0;
    r.air = false;
    r.lean = 0;
    r.twist = 0;
    r.body.set(0, 0, 0);
    r.arms = null;
    r.look = null;
    for (const x of [...r.feet, ...r.hands]) x.w = 0;
    const place = (root, hips) => {
      const o = own(f, root);
      f.pos.set(o.x, o.z);
      f.lift = hips - hipW(f);
      f.flip = 0;
    };
    if (a.phase === 'go') {
      const goal = own(f, _w.copy(k.standW).addScaledVector(k.out, -0.62));
      const g = new THREE.Vector2(goal.x, goal.z);
      if (f.pos.distanceTo(g) < 0.06) next('face');
      return { goal: g, speed: win ? 2.3 : LAPS[side].speed * 1.25 };
    }
    if (a.phase === 'face') {
      // on the spot, turning to the ropes step by step
      let off = (yawL - (f.bot.yaw ?? 0)) % (Math.PI * 2);
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if ((Math.abs(off) < 0.05 && at > 0.25) || at > 1.6) {
        next('climb');
        a.keys = climbKeys(f, side, win);
        a.i = 1;
      }
      return { hold: true, face: yawL, gesture: null };
    }
    if (a.phase === 'climb' || a.phase === 'down') {
      const K = a.phase === 'climb' ? a.keys : a.down;
      let u = at / K[a.i].dur;
      while (u >= 1 && a.i < K.length - 1) {
        a.since += K[a.i].dur;
        a.i++;
        u = (t - a.since) / K[a.i].dur;
      }
      u = Math.min(1, u);
      const s = climbStage(f, k, K[a.i - 1], K[a.i], u, r);
      place(s.root, s.hips);
      f.bot.yaw = yawL;
      if (a.phase === 'climb' && !win && a.i === K.length - 1) {
        // the gloves let go as it stands up: arms out a little for balance
        r.arms = { w: smooth(u), a0x: -0.3, a0z: -0.9, e0: -0.5, a1x: -0.3, a1z: 0.9, e1: -0.5 };
      }
      if (win && a.i >= 3) r.arms = { w: smooth(a.i === 3 ? u : 1), a0x: -0.25, a0z: -1.25, e0: -0.4, a1x: -0.25, a1z: 1.25, e1: -0.4 };
      if (a.phase === 'down' && a.i === 1) r.arms = { w: 1 - smooth(u), a0x: -0.3, a0z: -0.9, e0: -0.5, a1x: -0.3, a1z: 0.9, e1: -0.5 };
      r.look = _w.copy(k.standW).addScaledVector(k.out, 6).setY(FLOOR + 1.5).clone();
      r.lookW = 0.5;
      if (u >= 1 && a.i === K.length - 1) {
        if (a.phase === 'climb') {
          next('pose');
          a.top = { root: s.root.clone(), hips: s.hips, feet: K[a.i].feet.map((x) => x.at.clone()) };
          moment('ropes', side);
        } else {
          f.act = null;
          f.lift = 0;
          f.lastClimb = t;
          return { hold: true, face: yawL, gesture: null };
        }
      }
      return lead;
    }
    if (a.phase === 'bail') {
      // the bell (or the verdict) mid-climb: a hop back down onto the canvas
      const u = Math.min(1, at / 0.55);
      const e = smooth(u);
      const root = _w.lerpVectors(a.from.root, a.from.down, e);
      place(root, lerp(a.from.hips, hipW(f), e) + Math.sin(Math.PI * u) * 0.3);
      f.bot.yaw = yawL;
      r.legs = { hip: -0.6, knee: 0.9, w: Math.sin(Math.PI * u) * 0.8 };
      r.air = u < 0.9;
      if (u >= 1) {
        f.act = null;
        f.lift = 0;
        return null;
      }
      return lead;
    }
    const top = a.top;
    const H = hipW(f);
    if (a.phase === 'pose') {
      // up on the ropes, playing to the stands: the chest turns along the crowd
      place(top.root, top.hips + Math.sin(at * 2.3) * 0.015);
      f.bot.yaw = yawL;
      top.feet.forEach((p, j) => {
        r.feet[j].at.copy(p);
        r.feet[j].w = 1;
        r.feet[j].yaw = k.yaw;
        const rope = win ? 3 : 1;
        loadOn(k, k.s0 + (j ? -k.l : k.l) * 0.19, rope, 0.045);
        r.feet[j].at.y -= dipAt(k, k.s0, rope) * 0.9;
      });
      r.twist = Math.sin(at * 1.1) * 0.35;
      r.look = _w.copy(k.standW).addScaledVector(k.out, 8).addScaledVector(k.a, Math.sin(at * 1.1 + 0.4) * 5).setY(FLOOR + 3).clone();
      r.lookW = 0.8;
      state.exc[side] = Math.max(state.exc[side], win ? 1 : 0.85);
      if (at > (win ? 0.55 : 2.6)) {
        if (win) next('crouch');
        else {
          next('down');
          a.down = downKeys(a.keys);
          a.i = 1;
        }
      }
      return { ...lead, gesture: win ? null : a.gesture, arms: win ? { w: 1, a0x: -0.25, a0z: -1.25, e0: -0.4, a1x: -0.25, a1z: 1.25, e1: -0.4 } : null };
    }
    // the backflip: crouch, the arms swing up and it leaves the rope, turns about its middle (tucked, so
    // faster), opens out, lands on its feet and takes the blow in its knees
    const fly = a.fly ??= {};
    const pinFeet = (w) => top.feet.forEach((p, j) => {
      r.feet[j].at.copy(p);
      r.feet[j].w = w;
      r.feet[j].yaw = k.yaw;
    });
    if (a.phase === 'crouch' || a.phase === 'push') {
      const crouch = a.phase === 'crouch';
      const u = Math.min(1, at / (crouch ? 0.42 : 0.17));
      const by = crouch ? -0.36 * smooth(u) : lerp(-0.36, 0.04, easeOut(u));
      fly.C = _w.copy(top.root).setY(top.hips + FLOOR).clone();
      fly.theta = crouch ? 0 : -0.32 * u * u;
      fly.by = by;
      pinFeet(1);
      r.body.set(0, by, 0);
      r.lean = crouch ? 0.34 * smooth(u) : lerp(0.34, -0.22, easeOut(u));
      const back = crouch ? smooth(u) : 1 - easeOut(u * 1.1);
      const up = crouch ? 0 : easeOut(u);
      r.arms = { w: 1, a0x: lerp(lerp(-0.25, 0.75, back), -2.85, up), a0z: lerp(-0.35, -0.2, up), e0: lerp(-0.45, -0.15, up), a1x: lerp(lerp(-0.25, 0.75, back), -2.85, up), a1z: lerp(0.35, 0.2, up), e1: lerp(-0.45, -0.15, up) };
      if (u >= 1) {
        if (crouch) {
          next('push');
          moment('flip', side);
        } else {
          // the flight: a parabola for the middle of the body from here to a spot well inside the ropes,
          // the turn's pace from how tucked it is (the same spin, a smaller body: faster)
          next('air');
          const land = _w2.copy(k.standW).addScaledVector(k.out, -2.05).setY(FLOOR + H * 0.93);
          const C0 = fly.C.clone().addScaledVector(UPV, 0.04);
          const vy = 2.7;
          const T = (vy + Math.sqrt(vy * vy + 2 * 9.8 * (C0.y - land.y))) / 9.8;
          fly.air = { C0, land: land.clone(), vy, T, vh: land.clone().sub(C0).setY(0).divideScalar(T), theta0: fly.theta };
          const N = 48;
          const cum = [0];
          for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + 1 / (1 - 0.58 * tuckAt((i - 0.5) / N)));
          fly.air.cum = cum.map((x) => x / cum[N]);
        }
      }
    }
    if (a.phase === 'air') {
      const A = fly.air;
      const tau = Math.min(A.T, at);
      const u = tau / A.T;
      slowTo = u > 0.07 && u < 0.8 ? 0.3 : 1;
      fly.C = A.C0.clone().addScaledVector(A.vh, tau).setY(A.C0.y + A.vy * tau - 4.9 * tau * tau);
      fly.vel = A.vh.clone().setY(A.vy - 9.8 * tau);
      const i = Math.min(47, Math.floor(u * 48));
      const c = A.cum[i] + (A.cum[i + 1] - A.cum[i]) * (u * 48 - i);
      fly.theta = A.theta0 + (-Math.PI * 2 - A.theta0) * c;
      fly.by = lerp(fly.by ?? 0, 0, Math.min(1, dt * 12));
      const tk = tuckAt(u);
      const reach = smooth((u - 0.84) / 0.16); // the feet reach for the canvas
      r.air = reach < 0.5;
      r.legs = { hip: lerp(-0.35, -2.3, tk), knee: lerp(0.45, 2.45, tk), w: Math.min(1, at / 0.12) * (1 - reach) };
      r.hug = tk;
      r.lean = lerp(lerp(-0.22, 0.1, smooth(u / 0.2)), 0.55, tk);
      r.look = null;
      r.arms = { w: 1 - tk, a0x: lerp(-2.85, -1.2, smooth((u - 0.6) / 0.3)), a0z: lerp(-0.2, -0.55, smooth((u - 0.6) / 0.3)), e0: -0.3, a1x: lerp(-2.85, -1.2, smooth((u - 0.6) / 0.3)), a1z: lerp(0.2, 0.55, smooth((u - 0.6) / 0.3)), e1: -0.3 };
      fly.landFeet ??= [0, 1].map((j) => A.land.clone().addScaledVector(k.left, (j ? -1 : 1) * 0.17).addScaledVector(k.out, -0.12).setY(FLOOR + 0.141));
      if (reach > 0) fly.landFeet.forEach((p, j) => {
        r.feet[j].at.copy(p);
        r.feet[j].w = reach;
        r.feet[j].yaw = k.yaw;
      });
      if (at < 0.1) pinFeet(1 - at / 0.1); // the feet leave the rope
      r.body.set(0, fly.by, 0);
      if (at >= A.T) {
        next('land');
        slowTo = 1;
        fly.theta = 0;
        fly.by0 = A.land.y - FLOOR - H;
        moment('land', side);
        cam.shake = 0.28;
      }
    }
    if (a.phase === 'land') {
      // the knees take it, a lean forward, a step back with the way it was going, then up
      const ld = fly.air.land;
      const tl = at;
      const absorb = tl < 0.13 ? -0.42 * easeOut(tl / 0.13) : tl < 0.24 ? -0.42 : -0.42 * (1 - smooth((tl - 0.24) / 0.6));
      const back = smooth((tl - 0.32) / 0.4) * 0.26;
      const root = _w.copy(ld).setY(FLOOR).addScaledVector(k.out, -back);
      const o = own(f, root);
      f.pos.set(o.x, o.z);
      f.lift = 0;
      f.flip = 0;
      f.bot.yaw = yawL;
      r.body.set(0, fly.by0 * (1 - smooth(tl / 0.3)) + absorb, 0);
      r.lean = 0.5 * Math.sin(Math.PI * Math.min(1, tl / 0.9)) + 0.05;
      const pin = 1 - smooth((tl - 0.3) / 0.12); // then the feet are its own again: the step back
      fly.landFeet.forEach((p, j) => {
        r.feet[j].at.copy(p);
        r.feet[j].w = pin;
        r.feet[j].yaw = k.yaw;
      });
      r.arms = { w: 1 - smooth((tl - 0.55) / 0.35), a0x: -1.25, a0z: -0.6, e0: -0.45, a1x: -1.25, a1z: 0.6, e1: -0.45 };
      if (tl > 0.95) {
        f.winAt = f.pos.clone();
        f.act = null;
        return null;
      }
      return { ...lead, gesture: 'pump', gestureW: smooth((tl - 0.55) / 0.35) };
    }
    // in the air (and the take-off): the body turned about its middle
    if (fly.C) {
      f.flipC = fly.C.clone();
      f.flipV = fly.vel?.clone() ?? new THREE.Vector3();
      const yawW = k.yaw;
      const th = fly.theta;
      const off = _w2.set(Math.sin(th) * Math.sin(yawW), Math.cos(th), Math.sin(th) * Math.cos(yawW)).multiplyScalar(H);
      const root = fly.C.clone().sub(off);
      const o = own(f, root);
      f.pos.set(o.x, o.z);
      f.lift = root.y - FLOOR;
      f.flip = th;
      f.bot.yaw = yawL;
    }
    return lead;
  }
  /** How tucked the body is through the flight (0 open, 1 knees to the chest). */
  function tuckAt(u) {
    return smooth((u - 0.1) / 0.2) * (1 - smooth((u - 0.64) / 0.2));
  }

  // the referee's raise of the winner's arm, on its own clock: it takes the winner's wrist once it is
  // there, lifts it, holds it up, and lets go
  function raiseOf() {
    const r = referee;
    if (r.pose !== 'refRaise' || !state.winner || r.arrivedAt == null) return null;
    const tt = now() - r.since;
    const gripAt = Math.max(r.arrivedAt, 1.15);
    const grip = smooth((tt - gripAt) / 0.4);
    const up = smooth((tt - Math.max(gripAt + 0.35, 1.9)) / 0.55);
    const off = smooth((tt - 4.2) / 0.45);
    return { grip: grip * (1 - off), up, off, tt };
  }

  // a light boxer's guard: the gloves up by the chin (on the robot's own axes, metres: x to its left)
  const GUARD = [new THREE.Vector3(-0.17, 2.24, 0.32), new THREE.Vector3(0.12, 2.3, 0.44)];
  const GUARD_POLE = [new THREE.Vector3(-0.35, -1, -0.15), new THREE.Vector3(0.35, -1, -0.15)];

  function newRig() {
    const v = () => new THREE.Vector3();
    return { feet: [{ at: v(), w: 0, yaw: 0 }, { at: v(), w: 0, yaw: 0 }], hands: [{ at: v(), w: 0, pole: v() }, { at: v(), w: 0, pole: v() }], body: v(), look: null, lookW: 1, lean: 0, twist: 0, legs: null, hug: 0, air: false, arms: null, stance: 0, ground: FLOOR, breath: 1 };
  }
  /** A hop on the spot: the knees dip and push, the body leaves the canvas, lands, again (`ph` where in
   *  the hop, 0..1). */
  function hop(ph, h) {
    if (ph < 0.3) return { lift: 0, dip: -0.55 * h * Math.sin((Math.PI * ph) / 0.3) };
    return { lift: h * Math.sin((Math.PI * (ph - 0.3)) / 0.7), dip: 0 };
  }

  function moveFighter(f, side, t, dt) {
    const bot = f.bot;
    const lap = LAPS[side];
    const otherSide = side === 'red' ? 'blue' : 'red';
    const other = fighters[otherSide];
    // the two never share a clock: blue's poses run a little ahead (not the loser's, whose furniture
    // flies on its own times)
    const tt = t - f.since + (side === 'blue' && f.pose !== 'lose' ? 0.7 : 0);
    f.actRig ??= newRig();
    f.rig ??= newRig();
    // an act belongs to its pose: the bell or the verdict ends it at once; up on the ropes it hops down first
    if (f.act && f.act.phase !== 'bail' && (reduced || (f.act.kind === 'win' ? f.pose !== 'win' : f.pose !== 'hype'))) {
      if (f.act.phase === 'air') slowTo = 1;
      if (!reduced && ['climb', 'pose', 'down'].includes(f.act.phase) && (f.lift ?? 0) > 0.05) {
        const k = cornerOf(f, side);
        const root = f.st.g.localToWorld(new THREE.Vector3(f.pos.x, 0, f.pos.y)).setY(FLOOR);
        f.act = { kind: f.act.kind, phase: 'bail', since: t, from: { root, hips: (f.lift ?? 0) + hipW(f), down: k.standW.clone().addScaledVector(k.out, -0.9) } };
      } else {
        f.act = null;
        f.flip = 0;
      }
    }
    // the winner, once the referee has let go of its arm and the beaten one lies knocked out (or never
    // came at it): to its corner, up the ropes, and the backflip
    if (!reduced && f.pose === 'win' && !f.act && !f.flipped && tt > 2.3 && !fightHolds(f, other, tt)) {
      f.flipped = true;
      f.act = { kind: 'win', phase: 'go', since: t, gesture: 'pump' };
    }
    const lead = f.act ? stepAct(f, side, t, dt) : fightLead(f, side, t, dt);
    if (!lead?.place) {
      // back on its feet and on the floor, eased (a body that lay down gets up, it does not pop up)
      // (as springs: a body let go of by an act sets off from rest, it does not jump)
      [f.lift, f.liftV] = springTo(f.lift ?? 0, f.liftV ?? 0, 0, 9, dt);
      [f.flip, f.flipSpd] = springTo(Math.atan2(Math.sin(f.flip ?? 0), Math.cos(f.flip ?? 0)), f.flipSpd ?? 0, 0, 5, dt);
      if (Math.abs(f.flip) < 0.002 && Math.abs(f.flipSpd) < 0.01) f.flip = f.flipSpd = 0;
    } else {
      f.liftV = 0;
      f.flipSpd = 0;
    }
    // on its lap: an easy walk, with a few seconds of its own flair now and then
    const flair = !lead && f.pose === 'hype' && (f.flairUntil ?? 0) > t ? lap.flair : null;
    const gaitPhase = bot.gait ? bot.gait().phase * Math.PI * 2 : tt * 6.2;
    const p = reduced ? POSES.guard(0) : POSES[f.pose](tt, side, lead ? lead.gesture : f.gesture ?? flair, gaitPhase);
    if (lead) {
      // the act's own body: its gesture (faded in and out), its arms, and never the pose's own jumping about
      const g = lead.gesture ? GESTURES[lead.gesture](tt, undefined, gaitPhase) : GESTURES.stroll(tt, 0, gaitPhase);
      const gw = lead.gestureW ?? 1;
      const base = lead.arms ?? lead.rig?.arms ?? GUARD_ARMS;
      Object.assign(p, { bounce: 0, turn: 0, lean: lead.body?.lean ?? lead.rig?.lean ?? 0, look: -0.1, shake: 0, tuck: 0, hop: null });
      for (const key of ['a0x', 'a0z', 'e0', 'a1x', 'a1z', 'e1']) p[key] = lead.gesture ? lerp(base[key], g[key], gw) : lead.arms || lead.rig?.arms ? lerp(g[key], base[key], (lead.arms ?? lead.rig.arms).w ?? 1) : g[key];
      if (lead.gesture && g.shake) p.shake = g.shake * gw;
      if (lead.gesture && g.bounce) p.bounce = g.bounce * gw;
      if (lead.gesture && g.hop) p.hop = g.hop;
      p.seat = false;
      if (lead.p) Object.assign(p, lead.p); // the act's own body values (the head, the lean, the arms)
    }
    const c = applyBody(bot, p, dt, lead?.ease ?? 10);
    // walk to the spot of the pose (or to the next corner of its lap), round the desk when the way
    // crosses it, on the side it is nearer to
    let goal;
    let showing = false;
    let free = false;
    if (lead) {
      goal = lead.goal ? lead.goal.clone() : f.pos.clone();
      free = true; // an act knows its way: it never crosses the desk
    } else if (p.lap && !reduced) {
      if (f.lapI == null) {
        f.lapI = 0;
        f.dice = 1 + Math.floor(Math.random() * 2147483000); // its own run of chances, new on every visit
        f.nextFlair = t + 5 + (side === 'red' ? 2 : 7);
      }
      const lapAt = (i) => new THREE.Vector2(...lap.at[i % lap.at.length]);
      if (t > f.nextFlair) {
        f.dice = (f.dice * 16807) % 2147483647;
        f.flairUntil = t + 2.4 + (f.dice % 13) / 10;
        f.nextFlair = t + 11 + (f.dice % 9);
      }
      if (f.showUntil && t >= f.showUntil) {
        // the show is over: on to the next corner
        f.showUntil = 0;
        f.gesture = null;
        f.lapI++;
      } else if (!f.showUntil && f.pos.distanceTo(lapAt(f.lapI)) < 0.3) {
        // at a corner of its lap, the dice: mostly it walks on; now and then it stops and plays to the
        // stands, climbs the ropes at its corner, or (seldom) taunts the other, who may answer
        f.dice = (f.dice * 16807) % 2147483647;
        const roll = f.dice % 100;
        const pick = (list) => list[f.dice % list.length];
        f.lapI++;
        if (roll < lap.stops) {
          f.lapI--; // it stays at this corner for the show
          f.showUntil = t + 1.8 + (f.dice % 17) / 10;
          f.gesture = pick(lap.show);
        } else if (roll < lap.stops + 9 && tt > 6 && other.present && other.pose === 'hype' && !other.act && t - state.lastTaunt > 24) {
          state.lastTaunt = t;
          f.act = { kind: 'taunt', since: t, len: 2.4, gesture: pick(lap.taunts) };
          moment('taunt', side);
          state.exc[side] = Math.max(state.exc[side], 0.8); // its own stand answers the taunt
          // two times in three the other answers, a moment later
          if (f.dice % 3) other.act = { kind: 'answer', from: t + 0.7, since: t, len: 1.9, gesture: LAPS[otherSide].answers[f.dice % LAPS[otherSide].answers.length] };
        } else if (roll < lap.stops + 20 && tt > 8 && t - (f.lastClimb ?? -99) > 30) {
          f.lastClimb = t;
          f.act = { kind: 'climb', phase: 'go', since: t, gesture: pick(lap.ropes) };
        }
      }
      showing = !!f.showUntil;
      goal = showing ? f.pos.clone() : lapAt(f.lapI);
    } else {
      f.showUntil = 0;
      f.gesture = null;
      // after its backflip the winner celebrates where it landed
      goal = f.pose === 'win' && f.winAt ? f.winAt.clone() : new THREE.Vector2(...p.spot);
    }
    if (!f.path.length || !f.path[f.path.length - 1].equals(goal)) {
      const crossing = !free && ((f.pos.y < 0.4 && goal.y > 0.95) || (f.pos.y > 0.95 && goal.y < 0.4));
      const round = (crossing && goal.y > 0.95 ? goal.x : f.pos.x) < 0 ? -1.05 : 1.05;
      f.path = crossing ? [new THREE.Vector2(round, f.pos.y), new THREE.Vector2(round, goal.y), goal] : [goal];
    }
    const next = f.path[0];
    const d = next.clone().sub(f.pos);
    const dist = d.length();
    const walking = !lead?.place && dist > 0.25 && !lead?.hold; // a real walk, not the small drift of a pose
    // full speed to a corner of the way round the desk; to the spot itself slowing down as it
    // nears, so a drifting spot is followed smoothly and not in stop-and-go jumps (which a close-up
    // camera, riding with the robot, turned into a shaking picture); it gathers speed and slows down
    // over a step or two, never at once
    const toSpot = f.path.length === 1;
    if (lead?.place) f.spd = 0;
    else if (!toSpot && dist < 0.02) f.path.shift();
    else {
      // it turns before it goes: the more it still has to turn, the slower it steps
      let pace = 1;
      if (walking && bot.yaw != null) {
        let off = (Math.atan2(d.x, d.y) - bot.yaw) % (Math.PI * 2);
        if (off > Math.PI) off -= Math.PI * 2;
        if (off < -Math.PI) off += Math.PI * 2;
        pace = Math.max(0.05, Math.cos(Math.min(Math.abs(off), Math.PI / 2))) ** 1.5;
      }
      const speed = (lead?.speed ?? (p.lap && toSpot ? lap.speed : toSpot ? Math.min(p.speed ?? 1.7, dist * 7) : p.speed ?? 1.7)) * pace;
      f.spd = (f.spd ?? 0) + (Math.min(speed, toSpot ? dist * 6 : 9) - (f.spd ?? 0)) * Math.min(1, dt * 4);
      f.pos.add(d.clampLength(0, dt * f.spd));
    }
    // facing the way it walks; in an act, where the act says; stopped for a show, facing the stands
    let facing = c.turn;
    if (walking) facing = Math.atan2(d.x, d.y);
    else if (lead?.face != null) facing = lead.face;
    else if (showing) facing = yawOut(f);
    else if (f.pose === 'stand' && other.present && !raiseOf()) facing = yawAt(f, other) * 0.7; // squared up to the other, waiting
    if (!lead?.place) {
      // eased (a spring: a turn gathers speed, it does not start at full speed), and never faster than a
      // person turns: no snap at a corner of its way
      const y0 = bot.yaw ?? c.turn;
      const err = turnTo(y0, facing, 1) - y0;
      const top = lead ? (lead.turn ?? 4.5) : 3.6;
      const [y1, v1] = springTo(y0, f.yawV ?? 0, y0 + err, lead ? 5 : walking ? 4 : 3.2, dt);
      f.yawV = Math.max(-top, Math.min(top, v1));
      bot.yaw = y0 + Math.max(-top * dt, Math.min(top * dt, y1 - y0));
    } else f.yawV = 0;
    if (p.seat && !walking && Math.abs(turnTo(0, facing - (bot.yaw ?? facing), 1)) > 0.3) p.seat = false; // turned to its desk first, then down

    // the body's rig for this frame: an act's own, or the pose's (a guard, hops, typing)
    const rig = lead?.rig ?? f.rig;
    if (!lead?.rig) {
      for (const x of [...rig.feet, ...rig.hands]) x.w = 0;
      rig.legs = null;
      rig.hug = 0;
      rig.air = false;
      rig.twist = 0;
      rig.body.set(0, 0, 0);
      rig.look = null;
      rig.lookW = 1;
      rig.tilt = 0;
      rig.breathRate = null;
      rig.wide = 0;
      rig.feetFwd = 0;
      rig.toeOut = 0;
      rig.planted = null;
    }
    rig.ground = FLOOR;
    rig.stance = 0;
    rig.breath = reduced ? 0 : 1;
    const standing = !walking && !p.seat && !lead?.place;
    // a light boxer's guard between acts: gloves up by the chin, the feet set, the knees soft
    const guard = standing && !reduced && ((!f.act && (f.pose === 'hype' || f.pose === 'stand') && !f.gesture && !flair && !raiseOf()) || !!lead?.guard);
    f.guardW = (f.guardW ?? 0) + ((guard ? 1 : 0) - (f.guardW ?? 0)) * Math.min(1, dt * 5);
    const gw = f.guardW;
    if (gw > 0.01 && !lead?.place) {
      const q = bot.root.getWorldQuaternion(new THREE.Quaternion());
      const base = bot.root.getWorldPosition(new THREE.Vector3()).setY(FLOOR);
      rig.hands.forEach((h, i) => {
        h.at.copy(GUARD[i]).applyQuaternion(q).add(base);
        h.at.y += Math.sin(t * 4.1 + i * 1.3) * 0.012;
        h.pole.copy(GUARD_POLE[i]);
        h.w = Math.max(h.w, gw);
      });
      rig.stance = gw;
      rig.twist += -0.22 * gw;
      rig.body.y += (-0.06 + Math.sin(t * 4.1) * 0.012) * gw;
    }
    // standing: the weight drifts from foot to foot; the head looks about (at the other, at the stands)
    if (standing && !reduced) {
      rig.body.x += Math.sin(t * 0.47 + (side === 'red' ? 0 : 2)) * 0.035;
      if (!rig.look) {
        f.scan ??= { at: 0, yaw: 0, pitch: 0 };
        if (t > f.scan.at) {
          f.scan.at = t + 1.4 + Math.random() * 2.2;
          f.scan.yaw = (Math.random() - 0.5) * 0.7;
          f.scan.pitch = (Math.random() - 0.4) * 0.15;
        }
        const target = lead?.lookAt ?? (f.pose === 'stand' || gw > 0.5 ? (other.present ? other : null) : null);
        if (target) rig.look = target.bot.bones?.Head?.getWorldPosition(new THREE.Vector3()) ?? null;
        else {
          const q = bot.root.getWorldQuaternion(new THREE.Quaternion());
          rig.look = new THREE.Vector3(Math.sin(f.scan.yaw), 0.12 + f.scan.pitch, Math.cos(f.scan.yaw)).applyQuaternion(q).multiplyScalar(8).add(bot.root.getWorldPosition(new THREE.Vector3()));
          rig.look.y = FLOOR + 3 + f.scan.pitch * 6;
        }
        rig.lookW = 0.85;
      }
    }
    // a taunt: a step towards the other, the body behind the gesture
    if (lead?.body) rig.body.y += lead.body.y;
    if (lead?.step) {
      const dir = yawAt(f, other);
      const want = (lead.step - (f.stepDone ?? 0));
      f.pos.x += Math.sin(dir) * want;
      f.pos.y += Math.cos(dir) * want;
      f.stepDone = lead.step;
    } else f.stepDone = 0;
    // hops (the winner, an answer in time, fists pumping) and small bobs
    let hopLift = 0;
    if (!lead?.place && !reduced) {
      // a hop fades out (an act that starts mid-hop, or a sit, lands it first, eased); its own running
      // phase, so a new pose (another pace of hops) never jumps it to another point of the hop
      f.hopW = (f.hopW ?? 0) + ((p.hop && !p.seat ? 1 : 0) - (f.hopW ?? 0)) * Math.min(1, dt * 6);
      if (p.hop) f.hopP = p.hop;
      if (f.hopP) f.hopPh = ((f.hopPh ?? 0) + dt / f.hopP[0]) % 1;
      if (f.hopW > 0.01 && f.hopP) {
        const h = hop(f.hopPh, f.hopP[1]);
        hopLift = h.lift * f.hopW;
        rig.body.y += h.dip * f.hopW;
        rig.air = hopLift > 0.015;
      } else if (c.bounce > 0.001) rig.body.y -= c.bounce * 1.2;
    } else f.hopW = 0;
    c.bounce = 0;
    // the referee holds its arm up: the winner's near arm goes where the referee's grip takes it
    const raise = state.winner === side ? raiseOf() : null;
    if (raise && raise.grip > 0.001) {
      const s = referee.bot.root.getWorldPosition(new THREE.Vector3());
      const q = bot.root.getWorldQuaternion(new THREE.Quaternion());
      const me = bot.root.getWorldPosition(new THREE.Vector3());
      const leftW = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
      const i = leftW.dot(s.sub(me)) > 0 ? 1 : 0; // the arm on the referee's side
      const out = i ? 1 : -1;
      // straight up, held high by the referee's grip
      const low = new THREE.Vector3(out * 0.5, 1.5, 0.2);
      const high = new THREE.Vector3(out * 0.36, 3.2, 0.06);
      rig.hands[i].at.copy(low.lerp(high, raise.up)).applyQuaternion(q).add(me.setY(FLOOR));
      rig.hands[i].w = raise.grip;
      rig.hands[i].pole.set(out * 0.8, lerp(-1, 0.2, smooth(raise.up)), -0.6); // (eased: no elbow flip)
      f.raiseArm = i;
    } else f.raiseArm = null;
    // typing: each hand from key to key, a tap on each; the head reads the screen
    let reach = null;
    if (p.reach === 'keys' && !walking && p.seat) {
      f.keys ??= [0, 1].map(() => ({ from: new THREE.Vector3(), to: new THREE.Vector3(), u: 1, dur: 0.1 }));
      const calm = side === 'blue';
      reach = f.keys.map((kk, i) => {
        if (kk.u >= 1) {
          kk.from.copy(kk.to.lengthSq() ? kk.to : new THREE.Vector3(i ? 0.14 : -0.14, 0.955, 0.37));
          kk.to.set((i ? 0.14 : -0.14) + (Math.random() - 0.5) * 0.13, 0.955, 0.37 + (Math.random() - 0.55) * 0.09);
          kk.u = 0;
          kk.dur = (calm ? 0.13 : 0.09) + Math.random() * 0.08;
        }
        kk.u = Math.min(1, kk.u + dt / kk.dur);
        const e = smooth(Math.min(1, kk.u / 0.7));
        const v = new THREE.Vector3().lerpVectors(kk.from, kk.to, e);
        v.y += Math.sin(Math.PI * Math.min(1, kk.u / 0.7)) * 0.025 - (kk.u > 0.75 ? Math.sin(Math.PI * (kk.u - 0.75) / 0.25) * 0.008 : 0);
        return f.st.g.localToWorld(v);
      });
      rig.twist = Math.sin(t * (calm ? 0.5 : 0.7)) * 0.02;
      // the head on the screen, steady: its gaze drifts slowly over it (a damped follow, nothing of the
      // keystrokes reaches it), now and then a slow glance at the other fighter
      f.gaze ??= { at: null, mid: null, glance: t + 6 + Math.random() * 6, until: 0 };
      const G_ = f.gaze;
      if (t > G_.glance) {
        G_.until = t + 1.6;
        G_.glance = t + 9 + Math.random() * 8;
      }
      const want = t < G_.until && other.present ? other.bot.bones?.Head?.getWorldPosition(new THREE.Vector3()) ?? null : null;
      const scr = f.st.g.localToWorld(new THREE.Vector3(Math.sin(t * 0.37 + (calm ? 1 : 0)) * 0.12, 1.4 + Math.sin(t * 0.23) * 0.04, 0.84));
      const aim = want ?? scr;
      const kk2 = 1 - Math.exp(-dt * 3.2);
      G_.mid = G_.mid ? G_.mid.lerp(aim, kk2) : aim.clone();
      G_.at = G_.at ? G_.at.lerp(G_.mid, kk2) : G_.mid.clone();
      rig.look = G_.at.clone();
      rig.lookW = 0.9;
    } else if (p.reach === 'head' && !walking) reach = 'head';
    else if (p.seat && !walking && f.pose === 'guard') {
      rig.look = f.st.g.localToWorld(new THREE.Vector3(Math.sin(t * 0.7) * 0.15, 1.35, 0.84));
      rig.lookW = 0.8;
    }
    f.tiltW = (f.tiltW ?? 0) + ((p.tilt ?? 0) - (f.tiltW ?? 0)) * Math.min(1, dt * 3); // the head leans over, eased
    rig.tilt = f.tiltW * (side === 'red' ? 1 : -1);

    // on the floor, up on the ropes, or turning over in the air about the middle of its body
    const lift = (f.lift ?? 0) + hopLift;
    const flip = f.flip ?? 0;
    bot.root.rotation.order = 'YXZ';
    bot.root.rotation.set(flip, bot.yaw, 0);
    bot.root.position.set(f.pos.x, lift / STATION, f.pos.y); // (an act in the air put the root where the body's middle should be)
    bot.pose(c, p, t, walking, dt, reach, rig); // on the way to its chair it walks; it sits down once there
  }

  // ---- the loser's ending: it snaps and charges the winner and throws a wild haymaker; the winner ducks
  // under it and lands an uppercut on its jaw; the loser flies back onto its own desk, which breaks under
  // it (the monitor, the keyboard, the computer and the chair go flying), and lies there knocked out. The
  // winner stands over it a moment, turns to its stand with its fists up, and only then goes up the ropes
  // for its backflip.

  // the fight's line, in the loser's station (its units): from the middle of its desk out into the ring,
  // turned a little towards the near stands, clear of the referee beside the winner. The loser swings
  // `at` out along it (its run ends `run` short of there), the winner meets it `gap` further out
  const FIGHT = { skew: 0.21, at: 2.3, run: 0.4, gap: 1.3 };
  const HIT = 0.74; // from the start of the haymaker to the uppercut on the jaw (s)
  const FLY = 0.62; // the flight back onto the desk (s)
  const LAND = 0.22; // the desk giving way under the body (s)
  // how far the desk has given way: it goes on at about the speed the body hit it with, slowing as it buckles
  const landOf = (tc) => {
    const x = Math.min(1, Math.max(0, tc / LAND));
    return 1 - (1 - x) * (1 - x);
  };
  // the broken desk: its front legs buckle, the top tilts down to the front and sinks (the station's units)
  const CRUSH = { tilt: 0.36, drop: 0.55, back: -0.25 };
  const XV = new THREE.Vector3(1, 0, 0);
  const _fq = new THREE.Quaternion();
  const _fq2 = new THREE.Quaternion();
  const _fm = new THREE.Matrix4();
  const _fv = new THREE.Vector3();
  const _fr = new THREE.Vector3();
  const _fp = new THREE.Vector3();
  const _v2 = new THREE.Vector2();

  /** A point on a body's own axes (x to its left, y up from the canvas, z ahead; metres), from where it
   *  stands (`base`, on the canvas) facing world yaw `yawW`. */
  function onBody(base, yawW, x, y, z, out = new THREE.Vector3()) {
    const c = Math.cos(yawW);
    const sn = Math.sin(yawW);
    return out.set(base.x + x * c + z * sn, base.y + y, base.z - x * sn + z * c);
  }
  /** Where a fighter stands (on the canvas, world). */
  const baseOf = (f, out = new THREE.Vector3()) => f.st.g.localToWorld(out.set(f.pos.x, 0, f.pos.y));
  /** Keyframes [time, ...values] read at `t`: a smooth curve through them (it keeps going through a key,
   *  it eases in and out at the first and the last). */
  function keys(K, t) {
    const n = K.length - 1;
    t = Math.min(K[n][0], Math.max(K[0][0], t));
    let i = 0;
    while (i < n - 1 && t > K[i + 1][0]) i++;
    const a = K[i];
    const b = K[i + 1];
    const h = b[0] - a[0];
    const x = (t - a[0]) / h;
    const slope = (k, j) => (k <= 0 || k >= n ? 0 : (K[k + 1][j] - K[k - 1][j]) / (K[k + 1][0] - K[k - 1][0]));
    const x2 = x * x;
    const x3 = x2 * x;
    return a.slice(1).map((v, j) => (2 * x3 - 3 * x2 + 1) * v + (x3 - 2 * x2 + x) * h * slope(i, j + 1) + (-2 * x3 + 3 * x2) * b[j + 1] + (x3 - x2) * h * slope(i + 1, j + 1));
  }
  /** The desk's place in the hall: as it stands, or broken (`k` of the way). */
  function deskMatrix(f, k) {
    const h = f.st.home.desk;
    _fv.copy(h.p).add(_w2.set(0, -CRUSH.drop * k, CRUSH.back * k));
    _fm.compose(_fv, _fq.copy(h.q).multiply(_fq2.setFromAxisAngle(XV, CRUSH.tilt * k)), h.s);
    return _fm.premultiply(f.st.g.matrixWorld);
  }
  function crushDesk(f, k) {
    const o = f.st.parts.desk;
    const h = f.st.home.desk;
    o.position.copy(h.p).add(_fv.set(0, -CRUSH.drop * k, CRUSH.back * k));
    o.quaternion.copy(h.q).multiply(_fq.setFromAxisAngle(XV, CRUSH.tilt * k));
  }
  // how it lies: across the desk from its near front corner, the hips on the front edge, the head towards
  // the far back corner, the legs hanging over the edge (the desk's own units: x across, z to the front)
  const LIE = { hip: [0.3, 0.3], head: [-0.65, -0.76], top: 0.75 };
  /** A point on the desk's top (desk units; `s` mirrors it across), lifted `up` metres, world (`k`: 0 as
   *  it stands, 1 broken). */
  const onDesk = (f, k, s, x, z, up = 0) => _fp.set(s * x, LIE.top, z).applyMatrix4(deskMatrix(f, k)).addScaledVector(UPV, up).clone();
  /** The body's pitch lying on the desk (`k`: 0 as it stands, 1 broken): the head a little up the tilted top. */
  const lieTilt = (k) => -(Math.PI / 2 - 0.1 - 0.18 * k);

  /** The beaten fighter snaps: the fight begins (the page's 'lose'). */
  function startFight(f, side) {
    const wside = side === 'red' ? 'blue' : 'red';
    const s = side === 'red' ? -1 : 1; // the way to the near stands, across the station
    const u = new THREE.Vector2(s * Math.sin(FIGHT.skew), Math.cos(FIGHT.skew));
    const D = new THREE.Vector2(f.st.home.desk.p.x, f.st.home.desk.p.z);
    const along = (k) => D.clone().addScaledVector(u, k);
    const yawL = Math.atan2(u.x, u.y);
    const W = along(FIGHT.at + FIGHT.gap);
    const F = {
      L: f, W: fighters[wside], side, wside, s, u, D, along,
      Lc: along(FIGHT.at - FIGHT.run), Lrun: along(FIGHT.at + 0.3), Lp: along(FIGHT.at),
      WpW: f.st.g.localToWorld(new THREE.Vector3(W.x, 0, W.y)),
      yawL, yawW: yawL + f.st.g.rotation.y, yawLie: Math.atan2(-s * LIE.head[0], -LIE.head[1]),
      phase: 'snap', since: now(), t0: now(), w: { near: false, set: false, free: false },
    };
    state.fight = F;
    if (reduced) {
      // less motion: straight to how it ends, the loser lying on its broken desk, the things that flew
      // already lying where they fell
      F.phase = 'down';
      F.since = now() - 6;
      F.crashAt = now() - 6;
      F.w.free = true;
      crash(F);
      crushDesk(f, 1);
      for (let i = 0; i < 300; i++) flyParts(1 / 60);
    }
  }
  /** Whether the winner waits with its backflip: the beaten one has yet to come at it, or is still at it. */
  function fightHolds(f, other, tt) {
    if (!other.present) return false;
    if (other.pose === 'sad') return tt < 14;
    const F = state.fight;
    return other.pose === 'lose' && !!F && F.W === f && !F.w.free;
  }
  /** The desk gives way: the things on it and round it fly. */
  function crash(F) {
    const f = F.L;
    if (f.wrecked) return;
    launch(f, 'monitor', new THREE.Vector3(F.s * 0.5, 2.7, -2.8), [-5, 2, 1.5]);
    launch(f, 'keyboard', new THREE.Vector3(-F.s * 1.6, 3.0, 0.5), [6, 2, 7]);
    launch(f, 'tower', new THREE.Vector3(1.5, 0.7, -0.3), [0, 1, -5]);
    launch(f, 'chair', new THREE.Vector3(-F.s * 0.4, 1.1, -2.6), [-4, 1.5, 0.5]);
    f.wrecked = true;
  }

  /** The fight's beats, once a frame: when the run starts, the swing, the blow, the crash. */
  function fightTick(t) {
    const F = state.fight;
    if (!F) return;
    if (F.L.pose !== 'lose' || !F.L.present) {
      state.fight = null;
      slowTo = 1;
      return;
    }
    const age = t - F.since;
    const next = (phase) => {
      F.phase = phase;
      F.since = t;
    };
    const W = F.W;
    const L = F.L;
    if (F.phase === 'snap') {
      if (age > 0.95 && W.present && W.pose === 'win' && !W.act && F.w.near) next('charge');
    } else if (F.phase === 'charge') {
      const a0 = _v2.copy(L.pos).sub(F.D).dot(F.u);
      if (F.w.set && age > 0.3 && a0 >= FIGHT.at - FIGHT.run - 0.02) {
        next('swing');
        F.sw = {
          a0, perp: L.pos.clone().sub(F.D).addScaledVector(F.u, -a0), v0: Math.min(L.spd ?? 0, (3 * Math.max(0.05, FIGHT.at - a0)) / 0.42), yaw0: L.bot.yaw ?? F.yawL,
          feet: L.bot.feet.map((x) => x.at.clone()), feetYaw: L.bot.feet.map((x) => x.yaw), wpos: W.pos.clone(), wyaw: W.bot.yaw ?? 0, wfeet: W.bot.feet.map((x) => x.at.clone()), wfeetYaw: W.bot.feet.map((x) => x.yaw),
        };
      }
    } else if (F.phase === 'swing') {
      if (age >= HIT) {
        next('fly');
        F.hitAt = t;
        F.chin = chinOf(L);
        F.by0 = L.fightRig?.body.y ?? 0;
        F.tw0 = L.fightRig?.twist ?? 0; // (the chest turns back from the swing as it flies, not at once)
        F.hip0 = baseOf(L).add(_fv.set(0, hipW(L) + F.by0, 0));
        F.Hi = onDesk(L, 0, F.s, LIE.hip[0], LIE.hip[1], 0.26);
        moment('punch', F.wside);
        state.exc[F.wside] = 1;
        if (!reduced) {
          slowTo = 0.2;
          cam.shake = 0.32;
        }
      }
    } else if (F.phase === 'fly') {
      if (age > FLY * 0.34) slowTo = 1;
      if (age >= FLY) {
        next('crash');
        F.crashAt = t;
        crash(F);
        burst(F.Hi.clone().addScaledVector(UPV, 0.2));
        moment('crash', F.side);
        state.exc[F.wside] = 1;
        if (!reduced) cam.shake = 0.42;
      }
    } else if (F.phase === 'crash') {
      crushDesk(L, landOf(age));
      if (age >= 0.75) next('down');
    }
  }
  /** The point of a fighter's jaw (world). */
  function chinOf(f) {
    const h = f.bot.bones?.Head?.getWorldPosition(new THREE.Vector3()) ?? baseOf(f).setY(FLOOR + 2.5);
    const yawW = (f.bot.yaw ?? 0) + f.st.g.rotation.y;
    return h.add(_fv.set(Math.sin(yawW) * 0.17, 0.02, Math.cos(yawW) * 0.17));
  }
  /** A fighter's rig while the fight leads it, cleared for this frame. */
  function fightRigOf(f) {
    const r = (f.fightRig ??= newRig());
    Object.assign(r, { legs: null, hug: 0, air: false, lean: 0, twist: 0, arms: null, look: null, lookW: 1, wide: 0, feetFwd: 0, toeOut: 0, planted: null, breathRate: null });
    r.body.set(0, 0, 0);
    for (const x of [...r.feet, ...r.hands]) x.w = 0;
    return r;
  }
  /** A foot on the canvas: from `a` (turned `ya`) to `b` (turned `yb`), share `k` of its step (lifted
   *  on the way). */
  function footAt(ft, a, b, k, ya, yb) {
    const e = smooth(k);
    ft.at.lerpVectors(a, b, e).addScaledVector(UPV, Math.sin(Math.PI * Math.min(1, Math.max(0, k))) * 0.13);
    ft.w = 1;
    ft.yaw = turnTo(ya, yb, e);
  }

  /** Leads a fighter's body while the fight is on: what it does this frame, or null. */
  function fightLead(f, side, t) {
    const F = state.fight;
    if (!F || (F.L !== f && F.W !== f)) return null;
    const age = t - F.since;
    if (F.L === f) return loserLead(F, f, age, t);
    if (F.w.free || f.pose !== 'win' || !F.L.present) return null;
    return winnerLead(F, f, age, t);
  }

  function loserLead(F, f, age, t) {
    const W = F.W;
    if (F.phase === 'snap') {
      // the snap: a shudder as the fists clench, the head comes up, the chest out, heaving, staring the
      // winner down
      const clench = smooth(age / 0.25);
      const up = smooth((age - 0.2) / 0.35);
      const shake = Math.sin(t * 38) * 0.035 * clench * (1 - up * 0.6);
      const heave = Math.sin(t * 5.2) * 0.04 * up;
      return {
        hold: true, face: W.present ? yawAt(f, W) : f.bot.yaw, turn: 3, lookAt: W.present ? W : null,
        arms: { w: 1, a0x: lerp(-0.05, -0.7, up) + shake, a0z: -0.3, e0: lerp(-0.7, -2.15, up), a1x: lerp(-0.05, -0.75, up) - shake, a1z: 0.3, e1: lerp(-0.7, -2.1, up) },
        body: { y: -0.06 * clench * (1 - up) + 0.04 * up + heave * 0.5, lean: lerp(0.35, -0.1, up) + heave },
        p: { look: lerp(0.45, -0.05, up) },
      };
    }
    if (F.phase === 'charge') {
      // a dip, and it runs at the winner, the right fist cocked by its ear
      const dip = Math.sin(Math.PI * Math.min(1, age / 0.3));
      const arms = { w: 1, a0x: -0.85, a0z: -0.5, e0: -2.3, a1x: -1.0, a1z: 0.3, e1: -1.9 };
      if (age < 0.22) return { hold: true, face: yawAt(f, W), lookAt: W, arms, body: { y: -0.16 * dip, lean: 0.1 + 0.25 * smooth(age / 0.22) } };
      return { goal: F.w.set ? F.Lrun : F.Lc, speed: 2.7, lookAt: W, arms, body: { y: -0.16 * dip, lean: 0.36 } };
    }
    const r = fightRigOf(f);
    const lead = { hold: true, place: true, rig: r, p: {}, ease: F.phase === 'swing' ? 10 : 6 };
    if (F.phase === 'swing') {
      // the haymaker: the front foot plants, the right fist drawn back with the chest turned away, then
      // round with the whole body, over the ducking winner's head, and on, off balance
      const S = F.sw;
      const x = Math.min(1, age / 0.42);
      const span = FIGHT.at - S.a0;
      const along = (x * x * x - 2 * x * x + x) * S.v0 * 0.42 + (-2 * x * x * x + 3 * x * x) * span;
      f.pos.copy(F.D).addScaledVector(F.u, S.a0 + along).addScaledVector(S.perp, 1 - smooth(x));
      f.bot.yaw = turnTo(S.yaw0, F.yawL, smooth(age / 0.2));
      f.lift = 0;
      f.flip = 0;
      const ankle = (f.bot.ankleY ?? 0.1) * SIZE * STATION;
      const base = baseOf(f);
      const Lp = f.st.g.localToWorld(new THREE.Vector3(F.Lp.x, 0, F.Lp.y));
      footAt(r.feet[0], S.feet[0], onBody(Lp, F.yawW, 0.22, ankle, 0.5), (age - 0.04) / 0.26, S.feetYaw[0], F.yawW + 0.1);
      footAt(r.feet[1], S.feet[1], onBody(Lp, F.yawW, -0.24, ankle, -0.34), (age - 0.48) / 0.22, S.feetYaw[1], F.yawW - 0.25);
      const [tw, ln, by] = keys([[0, -0.1, 0.2, -0.05], [0.2, -0.65, 0.04, -0.02], [0.36, -0.15, 0.26, -0.1], [0.5, 0.65, 0.5, -0.2], [HIT, 0.72, 0.56, -0.26]], age);
      r.twist = tw;
      r.body.set(0, by, 0);
      lead.p.lean = ln;
      // the fists, on its own axes from where it stands
      const R = keys([[0, -0.3, 2.15, 0.3], [0.2, -0.95, 2.3, -0.4], [0.34, -0.95, 2.5, 0.55], [0.43, -0.05, 2.5, 1.2], [0.53, 0.7, 2.3, 0.75], [HIT, 0.6, 2.0, 0.4]], age);
      const [lx, lz, le] = keys([[0, -0.85, 0.3, -1.9], [0.2, -1.25, 0.35, -1.2], [0.45, 0.45, 0.3, -2.0], [HIT, 0.5, 0.35, -1.9]], age);
      Object.assign(lead.p, { a1x: lx, a1z: lz, e1: le });
      onBody(base, F.yawW, R[0], R[1] + by, R[2], r.hands[0].at);
      r.hands[0].w = 1;
      r.hands[0].pole.set(-1, 0.25, -0.35);
      r.look = W.bot.bones?.Head?.getWorldPosition(new THREE.Vector3()) ?? null;
      r.lookW = 0.7;
      return lead;
    }
    // knocked out: flung back off its feet and round in the air, onto the desk; the desk breaks under it,
    // and there it lies
    let hip;
    let th;
    let yaw = F.yawLie;
    if (F.phase === 'fly') {
      const u = Math.min(1, age / FLY);
      const vy = (F.Hi.y - F.hip0.y + 4.9 * FLY * FLY) / FLY;
      const tau = u * FLY;
      hip = _fv.lerpVectors(F.hip0, F.Hi, u).setY(F.hip0.y + vy * tau - 4.9 * tau * tau);
      th = lieTilt(0) * (0.3 * u + 0.7 * smooth(u));
      yaw = turnTo(F.yawL, F.yawLie, smooth((u - 0.15) / 0.8));
      r.body.y = F.by0 * (1 - smooth(u / 0.4));
      r.twist = (F.tw0 ?? 0) * (1 - smooth(u / 0.4));
      r.air = true;
      const k = smooth(u / 0.45);
      r.legs = { hip: -0.55 * k, knee: 0.9 * k, w: smooth(u / 0.2) };
      Object.assign(lead.p, { lean: lerp(0.44, -0.3, smooth(u / 0.3)), look: -0.6 * smooth(u / 0.12), a0x: -2.3, a0z: -1.1, e0: -0.35, a1x: -2.1, a1z: 1.2, e1: -0.45 });
    } else {
      // on the desk: it gives way (crushDesk, on the same clock), the body drops with it and bounces once
      const tc = t - F.crashAt;
      const k = landOf(tc);
      const b = tc > LAND ? Math.max(0, Math.sin(((tc - LAND) / 0.34) * Math.PI)) * 0.08 * (1 - smooth((tc - LAND) / 0.5)) : 0;
      hip = onDesk(f, 0, F.s, ...LIE.hip, 0.26).lerp(onDesk(f, 1, F.s, ...LIE.hip, 0.26), k).addScaledVector(UPV, b);
      th = lerp(lieTilt(0), lieTilt(1), k);
      const flop = smooth(tc / 0.45);
      // limp: the legs over the front edge, out along the canvas, the knees a little bent; the head rolled over to the
      // near side; one hand out on the desk by the head, the other by its side, sliding off the back edge
      // and hanging; a twitch
      r.legs = { hip: lerp(-0.55, -0.18, flop), knee: lerp(0.9, 0.28, flop), left: { hip: lerp(-0.55, -0.08, flop), knee: lerp(0.9, 0.12, flop) }, splay: 0.14 * flop, w: 1 }; // (out in front, low over the canvas: the hips lie only half a metre up)
      const td = F.phase === 'down' ? age : 0;
      const twitch = td > 1.5 && td < 1.85 ? Math.sin(((td - 1.5) / 0.35) * Math.PI) : 0;
      const slide = smooth((td - 2.6) / 1.2);
      // the body's frame on the desk (desk units): its middle line towards the head, its left
      const [hx, hz] = LIE.hip;
      const al = Math.hypot(...LIE.head);
      const ax = (F.s * LIE.head[0]) / al;
      const az = LIE.head[1] / al;
      const lx = -az;
      const lz = ax;
      const sx = F.s * hx + ax * 0.68;
      const sz = hz + az * 0.68;
      const iOff = F.s > 0 ? 1 : 0; // the near side's arm (the robot's left is the desk's +x as it lies)
      const sideOf = (i) => (i ? 1 : -1);
      const on = r.hands[1 - iOff];
      const so = sideOf(1 - iOff);
      on.at.copy(onDesk(f, k, 1, sx + lx * so * 0.6 + ax * 0.2, sz + lz * so * 0.6 + az * 0.2, 0.06 + 0.1 * twitch));
      on.w = flop;
      on.pole.set(so, 0, -0.5);
      const off = r.hands[iOff];
      const sf = sideOf(iOff);
      off.at.copy(onDesk(f, k, 1, sx + lx * sf * 0.5 - ax * 0.25, sz + lz * sf * 0.5 - az * 0.25, 0.06));
      if (slide > 0) {
        // along the top to the edge behind it, over, and down
        const edge = onDesk(f, k, 1, sx + lx * sf * 0.55 + ax * 0.05, -0.4, 0.04);
        off.at.lerp(edge, smooth(slide / 0.5));
        if (slide > 0.5) off.at.lerp(edge.setY(Math.max(FLOOR + 0.2, edge.y - 0.7)).addScaledVector(_fv.copy(edge).sub(hip).setY(0).normalize(), 0.12), smooth((slide - 0.5) / 0.5));
      }
      off.w = flop;
      off.pole.set(sf, 0, -0.5);
      Object.assign(lead.p, {
        lean: lerp(-0.3, 0.06, flop), look: lerp(-0.6, -0.15, flop), shake: -0.6 * F.s * flop, tilt: 0,
        a0x: lerp(-2.3, 0, flop), a0z: lerp(-1.1, -0.9, flop), e0: lerp(-0.35, -0.6, flop),
        a1x: lerp(-2.1, 0, flop), a1z: lerp(1.2, 0.9, flop), e1: lerp(-0.45, -0.6, flop),
      });
      // the visor flickers and goes dark
      const dim = tc < 0.6 ? (Math.sin(tc * 70) > 0 ? 0.35 : 0.1) : 0.08;
      for (const e of f.bot.eyes) e.scale.y = (e.userData.base ?? 1) * dim;
    }
    // the root (at its feet) from where the hips are and how the body is turned over
    f.bot.yaw = yaw;
    const yawW = yaw + f.st.g.rotation.y;
    const Heff = hipW(f) + r.body.y;
    const root = _fr.set(Math.sin(th) * Math.sin(yawW), Math.cos(th), Math.sin(th) * Math.cos(yawW)).multiplyScalar(-Heff).add(hip);
    const o = own(f, root);
    f.pos.set(o.x, o.z);
    f.lift = root.y - FLOOR;
    f.flip = th;
    return lead;
  }

  function winnerLead(F, f, age, t) {
    const L = F.L;
    const faceL = yawAt(f, L);
    if (F.phase === 'snap' || F.phase === 'charge') {
      // it sees the other coming: turns, steps out to meet it, the guard up
      if (t - F.t0 < 0.3) return null;
      const o = own(f, F.WpW);
      const goal = new THREE.Vector2(o.x, o.z);
      const d = f.pos.distanceTo(goal);
      F.w.near = d < 0.8;
      F.w.set = d < 0.08 && Math.abs(turnTo(0, faceL - (f.bot.yaw ?? 0), 1)) < 0.15;
      return { goal, speed: 1.9, face: faceL, guard: true, arms: { w: 1, ...GUARD_ARMS }, lookAt: L, ease: 4 };
    }
    const S = F.sw;
    const hitAge = F.hitAt != null ? t - F.hitAt : -1;
    if (F.phase === 'swing' || (F.hitAt != null && hitAge < 0.6)) {
      // the dodge and the counter, its feet set: down and under the swing, then up through the legs, the
      // hips turning, the right fist driven up into the jaw, and on up after it
      const r = fightRigOf(f);
      const tt = F.phase === 'swing' ? age : HIT + hitAge;
      // set feet, and a step in with the front foot as it comes up
      S.wface ??= faceL;
      const step = smooth((tt - 0.48) / 0.24);
      f.pos.copy(S.wpos).add(_v2.set(Math.sin(S.wface), Math.cos(S.wface)).multiplyScalar(0.25 * step));
      f.bot.yaw = turnTo(S.wyaw, S.wface, smooth(tt / 0.2));
      f.lift = 0;
      f.flip = 0;
      const yw = f.bot.yaw + f.st.g.rotation.y;
      const base = baseOf(f);
      r.feet[1].at.copy(S.wfeet[1]);
      r.feet[1].w = 1;
      r.feet[1].yaw = S.wfeetYaw[1];
      const fwd = _fv.set(Math.sin(yw), 0, Math.cos(yw)).multiplyScalar(0.25 * STATION);
      footAt(r.feet[0], S.wfeet[0], S.wfeet[0].clone().add(fwd), (tt - 0.46) / 0.2, S.wfeetYaw[0], yw - 0.1);
      const [by, bx, ln, tw] = keys([[0, -0.06, 0, 0.08, -0.22], [0.26, -0.06, 0, 0.08, -0.22], [0.42, -0.52, -0.14, 0.26, -0.42], [0.5, -0.54, -0.14, 0.28, -0.5], [HIT, -0.12, 0.04, 0.14, 0.45], [HIT + 0.3, 0.04, 0.02, -0.04, 0.35], [HIT + 0.6, -0.04, 0, 0.06, -0.2]], tt);
      r.body.set(bx, by, 0);
      r.twist = tw;
      const guardAt = (i, out = new THREE.Vector3()) => onBody(base, yw, GUARD[i].x, GUARD[i].y + by, GUARD[i].z, out);
      guardAt(1, r.hands[1].at);
      r.hands[1].w = 1;
      r.hands[1].pole.copy(GUARD_POLE[1]);
      const h = r.hands[0];
      h.w = 1;
      h.pole.set(-0.45, -1, -0.1);
      if (tt < 0.42) {
        guardAt(0, h.at);
        h.pole.copy(GUARD_POLE[0]);
      } else if (tt < HIT) {
        // loaded low by the hip, then up along a curve into the jaw, faster and faster
        const low = onBody(base, yw, -0.3, 1.45 + by * 0.3, 0.22);
        if (tt < 0.5) h.at.lerpVectors(guardAt(0), low, smooth((tt - 0.42) / 0.08));
        else {
          const k = ((tt - 0.5) / (HIT - 0.5)) ** 1.5;
          const mid = onBody(base, yw, -0.22, 1.65, 0.55);
          h.at.copy(low).multiplyScalar((1 - k) * (1 - k)).addScaledVector(mid, 2 * k * (1 - k)).addScaledVector(chinOf(L).addScaledVector(UPV, -0.06), k * k);
        }
      } else {
        // the follow-through, up past where the jaw was, then back to the guard
        const up = onBody(F.chin, yw, 0, 0.45, -0.12);
        h.at.lerpVectors(F.chin, up, easeOut(hitAge / 0.16)).lerp(guardAt(0), smooth((hitAge - 0.3) / 0.3));
      }
      r.look = chinOf(L);
      r.lookW = 0.8;
      return { hold: true, place: true, rig: r, p: { lean: ln, look: 0 } };
    }
    // the knockout landed: guard up, it watches the other go down, walks over and looks down at it, then
    // turns to its own stand with its fists up
    const ct = F.crashAt != null ? t - F.crashAt : -1;
    const over = F.along(2.05);
    const spot = f.st.g.worldToLocal(L.st.g.localToWorld(new THREE.Vector3(over.x, 0, over.y)));
    const goal = ct > 0.5 ? new THREE.Vector2(spot.x, spot.z) : f.pos.clone();
    if (ct < 2.2) return { goal, speed: 1.1, face: faceL, guard: ct < 0.5, lookAt: L, arms: { w: 1, a0x: -0.25, a0z: -0.2, e0: -1.2, a1x: -0.25, a1z: 0.2, e1: -1.2 } };
    const sx = F.wside === 'red' ? -1 : 1;
    const stand = f.st.g.worldToLocal(new THREE.Vector3(sx * 14, FLOOR, 2));
    state.exc[F.wside] = 1;
    if (ct > 4.4) F.w.free = true;
    return { hold: true, face: Math.atan2(stand.x - f.pos.x, stand.z - f.pos.y), turn: 2.6, gesture: 'pump', gestureW: smooth((ct - 2.5) / 0.4) * (1 - smooth((ct - 3.9) / 0.5)), p: { look: -0.25 }, ease: 5 };
  }

  function moveReferee(t, dt) {
    // a serious official: planted, feet a shoulder's width apart, arms down, looking straight ahead,
    // still. It moves only for the verdict: to the winner, the arm up, back to its place.
    const r = referee;
    const tt = t - r.since;
    const p = POSES[r.pose](tt, r.side);
    const c = applyBody(r.bot, p, dt, 4);
    const d = r.target.clone().sub(r.pos);
    const dist = d.length();
    const walking = dist > 0.03;
    // a steady pace: it gathers speed over a stride or two and slows down the same way to stop
    const pace = Math.min(1.05, Math.max(0.12, dist * 1.6));
    r.speed = (r.speed ?? 0) + (pace - (r.speed ?? 0)) * Math.min(1, dt * 2.2);
    if (!walking) r.speed = 0;
    r.pos.add(d.clampLength(0, dt * r.speed));
    if (r.pose === 'refRaise' && r.arrivedAt == null && dist < 0.08) r.arrivedAt = tt;
    if (r.pose !== 'refRaise') r.arrivedAt = null;
    r.bot.root.position.set(r.pos.x, FLOOR, r.pos.y);
    r.rig ??= newRig();
    const rig = r.rig;
    for (const x of [...rig.feet, ...rig.hands]) x.w = 0;
    rig.body.set(0, 0, 0);
    rig.twist = 0;
    rig.look = null;
    rig.lookW = 1;
    rig.breath = 0; // stock-still
    rig.wide = 0.09; // the feet a shoulder's width apart
    rig.toeOut = 0.05;
    rig.planted = walking ? 0.07 : 0.16; // no shuffling on the spot: a step only when it really must
    // where it faces: the way it walks; standing, always straight ahead (to the front of the ring), also
    // beside the winner at the raise: it does not turn with the winner's dance
    let face = 0;
    const raise = raiseOf();
    if (walking && dist > 0.2) face = Math.atan2(d.x, d.y);
    r.bot.yaw = turnTo(r.bot.yaw ?? 0, face, Math.min(1, dt * (walking ? 2.6 : 1.6)));
    r.bot.root.rotation.y = r.bot.yaw;
    // the gaze: straight ahead, level, locked to the body (it never turns its head, not even at the raise)
    const base = r.bot.root.getWorldPosition(new THREE.Vector3());
    const eye = r.bot.bones?.Head?.getWorldPosition(new THREE.Vector3()).y ?? FLOOR + 2.8;
    rig.look = base.set(base.x + Math.sin(r.bot.yaw) * 8, eye, base.z + Math.cos(r.bot.yaw) * 8);
    rig.lookW = 1;
    const q = r.bot.root.getWorldQuaternion(new THREE.Quaternion());
    const me = r.bot.root.getWorldPosition(new THREE.Vector3()).setY(FLOOR);
    // the arms straight down at its sides, the hands by the thighs (the one at the winner's wrist aside)
    const s = r.bot.root.scale.x;
    for (const i of [0, 1]) {
      const o = i ? 1 : -1;
      rig.hands[i].at.set(o * 0.31 * s, 0.86 * s, 0.01 * s).applyQuaternion(q).add(me);
      rig.hands[i].w = 1;
      rig.hands[i].pole.set(o * 0.3, 0, -1);
    }
    // the raise: its near hand on the winner's wrist, up together and held, then it lets go
    if (!raise) r.gripArm = null;
    if (raise && raise.grip + raise.off > 0.001 && state.winner) {
      const w = fighters[state.winner];
      const wi = w.raiseArm ?? 1;
      const wrist = w.bot.bones?.[wi ? 'LeftHand' : 'RightHand']?.getWorldPosition(new THREE.Vector3());
      if (wrist && raise.grip > 0.001) {
        const leftW = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
        const i = leftW.dot(wrist.clone().sub(me)) > 0 ? 1 : 0;
        rig.hands[i].at.lerp(wrist.addScaledVector(UPV, -0.05), raise.grip);
        r.gripArm = i;
      }
      // the elbow out to the side and back from the grip on until the arm hangs straight again (set and
      // dropped only while it hangs, where the elbow's way makes no difference), turning over smoothly as
      // the arm goes up; back enough that the arm never points along it on its way up or down (where the
      // elbow would flip over)
      if (r.gripArm != null) rig.hands[r.gripArm].pole.set(r.gripArm ? 0.6 : -0.6, lerp(-1, -0.3, smooth(raise.up)), -0.8);
    }
    rig.ground = FLOOR;
    r.bot.pose(c, p, t, walking, dt, null, rig);
  }

  // a slow device: once the hall has settled, if it cannot keep about 40 frames a second, the heavy
  // parts go (the floor's mirror) and it draws at a lower resolution
  let speedN = 0;
  let speedT = 0;
  let lightened = small;
  function watchSpeed(dt) {
    if (lightened || ++speedN < 90) return;
    speedT += dt;
    if (speedN < 90 + 120) return;
    lightened = true;
    if (speedT / 120 > 1 / 40) {
      room.lighten();
      renderer.setPixelRatio(Math.min(pixelRatio, 1));
      resize();
    }
  }

  const v3 = new THREE.Vector3();
  let last = performance.now() / 1000;
  // a page that drives the clock itself (frame-by-frame checks: window.ARENA_MANUAL) steps it with debug.step
  const manual = !!window.ARENA_MANUAL;
  let drawNow = true;
  let realT = 0;
  function frame() {
    const real = performance.now() / 1000;
    tick(Math.min(0.05, real - last));
    last = real;
    if (!manual) requestAnimationFrame(frame);
  }
  function tick(realDt) {
    realT += realDt;
    const real = realT;
    [slow, slowV] = springTo(slow, slowV, slowTo, 9, realDt); // (into and out of slow motion eased: no snap of the clock or the lens)
    slow = Math.min(1, Math.max(0.05, slow));
    const dt = realDt * slow;
    clock += dt;
    const t = clock;
    for (const side of ['red', 'blue']) state.exc[side] += (0.32 - state.exc[side]) * Math.min(1, dt * 0.35);

    // the hall: the fans with their side's mood, the crowd and its phones, the LED panels. How the hall
    // roars: on its feet for the winner, up and loud while the fighters work it, seated and tense in a round
    const hype = ['red', 'blue'].some((s) => fighters[s].present && fighters[s].pose === 'hype');
    const roar = state.lights === 'winner' ? 1 : hype ? 0.7 : state.lights === 'focus' ? 0.2 : 0.3;
    room.update(t, dt, state.exc, roar, reduced, state.winner);
    grade.uniforms.time.value = t;
    watchSpeed(realDt);

    // robots, the referee, flying furniture, sparks
    loads.length = 0;
    if (xg) fightTick(t);
    for (const side of ['red', 'blue']) {
      const f = fighters[side];
      if (!f.present) continue;
      if (xg) moveFighter(f, side, t, dt);
      if (f.screen === 'code') f.st.screens.code.offset.y = (t * 0.35) % 1;
    }
    if (xg) moveReferee(t, dt);
    // the ropes dip where they carry a climbing fighter (the four heaviest loads)
    loads.sort((x, y) => y.amount - x.amount);
    for (let i = 0; i < 4; i++) {
      const L = loads[i];
      if (!L) {
        ROPE_LOAD.at.value[i].set(0, 0, 0, 0);
        continue;
      }
      const at = ropeAt(L.k, L.s, L.rope, v3);
      ROPE_LOAD.at.value[i].set(at.x, FLOOR + ROPES[L.rope], at.z, reduced ? 0 : L.amount);
      ROPE_LOAD.side.value[i].set(L.k.post.x, L.k.post.z, ROPE0, SIDE_LEN - ROPE0);
    }
    flyParts(dt);
    for (let i = 0; i < sparkN; i++) {
      if (sparkLife[i] <= 0) {
        sparkPos[i * 3 + 1] = -50;
        continue;
      }
      sparkLife[i] -= dt;
      sparkVel[i * 3 + 1] -= 9.8 * dt;
      for (let k = 0; k < 3; k++) sparkPos[i * 3 + k] += sparkVel[i * 3 + k] * dt;
    }
    sparkGeo.attributes.position.needsUpdate = true;

    // beams
    sweep.forEach((b, i) => {
      if (b.kind === 'white') b.to.set(Math.sin(t * (0.22 + i * 0.05) + i * 1.7) * 3.4, FLOOR, Math.cos(t * (0.18 + i * 0.04) + i) * 2.6);
      else {
        // the corner's own half of the ring, slowly
        const s = b.kind === 'red' ? -1 : 1;
        b.to.set(s * (2.7 + Math.sin(t * 0.16 + i) * 1.4), FLOOR, Math.cos(t * 0.13 + i * 2.1) * 2.4);
      }
      aimBeam(b, b.from, b.to);
      b.m.visible = b.pool.visible = state.lights === 'sweep';
    });
    for (const side of ['red', 'blue']) {
      const f = fighters[side];
      f.bot.root.getWorldPosition(v3);
      focus[side].to.copy(v3);
      aimBeam(focus[side], focus[side].from, focus[side].to);
      focus[side].m.visible = state.lights === 'focus' && f.present;
      focus[side].m.material.uniforms.opacity.value = 0.07 + state.exc[side] * 0.04;
      spots[side].target.position.copy(v3);
    }
    if (state.winner) {
      fighters[state.winner].bot.root.getWorldPosition(v3);
      crown.to.copy(v3);
      crown.from.set(v3.x * 0.4, 13, 3);
      aimBeam(crown, crown.from, crown.to);
      winSpot.target.position.copy(v3);
    }
    crown.m.visible = state.lights === 'winner';
    // a lamp that throws a beam burns bright, the others glow
    for (const b of beams) b.head.k = b.m.visible ? 5 : 3;
    room.placeHeads();
    winSpot.intensity = state.lights === 'winner' ? 0.9 : 0;
    haze.update(t);
    pyro.update(t, dt);
    screens.update();

    // the camera: the whole ring, both corners, the referee and the scoreboard cube. The wide shot is
    // from high over the near stand on a long lens (the ring large, the hall's lines calm), the lens
    // shifted so the ring sits a little low with the scoreboard and the truss over it; between rounds
    // it now and then circles the whole hall once, in a round it cranes slowly down onto the ring, at
    // the end it leans towards the winner. Every shot moves a little (a slow push in, a drift that
    // shows the depth of the hall); the close ones breathe like a camera on a shoulder; a robot on the
    // ropes is shot from the floor below it, the backflip from the side, following the body's middle
    const portrait = camera.aspect < 0.8;
    const still = reduced; // those who ask for less motion: no drift, no shake, no hand
    const wide = { ...(portrait ? WIDE_TALL : WIDE) };
    if (!portrait) wide.fov = Math.min(62, Math.max(wide.fov, (Math.atan(WIDE_TAN / camera.aspect) * 360) / Math.PI)); // keep its width on a narrower screen
    if (state.lights === 'winner' && state.winner) {
      fighters[state.winner].bot.root.getWorldPosition(v3);
      wide.x = v3.x * 0.3;
      wide.d *= 0.93;
    }
    if (state.lights !== cam.mode) {
      cam.mode = state.lights;
      cam.modeAt = t;
      if (state.lights === 'winner') {
        cam.at = t;
        cam.shot = 'wide';
      }
      if (state.lights === 'focus' && cam.shot === 'wide') cam.at = t - 10.5; // a round opens on the wide shot a moment (see below)
    }
    // a fighter on the ropes, or the winner's backflip, takes the picture (not when a shot is held)
    const actor = !cam.fixed && !still ? ['red', 'blue'].map((s) => fighters[s]).find((f) => f.present && f.act && ((f.act.kind === 'climb' && f.act.phase !== 'go') || (f.act.kind === 'win' && f.act.phase !== 'go'))) : null;
    const actorSide = actor ? (actor === fighters.red ? 'red' : 'blue') : null;
    const airborne = actor && ['crouch', 'push', 'air', 'land'].includes(actor.act.phase);
    // the fight at the end: a tight two-shot from the side of its line (in close as the blow lands in slow
    // motion), the fall onto the desk from in front of it, then the wide shot again
    const F = state.fight;
    let fightShot = null;
    if (F && !still && !cam.fixed) {
      if (['snap', 'charge', 'swing'].includes(F.phase) || (F.phase === 'fly' && t - F.since < FLY * 0.36)) fightShot = 'fight';
      else if (F.crashAt == null || t - F.crashAt < 2.2) fightShot = 'fall';
      else if (!F.camDone) {
        F.camDone = true;
        cam.shot = 'wide';
        cam.at = t;
      }
    }
    let shot = cam.shot;
    if (actor) shot = airborne ? 'flip' : 'hero';
    else if (cam.fixed) shot = cam.fixed;
    else if (fightShot) shot = fightShot;
    else if (state.lights === 'focus' && !still) {
      // like a broadcast: while a round runs, cut between the wide shot and a shot over each robot's shoulder
      // (never cutting from the wide shot to a close-up while a fighter still walks to its desk: it would
      // walk right through the picture)
      const walking = ['red', 'blue'].some((s) => fighters[s].present && (fighters[s].spd ?? 0) > 0.15);
      if (t - cam.at > (cam.shot === 'wide' ? 12 : 3.5) && !(cam.shot === 'wide' && walking)) {
        cam.step = (cam.step + 1) % SHOTS.length;
        cam.shot = SHOTS[cam.step];
        if (cam.shot !== 'wide' && !fighters[cam.shot].present) cam.shot = 'wide';
        cam.at = t;
        cam.cut = true;
      }
      shot = cam.shot;
    } else if (state.lights === 'winner' && state.winner && !still) {
      // at the end: the referee raises the winner's arm (a slow push in on the two), then now and then
      // the winner up close
      const w = fighters[state.winner];
      const going = w.act?.kind === 'win' && w.act.phase === 'go';
      if (going) {
        if (cam.shot !== 'wide') {
          cam.shot = 'wide';
          cam.at = t;
          cam.cut = true;
        }
      } else if (t - cam.at > (cam.shot === 'wide' ? (t - cam.modeAt < 3 ? 1.1 : 6) : t - cam.modeAt < 6 ? 99 : 4.2)) {
        cam.shot = cam.shot === 'wide' ? 'winClose' : 'wide';
        cam.at = t;
        cam.cut = true;
      }
      shot = cam.shot;
    } else {
      if (cam.shot !== 'wide') cam.cut = true;
      cam.shot = shot = 'wide';
    }
    if (shot !== cam.was) {
      // a cut: the new shot starts where it starts, its move from there
      cam.was = shot;
      cam.cut = true;
      cam.shotAt = t;
    }
    const since = t - (cam.shotAt ?? t);
    let close = 0; // how much the camera breathes like one held on a shoulder
    let beamsOn = true;
    // the lens: its field of view and its shift (a share of half the picture's height; content moves up)
    const lensFov = (f, shift = 0) => {
      if (camera.fov !== f || cam.shift !== shift || cam.lensAspect !== camera.aspect) {
        camera.fov = f;
        camera.updateProjectionMatrix();
        camera.projectionMatrix.elements[9] = -shift;
        camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        cam.shift = shift;
        cam.lensAspect = camera.aspect;
      }
    };
    const push = (sec) => (still ? 1 : ease(Math.min(1, since / sec))); // a slow move over the shot
    if (shot === 'hero') {
      // from the floor in front of the corner, looking up at the robot on the ropes
      const k = actor.corner ?? cornerOf(actor, actorSide);
      const u = push(5);
      camAt.copy(k.standW).addScaledVector(k.out, 2.75 - 0.4 * u).addScaledVector(k.a, 2.15 - 0.35 * u).setY(0.66 + 0.12 * u);
      actor.bot.bones?.Spine2?.getWorldPosition(camLook) ?? actor.bot.root.getWorldPosition(camLook).add(camUp.set(0, 2.2, 0));
      camLook.y -= 0.35;
      if (cam.cut) cam.look.copy(camLook);
      cam.look.lerp(camLook, Math.min(1, dt * 5));
      lensFov(portrait ? 66 : 46);
      camera.position.copy(camAt);
      camera.lookAt(cam.look);
      close = 0.6;
    } else if (shot === 'flip') {
      // the backflip from the side: the body's middle followed with a little lead, the slow part tight,
      // a jolt as it lands
      const k = actor.corner;
      const C = actor.flipC ?? actor.bot.root.getWorldPosition(camLook).add(camUp.set(0, 1.6, 0));
      const lead = camFront.copy(actor.flipV ?? camFront.set(0, 0, 0)).multiplyScalar(0.12);
      camLook.copy(C).add(lead);
      const mid = camAt.copy(k.standW).addScaledVector(k.out, -1.05);
      const tight = 1 - slow; // the slow motion: in closer
      camAt.copy(mid).addScaledVector(k.a, 5.2 - 1.1 * tight).addScaledVector(k.out, 0.9).setY(FLOOR + 1.9);
      camAt.addScaledVector(camFront.subVectors(C, mid).setY(0), 0.25); // riding along a little
      camAt.y += (C.y - FLOOR - 2.2) * 0.3;
      if (cam.cut) cam.look.copy(camLook);
      cam.look.lerp(camLook, Math.min(1, realDt * 9));
      lensFov((portrait ? 64 : 42) - 9 * tight);
      camera.position.copy(camAt);
      camera.lookAt(cam.look);
      close = 0.4;
      beamsOn = false;
    } else if (shot === 'fight') {
      // the two side by side, from the near side of the line between them (the referee beyond them);
      // once the swing starts, framed on the spots where they fight
      const A = F.sw ? F.L.st.g.localToWorld(_ca.set(F.Lp.x, 0, F.Lp.y)) : F.L.bot.root.getWorldPosition(_ca).setY(FLOOR);
      const B = F.sw ? _cb.copy(F.WpW) : F.W.bot.root.getWorldPosition(_cb).setY(FLOOR);
      const ax = camFront.subVectors(B, A).setY(0);
      const sep = ax.length();
      ax.normalize();
      const n = camUp.set(-ax.z, 0, ax.x);
      if (n.z < 0) n.negate();
      const tight = 1 - slow;
      const mid = A.add(B).multiplyScalar(0.5);
      camAt.copy(mid).addScaledVector(n, Math.max(4.6, 2.8 + sep) * (1 - 0.14 * tight)).setY(FLOOR + 1.85 - 0.15 * tight);
      camLook.copy(mid).setY(FLOOR + 1.9);
      if (cam.cut) {
        cam.fp.copy(camAt);
        cam.look.copy(camLook);
      }
      cam.fp.lerp(camAt, Math.min(1, realDt * 3));
      cam.look.lerp(camLook, Math.min(1, realDt * 3));
      lensFov((portrait ? 62 : 42) - 4 * tight);
      camera.position.copy(cam.fp);
      camera.lookAt(cam.look);
      close = 0.6;
      beamsOn = false;
    } else if (shot === 'fall') {
      // the loser's desk from in front, a little to the near side: the body comes down onto it
      const g = F.L.st.g;
      const u = push(4);
      g.localToWorld(camAt.set(F.s * (3.6 - 0.25 * u), 2.6 - 0.1 * u, 2.0));
      g.localToWorld(camLook.set(F.s * 0.2, 0.6, 0.45));
      lensFov(portrait ? 58 : 36);
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      close = 0.5;
      beamsOn = false;
    } else if (shot === 'winClose' && state.winner) {
      // the winner (and the referee raising its arm), from in front, a slow push in
      const f = fighters[state.winner];
      f.bot.root.getWorldPosition(v3);
      // from the near stand's side, turned a little to the winner's own corner (the loser out of the
      // picture, the referee beside the winner)
      const turn = (f.winAt ? 0.24 : -0.32) * (state.winner === 'red' ? 1 : -1); // after its flip: from the middle of the near side, clear of the posts
      camFront.set(Math.sin(turn), 0, Math.cos(turn));
      referee.bot.root.getWorldPosition(camLook);
      const withRef = referee.pose === 'refRaise' && camLook.distanceTo(v3) < 2.2 ? 0.35 : 0;
      const u = push(t - cam.modeAt < 6 ? 6 : 4.2);
      const refAt = camLook.clone();
      camLook.lerp(v3, 1 - withRef).add(camUp.set(0, (1.75 + 0.35 * withRef) * SIZE * STATION * 0.82, 0));
      // (after the flip it stands near the ropes: the camera, outside them, a little higher, so the near top
      // rope passes under the picture instead of across the winner's legs)
      const over = f.winAt ? 0.42 : 0;
      camAt.copy(v3).addScaledVector(camFront, (3.7 - 0.85 * u) * SIZE * STATION).add(camUp.set(0.35, (1.35 + 0.1 * (1 - u) + over) * SIZE * STATION, 0));
      camAt.x += (refAt.x - v3.x) * 0.4 * withRef;
      camAt.z += (refAt.z - v3.z) * 0.4 * withRef;
      if (cam.cut) cam.look.copy(camLook);
      cam.look.lerp(camLook, Math.min(1, dt * 4));
      lensFov(portrait ? 58 : 40);
      camera.position.copy(camAt);
      camera.lookAt(cam.look);
      close = 0.7;
      beamsOn = false;
    } else if (shot === 'peek' && cam.peek) {
      // any point of view (for checks of the hall)
      camera.position.fromArray(cam.peek[0]);
      camera.lookAt(camLook.fromArray(cam.peek[1]));
      lensFov(42);
    } else if (shot === 'faceRed' || shot === 'faceBlue') {
      // face to face: from in front of the desk, the robot over its monitor (for videos and previews)
      const g = fighters[shot === 'faceRed' ? 'red' : 'blue'].st.g;
      const drift = still ? 0 : Math.sin(t * 0.21) * 0.12;
      g.localToWorld(camAt.set(0.2 + drift, 2.15, 2.2 - 0.12 * push(8)).multiplyScalar(SIZE));
      g.localToWorld(camLook.set(drift * 0.4, 1.5 * SIZE, 0));
      lensFov(portrait ? 58 : 44);
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      close = 0.5;
    } else if (shot === 'red' || shot === 'blue') {
      // over the robot's shoulder, from the outer side of the ring (away from the referee), pushing in
      const g = fighters[shot].st.g;
      const k = push(3.5);
      const out = shot === 'red' ? -1 : 1;
      const drift = still ? 0 : Math.sin(t * 0.33) * 0.1;
      g.localToWorld(camAt.set(2.3 * out + drift, 3.35 - k * 0.18, -2.75 + k * 0.38));
      g.localToWorld(camLook.set(-0.3 * out, 1.15, 0.5));
      lensFov(portrait ? 58 : 44);
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      close = 0.8;
      beamsOn = false; // no haze of the roof lights right in front of the lens
    } else {
      let want = wide;
      if (shot === 'orbit') {
        // round and round the hall (for videos and previews; still for those who ask for less motion)
        want = { ...(portrait ? ORBIT_TALL : ORBIT), az: still ? 0.7 : ((t - cam.at) / ORBIT_T) * Math.PI * 2 };
      } else if (state.lights === 'sweep' && !cam.fixed && !still) {
        // between rounds: the wide shot a while, then once round the whole hall, easing out and back in
        const u = ((t - cam.modeAt) % (ORBIT_T + 14) - 14) / ORBIT_T;
        if (u > 0) want = mixView(wide, portrait ? ORBIT_TALL : ORBIT, ease(Math.min(1, u / 0.12)) * ease(Math.min(1, (1 - u) / 0.12)), (1 - Math.cos(u * Math.PI)) * Math.PI);
      } else if (state.lights === 'focus' && !still) {
        // in a round: from a little higher and further, slowly down and in
        const k = 1 - ease(Math.min(1, (t - cam.at) / 12));
        want = { ...wide, h: wide.h + 1.2 * k, d: wide.d + 1.6 * k, pitch: wide.pitch + 0.035 * k };
      }
      if (!still && !cam.fixed && state.lights !== 'sweep') want.az = Math.sin(t * 0.08) * (portrait ? 0.2 : 0.1); // a slow broadcast drift
      if (!still && shot !== 'orbit') {
        // a slow push in over a long hold, and a sideways drift (the near rows slide past the far)
        want = { ...want, d: want.d * (1 - 0.03 * ease(Math.min(1, since / 14))), x: (want.x ?? 0) + Math.sin(t * 0.045) * 0.45, h: want.h + Math.sin(t * 0.06 + 1) * 0.1 };
      }
      if (cam.cut) Object.assign(cam.view, want);
      const k = Math.min(1, dt * 1.5);
      for (const key of ['d', 'h', 'pitch', 'fov', 'shift', 'x']) cam.view[key] += (want[key] - cam.view[key]) * k;
      cam.view.az += Math.atan2(Math.sin(want.az - cam.view.az), Math.cos(want.az - cam.view.az)) * Math.min(1, dt * 3);
      const { az, d, h, pitch, x } = cam.view;
      lensFov(cam.view.fov, cam.view.shift);
      camera.position.set(x + Math.sin(az) * d, h, Math.cos(az) * d);
      camLook.set(-Math.sin(az) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)).add(camera.position);
      camera.lookAt(camLook);
    }
    cam.cut = false;
    if (!still) {
      // a camera on a shoulder (close shots only): a slow, uneven sway of a fraction of a degree
      if (close > 0) {
        const s = close * 0.0042;
        camera.rotateY((Math.sin(t * 0.83) + 0.6 * Math.sin(t * 1.91 + 1.3) + 0.3 * Math.sin(t * 3.7 + 0.4)) * s);
        camera.rotateX((Math.sin(t * 0.71 + 2) + 0.5 * Math.sin(t * 2.3 + 0.7) + 0.3 * Math.sin(t * 4.1)) * s * 0.8);
        camera.rotateZ(Math.sin(t * 0.5 + 0.9) * s * 0.35);
      }
      // a jolt (a landing, a bump), dying away
      if (cam.shake > 0) {
        const j = cam.shake;
        camera.position.x += Math.sin(real * 47) * j * 0.12;
        camera.position.y += Math.sin(real * 61 + 1) * j * 0.16;
        camera.rotateZ(Math.sin(real * 39 + 2) * j * 0.02);
        cam.shake = Math.max(0, cam.shake - realDt * 0.9);
      }
    } else cam.shake = 0;
    if (!beamsOn) for (const b of beams) b.m.visible = false;
    draw(dt);
  }
  if (!manual) requestAnimationFrame(frame);
  else tick(1 / 60);
  document.fonts?.ready.then(() => {
    redraw(board, () => {});
  });

  // ------------------------------------------------------------------ what the page can ask

  return {
    kind: '3d',
    setFighters({ red = true, blue }) {
      for (const [side, on] of [['red', !!red], ['blue', !!blue]]) {
        const f = fighters[side];
        if (on && !f.present) {
          // back after a while away (the next fight): it starts afresh where its next pose puts it, on its
          // feet, its desk whole (not getting up from where it lay at the end of the last fight)
          if (f.wrecked) resetStation(f);
          Object.assign(f, { placed: false, pose: null, act: null, lift: 0, flip: 0, path: [], spd: 0, gesture: null, showUntil: 0, lapI: null, hopW: 0, guardW: 0, tiltW: 0, keys: null, gaze: null });
        }
        f.present = on;
        f.st.g.visible = on;
      }
    },
    setPose(side, pose) {
      const f = fighters[side];
      if (!f) return;
      if (f.pose === pose) {
        f.placed = true; // already in it (a robot starts out working the crowd): from here on it walks
        return;
      }
      if (f.wrecked && pose !== 'lose') resetStation(f);
      f.pose = pose;
      f.since = now();
      f.flipped = false;
      f.winAt = null;
      if (!f.placed) {
        // the first thing the page says: the robot is already where it should be (a viewer may join mid-round)
        f.placed = true;
        f.pos.fromArray(POSES[pose](0).spot);
        f.path = [];
        f.bot.place?.(!!POSES[pose](0).seat);
        f.bot.cur = {};
        f.bot.curV = {};
      }
      const screen = pose === 'done' || pose === 'win' ? 'sent' : pose === 'fail' ? 'time' : 'code';
      f.screen = screen;
      if (!f.wrecked) {
        f.st.face.map = f.st.screens[screen];
        f.st.face.color.setHex(screen === 'code' ? 0xc8d4ff : 0xffffff);
      }
      const eyeScale = pose === 'fail' || pose === 'lose' ? 0.35 : pose === 'done' || pose === 'win' ? 1.6 : 1;
      f.bot.eyes.forEach((e) => {
        const b = e.userData.base ?? 1; // an armoured robot's eyes sit on its head bone, in that bone's units
        e.scale.set(b, b * eyeScale, b);
      });
      if (pose === 'lose' && xg) startFight(f, side); // it snaps: the fight
    },
    poseOf: (side) => fighters[side]?.pose,
    /** Calls fn(name, side) at 'ropes' (up on the ropes), 'taunt', 'flip' (the winner leaves the top rope), 'land',
     *  'punch' (the winner's uppercut lands on the loser's jaw) and 'crash' (the loser breaks its desk). */
    onMoment(fn) {
      onMoment = fn;
    },
    /** Where a fighter stands and which way it faces, in the hall's own coordinates (for checks and camera work). */
    where(side) {
      const f = fighters[side];
      const at = f.bot.root.getWorldPosition(new THREE.Vector3());
      const facing = f.bot.root.getWorldDirection(new THREE.Vector3());
      return { x: at.x, y: at.y, z: at.z, fx: facing.x, fz: facing.z, pose: f.pose, gesture: f.gesture ?? null, act: f.act ? `${f.act.kind}${f.act.phase ? ':' + f.act.phase : ''}` : state.fight && (state.fight.L === f || state.fight.W === f) ? `fight:${state.fight.phase}` : null, lift: f.lift ?? 0, flip: f.flip ?? 0, slow };
    },
    excite(side, amount) {
      for (const s of side ? [side] : ['red', 'blue']) state.exc[s] = Math.min(1, Math.max(state.exc[s], amount));
    },
    /** 'round': a burst from every corner post; 'win': fountains, flames and confetti for the winner. */
    pyro(kind, side = null) {
      if (reduced) return;
      pyro.fire(kind, kind === 'win' && side ? sidePosts[side] : postTops, now());
    },
    setLights(mode, winner = null) {
      if (state.lights === mode && state.winner === winner) return;
      if (state.lights === 'winner' && mode !== 'winner') pyro.sweep();
      state.lights = mode;
      state.winner = winner;
      if (mode === 'winner' && winner) {
        // beside the winner's spot in front of its desk, on the side towards the centre
        const spot = fighters[winner].st.g.localToWorld(new THREE.Vector3(0, 0, 1.5));
        referee.target.set(spot.x + (winner === 'red' ? 1.08 : -1.08), spot.z - 0.12);
        referee.pose = 'refRaise';
        referee.side = winner;
        referee.since = now();
      } else if (referee.pose === 'refRaise') {
        referee.target.set(0, -0.35);
        referee.pose = 'ref';
        referee.since = now();
      }
    },
    /** The referee signals the start of a round. */
    signal() {
      if (referee.pose === 'refRaise') return;
      referee.pose = 'refStart';
      referee.since = now();
      setTimeout(() => {
        if (referee.pose === 'refStart') {
          referee.pose = 'ref';
          referee.since = now();
        }
      }, 1300);
    },
    setTicker() {}, // the boards show the arena's name; the round is on the scoreboard
    /** The scoreboard cube over the ring: up to three lines. */
    setBoard(lines) {
      const key = lines.join('|');
      if (board.userData.key === key) return;
      board.userData.key = key;
      redraw(board, (g) => (g.__lines = lines));
    },
    bump() {
      cam.shake = 0.35;
    },
    /** Hold one camera shot ('wide', 'orbit' (round the hall), 'red', 'blue', 'faceRed', 'faceBlue', or 'peek' from `at` towards `look`), or null to let the cuts run (for videos and previews). */
    holdShot(shot, at = null, look = null) {
      cam.fixed = shot;
      cam.peek = at && look ? [at, look] : null;
      cam.at = now();
    },
    /** For checks: the scene's insides, and a clock that steps by hand (with window.ARENA_MANUAL). */
    debug: {
      THREE,
      fighters,
      referee,
      camera,
      cam,
      now,
      /** Starts an act now: 'climb' (with a gesture up there), 'taunt' (the other answers), or 'win'. */
      act(side, kind, gesture = null) {
        const f = fighters[side];
        const o = fighters[side === 'red' ? 'blue' : 'red'];
        if (kind === 'taunt') {
          f.act = { kind, since: now(), len: 2.4, gesture: gesture ?? 'beckon' };
          o.act = { kind: 'answer', from: now() + 0.7, since: now(), len: 1.9, gesture: LAPS[side === 'red' ? 'blue' : 'red'].answers[0] };
        } else f.act = { kind, phase: 'go', since: now(), gesture: gesture ?? 'pump' };
        if (kind === 'win') f.flipped = true;
      },
      /** Runs `sec` of the scene's clock in steps of `dt` (real seconds; slow motion stretches them), drawing the last. */
      step(sec, dt = 1 / 60) {
        const n = Math.max(1, Math.round(sec / dt));
        for (let i = 0; i < n; i++) {
          drawNow = i === n - 1;
          tick(dt);
        }
        drawNow = true;
        return clock;
      },
    },
  };
}

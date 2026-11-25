// The arena in 3D: a hexagon ring under the lights, packed stands all around, a scoreboard cube
// over the ring, and two robot fighters at their own gaming desks. They do not fight each other:
// before the bell they walk out and work the crowd; at the bell they sit down and type; whoever
// answers jumps up with both arms raised, whoever runs out of time holds its head. At the end the
// referee robot raises the winner's arm, the winner dances, and the loser smashes its monitor,
// throws its keyboard, flips its desk and hurls its chair, then sits on the floor.
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
import { buildRoom, loadHallAssets, hallEnvironment, volumeMaterial, softSpot, GradeShader, TRUSS, emblemPlate } from './room.js';
import { loadXbot, makeXRobot } from './xbot.js';

const COLOR = { red: 0xef4444, blue: 0x22c55e, ref: 0xe6ebf5, gold: 0xf5b301 };
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

const stripeTex = () => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f4f6fb';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111318';
  g.fillRect(0, 0, w / 2, h);
}, { repeat: [5, 1] });

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
    visor: std({ color: 0x04060b, metalness: 1, roughness: 0.06 }),
    gold: std({ color: 0xf5b301, metalness: 0.85, roughness: 0.28, emissive: 0x2a1c00 }),
    desk: std({ color: 0x1b1d22, metalness: 0.85, roughness: 0.32 }),
    stripes: std({ map: stripeTex(), roughness: 0.6 }),
    accent: (c) => std({ color: c, metalness: 0.35, roughness: 0.32 }),
    glow,
  };
}
const capsule = (r, l) => new THREE.CapsuleGeometry(r, l, 4, 12);
const sphere = (r) => new THREE.SphereGeometry(r, 18, 14);
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

// ------------------------------------------------------------------ a robot

function buildRobot(kind, M) {
  const ref = kind === 'ref';
  const acc = M.accent(COLOR[kind]);
  const glow = M.glow(ref ? COLOR.gold : COLOR[kind]);
  const root = new THREE.Group();
  const hips = new THREE.Group();
  hips.position.y = 0.95;
  root.add(hips);
  const legs = [-1, 1].map((s) => {
    const hip = new THREE.Group();
    hip.position.set(0.17 * s, 0, 0);
    hips.add(hip);
    mesh(capsule(0.12, 0.3), M.metal, [0, -0.24, 0], hip);
    const knee = new THREE.Group();
    knee.position.y = -0.47;
    hip.add(knee);
    mesh(sphere(0.115), M.dark, [0, 0, 0], knee);
    mesh(capsule(0.105, 0.28), M.metal, [0, -0.22, 0], knee);
    mesh(rbox(0.24, 0.1, 0.36), ref ? M.black : M.dark, [0, -0.44, 0.07], knee);
    return { hip, knee };
  });
  mesh(cyl(0.33, 0.36, 0.28), ref ? M.black : acc, [0, 0.02, 0], hips);
  const belt = mesh(new THREE.TorusGeometry(0.345, 0.045, 8, 28), M.gold, [0, 0.16, 0], hips);
  belt.rotation.x = Math.PI / 2;
  const torso = new THREE.Group();
  torso.position.y = 0.18;
  hips.add(torso);
  mesh(rbox(0.84, 0.7, 0.48, 0.12), ref ? M.stripes : M.metal, [0, 0.42, 0], torso);
  if (!ref) mesh(rbox(0.52, 0.3, 0.06, 0.03), acc, [0, 0.5, 0.235], torso);
  const core = mesh(cyl(0.1, 0.1, 0.04, 6), glow, [0, 0.5, 0.275], torso);
  core.rotation.x = Math.PI / 2;
  if (ref) {
    for (const s of [-1, 1]) {
      const tie = mesh(new THREE.ConeGeometry(0.06, 0.12, 4), M.black, [0.06 * s, 0.76, 0.25], torso);
      tie.rotation.z = (Math.PI / 2) * s;
    }
  }
  for (const s of [-1, 1]) mesh(sphere(0.16), ref ? M.black : acc, [0.5 * s, 0.7, 0], torso);
  mesh(cyl(0.09, 0.11, 0.14), M.dark, [0, 0.83, 0], torso);
  const head = new THREE.Group();
  head.position.y = 0.9;
  torso.add(head);
  mesh(rbox(0.6, 0.44, 0.5, 0.15), M.metal, [0, 0.22, 0], head);
  mesh(rbox(0.48, 0.22, 0.05, 0.05), M.visor, [0, 0.22, 0.245], head);
  const eyes = [-1, 1].map((s) => mesh(new THREE.BoxGeometry(0.1, 0.07, 0.02), glow, [0.11 * s, 0.23, 0.275], head));
  mesh(cyl(0.015, 0.015, 0.22, 6), M.dark, [0, 0.53, 0], head);
  const beacon = mesh(sphere(0.05), glow, [0, 0.66, 0], head);
  for (const s of [-1, 1]) {
    const ear = mesh(cyl(0.07, 0.07, 0.06), M.dark, [0.32 * s, 0.22, 0], head);
    ear.rotation.z = Math.PI / 2;
  }
  const arms = [-1, 1].map((s) => {
    const sh = new THREE.Group();
    sh.position.set(0.5 * s, 0.66, 0);
    torso.add(sh);
    mesh(capsule(0.09, 0.3), M.metal, [0, -0.24, 0], sh);
    const el = new THREE.Group();
    el.position.y = -0.46;
    sh.add(el);
    mesh(sphere(0.1), M.dark, [0, 0, 0], el);
    mesh(capsule(0.085, 0.26), M.metal, [0, -0.22, 0], el);
    const hand = mesh(sphere(0.12), ref ? M.metal : acc, [0, -0.47, 0], el);
    hand.scale.set(1, 1.15, 0.9);
    return { sh, el };
  });
  return { root, hips, torso, head, legs, arms, eyes, beacon, glow };
}

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
const HIP = 0.95; // the height a body turns about in the air
const lerpTo = (a, b, k) => a + (b - a) * k;
/** What the arms do out in the ring. */
const GESTURES = {
  // an easy walk: the arms swing with the steps
  stroll: (t, wide = 0.5) => {
    const k = Math.sin(t * 6.2) * wide;
    return { a0x: k, a0z: -0.14, e0: -0.3 - Math.max(0, -k) * 0.4, a1x: -k, a1z: 0.14, e1: -0.3 - Math.max(0, k) * 0.4 };
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
  // both fists pumping over the head
  pump: (t) => {
    const k = (Math.sin(t * 7) + 1) / 2;
    return { a0x: -0.3, a0z: -2.88, e0: -0.3 - 0.4 * k, a1x: -0.3, a1z: 2.88, e1: -0.3 - 0.4 * (1 - k), bounce: Math.abs(Math.sin(t * 5)) * 0.1 };
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

const POSES = {
  // out in front of the desk, walking about and pumping the crowd
  hype: (t, side, gesture) => {
    // on its lap in its own manner, or stopped at a corner playing to the stands
    const arms = gesture ? GESTURES[gesture](t) : GESTURES.stroll(t, LAPS[side === 'blue' ? 'blue' : 'red'].swing);
    return { spot: [0, 1.4], lap: true, seat: false, bounce: 0, turn: 0, lean: gesture === 'flex' ? -0.08 : 0, look: gesture ? -0.2 : -0.1, ...arms };
  },
  // at the desk, hands near the keyboard, waiting for the bell
  guard: (t) => ({ spot: [0, 0], reach: 'keys', seat: true, bounce: 0, turn: 0, lean: 0.1, look: 0.1, a0x: 0.45, a0z: 0.48, e0: -1.85 + Math.sin(t * 3) * 0.05, a1x: 0.45, a1z: -0.48, e1: -1.85 + Math.sin(t * 3 + 1) * 0.05 }),
  // typing
  work: (t, side) => {
    const calm = side === 'blue';
    const q = calm ? 0.72 : 1; // blue types evenly, red hammers the keys
    return { spot: [0, 0], reach: 'keys', seat: true, bounce: 0, turn: 0, lean: calm ? 0.1 : 0.26, look: (calm ? 0.2 : 0.34) + Math.sin(t * (calm ? 0.9 : 1.7)) * (calm ? 0.12 : 0.05), a0x: 0.45 + Math.sin(t * 21 * q) * 0.04, a0z: 0.5, e0: -1.91 + Math.sin(t * 25 * q) * 0.1, a1x: 0.45 + Math.sin(t * 19 * q + 2) * 0.04, a1z: -0.5, e1: -1.91 + Math.sin(t * 23 * q + 1) * 0.1 };
  },
  // answered in time: up from the chair, both arms high
  done: (t, side) => {
    const pump = (Math.sin(t * 7) + 1) / 2;
    if (side === 'blue') {
      // one fist driven up again and again, the other hand at its hip
      const k = (Math.sin(t * 9) + 1) / 2;
      return { spot: [0, 0], seat: false, bounce: Math.abs(Math.sin(t * 4.5)) * 0.07, turn: Math.sin(t * 1.4) * 0.3, lean: -0.03, look: -0.05, a0x: -0.4, a0z: -2.7, e0: -0.2 - 0.9 * k, a1x: 0.1, a1z: 0.5, e1: -1.3 };
    }
    return { spot: [0, 0], seat: false, bounce: Math.abs(Math.sin(t * 5)) * 0.12, turn: Math.sin(t * 2) * 0.2, lean: -0.05, look: 0, a0x: -0.3, a0z: -2.88, e0: -0.3 - 0.4 * pump, a1x: -0.3, a1z: 2.88, e1: -0.3 - 0.4 * (1 - pump) };
  },
  // out of time: head in its hands
  fail: (t) => ({ spot: [0, 0], reach: 'head', seat: true, bounce: 0, turn: 0, lean: 0.35, look: 0.55 + Math.sin(t * 1.4) * 0.08, shake: Math.sin(t * 2.2) * 0.3, a0x: -2.1, a0z: 0.35, e0: -1.6, a1x: -2.1, a1z: -0.35, e1: -1.6 }),
  // the fight is over, waiting for the judge
  idle: (t) => ({ spot: [0, 0], seat: true, bounce: 0, turn: 0, lean: -0.1, look: 0, ...ARMS_DOWN, a0x: -0.3, a1x: -0.3, e0: -0.6 + Math.sin(t) * 0.05, e1: -0.6 }),
  // the fight is over: up from the chair and out in front of the desk, facing the ring, waiting for the referee
  stand: (t) => ({ spot: [0, 1.45], seat: false, bounce: 0, turn: 0, lean: 0, look: -0.05 + Math.sin(t * 0.9) * 0.03, ...ARMS_DOWN, a0z: -0.12 + Math.sin(t * 1.3) * 0.02, a1z: 0.12 - Math.sin(t * 1.3) * 0.02 }),
  // beaten: it stays where it stood, head and shoulders down
  sad: (t) => ({ spot: [0, 1.45], seat: false, bounce: 0, turn: Math.sin(t * 0.6) * 0.12, lean: 0.22, look: 0.55 + Math.sin(t * 1.1) * 0.05, ...ARMS_DOWN, e0: -0.05, e1: -0.05 }),
  // the winner: out to the front, jumping, arms up, turning to every stand
  win: (t) => {
    // the champion: jumping, both fists pumping above the head
    const pump = (Math.sin(t * 8) + 1) / 2;
    return { spot: [Math.sin(t * 0.8) * 0.3, 1.5], seat: false, bounce: Math.abs(Math.sin(t * 6)) * 0.26, turn: Math.sin(t * 1.3) * 0.6, lean: -0.05, look: 0.05, a0x: -0.28, a0z: -2.9, e0: -0.25 - 0.55 * pump, a1x: -0.28, a1z: 2.9, e1: -0.25 - 0.55 * (1 - pump) };
  },
  // the loser: smashes everything, then sits on the floor
  lose: (t) => {
    if (t < 0.5) return { spot: [0, 0], seat: t < 0.25, bounce: 0, turn: 0, lean: 0, look: 0, ...ARMS_DOWN };
    if (t < 1.1) { // the monitor
      const k = ease((t - 0.5) / 0.35);
      const hit = ease((t - 0.85) / 0.15);
      return { spot: [0, -0.05], seat: false, bounce: 0, turn: 0, lean: lerp(-0.2, 0.3, hit), look: 0.2, a0x: 0, a0z: -0.3, e0: -0.4, a1x: lerp(lerp(0, 0.7, k), -1.7, hit), a1z: 0.2, e1: lerp(lerp(0, -1.4, k), -0.1, hit) };
    }
    if (t < 1.9) { // the keyboard: both fists down
      const k = ease((t - 1.1) / 0.4);
      const hit = ease((t - 1.5) / 0.15);
      return { spot: [0, -0.05], seat: false, bounce: 0, turn: 0, lean: lerp(0, 0.45, hit), look: 0.3, a0x: lerp(-2.6 * k, -0.9, hit), a0z: 0.2, e0: lerp(-0.6, -0.1, hit), a1x: lerp(-2.6 * k, -0.9, hit), a1z: -0.2, e1: lerp(-0.6, -0.1, hit) };
    }
    if (t < 2.8) { // the desk: lift and flip
      const k = ease((t - 1.9) / 0.4);
      const up = ease((t - 2.35) / 0.25);
      return { spot: [0, -0.05], seat: false, bounce: 0, turn: 0, lean: lerp(0.5 * k, -0.25, up), look: lerp(0.3, -0.3, up), a0x: lerp(-1.1 * k, -2.9, up), a0z: 0.25, e0: -0.3, a1x: lerp(-1.1 * k, -2.9, up), a1z: -0.25, e1: -0.3 };
    }
    if (t < 3.9) { // the chair: turn round, grab, throw
      const k = ease((t - 2.8) / 0.4);
      const thr = ease((t - 3.4) / 0.25);
      return { spot: [0, -0.05], seat: false, bounce: 0, turn: Math.PI * k, lean: lerp(0.3, -0.2, thr), look: 0, a0x: lerp(-1.3, -2.8, thr), a0z: -0.4, e0: -0.4, a1x: lerp(-1.3, -2.8, thr), a1z: 0.4, e1: -0.4 };
    }
    // on the floor, head down
    const k = ease((t - 3.9) / 0.6);
    return { spot: [0, 0.35], seat: false, floor: k, bounce: 0, turn: Math.PI * (1 - k), lean: 0.35 * k, look: 0.5 * k + Math.sin(t * 1.3) * 0.05, a0x: -0.9 * k, a0z: 0.2, e0: -0.9 * k, a1x: -0.9 * k, a1z: -0.2, e1: -0.9 * k };
  },
  // the referee
  ref: (t) => ({ spot: [0, 0], seat: false, bounce: 0, turn: Math.sin(t * 0.5) * 0.35, lean: 0, look: 0, a0x: 0.45, a0z: -0.1, e0: -1.1, a1x: 0.45, a1z: 0.1, e1: -1.1 }),
  refStart: (t) => {
    const up = ease(t / 0.35);
    const chop = ease((t - 0.5) / 0.25);
    return { spot: [0, 0], seat: false, bounce: 0, turn: 0, lean: 0, look: 0, a0x: lerp(0, -1.4, chop), a0z: lerp(-1.5 * up, 0, chop), e0: 0, a1x: lerp(0, -1.4, chop), a1z: lerp(1.5 * up, 0, chop), e1: 0 };
  },
  refRaise: (t, side) => {
    const up = ease((t - 1.9) / 0.5); // it walks over first
    const arm = side === 'red' ? { a0x: 0, a0z: -2.95 * up, e0: -0.1 } : { a1x: 0, a1z: 2.95 * up, e1: -0.1 };
    return { spot: [0, 0], seat: false, bounce: 0, turn: 0, lean: 0, look: -0.15, a0x: 0.2, a0z: -0.1, e0: -0.4, a1x: 0.2, a1z: 0.1, e1: -0.4, ...arm };
  },
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
  // the robots' model and the hall's baked parts load together; each falls back to code on its own.
  // A still of the hall comes first and shows while the hall is built and its shaders compile (seconds
  // on a cold start), until the first frame is drawn
  const poster = new Image();
  poster.src = POSTER;
  const shown = poster.decode().then(() => {
    root.style.background = `#05070d url(${POSTER}) center / cover no-repeat`;
  }, () => {});
  const [xg, assets] = await Promise.all([
    loadXbot(small).catch((e) => {
      console.warn('humanoid robots not available, using the simple ones:', e.message);
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
    const bot = xg ? makeXRobot(side, xg, COLOR) : buildRobot(side, M);
    bot.root.scale.setScalar(SIZE);
    st.g.add(bot.root);
    fighters[side] = { st, bot, pose: 'hype', since: 0, pos: new THREE.Vector2(0, 1.35), path: [], cur: {}, events: new Set(), wrecked: false, present: true, screen: 'code', placed: false };
    spots[side].target.position.set(SEAT[side].x, FLOOR, SEAT[side].z);
    focus[side].to.set(SEAT[side].x, FLOOR, SEAT[side].z);
  }
  const refBot = xg ? makeXRobot('ref', xg, COLOR) : buildRobot('ref', M);
  refBot.root.scale.setScalar(SIZE * (xg?.robots ? 1.1 : 1)); // the armoured referee a little larger: it stands among the fighters, not under them
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
    f.events.clear();
  }

  // the camera
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  // cut: true at the start, so the camera is in place from the first frame instead of drifting in
  const cam = { mode: null, modeAt: 0, shake: 0, view: { ...WIDE }, shot: 'wide', step: 0, at: 0, cut: true };
  const SHOTS = ['wide', 'red', 'wide', 'blue'];
  const camAt = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  const camFront = new THREE.Vector3();
  const camUp = new THREE.Vector3();
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
  const now = () => clock;
  // moments the page may want to hear of ('ropes', 'taunt', 'flip', 'land'), for the hall's voice
  let onMoment = null;
  const moment = (name, side) => {
    try {
      onMoment?.(name, side);
    } catch {
      // the page's own trouble
    }
  };

  // ------------------------------------------------------------------ every frame

  function applyBody(bot, p, k) {
    const cur = bot.cur ?? (bot.cur = {});
    for (const key of ['bounce', 'turn', 'lean', 'look', 'shake', 'a0x', 'a0z', 'e0', 'a1x', 'a1z', 'e1', 'floor', 'tuck']) {
      const v = p[key] ?? 0;
      cur[key] = cur[key] == null ? v : cur[key] + (v - cur[key]) * k;
    }
    return cur;
  }

  // ---- acts: a taunt and its answer, a climb onto the ropes, the winner's backflip

  /** A fighter's corner post on the camera's side of the ring: where it stands on the ropes there (on
   *  the turnbuckles of the near side, beside the post), where it hops down, and where the winner lands
   *  (in the station's own coordinates; the post in the hall's). */
  function cornerOf(f, side) {
    if (!f.corner) {
      const [k, along] = side === 'red' ? [2, 1] : [1, 2];
      const post = corner(k).multiplyScalar((RING - 0.08) / RING).setY(FLOOR);
      const inward = post.clone().setY(0).normalize().multiplyScalar(-1);
      const standW = post.clone().addScaledVector(corner(along).sub(corner(k)).normalize(), 0.48);
      const own = (w) => {
        const v = f.st.g.worldToLocal(w.clone());
        return new THREE.Vector2(v.x, v.z);
      };
      f.corner = { standW, outW: inward.clone().multiplyScalar(-1), stand: own(standW), hop: own(standW.clone().addScaledVector(inward, 0.9)), land: own(standW.clone().addScaledVector(inward, 1.9)) };
    }
    return f.corner;
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

  /** Leads the body while an act runs: what the act wants this frame, or null when there is none. */
  function stepAct(f, side, t) {
    const a = f.act;
    const other = fighters[side === 'red' ? 'blue' : 'red'];
    if (a.kind === 'answer' && !a.began) {
      if (t < a.from) return null; // it has not noticed yet
      a.began = true;
      a.since = t;
    }
    const at = t - a.since; // the time in this phase
    const next = (phase) => {
      a.phase = phase;
      a.since = t;
    };
    if (a.kind === 'taunt' || a.kind === 'answer') {
      if (at > a.len || !other.present) {
        f.act = null;
        return null;
      }
      return { hold: true, face: yawAt(f, other), gesture: a.gesture };
    }
    const k = cornerOf(f, side);
    const top = a.kind === 'win' ? ROPE_TOP : ROPE_MID;
    if (a.phase === 'go') {
      if (f.pos.distanceTo(k.stand) < 0.14) next('up');
      return { goal: k.stand, speed: a.kind === 'win' ? 2.5 : LAPS[side].speed * 1.3 };
    }
    if (a.phase === 'up') {
      // two steps up the ropes
      const u = Math.min(1, at / 0.8);
      f.lift = top * (u < 0.5 ? ease(u * 2) * 0.55 : 0.55 + ease((u - 0.5) * 2) * 0.45);
      if (u >= 1) {
        next('pose');
        moment('ropes', side);
      }
      return { hold: true, face: yawOut(f), gesture: null, pose: { tuck: Math.sin(u * Math.PI * 2) ** 2 * 0.35 } };
    }
    if (a.phase === 'pose') {
      // up on the ropes, playing to the stands
      f.lift = top;
      state.exc[side] = Math.max(state.exc[side], a.kind === 'win' ? 1 : 0.85);
      if (at > (a.kind === 'win' ? 1.7 : 2.6)) {
        a.from = f.pos.clone();
        a.yaw = f.bot.yaw;
        if (a.kind === 'win') {
          next('flip');
          moment('flip', side);
        } else next('down');
      }
      return { hold: true, face: yawOut(f), gesture: a.gesture };
    }
    if (a.phase === 'down') {
      // a hop back into the ring
      const u = Math.min(1, at / 0.55);
      f.pos.lerpVectors(a.from, k.hop, ease(u));
      f.lift = top * (1 - u) + Math.sin(u * Math.PI) * 0.35;
      if (u >= 1) {
        f.lift = 0;
        f.act = null;
        f.lastClimb = t;
        return null;
      }
      return { hold: true, face: a.yaw, gesture: null, pose: { tuck: Math.sin(u * Math.PI) * 0.4 } };
    }
    if (a.phase === 'flip') {
      // off the top rope, backwards: one whole turn in the air and down on its feet; the middle of it
      // in slow motion
      const u = Math.min(1, at / 1.25);
      slowTo = u > 0.1 && u < 0.86 ? 0.26 : 1;
      f.pos.lerpVectors(a.from, k.land, u);
      f.lift = ROPE_TOP * (1 - u) + 4 * u * (1 - u) * 1.15;
      f.flip = -Math.PI * 2 * ease(u);
      const tuck = Math.sin(Math.min(1, u * 1.1) * Math.PI);
      if (u >= 1) {
        f.flip = 0;
        f.lift = 0;
        slowTo = 1;
        next('land');
        moment('land', side);
        cam.shake = 0.4;
      }
      // the arms up at the take-off and the landing, round the knees in the air
      return { hold: true, face: a.yaw, gesture: null, pose: { tuck: tuck * 0.9, a0x: lerp(-0.3, -1.25, tuck), a0z: lerp(-2.6, -0.2, tuck), e0: lerp(-0.3, -1.5, tuck), a1x: lerp(-0.3, -1.25, tuck), a1z: lerp(2.6, 0.2, tuck), e1: lerp(-0.3, -1.5, tuck) } };
    }
    // the landing: the knees take it, then up with both arms; from here on it celebrates where it landed
    const u = Math.min(1, at / 0.9);
    const dip = Math.sin(Math.min(1, u * 1.6) * Math.PI);
    f.lift = -0.16 * dip;
    if (u >= 1) {
      f.lift = 0;
      f.winAt = f.pos.clone();
      f.act = null;
      return null;
    }
    return { hold: true, face: a.yaw, gesture: 'pump', pose: { tuck: dip * 0.45, bounce: 0 } };
  }

  function moveFighter(f, side, t, dt) {
    const bot = f.bot;
    const lap = LAPS[side];
    const otherSide = side === 'red' ? 'blue' : 'red';
    const other = fighters[otherSide];
    // the two never share a clock: blue's poses run a little ahead (not the loser's, whose furniture
    // flies on its own times)
    const tt = t - f.since + (side === 'blue' && f.pose !== 'lose' ? 0.7 : 0);
    // an act belongs to its pose: the bell or the verdict ends it at once (down from the ropes too)
    if (f.act && (reduced || (f.act.kind === 'win' ? f.pose !== 'win' : f.pose !== 'hype'))) {
      if (f.act.phase === 'flip') slowTo = 1;
      f.act = null;
    }
    // the winner, once the referee has raised its arm: to its corner, up the ropes, and the backflip
    if (!reduced && f.pose === 'win' && !f.act && !f.flipped && tt > 3.2) {
      f.flipped = true;
      f.act = { kind: 'win', phase: 'go', since: t, gesture: 'pump' };
    }
    const lead = f.act ? stepAct(f, side, t) : null;
    const onRopes = f.act && (f.act.kind === 'climb' || f.act.kind === 'win') && f.act.phase !== 'go';
    if (!onRopes) f.lift = (f.lift ?? 0) * Math.max(0, 1 - dt * 9); // back on the floor
    if (f.act?.phase !== 'flip') f.flip = 0;
    // on its lap: an easy walk, with a few seconds of its own flair now and then
    const flair = !lead && f.pose === 'hype' && (f.flairUntil ?? 0) > t ? lap.flair : null;
    const p = reduced ? POSES.guard(0) : POSES[f.pose](tt, side, lead ? lead.gesture : f.gesture ?? flair);
    if (lead) {
      // the act's own body: its gesture, whatever else it asks, and never the pose's own jumping about
      Object.assign(p, { bounce: 0, turn: 0, lean: 0, look: -0.1, shake: 0, tuck: 0 }, lead.gesture ? GESTURES[lead.gesture](tt) : GESTURES.stroll(tt, 0), lead.pose ?? {}, { seat: false });
    }
    const c = applyBody(bot, p, Math.min(1, dt * 10));
    // walk to the spot of the pose (or to the next corner of its lap), round the desk when the way
    // crosses it, on the side it is nearer to
    let goal;
    let showing = false;
    let free = false;
    if (lead) {
      goal = lead.hold ? f.pos.clone() : lead.goal.clone();
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
    const walking = dist > 0.25 && !lead?.hold; // a real walk, not the small drift of a pose
    // full speed to a corner of the way round the desk; to the spot itself slowing down as it
    // nears, so a drifting spot is followed smoothly and not in stop-and-go jumps (which a close-up
    // camera, riding with the robot, turned into a shaking picture)
    const toSpot = f.path.length === 1;
    if (!toSpot && dist < 0.02) f.path.shift();
    else {
      // it turns before it goes: the more it still has to turn, the slower it steps
      let pace = 1;
      if (walking && bot.yaw != null) {
        let off = (Math.atan2(d.x, d.y) - bot.yaw) % (Math.PI * 2);
        if (off > Math.PI) off -= Math.PI * 2;
        if (off < -Math.PI) off += Math.PI * 2;
        pace = Math.max(0.08, Math.cos(Math.min(Math.abs(off), Math.PI / 2)));
      }
      const speed = lead?.speed ?? (p.lap && toSpot ? lap.speed : toSpot ? Math.min(1.7, dist * 7) : 1.7);
      f.pos.add(d.clampLength(0, dt * pace * speed));
    }
    // facing the way it walks; in an act, where the act says; stopped for a show, facing the stands
    let facing = c.turn;
    if (walking) facing = Math.atan2(d.x, d.y);
    else if (lead?.face != null) facing = lead.face;
    else if (showing) facing = yawOut(f);
    bot.yaw = turnTo(bot.yaw ?? c.turn, facing, Math.min(1, dt * (lead ? 9 : 6)));
    // on the floor, up on the ropes, or turning over in the air about its hips
    const lift = f.lift ?? 0;
    const flip = f.flip ?? 0;
    bot.root.rotation.order = 'YXZ';
    bot.root.rotation.set(flip, bot.yaw, 0);
    bot.root.position.set(f.pos.x - HIP * Math.sin(flip) * Math.sin(bot.yaw), lift / STATION + HIP * (1 - Math.cos(flip)), f.pos.y - HIP * Math.sin(flip) * Math.cos(bot.yaw));
    if (bot.pose) {
      let reach = null;
      if (p.reach === 'keys' && !walking) {
        const j = Math.sin(t * 22) * 0.012;
        reach = [f.st.g.localToWorld(new THREE.Vector3(-0.13, 0.8 + j, 0.3)), f.st.g.localToWorld(new THREE.Vector3(0.13, 0.8 - j, 0.3))];
      } else if (p.reach === 'head' && !walking) reach = 'head';
      bot.pose(c, p, t, walking, dt, reach); // on the way to its chair it walks; it sits down once there
    } else applyLimbs(bot, c, p, t, walking);
  }

  function applyLimbs(bot, c, p, t, walking) {
    const seated = p.seat && !walking;
    const sit = bot.sit = (bot.sit ?? 0) + ((seated ? 1 : 0) - (bot.sit ?? 0)) * 0.15;
    const floor = c.floor || 0;
    bot.hips.position.y = lerp(lerp(0.95, 0.5, sit), 0.22, floor) + (seated ? 0 : c.bounce);
    const step = walking ? Math.sin(t * 9) : 0;
    bot.legs.forEach((leg, i) => {
      const s = i ? -1 : 1;
      leg.hip.rotation.x = lerp(step * 0.55 * s - c.bounce * 1.5, -1.5, Math.max(sit, floor, c.tuck || 0));
      leg.knee.rotation.x = lerp(Math.max(0, -step * s) * 0.7 + c.bounce * 2.5, 1.5, Math.max(sit, c.tuck || 0)) * (1 - floor) + 0.15 * floor;
    });
    bot.torso.rotation.x = c.lean;
    bot.head.rotation.x = c.look;
    bot.head.rotation.y = c.shake;
    bot.arms[0].sh.rotation.set(c.a0x, 0, c.a0z);
    bot.arms[0].el.rotation.x = c.e0;
    bot.arms[1].sh.rotation.set(c.a1x, 0, c.a1z);
    bot.arms[1].el.rotation.x = c.e1;
    bot.beacon.visible = Math.sin(t * 6) > -0.3;
  }

  function wreck(f, tt) {
    const once = (name, at, fn) => {
      if (tt >= at && !f.events.has(name)) {
        f.events.add(name);
        fn();
      }
    };
    once('monitor', 1.0, () => launch(f, 'monitor', new THREE.Vector3(0.6, 3.2, 3.8), [3, 6, 2]));
    once('keyboard', 1.62, () => launch(f, 'keyboard', new THREE.Vector3(-0.8, 4.2, 1.2), [8, 3, 5]));
    once('desk', 2.6, () => launch(f, 'desk', new THREE.Vector3(0, 3.6, 2.6), [-5.5, 0.6, 0.4]));
    once('chair', 3.62, () => launch(f, 'chair', new THREE.Vector3(1.8, 3.4, -2.6), [2, 7, 3]));
    once('tower', 3.75, () => launch(f, 'tower', new THREE.Vector3(2.4, 1.6, 1.2), [0, 4, 6]));
    f.wrecked = true;
  }

  function moveReferee(t, dt) {
    const r = referee;
    const tt = t - r.since;
    const p = POSES[r.pose](tt, r.side);
    const c = applyBody(r.bot, p, Math.min(1, dt * 10));
    const d = r.target.clone().sub(r.pos);
    const dist = d.length();
    const walking = dist > 0.03;
    r.speed = Math.min(2, dist * 5, (r.speed ?? 0) + dt * 5); // speeding up at the start, slowing down at the end
    r.pos.add(d.clampLength(0, dt * r.speed));
    r.bot.root.position.set(r.pos.x, FLOOR, r.pos.y);
    // facing the way it walks (the distance left, not this frame's step), then the pose's way
    r.bot.yaw = turnTo(r.bot.yaw ?? 0, walking && dist > 0.2 ? Math.atan2(d.x, d.y) : c.turn, Math.min(1, dt * 6));
    r.bot.root.rotation.y = r.bot.yaw;
    if (r.bot.pose) r.bot.pose(c, p, t, walking, dt, null);
    else applyLimbs(r.bot, c, p, t, walking);
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
  const camFollow = new THREE.Vector3();
  let following = false;
  function frame() {
    const real = performance.now() / 1000;
    const realDt = Math.min(0.05, real - last);
    last = real;
    slow += (slowTo - slow) * Math.min(1, realDt * 9);
    const dt = realDt * slow;
    clock += dt;
    const t = clock;
    for (const side of ['red', 'blue']) state.exc[side] += (0.32 - state.exc[side]) * Math.min(1, dt * 0.35);

    // the hall: the fans with their side's mood, the crowd and its phones, the LED panels. How the hall
    // roars: on its feet for the winner, up and loud while the fighters work it, seated and tense in a round
    const hype = ['red', 'blue'].some((s) => fighters[s].present && fighters[s].pose === 'hype');
    const roar = state.lights === 'winner' ? 1 : hype ? 0.7 : state.lights === 'focus' ? 0.2 : 0.3;
    room.update(t, dt, state.exc, roar, reduced);
    grade.uniforms.time.value = t;
    watchSpeed(realDt);

    // robots, the referee, flying furniture, sparks
    for (const side of ['red', 'blue']) {
      const f = fighters[side];
      if (!f.present) continue;
      moveFighter(f, side, t, dt);
      if (f.pose === 'lose') wreck(f, t - f.since);
      if (f.screen === 'code') f.st.screens.code.offset.y = (t * 0.35) % 1;
    }
    moveReferee(t, dt);
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
    // the end it leans towards the winner
    const portrait = camera.aspect < 0.8;
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
    }
    // like a broadcast: while a round runs, cut between the wide shot and a shot over each robot's shoulder
    if (cam.fixed) {
      cam.shot = cam.fixed;
    } else if (state.lights === 'focus' && !reduced) {
      if (t - cam.at > (cam.shot === 'wide' ? 12 : 3.5)) {
        cam.step = (cam.step + 1) % SHOTS.length;
        cam.shot = SHOTS[cam.step];
        if (cam.shot !== 'wide' && !fighters[cam.shot].present) cam.shot = 'wide';
        cam.at = t;
        cam.cut = true;
      }
    } else if (state.lights === 'winner' && state.winner && !reduced) {
      // at the end, now and then the winner up close
      if (t - cam.at > (cam.shot === 'wide' ? 6 : 4.2)) {
        cam.shot = cam.shot === 'wide' ? 'winClose' : 'wide';
        cam.at = t;
        cam.cut = true;
      }
    } else if (cam.shot !== 'wide') {
      cam.shot = 'wide';
      cam.cut = true;
    }
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
    if (cam.shot !== 'wide' && cam.shot !== 'orbit') lensFov(cam.shot === 'peek' ? 42 : portrait ? 58 : 44);
    const flier = !cam.fixed && !reduced && state.winner && fighters[state.winner].act?.kind === 'win' && fighters[state.winner].act.phase !== 'go' ? fighters[state.winner] : null;
    if (flier) {
      lensFov(portrait ? 58 : 44);
      const k = flier.corner;
      camFront.set(-k.outW.z, 0, k.outW.x); // along the ropes
      camera.position.copy(k.standW).addScaledVector(k.outW, 4.6).addScaledVector(camFront, state.winner === 'red' ? -1.5 : 1.5).add(camUp.set(0, 2.9, 0));
      // its hips, wherever the flip has them, followed softly
      flier.st.g.localToWorld(camLook.set(flier.pos.x, (flier.lift ?? 0) / STATION + HIP, flier.pos.y));
      if (!following) camFollow.copy(camLook);
      following = true;
      camFollow.lerp(camLook, Math.min(1, realDt * 7));
      camera.lookAt(camFollow);
      for (const b of beams) b.m.visible = false;
      cam.shot = 'wide';
      cam.at = t;
      cam.cut = true;
      draw(dt);
      requestAnimationFrame(frame);
      return;
    }
    following = false;
    if (cam.shot === 'winClose' && state.winner) {
      const f = fighters[state.winner];
      f.bot.root.getWorldPosition(v3);
      f.st.g.getWorldQuaternion(camQ);
      camFront.set(0, 0, 1).applyQuaternion(camQ);
      const k = Math.min(1, (t - cam.at) / 4.2);
      camera.position.copy(v3).addScaledVector(camFront, (2.9 - k * 0.4) * SIZE * STATION).add(camUp.set(0.35, 1.85 * SIZE * STATION, 0));
      camLook.copy(v3).add(camUp.set(0, 1.4 * SIZE * STATION, 0));
      camera.lookAt(camLook);
      for (const b of beams) b.m.visible = false;
      draw(dt);
      requestAnimationFrame(frame);
      return;
    }
    if (cam.shot === 'peek' && cam.peek) {
      // any point of view (for checks of the hall)
      camera.position.fromArray(cam.peek[0]);
      camera.lookAt(camLook.fromArray(cam.peek[1]));
      draw(dt);
      requestAnimationFrame(frame);
      return;
    }
    if (cam.shot === 'faceRed' || cam.shot === 'faceBlue') {
      // face to face: from in front of the desk, the robot over its monitor (for videos and previews)
      const g = fighters[cam.shot === 'faceRed' ? 'red' : 'blue'].st.g;
      g.localToWorld(camAt.set(0.2, 2.15, 2.2).multiplyScalar(SIZE));
      g.localToWorld(camLook.set(0, 1.5 * SIZE, 0));
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      draw(dt);
      requestAnimationFrame(frame);
      return;
    }
    if (cam.shot === 'red' || cam.shot === 'blue') {
      const g = fighters[cam.shot].st.g;
      const k = Math.min(1, (t - cam.at) / 3.5);
      const out = cam.shot === 'red' ? -1 : 1; // from the outer side of the ring, away from the referee
      g.localToWorld(camAt.set(2.3 * out, 3.35 - k * 0.15, -2.75 + k * 0.3));
      g.localToWorld(camLook.set(-0.3 * out, 1.15, 0.5));
      for (const b of beams) b.m.visible = false; // no haze of the roof lights right in front of the lens
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      draw(dt);
      requestAnimationFrame(frame);
      return;
    }
    let want = wide;
    if (cam.shot === 'orbit') {
      // round and round the hall (for videos and previews; still for those who ask for less motion)
      want = { ...(portrait ? ORBIT_TALL : ORBIT), az: reduced ? 0.7 : ((t - cam.at) / ORBIT_T) * Math.PI * 2 };
    } else if (state.lights === 'sweep' && !cam.fixed && !reduced) {
      // between rounds: the wide shot a while, then once round the whole hall, easing out and back in
      const u = ((t - cam.modeAt) % (ORBIT_T + 14) - 14) / ORBIT_T;
      if (u > 0) want = mixView(wide, portrait ? ORBIT_TALL : ORBIT, ease(Math.min(1, u / 0.12)) * ease(Math.min(1, (1 - u) / 0.12)), (1 - Math.cos(u * Math.PI)) * Math.PI);
    } else if (state.lights === 'focus' && !reduced) {
      // in a round: from a little higher and further, slowly down and in
      const k = 1 - ease(Math.min(1, (t - cam.at) / 12));
      want = { ...wide, h: wide.h + 1.2 * k, d: wide.d + 1.6 * k, pitch: wide.pitch + 0.035 * k };
    }
    if (!reduced && !cam.fixed && state.lights !== 'sweep') want.az = Math.sin(t * 0.08) * (portrait ? 0.2 : 0.1); // a slow broadcast drift
    if (cam.cut) {
      cam.cut = false;
      Object.assign(cam.view, want);
    }
    const k = Math.min(1, dt * 1.5);
    for (const key of ['d', 'h', 'pitch', 'fov', 'shift', 'x']) cam.view[key] += (want[key] - cam.view[key]) * k;
    cam.view.az += Math.atan2(Math.sin(want.az - cam.view.az), Math.cos(want.az - cam.view.az)) * Math.min(1, dt * 3);
    const { az, d, h, pitch, x } = cam.view;
    lensFov(cam.view.fov, cam.view.shift);
    camera.position.set(x + Math.sin(az) * d, h, Math.cos(az) * d);
    camLook.set(-Math.sin(az) * Math.cos(pitch), -Math.sin(pitch), -Math.cos(az) * Math.cos(pitch)).add(camera.position);
    if (cam.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * cam.shake;
      camera.position.y += (Math.random() - 0.5) * cam.shake;
      cam.shake = Math.max(0, cam.shake - dt * 0.6);
    }
    camera.lookAt(camLook);
    draw(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.fonts?.ready.then(() => {
    redraw(board, () => {});
  });

  // ------------------------------------------------------------------ what the page can ask

  return {
    kind: '3d',
    setFighters({ red = true, blue }) {
      fighters.red.present = !!red;
      fighters.red.st.g.visible = !!red;
      fighters.blue.present = !!blue;
      fighters.blue.st.g.visible = !!blue;
    },
    setPose(side, pose) {
      const f = fighters[side];
      if (!f || f.pose === pose) return;
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
        f.bot.sit = POSES[pose](0).seat ? 1 : 0;
      }
      const screen = pose === 'done' || pose === 'win' ? 'sent' : pose === 'fail' ? 'time' : 'code';
      f.screen = screen;
      if (!f.wrecked) {
        f.st.face.map = f.st.screens[screen];
        f.st.face.color.setHex(screen === 'code' ? 0xc8d4ff : 0xffffff);
      }
      const eyeScale = pose === 'fail' || pose === 'lose' ? 0.35 : pose === 'done' || pose === 'win' ? 1.6 : 1;
      f.bot.eyes.forEach((e) => e.scale.set(1, eyeScale, 1));
    },
    poseOf: (side) => fighters[side]?.pose,
    /** Calls fn(name, side) at 'ropes' (up on the ropes), 'taunt', 'flip' (the winner leaves the top rope) and 'land'. */
    onMoment(fn) {
      onMoment = fn;
    },
    /** Where a fighter stands and which way it faces, in the hall's own coordinates (for checks and camera work). */
    where(side) {
      const f = fighters[side];
      const at = f.bot.root.getWorldPosition(new THREE.Vector3());
      const facing = f.bot.root.getWorldDirection(new THREE.Vector3());
      return { x: at.x, y: at.y, z: at.z, fx: facing.x, fz: facing.z, pose: f.pose, gesture: f.gesture ?? null, act: f.act ? `${f.act.kind}${f.act.phase ? ':' + f.act.phase : ''}` : null, lift: f.lift ?? 0, flip: f.flip ?? 0, slow };
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
        referee.target.set(spot.x + (winner === 'red' ? 1.45 : -1.45), spot.z - 0.35);
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
  };
}

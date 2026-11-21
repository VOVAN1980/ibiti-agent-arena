// The arena in 3D: a hexagon ring under the lights, packed stands all around, a scoreboard cube
// over the ring, and two robot fighters at their own gaming desks. They do not fight each other:
// before the bell they walk out and work the crowd; at the bell they sit down and type; whoever
// answers jumps up with both arms raised, whoever runs out of time holds its head. At the end the
// referee robot raises the winner's arm, the winner dances, and the loser smashes its monitor,
// throws its keyboard, flips its desk and hurls its chair, then sits on the floor.
// The page tells the scene what happens (the same calls as the 2D scene in scene.js); the scene
// only draws it.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import { beamMaterial, buildHaze, buildScreens, buildPyro, buildFlags } from './atmosphere.js';
import { loadXbot, makeXRobot } from './xbot.js';

const COLOR = { red: 0xef4444, blue: 0x3b82f6, ref: 0xe6ebf5, gold: 0xf5b301 };
const CSS = { red: '#ef4444', blue: '#3b82f6' };
const FLOOR = 0.6; // the top of the ring
const RING = 6; // the ring's radius (corner to centre)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = Math.min(screen.width, screen.height) < 700 || matchMedia('(pointer: coarse)').matches;

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
  t.anisotropy = 4;
  t.userData.canvas = c;
  t.userData.draw = draw;
  return t;
}

// the BNB mark (24x24), drawn on the ring floor and on the backs of the monitors
const BNB = new Path2D('M16.624 13.9202l2.7175 2.7154-7.353 7.353-7.353-7.352 2.7175-2.7164 4.6355 4.6595 4.6356-4.6595zm4.6366-4.6366L24 12l-2.7154 2.7164L18.5682 12l2.6924-2.7164zm-9.272.001l2.7163 2.6914-2.7164 2.7174v-.001L9.2721 12l2.7164-2.7154zm-9.2722-.001L5.4088 12l-2.6914 2.6924L0 12l2.7164-2.7164zM11.9885.0115l7.353 7.329-2.7174 2.7154-4.6356-4.6356-4.6355 4.6595-2.7174-2.7154 7.353-7.353z');
function drawBnb(g, cx, cy, size, rot = 0) {
  g.save();
  g.translate(cx, cy);
  g.rotate(rot);
  g.scale(size / 24, size / 24);
  g.translate(-12, -12);
  g.fill(BNB);
  g.restore();
}

const hexPath = (g, x, y, r) => {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    g.lineTo(x + r * Math.cos(a), y + r * Math.sin(a));
  }
  g.closePath();
};

const floorTex = () => canvasTex(1024, 1024, (g, w, h) => {
  const bg = g.createRadialGradient(w / 2, h / 2, 40, w / 2, h / 2, w / 2);
  bg.addColorStop(0, '#16213d');
  bg.addColorStop(1, '#070b16');
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(110,140,230,.22)';
  g.lineWidth = 2;
  const r = 34;
  for (let y = 0, row = 0; y < h + r; y += r * 1.5, row++) for (let x = (row % 2) * r * 0.866; x < w + r; x += r * 1.732) {
    hexPath(g, x, y, r);
    g.stroke();
  }
  // the BNB mark in the centre; the floor's texture lies turned a quarter, so the mark is turned back
  g.fillStyle = 'rgba(176,134,10,.78)'; // a muted gold: under the spotlights a bright one dazzles
  drawBnb(g, w / 2, h / 2, 430, -Math.PI / 2);

});

const hazardTex = () => canvasTex(256, 64, (g, w, h) => {
  g.fillStyle = '#111318';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#f5b301';
  for (let x = -h; x < w + h; x += 48) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + 24, h);
    g.lineTo(x + 24 + h, 0);
    g.lineTo(x + h, 0);
    g.fill();
  }
}, { repeat: [14, 1] });

const stripeTex = () => canvasTex(64, 64, (g, w, h) => {
  g.fillStyle = '#f4f6fb';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#111318';
  g.fillRect(0, 0, w / 2, h);
}, { repeat: [5, 1] });

function tickerTex() {
  // three boards side by side, each with room to breathe: the arena, the chain it runs on, the ID it serves
  return canvasTex(2048, 64, (g, w, h) => {
    g.fillStyle = '#05070d';
    g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(245,179,1,.35)';
    g.fillRect(0, 4, w, 2);
    g.fillRect(0, h - 6, w, 2);
    g.font = '700 30px Orbitron, Inter, sans-serif';
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    const third = w / 3;
    g.fillStyle = '#f5b301';
    g.fillText('IBITI AGENT ARENA', third * 0.5, h / 2 + 2);
    g.fillStyle = '#f0b90b';
    drawBnb(g, third * 1.5 - 180, h / 2, 34);
    g.fillText('BUILT ON BNB CHAIN', third * 1.5 + 22, h / 2 + 2);
    g.fillStyle = '#e6ebf5';
    g.fillText('AGENT ID · BINANCE WALLET', third * 2.5, h / 2 + 2);
  }, { repeat: [3, 1] });
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
      g.fillStyle = '#f0b90b';
      g.shadowColor = '#f0b90b';
      g.shadowBlur = 16;
      drawBnb(g, w / 2, h / 2, 96);
    } else {
      g.fillStyle = kind === 'sent' ? '#22c55e' : '#f97316';
      g.font = '800 54px Inter, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(kind === 'sent' ? '✓' : '✗', w / 2, h / 2 - 20);
      g.font = '800 26px Orbitron, Inter, sans-serif';
      g.fillText(kind === 'sent' ? 'SENT' : 'TIME', w / 2, h / 2 + 36);
    }
  });
}

function boardTex() {
  return canvasTex(512, 256, (g, w, h) => {
    const lines = g.__lines ?? ['IBITI AGENT ARENA'];
    g.fillStyle = '#03050a';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#f5b301';
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    lines.slice(0, 3).forEach((line, i) => {
      g.fillStyle = i === 1 ? '#ffffff' : i === 0 ? '#f5b301' : '#9fb6ff';
      g.font = `800 ${i === 1 ? 74 : 34}px Orbitron, Inter, sans-serif`;
      g.fillText(String(line).slice(0, 26), w / 2, [62, 140, 212][i]);
    });
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
    dark: std({ color: 0x262d3d, metalness: 0.75, roughness: 0.38 }),
    black: std({ color: 0x0d1018, metalness: 0.4, roughness: 0.5 }),
    visor: std({ color: 0x04060b, metalness: 1, roughness: 0.06 }),
    gold: std({ color: 0xf5b301, metalness: 0.85, roughness: 0.28, emissive: 0x2a1c00 }),
    desk: std({ color: 0x1a2030, metalness: 0.5, roughness: 0.35 }),
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

// poses: what the body does, as a function of the time since the pose began
const lerp = (a, b, k) => a + (b - a) * k;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
const ARMS_DOWN = { a0x: 0, a0z: -0.1, e0: -0.15, a1x: 0, a1z: 0.1, e1: -0.15 };

const POSES = {
  // out in front of the desk, walking about and pumping the crowd
  hype: (t) => {
    // walking about, waving to the stands with one arm at a time
    const right = Math.floor(t / 3) % 2 === 0;
    const wave = Math.sin(t * 7);
    const up = { x: -0.15, z: 2.5, e: -0.55 + wave * 0.35 };
    const down = { x: 0.05, z: 0.12, e: -0.25 };
    const r = right ? up : down;
    const l = right ? down : up;
    return { spot: [Math.sin(t * 0.7) * 0.55, 1.35 + Math.cos(t * 0.7) * 0.25], walkAnim: true, seat: false, bounce: Math.abs(Math.sin(t * 5.2)) * 0.06, turn: Math.sin(t * 0.9) * 0.5, lean: 0, look: -0.1, a0x: r.x, a0z: -r.z, e0: r.e, a1x: l.x, a1z: l.z, e1: l.e };
  },
  // at the desk, hands near the keyboard, waiting for the bell
  guard: (t) => ({ spot: [0, 0], reach: 'keys', seat: true, bounce: 0, turn: 0, lean: 0.1, look: 0.1, a0x: 0.45, a0z: 0.48, e0: -1.85 + Math.sin(t * 3) * 0.05, a1x: 0.45, a1z: -0.48, e1: -1.85 + Math.sin(t * 3 + 1) * 0.05 }),
  // typing
  work: (t) => ({ spot: [0, 0], reach: 'keys', seat: true, bounce: 0, turn: 0, lean: 0.2, look: 0.3 + Math.sin(t * 1.7) * 0.05, a0x: 0.45 + Math.sin(t * 21) * 0.04, a0z: 0.5, e0: -1.91 + Math.sin(t * 25) * 0.1, a1x: 0.45 + Math.sin(t * 19 + 2) * 0.04, a1z: -0.5, e1: -1.91 + Math.sin(t * 23 + 1) * 0.1 }),
  // answered in time: up from the chair, both arms high
  done: (t) => {
    const pump = (Math.sin(t * 7) + 1) / 2;
    return { spot: [0, 0], seat: false, bounce: Math.abs(Math.sin(t * 5)) * 0.12, turn: Math.sin(t * 2) * 0.2, lean: -0.05, look: 0, a0x: -0.3, a0z: -2.88, e0: -0.3 - 0.4 * pump, a1x: -0.3, a1z: 2.88, e1: -0.3 - 0.4 * (1 - pump) };
  },
  // out of time: head in its hands
  fail: (t) => ({ spot: [0, 0], reach: 'head', seat: true, bounce: 0, turn: 0, lean: 0.35, look: 0.55 + Math.sin(t * 1.4) * 0.08, shake: Math.sin(t * 2.2) * 0.3, a0x: -2.1, a0z: 0.35, e0: -1.6, a1x: -2.1, a1z: -0.35, e1: -1.6 }),
  // the fight is over, waiting for the judge
  idle: (t) => ({ spot: [0, 0], seat: true, bounce: 0, turn: 0, lean: -0.1, look: 0, ...ARMS_DOWN, a0x: -0.3, a1x: -0.3, e0: -0.6 + Math.sin(t) * 0.05, e1: -0.6 }),
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
    const up = ease((t - 0.8) / 0.4);
    const arm = side === 'red' ? { a0x: 0, a0z: -2.95 * up, e0: -0.1 } : { a1x: 0, a1z: 2.95 * up, e1: -0.1 };
    return { spot: [0, 0], seat: false, bounce: 0, turn: 0, lean: 0, look: -0.15, a0x: 0.2, a0z: -0.1, e0: -0.4, a1x: 0.2, a1z: 0.1, e1: -0.4, ...arm };
  },
};

// ------------------------------------------------------------------ a desk with a computer

function buildStation(side, M) {
  const g = new THREE.Group();
  const acc = M.accent(COLOR[side]);
  const glow = M.glow(COLOR[side], 2.6);
  const chair = new THREE.Group();
  chair.position.set(0, 0, -0.12);
  g.add(chair);
  mesh(rbox(0.58, 0.09, 0.54, 0.04), acc, [0, 0.36, 0], chair);
  mesh(rbox(0.58, 0.74, 0.08, 0.04), acc, [0, 0.78, -0.3], chair);
  mesh(new THREE.BoxGeometry(0.08, 0.6, 0.02), glow, [0, 0.8, -0.255], chair);
  mesh(cyl(0.035, 0.035, 0.32, 8), M.dark, [0, 0.18, 0], chair);
  mesh(cyl(0.3, 0.32, 0.04, 5), M.dark, [0, 0.03, 0], chair);
  const desk = new THREE.Group();
  desk.position.set(0, 0, 0.48);
  g.add(desk);
  mesh(rbox(1.5, 0.06, 0.72, 0.02), M.desk, [0, 0.72, 0], desk);
  for (const x of [-0.68, 0.68]) for (const z of [-0.28, 0.28]) mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), M.dark, [x, 0.35, z], desk);
  mesh(new THREE.BoxGeometry(1.46, 0.025, 0.025), glow, [0, 0.685, 0.36], desk);
  const monitor = new THREE.Group();
  monitor.position.set(0, 0.75, 0.7);
  g.add(monitor);
  mesh(cyl(0.03, 0.03, 0.1, 8), M.dark, [0, 0.05, 0], monitor);
  mesh(cyl(0.15, 0.17, 0.02, 16), M.dark, [0, 0.01, 0], monitor);
  const screens = { code: screenTex(side, 'code'), sent: screenTex(side, 'sent'), time: screenTex(side, 'time') };
  screens.code.wrapT = THREE.RepeatWrapping;
  const face = new THREE.MeshBasicMaterial({ map: screens.code, color: 0xc8d4ff });
  const back = new THREE.MeshStandardMaterial({ map: screenTex(side, 'back'), emissive: 0xffffff, emissiveMap: screenTex(side, 'back'), emissiveIntensity: 1.6, roughness: 0.4 });
  const dark = M.black;
  mesh(new THREE.BoxGeometry(0.86, 0.5, 0.05), [dark, dark, dark, dark, back, face], [0, 0.33, 0], monitor);
  const keyboard = new THREE.Group();
  keyboard.position.set(0, 0.765, 0.32);
  g.add(keyboard);
  mesh(rbox(0.62, 0.03, 0.2, 0.01), M.black, [0, 0, 0], keyboard);
  mesh(new THREE.BoxGeometry(0.58, 0.012, 0.16), M.glow(COLOR[side], 1.2), [0, 0.018, 0], keyboard);
  const tower = new THREE.Group();
  tower.position.set(0.6, 0, 0.42);
  g.add(tower);
  mesh(rbox(0.24, 0.5, 0.5, 0.02), M.black, [0, 0.25, 0], tower);
  mesh(new THREE.BoxGeometry(0.01, 0.42, 0.42), glow, [0.125, 0.25, 0], tower);
  const light = new THREE.PointLight(COLOR[side], 1.4, 2.6, 0);
  light.position.set(0, 1.2, 0.45);
  g.add(light);
  const parts = { monitor, keyboard, desk, chair, tower };
  const home = Object.fromEntries(Object.entries(parts).map(([k, o]) => [k, { p: o.position.clone(), q: o.quaternion.clone() }]));
  return { g, parts, home, face, screens, light };
}

// ------------------------------------------------------------------ the scene

export async function createScene(root) {
  const xg = await loadXbot().catch((e) => {
    console.warn('humanoid robots not available, using the simple ones:', e.message);
    return null;
  });
  root.innerHTML = '';
  const renderer = new THREE.WebGLRenderer({ antialias: !small, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = !small;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'gl';
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x04060b);
  scene.fog = new THREE.FogExp2(0x05070d, 0.03);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  const M = materials();

  // lights
  scene.add(new THREE.HemisphereLight(0x8fa6ff, 0x120c18, 0.32));
  const key = new THREE.DirectionalLight(0xffffff, 0.7);
  key.position.set(3, 12, 7);
  key.castShadow = !small;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
  scene.add(key);
  const spots = {};
  for (const side of ['red', 'blue']) {
    const s = new THREE.SpotLight(COLOR[side], 1.15, 0, 0.42, 0.65, 0);
    s.position.set(side === 'red' ? -4 : 4, 9, 3);
    scene.add(s, s.target);
    spots[side] = s;
  }
  const winSpot = new THREE.SpotLight(0xffd666, 0, 0, 0.3, 0.5, 0);
  winSpot.position.set(0, 11, 2);
  scene.add(winSpot, winSpot.target);

  // the ring
  const ringMat = [
    new THREE.MeshStandardMaterial({ map: hazardTex(), roughness: 0.55, metalness: 0.2 }),
    new THREE.MeshStandardMaterial({ map: floorTex(), roughness: 0.3, metalness: 0.5, envMapIntensity: 0.7 }),
    M.black,
  ];
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(RING, RING + 0.22, FLOOR, 6, 1, false, Math.PI / 6), ringMat);
  ring.position.y = FLOOR / 2;
  ring.receiveShadow = true;
  scene.add(ring);
  const corner = (k) => new THREE.Vector3(RING * Math.cos((k * Math.PI) / 3), FLOOR, RING * Math.sin((k * Math.PI) / 3));
  const cornerColor = (k) => (k === 3 ? COLOR.red : k === 0 ? COLOR.blue : 0xe6ebf5);
  for (let k = 0; k < 6; k++) {
    const a = corner(k);
    const b = corner((k + 1) % 6);
    const edge = k === 2 || k === 3 ? COLOR.red : k === 5 || k === 0 ? COLOR.blue : 0xdfe6ff;
    scene.add(bar(a.clone().setY(FLOOR + 0.02), b.clone().setY(FLOOR + 0.02), 0.035, M.glow(edge, 1.5)));
    const post = a.clone().multiplyScalar(0.97);
    scene.add(mesh(cyl(0.09, 0.1, 1.7, 12), M.dark, [post.x, FLOOR + 0.85, post.z]));
    scene.add(mesh(rbox(0.26, 0.26, 0.26, 0.06), M.glow(cornerColor(k), cornerColor(k) === 0xe6ebf5 ? 0.9 : 2.2), [post.x, FLOOR + 1.72, post.z]));
    const pb = b.clone().multiplyScalar(0.97);
    for (const h of [0.55, 1.0, 1.45]) scene.add(bar(post.clone().setY(FLOOR + h), pb.clone().setY(FLOOR + h), 0.026, M.glow(edge === 0xdfe6ff ? 0x7f8db8 : edge, edge === 0xdfe6ff ? 0.35 : 0.75)));
  }

  // the LED boards around the ring and the scoreboard cube above it
  const ticker = tickerTex();
  const tickerIn = ticker.clone();
  tickerIn.repeat.set(-3, 1); // seen from inside the circle, the text must not read backwards
  const boardGeo = new THREE.CylinderGeometry(RING + 1.6, RING + 1.6, 0.7, 96, 1, true);
  for (const [map, side] of [[ticker, THREE.FrontSide], [tickerIn, THREE.BackSide]]) {
    const m = new THREE.Mesh(boardGeo, new THREE.MeshBasicMaterial({ map, side, color: 0xa8a8a8 }));
    m.position.y = 0.35;
    scene.add(m);
  }
  const board = boardTex();
  const cube = new THREE.Group();
  cube.position.set(0, 6.95, 0.1);
  scene.add(cube);
  mesh(new THREE.BoxGeometry(3.0, 1.3, 3.0), M.black, [0, 0, 0], cube);
  for (let i = 0; i < 4; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(2.86, 1.2), new THREE.MeshBasicMaterial({ map: board, color: 0xd8d8d8 }));
    p.position.set(Math.sin((i * Math.PI) / 2) * 1.51, 0, Math.cos((i * Math.PI) / 2) * 1.51);
    p.rotation.y = (i * Math.PI) / 2;
    cube.add(p);
  }
  mesh(new THREE.BoxGeometry(3.1, 0.08, 3.1), M.glow(COLOR.gold, 1.1), [0, -0.7, 0], cube);
  scene.add(bar(new THREE.Vector3(0, 7.6, 0.1), new THREE.Vector3(0, 16, 0.1), 0.05, M.dark));

  // the stands: a raked bowl of fans, red on the left, blue on the right
  const bowl = [];
  const rings = small ? 10 : 16;
  for (let k = 0; k < rings; k++) {
    const r = RING + 2.6 + k * 0.92;
    const base = 0.15 + k * 0.52;
    const n = Math.floor((2 * Math.PI * r) / 0.6);
    for (let j = 0; j < n; j++) {
      const a = (j / n) * Math.PI * 2 + (k % 2) * (Math.PI / n);
      const x = r * Math.cos(a);
      const z = r * Math.sin(a);
      if (k > 3 && z > 0 && Math.abs(Math.atan2(x, z)) < 0.85) continue; // behind the camera the stands stay open; the first rows are seen below
      bowl.push({ x, z, base, side: x < -1.5 ? 'red' : x > 1.5 ? 'blue' : Math.random() < 0.5 ? 'red' : 'blue', ph: Math.random() * 6.28, sp: 0.8 + Math.random() * 0.6 });
    }
    const step = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.46, r + 0.46, 0.08, 96, 1, true, 0.85 + Math.PI / 2 - Math.PI, Math.PI * 2 - 1.7), M.dark);
    step.position.y = base - 0.02;
  }
  const tiers = new THREE.Mesh(new THREE.CylinderGeometry(RING + 2.2 + rings * 0.92, RING + 2.2, rings * 0.52, 96, 1, true), new THREE.MeshStandardMaterial({ color: 0x0b1020, roughness: 0.9, side: THREE.BackSide }));
  tiers.position.y = (rings * 0.52) / 2 - 0.1;
  scene.add(tiers);
  // the fans: a body in a team shirt (shoulders, arms at the sides) and a head with a face and hair;
  // some wear a cap in their team's colour. Everyone faces the ring: far fans show their faces, near
  // fans the backs of their heads.
  const tint = (geo, rgb = [1, 1, 1]) => {
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(rgb, i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return geo;
  };
  const bodyGeo = mergeGeometries([
    tint(new THREE.CapsuleGeometry(0.19, 0.3, 4, 10).scale(1.3, 1, 0.75).translate(0, 0.44, 0)),
    ...[-1, 1].map((s2) => tint(new THREE.SphereGeometry(0.1, 10, 8).translate(0.27 * s2, 0.66, 0))),
    ...[-1, 1].map((s2) => tint(new THREE.CapsuleGeometry(0.065, 0.3, 3, 8).rotateZ(0.12 * s2).translate(0.33 * s2, 0.45, 0.02))),
  ]);
  const HAIR = [0.13, 0.1, 0.08];
  const headGeo = mergeGeometries([
    tint(new THREE.CylinderGeometry(0.055, 0.06, 0.1, 8).translate(0, 0.81, 0)),
    tint(new THREE.SphereGeometry(0.115, 14, 10).scale(0.92, 1.05, 1).translate(0, 0.95, 0.01)),
    tint(new THREE.SphereGeometry(0.123, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(-0.4).translate(0, 0.965, -0.015), HAIR),
  ]);
  const capGeo = mergeGeometries([
    tint(new THREE.SphereGeometry(0.13, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).translate(0, 0.975, 0)),
    tint(new THREE.CylinderGeometry(0.1, 0.1, 0.016, 12).scale(1, 1, 1.25).translate(0, 0.965, 0.12)),
  ]);
  const fanMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  const crowd = new THREE.InstancedMesh(bodyGeo, fanMat, bowl.length);
  const heads = new THREE.InstancedMesh(headGeo, fanMat, bowl.length);
  const caps = new THREE.InstancedMesh(capGeo, fanMat, bowl.length);
  const armsGeo = mergeGeometries([-1, 1].map((s2) => tint(new THREE.CapsuleGeometry(0.06, 0.36, 2, 6).rotateZ(-0.38 * s2).translate(0.35 * s2, 0.93, 0))));
  const armed = bowl.filter(() => Math.random() < 0.45);
  const arms = new THREE.InstancedMesh(armsGeo, fanMat, armed.length);
  const shirt = { red: [0xb91c1c, 0xdc2626, 0x7f1d1d, 0xef4444, 0x991b1b], blue: [0x1d4ed8, 0x2563eb, 0x1e3a8a, 0x3b82f6, 0x1e40af], plain: [0x1f2937, 0x374151, 0x8b93a1, 0x111827, 0x6b7280] };
  const skin = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0x6b4423, 0xd9a066];
  const c = new THREE.Color();
  const mtx = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  bowl.forEach((p, i) => {
    p.h = 0.9 + Math.random() * 0.2;
    p.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.atan2(-p.x, -p.z) + (Math.random() - 0.5) * 0.4, 0));
    p.shirt = Math.random() < 0.18 ? pick(shirt.plain) : pick(shirt[p.side]);
    const w = 0.9 + Math.random() * 0.2;
    mtx.compose(pos.set(p.x, p.base, p.z), p.q, scl.set(w, p.h, w));
    crowd.setMatrixAt(i, mtx);
    heads.setMatrixAt(i, mtx);
    crowd.setColorAt(i, c.setHex(p.shirt));
    heads.setColorAt(i, c.setHex(pick(skin)));
    const cap = Math.random() < 0.22;
    caps.setMatrixAt(i, cap ? mtx : mtx.clone().scale(scl.set(0, 0, 0)));
    caps.setColorAt(i, c.setHex(p.side === 'red' ? 0xef4444 : 0x3b82f6));
  });
  armed.forEach((p, i) => arms.setColorAt(i, c.setHex(p.shirt)));
  // glow sticks: a third of those who raise their arms hold one up in their team's colour
  const stickers = armed.filter(() => Math.random() < 0.35);
  const sticks = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.03, 0.26, 2, 6).translate(0.43, 1.32, 0.04), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.6, 2.6) }), stickers.length);
  stickers.forEach((p, i) => sticks.setColorAt(i, c.setHex(p.side === 'red' ? 0xff5a5a : 0x5aa0ff)));
  for (const m of [crowd, heads, caps, arms, sticks]) {
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  // phone lights twinkling in the stands
  const flashN = small ? 120 : 260;
  const flashPos = new Float32Array(flashN * 3);
  const flashCol = new Float32Array(flashN * 3);
  const flashOf = Array.from({ length: flashN }, () => bowl[Math.floor(Math.random() * bowl.length)]);
  flashOf.forEach((p, i) => flashPos.set([p.x, p.base + 1.05, p.z], i * 3));
  const flashGeo = new THREE.BufferGeometry();
  flashGeo.setAttribute('position', new THREE.BufferAttribute(flashPos, 3));
  flashGeo.setAttribute('color', new THREE.BufferAttribute(flashCol, 3));
  const flashes = new THREE.Points(flashGeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  scene.add(flashes);

  // light beams from the roof
  const beams = [];
  const makeBeam = (color, o, width) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(width, 1, 28, 1, true), beamMaterial(color, o));
    scene.add(m);
    const b = { m, from: new THREE.Vector3(), to: new THREE.Vector3(), base: o };
    beams.push(b);
    return b;
  };
  const sweep = [0xef4444, 0x3b82f6, 0xef4444, 0x3b82f6].map((col) => makeBeam(col, 0.07, 1.3));
  const focus = { red: makeBeam(0xff9a9a, 0.04, 1.1), blue: makeBeam(0x9ab8ff, 0.04, 1.1) };
  const crown = makeBeam(0xffd666, 0.05, 1.4);
  const aimBeam = (b, from, to) => {
    const d = new THREE.Vector3().subVectors(from, to);
    const len = d.length();
    b.m.scale.set(1, len, 1);
    b.m.position.copy(to).addScaledVector(d, 0.5);
    b.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  };

  // the fighters, their desks, and the referee
  const SEAT = { red: { x: -2.15, z: 0.25, rot: 0.8 }, blue: { x: 2.15, z: 0.25, rot: -0.8 } };
  const fighters = {};
  for (const side of ['red', 'blue']) {
    const st = buildStation(side, M);
    st.g.position.set(SEAT[side].x, FLOOR, SEAT[side].z);
    st.g.rotation.y = SEAT[side].rot;
    scene.add(st.g);
    const bot = xg ? makeXRobot(side, xg, COLOR) : buildRobot(side, M);
    st.g.add(bot.root);
    fighters[side] = { st, bot, pose: 'hype', since: 0, pos: new THREE.Vector2(0, 1.35), path: [], cur: {}, events: new Set(), wrecked: false, present: true, screen: 'code', placed: false };
    spots[side].target.position.set(SEAT[side].x, FLOOR, SEAT[side].z);
    focus[side].to.set(SEAT[side].x, FLOOR, SEAT[side].z);
    focus[side].from.set(side === 'red' ? -4 : 4, 12, 2);
  }
  const refBot = xg ? makeXRobot('ref', xg, COLOR) : buildRobot('ref', M);
  refBot.root.position.set(0, FLOOR, -0.35);
  scene.add(refBot.root);
  const referee = { bot: refBot, pose: 'ref', since: 0, side: null, pos: new THREE.Vector2(0, -0.35), target: new THREE.Vector2(0, -0.35), cur: {} };

  // the atmosphere: haze, two big screens with live close-ups, pyrotechnics, flags
  const haze = buildHaze(scene, small);
  const screens = buildScreens(scene, renderer, { red: fighters.red.st, blue: fighters.blue.st }, small, M);
  const pyro = buildPyro(scene, small, FLOOR);
  const flags = buildFlags(scene, bowl, small);
  const postTops = Array.from({ length: 6 }, (_, k) => corner(k).multiplyScalar(0.97).setY(FLOOR + 1.9));
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
    }
    f.st.face.color.setHex(0xc8d4ff);
    f.wrecked = false;
    f.events.clear();
  }

  // the camera
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 140);
  // cut: true at the start, so the camera is in place from the first frame instead of drifting in
  const cam = { mode: 'sweep', winner: null, shake: 0, aim: new THREE.Vector3(0, 1.3, 0.3), dist: 13, shot: 'wide', step: 0, at: 0, cut: true };
  const SHOTS = ['wide', 'red', 'wide', 'blue'];
  const camAt = new THREE.Vector3();
  const camLook = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  const camFront = new THREE.Vector3();
  const camUp = new THREE.Vector3();
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), small ? 0.5 : 0.55, 0.45, 0.92);
  composer.addPass(bloom);
  const vignette = new ShaderPass(VignetteShader);
  vignette.uniforms.offset.value = 1.05;
  vignette.uniforms.darkness.value = 1.2;
  composer.addPass(vignette);
  composer.addPass(new OutputPass());

  let size = { w: 1, h: 1 };
  function resize() {
    const r = root.getBoundingClientRect();
    size = { w: Math.max(1, r.width), h: Math.max(1, r.height) };
    renderer.setSize(size.w, size.h, false);
    composer.setSize(size.w, size.h);
    bloom.resolution.set(size.w / 2, size.h / 2);
    camera.aspect = size.w / size.h;
    camera.fov = camera.aspect < 0.8 ? 58 : 44;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(resize).observe(root);

  const state = { exc: { red: 0.35, blue: 0.35 }, lights: 'sweep', winner: null };

  // ------------------------------------------------------------------ every frame

  function applyBody(bot, p, k) {
    const cur = bot.cur ?? (bot.cur = {});
    for (const key of ['bounce', 'turn', 'lean', 'look', 'shake', 'a0x', 'a0z', 'e0', 'a1x', 'a1z', 'e1', 'floor']) {
      const v = p[key] ?? 0;
      cur[key] = cur[key] == null ? v : cur[key] + (v - cur[key]) * k;
    }
    return cur;
  }

  function moveFighter(f, side, t, dt) {
    const bot = f.bot;
    const tt = t - f.since;
    const p = reduced ? POSES.guard(0) : POSES[f.pose](tt);
    const c = applyBody(bot, p, Math.min(1, dt * 10));
    // walk to the spot of the pose, round the desk when the way crosses it
    const goal = new THREE.Vector2(...p.spot);
    if (!f.path.length || !f.path[f.path.length - 1].equals(goal)) {
      const crossing = (f.pos.y < 0.4 && goal.y > 0.95) || (f.pos.y > 0.95 && goal.y < 0.4);
      f.path = crossing ? [new THREE.Vector2(1.05, f.pos.y), new THREE.Vector2(1.05, goal.y), goal] : [goal];
    }
    const next = f.path[0];
    const d = next.clone().sub(f.pos);
    const moving = d.length() > 0.02;
    const walking = d.length() > 0.25; // a real walk, not the small drift of a pose
    if (moving) f.pos.add(d.clampLength(0, dt * 1.7));
    else if (f.path.length > 1) f.path.shift();
    bot.root.position.set(f.pos.x, 0, f.pos.y);
    bot.yaw = turnTo(bot.yaw ?? c.turn, walking ? Math.atan2(d.x, d.y) : c.turn, Math.min(1, dt * 6));
    bot.root.rotation.y = bot.yaw;
    if (bot.pose) {
      let reach = null;
      if (p.reach === 'keys') {
        const j = Math.sin(t * 22) * 0.012;
        reach = [f.st.g.localToWorld(new THREE.Vector3(-0.13, 0.8 + j, 0.3)), f.st.g.localToWorld(new THREE.Vector3(0.13, 0.8 - j, 0.3))];
      } else if (p.reach === 'head') reach = 'head';
      bot.pose(c, p, t, walking && !p.seat, dt, reach);
    } else applyLimbs(bot, c, p, t, walking && !p.seat);
  }

  function applyLimbs(bot, c, p, t, walking) {
    const seated = p.seat && !walking;
    const sit = bot.sit = (bot.sit ?? 0) + ((seated ? 1 : 0) - (bot.sit ?? 0)) * 0.15;
    const floor = c.floor || 0;
    bot.hips.position.y = lerp(lerp(0.95, 0.5, sit), 0.22, floor) + (seated ? 0 : c.bounce);
    const step = walking ? Math.sin(t * 9) : 0;
    bot.legs.forEach((leg, i) => {
      const s = i ? -1 : 1;
      leg.hip.rotation.x = lerp(step * 0.55 * s - c.bounce * 1.5, -1.5, Math.max(sit, floor));
      leg.knee.rotation.x = lerp(Math.max(0, -step * s) * 0.7 + c.bounce * 2.5, 1.5, sit) * (1 - floor) + 0.15 * floor;
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
    const walking = d.length() > 0.03;
    if (walking) r.pos.add(d.clampLength(0, dt * 2));
    r.bot.root.position.set(r.pos.x, FLOOR, r.pos.y);
    r.bot.yaw = turnTo(r.bot.yaw ?? 0, walking && d.length() > 0.2 ? Math.atan2(d.x, d.y) : c.turn, Math.min(1, dt * 6));
    r.bot.root.rotation.y = r.bot.yaw;
    if (r.bot.pose) r.bot.pose(c, p, t, walking, dt, null);
    else applyLimbs(r.bot, c, p, t, walking);
  }

  const v3 = new THREE.Vector3();
  let last = performance.now() / 1000;
  function frame() {
    const t = performance.now() / 1000;
    const dt = Math.min(0.05, t - last);
    last = t;
    for (const side of ['red', 'blue']) state.exc[side] += (0.32 - state.exc[side]) * Math.min(1, dt * 0.35);

    // the fans jump with their side's mood
    const arr = crowd.instanceMatrix.array;
    const headArr = heads.instanceMatrix.array;
    const capArr = caps.instanceMatrix.array;
    for (let i = 0; i < bowl.length; i++) {
      const p = bowl[i];
      const e = state.exc[p.side];
      p.y = p.base + (reduced ? 0 : Math.max(0, Math.sin(t * 3.4 * p.sp + p.ph)) * (0.04 + e * 0.42));
      arr[i * 16 + 13] = p.y;
      headArr[i * 16 + 13] = p.y;
      capArr[i * 16 + 13] = p.y;
    }
    crowd.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    caps.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < armed.length; i++) {
      const p = armed[i];
      const up = !reduced && Math.sin(t * 2.1 * p.sp + p.ph * 3) > 1.25 - state.exc[p.side];
      mtx.compose(pos.set(p.x, p.y, p.z), p.q, up ? scl.set(1, p.h, 1) : scl.set(0, 0, 0));
      arms.setMatrixAt(i, mtx);
      p.up = up;
    }
    arms.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < stickers.length; i++) {
      const p = stickers[i];
      mtx.compose(pos.set(p.x, p.y, p.z), p.q, p.up ? scl.set(1, p.h, 1) : scl.set(0, 0, 0));
      sticks.setMatrixAt(i, mtx);
    }
    sticks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < flashN; i++) {
      let v = flashCol[i * 3] * 0.9;
      const e = state.exc[flashOf[i].side];
      if (!reduced && Math.random() < 0.004 + e * 0.02) v = 1;
      flashCol.set([v, v, v * 0.92], i * 3);
    }
    flashGeo.attributes.color.needsUpdate = true;

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
      b.from.set(-9 + i * 6, 13, -5);
      b.to.set(Math.sin(t * (0.45 + i * 0.12) + i * 1.7) * 5, FLOOR, Math.cos(t * (0.38 + i * 0.1) + i) * 3);
      aimBeam(b, b.from, b.to);
      b.m.visible = state.lights === 'sweep';
    });
    for (const side of ['red', 'blue']) {
      const f = fighters[side];
      f.bot.root.getWorldPosition(v3);
      focus[side].to.copy(v3);
      aimBeam(focus[side], focus[side].from, focus[side].to);
      focus[side].m.visible = state.lights === 'focus' && f.present;
      focus[side].m.material.uniforms.opacity.value = 0.03 + state.exc[side] * 0.025;
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
    winSpot.intensity = state.lights === 'winner' ? 0.9 : 0;
    haze.update(t);
    flags.update(t, state.exc);
    pyro.update(t, dt);
    screens.update();
    ticker.offset.x = reduced ? 0 : (t * 0.004) % 1; // a slow drift
    tickerIn.offset.x = -ticker.offset.x;

    // the camera: the whole ring, both corners, the referee and the scoreboard cube, with a slow
    // broadcast drift; at the end a little closer to the winner
    const portrait = camera.aspect < 0.8;
    const half = portrait ? 4.4 : 8.2;
    const hf = 2 * Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    let dist = Math.max(portrait ? 11 : 16.5, half / Math.tan(hf / 2));
    const aim = new THREE.Vector3(0, portrait ? 2.2 : 3.45, 0.4);
    if (state.lights === 'winner' && state.winner) {
      fighters[state.winner].bot.root.getWorldPosition(v3);
      aim.x += (v3.x - aim.x) * 0.3;
      aim.z += (v3.z - aim.z) * 0.15;
      dist *= 0.92;
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
    if (cam.shot === 'winClose' && state.winner) {
      const f = fighters[state.winner];
      f.bot.root.getWorldPosition(v3);
      f.st.g.getWorldQuaternion(camQ);
      camFront.set(0, 0, 1).applyQuaternion(camQ);
      const k = Math.min(1, (t - cam.at) / 4.2);
      camera.position.copy(v3).addScaledVector(camFront, 2.9 - k * 0.4).add(camUp.set(0.35, 1.85, 0));
      camLook.copy(v3).add(camUp.set(0, 1.4, 0));
      camera.lookAt(camLook);
      for (const b of beams) b.m.visible = false;
      composer.render(dt);
      requestAnimationFrame(frame);
      return;
    }
    if (cam.shot === 'faceRed' || cam.shot === 'faceBlue') {
      // face to face: from in front of the desk, the robot over its monitor (for videos and previews)
      const g = fighters[cam.shot === 'faceRed' ? 'red' : 'blue'].st.g;
      g.localToWorld(camAt.set(0.2, 2.15, 2.2));
      g.localToWorld(camLook.set(0, 1.5, 0));
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      composer.render(dt);
      requestAnimationFrame(frame);
      return;
    }
    if (cam.shot !== 'wide') {
      const g = fighters[cam.shot].st.g;
      const k = Math.min(1, (t - cam.at) / 3.5);
      const out = cam.shot === 'red' ? -1 : 1; // from the outer side of the ring, away from the referee
      g.localToWorld(camAt.set(2.3 * out, 3.35 - k * 0.15, -2.75 + k * 0.3));
      g.localToWorld(camLook.set(-0.3 * out, 1.15, 0.5));
      for (const b of beams) b.m.visible = false; // no haze of the roof lights right in front of the lens
      camera.position.copy(camAt);
      camera.lookAt(camLook);
      composer.render(dt);
      requestAnimationFrame(frame);
      return;
    }
    if (cam.cut) {
      cam.cut = false;
      cam.aim.copy(aim);
      cam.dist = dist;
    }
    cam.aim.lerp(aim, Math.min(1, dt * 1.2));
    cam.dist += (dist - cam.dist) * Math.min(1, dt * 1.2);
    const az = Math.PI / 2 + (reduced ? 0 : Math.sin(t * 0.08) * 0.22);
    const el = portrait ? 0.62 : 0.48;
    camera.position.set(cam.aim.x + Math.cos(az) * Math.cos(el) * cam.dist, cam.aim.y + Math.sin(el) * cam.dist, cam.aim.z + Math.sin(az) * Math.cos(el) * cam.dist);
    if (cam.shake > 0) {
      camera.position.x += (Math.random() - 0.5) * cam.shake;
      camera.position.y += (Math.random() - 0.5) * cam.shake;
      cam.shake = Math.max(0, cam.shake - dt * 0.6);
    }
    camera.lookAt(cam.aim);
    composer.render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  document.fonts?.ready.then(() => {
    redraw(ticker, () => {});
    redraw(board, () => {});
  });

  // ------------------------------------------------------------------ what the page can ask

  const now = () => performance.now() / 1000;
  return {
    kind: '3d',
    setFighters({ blue }) {
      fighters.blue.present = !!blue;
      fighters.blue.st.g.visible = !!blue;
    },
    setPose(side, pose) {
      const f = fighters[side];
      if (!f || f.pose === pose) return;
      if (f.wrecked && pose !== 'lose') resetStation(f);
      f.pose = pose;
      f.since = now();
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
    /** Hold one camera shot ('wide', 'red', 'blue', 'faceRed', 'faceBlue'), or null to let the cuts run (for videos and previews). */
    holdShot(shot) {
      cam.fixed = shot;
      cam.at = now();
    },
  };
}

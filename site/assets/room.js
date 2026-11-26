// The hall around the fight: a dark arena in haze, a hexagon ring of dark steel (six thick posts with
// an LED strip set into their faces, braided steel ropes, a canvas of embossed hex plates with the
// gold emblem in the middle, an apron of riveted steel panels with backlit mesh grilles and steps up
// the near side), a wet black floor that mirrors it all, ringed by a dashed light track, a circular
// box truss with moving heads and LED blocks above, a plain steel railing, and the stands: three tiers
// of stepped rows round the hall, lit stair aisles, balconies with railings and LED dashes, a crowd on
// the seats and their phones. Red is the left half of the hall, green the right.
// The ring's steel (posts, apron, brackets, steps, canvas) and the crowd come baked from
// assets/arena/ (loadHallAssets); when they do not load, the hall builds its own in code.
// The fighters, their desks, the referee and the scoreboard are scene3d.js's; this module only builds
// and runs the room.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const MIRROR = 1; // the layer of what the wet floor mirrors
export const TIME = { value: 0 }; // shared by the shaders that move
const MIRROR_PASS = { value: 0 }; // 1 while the floor's mirror is drawn
export const TRUSS = { y: 9.0, r: 9.6, yIn: 8.05, rIn: 4.4 }; // the two rings of the lighting truss
export const STANDS_R = 13.5; // the first row of the stands
export const RAIL_R = STANDS_R - 0.1; // the steel railing in front of them
export const ROPES = [0.35, 0.72, 1.08, 1.45]; // the ropes' heights over the canvas
// what weighs on the ropes (a climbing fighter's feet and hands), set each frame by scene3d.js: up to four
// loads, each (x, rope's height, z, how far down in metres) and its side of the ring (the post's x and z,
// where along the side from that post the rope starts and ends); a rope dips in a V to its two ends
export const ROPE_LOAD = { at: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, side: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) } };

// The stands, from the floor out: the lower bowl, then a middle and an upper tier, each on a balcony
// over a walkway behind the tier below. rows of `depth` metres each rising `rise`; `aisles` stair
// aisles cut through them round the circle; gap: the walkway; fascia: the balcony's wall above it.
const TIERS = [
  { rows: 19, depth: 0.49, rise: 0.245, aisles: 12 },
  { rows: 15, depth: 0.5, rise: 0.312, aisles: 16, gap: 1.9, fascia: 2.5 },
  { rows: 14, depth: 0.49, rise: 0.36, aisles: 20, gap: 1.2, fascia: 2.3 },
];
const SEAT_W = 0.37; // a seat's share of its row
const AISLE_W = 1.3;
for (const [k, t] of TIERS.entries()) {
  const below = TIERS[k - 1];
  const r0 = below ? below.r1 + t.gap : STANDS_R + 0.25;
  const y0 = below ? below.yTop + t.fascia : 0.55;
  Object.assign(t, { k, r0, y0, r1: r0 + t.rows * t.depth, yTop: y0 + (t.rows - 1) * t.rise });
}
/** The height of the stands' floor (a tread, or the walkway behind a tier) `r` metres from the centre. */
export function standHeight(r) {
  if (r < TIERS[0].r0) return 0;
  for (const t of TIERS) {
    if (r < t.r0) return t.y0 - t.fascia; // the walkway in front of this tier's balcony
    if (r < t.r1) return t.y0 + Math.floor((r - t.r0) / t.depth) * t.rise;
  }
  return TIERS[TIERS.length - 1].yTop;
}

const RED = new THREE.Color().setRGB(1, 0.012, 0.012); // linear: a pure, deep red
const GREEN = new THREE.Color().setRGB(0.02, 1, 0.07); // and a pure green
const sideColor = (x) => (x < 0 ? RED : GREEN);

// ------------------------------------------------------------------ the baked parts

const ARENA = new URL('./arena/', import.meta.url).href;
/**
 * Loads the hall's baked parts: the ring kit (steel posts, apron sides, brackets, steps, canvas,
 * emblem, desk, monitor and chair, baked PBR maps inside) and the crowd's atlas (people in their poses,
 * colour and normal maps and the cells). Phones take the smaller set. Either is null if it does not load:
 * the hall then builds that part in code.
 */
export async function loadHallAssets(small) {
  const soft = (p, what) => p.catch((e) => {
    console.warn(`${what} not available, building it in code:`, e?.message || 'failed to load');
    return null;
  });
  const kit = new GLTFLoader().loadAsync(`${ARENA}models/ring-kit${small ? '-lite' : ''}.glb`).then((gltf) => {
    const pieces = Object.fromEntries(gltf.scene.children.map((o) => [o.name, o]));
    // the steel needs the hall's reflections to read as steel; the canvas's plates are blackened metal
    // that takes the lamps' light; the gold is polished metal with its own maps (buffing swirls and fine
    // scratches in its roughness and normals, a faint tarnish in patches), its shine the reflections on
    // its chamfers and a breath of its own light, so it reads in shadow
    const tune = { KIT: 1.7, ACCENT_NEUTRAL: 1.3, CANVAS: 2.2, GOLD: 1.6, GRILLE: 1.6, TREAD: 2.6 };
    gltf.scene.traverse((o) => {
      const m = o.material;
      if (!o.isMesh || !tune[m.name]) return;
      m.envMapIntensity = tune[m.name];
      if (m.name === 'CANVAS') m.metalness = 0.8;
      if (m.name === 'GOLD') Object.assign(m, { aoMap: null, metalness: 1, roughness: 1, emissive: new THREE.Color(0xf2cf6e), emissiveMap: m.map, emissiveIntensity: 0.025 });
      if (m.name === 'GRILLE') m.alphaTest = 0.35;
      if (m.name === 'KIT' || m.name === 'TREAD') shoulder(m);
    });
    return pieces;
  });
  const lite = small ? '-lite' : '';
  const load = (name, srgb) => new THREE.TextureLoader().loadAsync(`${ARENA}${name}`).then((t) => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
  // the crowd: the people, their normals and (not on phones) their heads at about twice the texels
  const crowd = Promise.all([
    fetch(`${ARENA}crowd-atlas.json`).then((r) => (r.ok ? r.json() : Promise.reject(new Error(`crowd-atlas.json: ${r.status}`)))),
    load(`crowd-atlas${lite}.webp`, true),
    load(`crowd-atlas${lite}-normal.webp`, false),
    small ? null : load('crowd-heads.webp', true).catch(() => null),
  ]).then(([atlas, map, normal, heads]) => ({ cells: atlas.cells, elev: atlas.elev, headsSize: atlas.headsSize, map, normal, heads: atlas.files?.heads ? heads : null }));
  const [k, c] = await Promise.all([soft(kit, 'the ring kit'), soft(crowd, 'the crowd atlas')]);
  return { kit: k, crowd: c };
}

// ------------------------------------------------------------------ noise and drawn textures

/** An LED strip across its width (u): its colour (linear, deep at the edges) rising to a white-hot core
 *  (a touch of the colour left in it). */
function stripCore(color) {
  const c = canvas(64, 2);
  const g = c.getContext('2d');
  const hot = color.clone().lerp(new THREE.Color(1, 1, 1), 0.8);
  const gr = g.createLinearGradient(0, 0, 64, 0);
  for (const [u, k] of [[0, 0], [0.22, 0.04], [0.4, 0.45], [0.5, 1], [0.6, 0.45], [0.78, 0.04], [1, 0]]) gr.addColorStop(u, `#${color.clone().lerp(hot, k).getHexString(THREE.SRGBColorSpace)}`);
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 2);
  return tex(c, { aniso: 4 });
}

/** A tileable value-noise field, `size` square, summed over octaves: values about 0..1. */
function fbm(size, cells, octaves = 5, seed = 1) {
  let s = seed * 9301 + 49297;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = cells << o;
    const lat = new Float32Array(n * n).map(rnd);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * n;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % n) * n;
      const r1 = ((y0 + 1) % n) * n;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * n;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % n;
        const a = lat[r0 + x0] + (lat[r0 + x1] - lat[r0 + x0]) * sx;
        const b = lat[r1 + x0] + (lat[r1 + x1] - lat[r1 + x0]) * sx;
        out[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
function tex(c, { srgb = true, repeat = null, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  t.anisotropy = aniso;
  return t;
}

/** A soft round spot of light, for pools on the floor and glows. */
export function softSpot(size = 128, k = 2.2) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.min(1, Math.hypot(x - size / 2 + 0.5, y - size / 2 + 0.5) / (size / 2));
    const v = Math.pow(1 - d, k) * 255;
    const i = (y * size + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false });
}


/** A normal map from a height field `h` (size × size, tiling), `k` the bumps' strength. */
function normalFrom(h, size, k, repeat = null) {
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * k;
    const dy = (at(x, y + 1) - at(x, y - 1)) * k;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat });
}

/** The heights a canvas holds, as 0..1 from its red channel. */
function heightsOf(c) {
  const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const h = new Float32Array(c.width * c.height);
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] / 255;
  return h;
}

/** The IBITI emblem as the ring shows it: a hexagon outline with its points to the sides and three
 *  bars across, `r` the hexagon's corner radius. */
function emblemPath(g, cx, cy, r, fill) {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = fill;
  const hex = (rr) => {
    for (let k = 0; k < 6; k++) g[k ? 'lineTo' : 'moveTo'](rr * Math.cos((k * Math.PI) / 3), rr * Math.sin((k * Math.PI) / 3));
    g.closePath();
  };
  g.beginPath();
  hex(r);
  hex(r * 0.8); // the hole
  g.fill('evenodd');
  const bw = r * 0.86;
  const bh = r * 0.155;
  for (const y of [-1, 0, 1]) g.fillRect(-bw / 2, y * r * 0.255 - bh / 2, bw, bh);
  g.restore();
}

/** The ring's canvas: plates of near-black steel in a hexagon pattern, each a touch different, with
 *  bevelled edges and dark seams, and the emblem inlaid in gold in the middle. `R` the canvas's corner
 *  radius in metres. Returns colour, roughness (green) / metalness (blue), normal and emissive maps. */
function plateMaps(size, R, ring) {
  const ppm = size / (2 * R); // pixels per metre
  const tile = 0.46 * ppm; // a plate's corner radius
  const col = canvas(size);
  const g = col.getContext('2d');
  const hc = canvas(size);
  const hg = hc.getContext('2d');
  const rc = canvas(size);
  const rg = rc.getContext('2d');
  g.fillStyle = '#060607';
  g.fillRect(0, 0, size, size);
  hg.fillStyle = '#000';
  hg.fillRect(0, 0, size, size);
  rg.fillStyle = 'rgb(0,110,150)';
  rg.fillRect(0, 0, size, size);
  const hexAt = (cg, x, y, r) => {
    cg.beginPath();
    for (let k = 0; k < 6; k++) cg.lineTo(x + r * Math.cos((k * Math.PI) / 3), y + r * Math.sin((k * Math.PI) / 3));
    cg.closePath();
  };
  const tint = ring === 'green' ? [0, 2, 1] : [1, 0, 1];
  const dx = tile * 1.5;
  const dy = tile * Math.sqrt(3);
  for (let i = -1; i * dx < size + tile; i++) for (let j = -1; j * dy < size + tile; j++) {
    const x = i * dx;
    const y = j * dy + (i % 2 ? dy / 2 : 0);
    const v = 36 + Math.random() * 14;
    // the plate, a little lighter at its upper left, darker at its lower right: it stands proud
    const grad = g.createLinearGradient(x - tile, y - tile, x + tile, y + tile);
    grad.addColorStop(0, `rgb(${v + 8 + tint[0]},${v + 8 + tint[1]},${v + 11 + tint[2]})`);
    grad.addColorStop(1, `rgb(${v - 8},${v - 8},${v - 6})`);
    g.fillStyle = grad;
    hexAt(g, x, y, tile - 2.2 * (size / 2048));
    g.fill();
    // a bevel: a light line just inside the edge
    g.strokeStyle = `rgba(150,155,165,${0.1 + Math.random() * 0.08})`;
    g.lineWidth = 1.6 * (size / 2048);
    hexAt(g, x, y, tile - 4.5 * (size / 2048));
    g.stroke();
    // heights: the plate up, its edge sloping down to the seam
    for (let s = 0; s < 4; s++) {
      const k = s / 3;
      hg.fillStyle = `rgb(${90 + k * 140},0,0)`;
      hexAt(hg, x, y, tile - (1.5 + (1 - k) * 0 + s * 2.2) * (size / 2048));
      hg.fill();
    }
    // roughness: each plate its own polish
    const rough = 70 + Math.random() * 40;
    rg.fillStyle = `rgb(0,${rough},${130 + Math.random() * 40})`;
    hexAt(rg, x, y, tile - 2 * (size / 2048));
    rg.fill();
  }
  // grime and wear: soft blots, a scuff where the fighters walk
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (0.2 + Math.random() * 0.9) * ppm;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, Math.random() < 0.6 ? 'rgba(0,0,0,.16)' : 'rgba(255,255,255,.03)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the emblem, inlaid in gold, raised a little
  const er = 2.1 * ppm;
  const c0 = size / 2;
  const gold = g.createLinearGradient(c0 - er, c0 - er, c0 + er, c0 + er);
  gold.addColorStop(0, '#b88a34');
  gold.addColorStop(0.45, '#9a6818');
  gold.addColorStop(0.7, '#ab7c2a');
  gold.addColorStop(1, '#8a5a12');
  emblemPath(g, c0, c0, er, gold);
  emblemPath(hg, c0, c0, er, '#ffffff');
  emblemPath(rg, c0, c0, er, 'rgb(0,165,90)'); // satin gold paint: rough 0.65, metal 0.35
  // the light it gives back even in shadow (so it always reads as gold)
  const ec = canvas(size / 4);
  const eg = ec.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, size / 4, size / 4);
  emblemPath(eg, size / 8, size / 8, er / 4, '#ffb238');
  const hs = size / 2;
  const small = canvas(hs);
  small.getContext('2d').drawImage(hc, 0, 0, hs, hs);
  return {
    map: tex(col, { aniso: 12 }),
    rough: tex(rc, { srgb: false }),
    normal: normalFrom(heightsOf(small), hs, 2.2),
    emissive: tex(ec),
  };
}

/** Over the whole canvas (the kit's plates tile), in three channels: r grime (blotches, darker where the
 *  fighters walk, lighter where the plates are scuffed bright; 0.5 the plain plate), g dust (a dry film
 *  that gathers towards the ropes and the corners), b the soles' rubber marks (short dark arcs, most
 *  of them in the middle and round the stations). The texture spans the ring's width. */
function grimeTex(size) {
  const n = fbm(size, 5, 5, 31);
  const f = fbm(size, 24, 3, 17);
  const d = fbm(size, 9, 4, 43);
  const marks = canvas(size);
  const mg = marks.getContext('2d');
  mg.fillStyle = '#000';
  mg.fillRect(0, 0, size, size);
  let seed = 977;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const px = size / 12.2; // pixels a metre (the texture spans 2R + 0.2)
  const spots = [[0, 0, 2.6], [-2.7, -1.5, 1.4], [2.7, -1.5, 1.4], [0, 3.2, 1.6]]; // the middle, the stations, the steps' side
  mg.lineCap = 'round';
  for (let i = 0; i < 420; i++) {
    const [cx, cz, r] = spots[i % 5 === 0 ? 1 + (i % 3) : 0];
    const a = rnd() * Math.PI * 2;
    const rr = r * Math.sqrt(rnd());
    const x = (cx + Math.cos(a) * rr) * px + size / 2;
    const y = size / 2 - (cz + Math.sin(a) * rr) * px; // canvas rows run down, the texture's v (z) up
    const len = (0.12 + rnd() * 0.45) * px;
    const dir = rnd() * Math.PI * 2;
    const bend = (rnd() - 0.5) * len * 0.8;
    mg.strokeStyle = `rgba(255,255,255,${0.3 + rnd() * 0.6})`;
    mg.lineWidth = Math.max(1.5, (0.02 + rnd() * 0.045) * px);
    mg.beginPath();
    mg.moveTo(x, y);
    mg.quadraticCurveTo(x + Math.cos(dir) * len * 0.5 - Math.sin(dir) * bend, y + Math.sin(dir) * len * 0.5 + Math.cos(dir) * bend, x + Math.cos(dir) * len, y + Math.sin(dir) * len);
    mg.stroke();
  }
  const md = mg.getImageData(0, 0, size, size).data;
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const r = Math.hypot(x - size / 2, y - size / 2) / (size / 2); // 0 the middle, about 1 the ring's corners
      const v = 128 + (THREE.MathUtils.smoothstep(n[i], 0.3, 0.75) - 0.5) * 150 + (f[i] - 0.5) * 60 - THREE.MathUtils.smoothstep(r, 0.55, 0.95) * 30;
      const dust = THREE.MathUtils.smoothstep(d[i] * 0.7 + r * 0.55 + (f[i] - 0.5) * 0.3, 0.62, 0.95);
      img.data[i * 4] = v;
      img.data[i * 4 + 1] = dust * 255;
      img.data[i * 4 + 2] = md[i * 4];
      img.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, aniso: 8 });
}

/** The posts' polished caps: turned steel (fine rings round the cap, in the roughness), smudges where
 *  hands lean on them, scratches, a little grime at the lip. Colour (multiplies the steel) and roughness
 *  (absolute: 0.1 to 0.4), u round the cap, v up its profile. */
function capMaps(size) {
  const sm = fbm(size, 6, 4, 61);
  const fine = fbm(size, 48, 2, 62);
  const c = canvas(size);
  const r = canvas(size);
  const g = c.getContext('2d');
  const rg = r.getContext('2d');
  const img = g.createImageData(size, size);
  const rimg = rg.createImageData(size, size);
  let seed = 4421;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const rings = Array.from({ length: size }, () => rnd());
  for (let y = 0; y < size; y++) {
    const v = 1 - y / size; // 0 the lip, 1 the top
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const smudge = THREE.MathUtils.smoothstep(sm[i], 0.45, 0.8);
      const rough = 0.12 + 0.05 * rings[y] + 0.04 * (fine[i] - 0.5) + 0.2 * smudge + 0.08 * THREE.MathUtils.smoothstep(v, 0.25, 0.0);
      const col = (0.93 + 0.07 * rings[y] - 0.12 * smudge - 0.25 * THREE.MathUtils.smoothstep(v, 0.2, 0.0)) * 255;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = col;
      img.data[i * 4 + 3] = 255;
      rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = rough * 255;
      rimg.data[i * 4 + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  // scratches: short straight strokes, brighter and smoother in the colour, rougher in the roughness
  for (let k = 0; k < 140; k++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const a = rnd() * Math.PI;
    const l = (0.02 + rnd() * 0.12) * size;
    for (const [ctx, style] of [[g, `rgba(255,255,255,${0.05 + rnd() * 0.12})`], [rg, `rgba(100,100,100,${0.25 + rnd() * 0.35})`]]) {
      ctx.strokeStyle = style;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
      ctx.stroke();
    }
  }
  return { map: tex(c, { repeat: [2, 1], aniso: 8 }), rough: tex(r, { srgb: false, repeat: [2, 1], aniso: 8 }) };
}

/** Dark brushed steel with a little grime, `w` × `h`, tiling. */
function steelTex(w, h, base = 46) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const n = fbm(128, 4, 4, 23);
  for (let y = 0; y < h; y++) {
    let streak = 0;
    for (let x = 0; x < w; x++) {
      if (x % 7 === 0) streak = (Math.random() - 0.5) * 9;
      const v = base + streak + (n[((y * 128 / h) | 0) * 128 + ((x * 128 / w) | 0)] - 0.5) * 22;
      const i = (y * w + x) * 4;
      img.data[i] = v;
      img.data[i + 1] = v + 1;
      img.data[i + 2] = v + 4;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Rivets along the edges of a rectangle (x, y, w, h) every `step` pixels. */
function rivets(g, x, y, w, h, step, r) {
  const dot = (px, py) => {
    const gr = g.createRadialGradient(px - r * 0.3, py - r * 0.3, 0, px, py, r);
    gr.addColorStop(0, 'rgba(200,205,215,.9)');
    gr.addColorStop(0.6, 'rgba(90,94,102,.9)');
    gr.addColorStop(1, 'rgba(10,10,12,.9)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(px, py, r, 0, Math.PI * 2);
    g.fill();
  };
  for (let px = x; px <= x + w + 0.1; px += step) {
    dot(px, y);
    dot(px, y + h);
  }
  for (let py = y + step; py < y + h - 0.1; py += step) {
    dot(x, py);
    dot(x + w, py);
  }
}

/** One panel of the apron's slanted skirt: a riveted steel frame round a diamond-mesh grille that is
 *  lit from behind, an LED line along the grille's foot. Colour map and emissive map (white where the
 *  light comes through; the material gives it the side's colour). */
function skirtMaps() {
  const W = 1024;
  const H = 256;
  const c = steelTex(W, H, 40);
  const g = c.getContext('2d');
  const e = canvas(W, H);
  const eg = e.getContext('2d');
  eg.fillStyle = '#000';
  eg.fillRect(0, 0, W, H);
  // the frame's bevels
  g.strokeStyle = 'rgba(160,165,175,.35)';
  g.lineWidth = 3;
  g.strokeRect(6, 6, W - 12, H - 12);
  g.strokeStyle = 'rgba(0,0,0,.6)';
  g.lineWidth = 4;
  g.strokeRect(12, 12, W - 24, H - 24);
  rivets(g, 26, 22, W - 52, H - 44, 48, 4.2);
  // the grille's opening, sunk into the frame
  const gx = 70;
  const gy = 50;
  const gw = W - 140;
  const gh = H - 100;
  g.fillStyle = '#050506';
  g.fillRect(gx - 6, gy - 6, gw + 12, gh + 12);
  g.strokeStyle = 'rgba(170,175,185,.4)';
  g.lineWidth = 3;
  g.strokeRect(gx - 8, gy - 8, gw + 16, gh + 16);
  // the light behind it: strongest at the foot, as a strip there throws it up
  const glow = eg.createLinearGradient(0, gy, 0, gy + gh);
  glow.addColorStop(0, 'rgba(255,255,255,.45)');
  glow.addColorStop(0.7, 'rgba(255,255,255,.8)');
  glow.addColorStop(1, 'rgba(255,255,255,1)');
  eg.fillStyle = glow;
  eg.fillRect(gx, gy, gw, gh);
  // the mesh: diagonal wires both ways, dark on the colour map and on the light
  const s = 30;
  for (const cg of [g, eg]) {
    cg.save();
    cg.beginPath();
    cg.rect(gx, gy, gw, gh);
    cg.clip();
    cg.strokeStyle = cg === g ? '#2a2c31' : '#000';
    cg.lineWidth = 6;
    for (let x = gx - gh; x < gx + gw + gh; x += s) {
      cg.beginPath();
      cg.moveTo(x, gy);
      cg.lineTo(x + gh, gy + gh);
      cg.stroke();
      cg.beginPath();
      cg.moveTo(x + gh, gy);
      cg.lineTo(x, gy + gh);
      cg.stroke();
    }
    cg.restore();
  }
  // the LED line at the grille's foot
  eg.fillStyle = '#fff';
  eg.fillRect(gx, gy + gh + 10, gw, 7);
  g.fillStyle = '#ddd';
  g.fillRect(gx, gy + gh + 10, gw, 7);
  return { map: tex(c, { aniso: 8 }), emissive: tex(e, { aniso: 8 }) };
}

/** The flat steel lip round the ring's top and the corner brackets: riveted plates. */
function plateTex(W = 512, H = 128) {
  const c = steelTex(W, H, 50);
  const g = c.getContext('2d');
  g.strokeStyle = 'rgba(0,0,0,.55)';
  g.lineWidth = 3;
  for (let x = 0; x <= W; x += W / 4) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, H);
    g.stroke();
  }
  g.strokeStyle = 'rgba(170,175,185,.25)';
  g.lineWidth = 2;
  g.strokeRect(3, 3, W - 6, H - 6);
  rivets(g, 14, 14, W - 28, H - 28, 30, 3.4);
  return tex(c, { repeat: [1, 1] });
}

/** Diamond plate, for the treads of the steps: colour and normal. */
function treadMaps() {
  const S = 128;
  const c = steelTex(S, S, 58);
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    // raised lozenges, alternating in direction
    const cx = (x % 32) - 16;
    const cy = (y % 32) - 16;
    const flip = ((x >> 5) + (y >> 5)) % 2 ? 1 : -1;
    const u = (cx + flip * cy) / 1.414;
    const v = (cx - flip * cy) / 1.414;
    h[y * S + x] = Math.max(0, 1 - Math.hypot(u / 11, v / 2.6));
  }
  return { map: tex(c, { repeat: [10, 2] }), normal: normalFrom(h, S, 3, [10, 2]) };
}

/** Braided steel cable, as tiling maps over one lay of the rope (u: `BRAID.lay` metres along it, v:
 *  once round): six strands winding round it, each laid of fine wires at their own angle; the grooves
 *  between the strands deep, dark and dull, the wires' crests polished, each wire a touch different.
 *  Returns the normal map, a colour map (the grooves darker) and an ORM map (R the grooves' occlusion,
 *  G the roughness). Mipmapped and anisotropic, so far off it settles to a calm sheen. */
const BRAID = { lay: 0.24, strands: 6 }; // a strand's crest every 4 cm along the rope
function braidMaps(S) {
  const N = BRAID.strands;
  const WIRES = S >= 512 ? 64 : 40; // wires round the rope, each a few mm
  const h = new Float32Array(S * S);
  const col = canvas(S);
  const orm = canvas(S);
  const ci = col.getContext('2d').createImageData(S, S);
  const oi = orm.getContext('2d').createImageData(S, S);
  const wireHash = (k) => {
    const s = Math.sin(k * 127.1 + 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = (x + 0.5) / S;
    const v = (y + 0.5) / S;
    const sa = N * (u + v); // across the strands (each winds once round per lay)
    const strand = Math.floor(sa) % N;
    const t = (sa - Math.floor(sa)) * 2 - 1;
    const hs = Math.sqrt(Math.max(0, 1 - t * t)); // a strand's round back
    // its wires: nearly along the rope, crossing the strand at a slant (the strand's own lay)
    const wa = WIRES * v - 8 * u + strand * 0.37;
    const wire = Math.floor(wa) + strand * 97;
    const tw = (wa - Math.floor(wa)) * 2 - 1;
    const hw = Math.sqrt(Math.max(0, 1 - tw * tw));
    const i = y * S + x;
    h[i] = hs * 0.7 + Math.sqrt(hs) * hw * 0.3;
    const groove = 1 - Math.min(1, hs / 0.55); // 1 deep in the groove between strands
    const seam = 1 - hw; // the thin line between two wires
    const vary = wireHash(wire);
    const ao = 1 - 0.7 * groove * groove - 0.18 * seam * seam * hs;
    const bright = (0.9 + 0.1 * vary) * (1 - 0.55 * groove) * (1 - 0.2 * seam * seam);
    const rough = 0.16 + 0.09 * vary + 0.36 * groove + 0.08 * seam;
    const p = i * 4;
    ci.data[p] = ci.data[p + 1] = ci.data[p + 2] = Math.round(Math.min(1, bright) * 255);
    ci.data[p + 3] = 255;
    oi.data[p] = Math.round(Math.max(0, ao) * 255);
    oi.data[p + 1] = Math.round(Math.min(1, rough) * 255);
    oi.data[p + 2] = 255;
    oi.data[p + 3] = 255;
  }
  col.getContext('2d').putImageData(ci, 0, 0);
  orm.getContext('2d').putImageData(oi, 0, 0);
  const aniso = 16; // (three clamps it to what the GPU has)
  const normal = normalFrom(h, S, S / 48, [1, 1]);
  normal.anisotropy = aniso;
  return { normal, map: tex(col, { repeat: [1, 1], aniso }), orm: tex(orm, { srgb: false, repeat: [1, 1], aniso }) };
}

/** A soft shoulder on polished metal's brightest flashes: above 1 (linear, before the tone mapping)
 *  they roll off towards 2, so a lamp caught in the steel or the gold still flashes but never burns out
 *  to a patch of pure white. */
function shoulder(mat) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', `{
        float m = max(max(outgoingLight.r, outgoingLight.g), outgoingLight.b);
        if (m > 1.0) outgoingLight *= (1.0 + (m - 1.0) / m) / m;
      }
      #include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `shoulder${prev ? prev.toString() : ''}`;
  return mat;
}

/** Polished dark concrete, wet: colour, roughness and a fine normal map, slabs of 2.8 m. Puddles lie
 *  nearly as smooth as glass, round them it is damp, here and there drier and dull; grit, scuffs and
 *  a few hairline cracks. */
function floorMaps(size) {
  const n = fbm(size, 4, 6, 11); // the concrete's mottling
  const p = fbm(size, 6, 5, 5); // where the water lies
  const f = fbm(size, 32, 3, 7); // grit
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = canvas(size);
  const rg = r.getContext('2d');
  const rimg = rg.createImageData(size, size);
  const crack = new Uint8Array(size * size);
  for (let k = 0; k < 14; k++) {
    let x = Math.random() * size;
    let y = Math.random() * size;
    let a = Math.random() * Math.PI * 2;
    for (let i = 0; i < size * 0.4; i++) {
      a += (Math.random() - 0.5) * 0.5;
      x = (x + Math.cos(a) + size) % size;
      y = (y + Math.sin(a) + size) % size;
      crack[(y | 0) * size + (x | 0)] = 1;
    }
  }
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const seam = x % (size / 2) < 2 || y % (size / 2) < 2 ? 1 : 0;
    const wet = THREE.MathUtils.smoothstep(p[i], 0.36, 0.66);
    const v = 40 + (n[i] - 0.5) * 20 + (f[i] - 0.5) * 10 - seam * 9 - crack[i] * 13 - wet * 4;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v + 0.5;
    img.data[i * 4 + 2] = v + 2;
    img.data[i * 4 + 3] = 255;
    const rough = 0.3 - wet * 0.24 + (n[i] - 0.5) * 0.1 + (f[i] - 0.5) * 0.06 + (seam || crack[i] ? 0.2 : 0);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = Math.max(6, Math.min(255, rough * 255));
    rimg.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  const bump = new Float32Array(size * size).map((_, i) => f[i] - crack[i] * 0.3);
  return { map: tex(c, { repeat: [5, 5] }), rough: tex(r, { srgb: false, repeat: [5, 5] }), normal: normalFrom(bump, size, 1.2, [5, 5]) };
}

/** The emblem on a dark steel plate, for the desks' fronts and the scoreboard's sides. */
export function emblemPlate(w = 512, h = 512, glow = null) {
  const c = steelTex(w, h, 30);
  const g = c.getContext('2d');
  const r = Math.min(w, h) * 0.34;
  if (glow) {
    // an LED panel: its colour glowing up from the foot and in from the edges, through a fine dot grid
    const foot = g.createLinearGradient(0, h, 0, 0);
    foot.addColorStop(0, glow);
    foot.addColorStop(0.45, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.55;
    g.fillStyle = foot;
    g.fillRect(0, 0, w, h);
    const edge = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
    edge.addColorStop(0, 'rgba(0,0,0,0)');
    edge.addColorStop(1, glow);
    g.globalAlpha = 0.4;
    g.fillStyle = edge;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(0,0,0,.45)';
    for (let x = 0; x < w; x += 3) g.fillRect(x, 0, 1, h);
    for (let y = 0; y < h; y += 3) g.fillRect(0, y, w, 1);
  }
  g.save();
  g.translate(w / 2, h / 2);
  g.rotate(Math.PI / 2); // on an upright face the emblem stands on a point, as on the scoreboard
  const gold = g.createLinearGradient(-r, -r, r, r);
  gold.addColorStop(0, '#ffd774');
  gold.addColorStop(0.5, '#e2a634');
  gold.addColorStop(1, '#f3c252');
  g.shadowColor = 'rgba(255,180,60,.55)';
  g.shadowBlur = r * 0.18;
  g.beginPath();
  for (let k = 0; k < 6; k++) g[k ? 'lineTo' : 'moveTo'](r * Math.cos((k * Math.PI) / 3), r * Math.sin((k * Math.PI) / 3));
  g.closePath();
  for (let k = 0; k < 6; k++) g[k ? 'lineTo' : 'moveTo'](r * 0.8 * Math.cos((-k * Math.PI) / 3), r * 0.8 * Math.sin((-k * Math.PI) / 3));
  g.closePath();
  g.fillStyle = gold;
  g.fill();
  g.rotate(-Math.PI / 2);
  for (const y of [-1, 0, 1]) g.fillRect(-r * 0.38, y * r * 0.27 - r * 0.075, r * 0.76, r * 0.15);
  g.restore();
  return tex(c, { aniso: 8 });
}

// ------------------------------------------------------------------ the environment light

/** What the metal reflects, seen from the ring's middle: a dark hall, rings of small hot lamps on the
 *  truss above and the haze they light under the roof, the scoreboard's faces, the stands all round in
 *  bands (mostly grey, only a touch of each half's colour, dimmer as they rise) with the balconies' LED
 *  dashes, the light track and the apron low round the ring, and the wet floor below. The colour stays
 *  small and local, so the steel reads as steel; the lights carry the red and the green. */
export function hallEnvironment(renderer) {
  const env = new THREE.Scene();
  const EYE = 1.6; // the height it is seen from
  env.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: 0x040507, side: THREE.BackSide })));
  const lamp = (w, h, color, k, at, rotX = Math.PI / 2, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(at[0], at[1] - EYE, at[2]);
    m.rotation.set(rotX, rotY, 0);
    env.add(m);
  };
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    lamp(0.6, 0.6, 0xffffff, 30, [Math.cos(a) * TRUSS.r, TRUSS.y - 0.5, Math.sin(a) * TRUSS.r]);
    if (i % 2) lamp(0.5, 0.5, 0xffffff, 26, [Math.cos(a) * TRUSS.rIn, TRUSS.yIn - 0.5, Math.sin(a) * TRUSS.rIn]);
  }
  // the scoreboard's four bright faces
  for (let i = 0; i < 4; i++) lamp(3, 1.4, 0xd8dce6, 0.5, [Math.sin((i * Math.PI) / 2) * 2.5, 6.9, Math.cos((i * Math.PI) / 2) * 2.5], 0, (i * Math.PI) / 2);
  /** A ring of the hall from y0 to y1 at radius r, `sat` of the way to its side's colour, `k` bright, in
   *  `dash` dashes. */
  const band = (r, y0, y1, k, sat, dash = 0) => {
    const g = new THREE.CylinderGeometry(r, r, y1 - y0, dash ? dash * 3 : 128, 1, true).translate(0, (y0 + y1) / 2 - EYE, 0).toNonIndexed();
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i += 3) {
      // a dash: every third face pair of the ring, lit; the colour by the face's middle
      const x = (p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3 / r;
      const z = (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3 / r;
      const on = dash ? +(Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * dash * 3) % 3 === 0) : 1;
      c.setRGB(0.5, 0.48, 0.52).lerp(x < 0 ? RED : GREEN, sat * THREE.MathUtils.smoothstep(Math.abs(x), 0.1, 0.6)).multiplyScalar(k * on * (x > 0 ? 0.7 : 1));
      for (let j = 0; j < 3; j++) col.set([c.r, c.g, c.b], (i + j) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    env.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  };
  band(STANDS_R + 4, 0.4, 5.5, 0.75, 0.22);
  band(STANDS_R + 8, 5.5, 8.5, 0.3, 0.15); // the beams' haze over the stands
  band(STANDS_R + 14, 7.5, 12.5, 0.16, 0.3);
  band(STANDS_R + 23, 14, 19, 0.06, 0.2);
  band(STANDS_R + 11.6, 7.15, 7.35, 2.5, 1, 90); // the balconies' dashes
  band(9, 0.0, 0.08, 1.6, 1, 46); // the light track
  band(6.2, 0.1, 0.9, 0.22, 0.35); // the apron's glow
  lamp(22, 22, 0x8c929c, 0.32, [0, 17, 0]); // the haze under the roof, lit by the truss
  // below: the wet floor, grey with a little of each half's colour
  lamp(30, 60, 0x8c3a3c, 0.07, [-17, -0.5, 0]);
  lamp(30, 60, 0x3a7c4a, 0.05, [17, -0.5, 0]);
  lamp(14, 60, 0x5a5c62, 0.3, [0, -0.45, 0]);
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(env, 0.02).texture;
  pm.dispose();
  return t;
}

/** What polished metal up close reflects (the gold emblem, the post caps): the same hall seen sharper
 *  and with more contrast, a black room with rows of small hot lamps all round at the heights the
 *  rig's beams cross, the truss's lamps overhead, a warm glow from the stands low down and a dark
 *  floor, so a polished face catches bright points and dark gaps instead of an even tint. */
function polishedEnvironment(renderer) {
  const env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: 0x020203, side: THREE.BackSide })));
  const spot = (r, el, az, size, k, color = 0xfff4e4) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(size, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(Math.cos(az) * Math.cos(el) * r, Math.sin(el) * r, Math.sin(az) * Math.cos(el) * r);
    m.lookAt(0, 0, 0);
    env.add(m);
  };
  for (let i = 0; i < 36; i++) {
    const az = (i / 36) * Math.PI * 2;
    spot(20, 0.3 + 0.25 * ((i * 7) % 3) / 2, az + 0.05, 0.4, 9);
    if (i % 2) spot(20, 0.95 + 0.2 * (i % 3), az, 0.55, 7);
  }
  spot(20, 1.45, 0, 2.2, 2.5, 0xfff0dc); // the key's glow, straight above
  // the stands' warm glow low down, the haze the beams light over them, and the halves' colour only at
  // the sides
  for (const [y0, y1, k] of [[-1, 4, 0.32], [4, 12, 0.85]]) env.add(new THREE.Mesh(new THREE.CylinderGeometry(24, 24, y1 - y0, 64, 1, true).translate(0, (y0 + y1) / 2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x8a7a66).multiplyScalar(k), side: THREE.DoubleSide })));
  // the wet floor below, catching the hall's light (an upright gold face mirrors it to the camera)
  env.add(new THREE.Mesh(new THREE.CircleGeometry(40, 48).rotateX(-Math.PI / 2).translate(0, -5, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7a6a58).multiplyScalar(0.55), side: THREE.DoubleSide })));
  for (const [x, c] of [[-1, RED], [1, GREEN]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.6), side: THREE.DoubleSide }));
    m.position.set(x * 22, 1, 0);
    m.lookAt(0, 1, 0);
    env.add(m);
  }
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(env, 0.01).texture;
  pm.dispose();
  return t;
}

// ------------------------------------------------------------------ the floor's mirror

/** A planar reflection of the layer MIRROR in the plane y = 0, rendered at a fraction of the screen. */
function makeMirror(renderer, scene) {
  const rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType });
  rt.texture.generateMipmaps = true;
  rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const cam = new THREE.PerspectiveCamera();
  cam.layers.set(MIRROR);
  const matrix = new THREE.Matrix4();
  const normal = new THREE.Vector3(0, 1, 0);
  const origin = new THREE.Vector3();
  const plane = new THREE.Plane();
  const clip = new THREE.Vector4();
  const q = new THREE.Vector4();
  const view = new THREE.Vector3();
  const look = new THREE.Vector3();
  const target = new THREE.Vector3();
  const rot = new THREE.Matrix4();
  const camPos = new THREE.Vector3();
  return {
    texture: rt.texture,
    matrix,
    setSize(w, h) {
      rt.setSize(Math.max(64, Math.round(w)), Math.max(64, Math.round(h)));
    },
    render(camera) {
      camPos.setFromMatrixPosition(camera.matrixWorld);
      view.subVectors(origin, camPos);
      if (view.dot(normal) > 0) return;
      view.reflect(normal).negate().add(origin);
      rot.extractRotation(camera.matrixWorld);
      look.set(0, 0, -1).applyMatrix4(rot).add(camPos);
      target.subVectors(origin, look).reflect(normal).negate().add(origin);
      cam.position.copy(view);
      cam.up.set(0, 1, 0).applyMatrix4(rot).reflect(normal);
      cam.lookAt(target);
      cam.far = camera.far;
      cam.updateMatrixWorld();
      cam.projectionMatrix.copy(camera.projectionMatrix);
      matrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
      matrix.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
      // the near plane on the mirror's plane, so nothing under the floor shows in it
      plane.setFromNormalAndCoplanarPoint(normal, origin).applyMatrix4(cam.matrixWorldInverse);
      clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
      const p = cam.projectionMatrix.elements;
      q.x = (Math.sign(clip.x) + p[8]) / p[0];
      q.y = (Math.sign(clip.y) + p[9]) / p[5];
      q.z = -1;
      q.w = (1 + p[10]) / p[14];
      clip.multiplyScalar(2 / clip.dot(q));
      p[2] = clip.x;
      p[6] = clip.y;
      p[10] = clip.z + 1 - 0.003;
      p[14] = clip.w;
      const prevTarget = renderer.getRenderTarget();
      const prevShadow = renderer.shadowMap.autoUpdate;
      renderer.shadowMap.autoUpdate = false; // the shadows of this frame are drawn once, for the hall
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.setRenderTarget(prevTarget);
      renderer.shadowMap.autoUpdate = prevShadow;
    },
  };
}

// ------------------------------------------------------------------ light you can see

/** A light beam in haze: brightest in its core near the lamp, soft at its silhouette, fading out along
 *  its throw (gone by `reach` of the way down), the haze in it drifting and breaking up. */
export function volumeMaterial(color, opacity, reach = 0.66) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity }, reach: { value: reach }, time: TIME },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vView; varying vec3 vW;
      void main() {
        vH = uv.y;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        vec4 mv = viewMatrix * w;
        vView = normalize(-mv.xyz);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; uniform float reach; uniform float time;
      varying float vH; varying vec3 vN; varying vec3 vView; varying vec3 vW;
      float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x) {
        vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
      }
      void main() {
        float core = pow(abs(dot(vN, vView)), 1.6);
        float d = 1.0 - vH;                                        // 0 at the lamp, 1 where it lands
        float along = pow(clamp(1.0 - d / reach, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.14, d);
        along *= mix(0.72, 1.0, smoothstep(0.12, 0.45, d)); // the core by the lamp held below white
        vec3 q = vW * 0.75 + vec3(time * 0.05, -time * 0.11, time * 0.04);
        float haze = noise(q) * 0.65 + noise(q * 2.3 + 7.1) * 0.35;
        haze = smoothstep(0.15, 0.85, haze) * 0.85 + 0.15;
        gl_FragColor = vec4(color * opacity * core * along * haze * 3.2, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

// ------------------------------------------------------------------ the stands

/** The light on the stands, in GLSL. The scene's lamps are aimed at the ring and do not reach the
 *  stands; this stands for them: a dim cool ambient, the side's colour (red left, green right, a grey
 *  at the ends) strongest low down near the ring and on what faces it, the truss's white from above,
 *  and the pools of the fans where they land (`POOLS` of them). */
const HALL_LIGHT = `
  uniform vec3 uRed; uniform vec3 uGreen; uniform vec2 uExc; uniform float uGain;
  #if POOLS > 0
  uniform vec4 uPools[POOLS]; uniform vec3 uPoolCol[POOLS];
  #endif
  vec3 hallLight(vec3 p, vec3 n) {
    float r = length(p.xz);
    vec2 d = p.xz / max(r, 0.001);
    float redW = smoothstep(0.1, 0.65, -d.x);
    float greenW = smoothstep(0.1, 0.65, d.x);
    float low = exp(-max(p.y, 0.0) * 0.1 - max(r - 14.0, 0.0) * 0.03);
    vec3 side = uRed * redW * (0.55 + uExc.x) + uGreen * greenW * (0.35 + uExc.y) * 0.75 + vec3(0.62, 0.6, 0.68) * (1.0 - redW - greenW) * 0.6;
    float face = max(dot(n, vec3(-d.x, 0.0, -d.y)), 0.0);
    float top = max(n.y, 0.0);
    vec3 l = vec3(0.012, 0.013, 0.018) + side * low * (0.07 + 0.06 * face) + vec3(0.95, 0.92, 0.88) * low * (top * 0.03 + face * 0.025);
    #if POOLS > 0
    for (int i = 0; i < POOLS; i++) {
      vec3 q = p - uPools[i].xyz;
      l += uPoolCol[i] * exp(-dot(q, q) / uPools[i].w);
    }
    #endif
    return l * uGain;
  }`;
const HASH = 'float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }';

// The crowd atlas's people (28: the rest wear dark clothes and neutrals): who wears a corner's colour (a
// red jersey, scarves, a maroon hoodie and top, a red cap and beanie; green scarves, a green jersey, top
// and cap), and the share of each on the red half's seats, the ends' and the green half's
const FANS = { red: [2, 7, 11, 12, 16, 19, 23], green: [5, 10, 15, 20, 21], none: [0, 1, 3, 4, 6, 8, 9, 13, 14, 17, 18, 22] };
const FAN_SHARE = [[0.2, 0.02], [0.04, 0.04], [0.02, 0.2]];
// the dark hues the clothes take on (linear): black and charcoal most, a muted navy, maroon, olive,
// brown and slate
const DYES = [[0.018, 0.018, 0.02], [0.03, 0.03, 0.032], [0.045, 0.044, 0.042], [0.025, 0.03, 0.048], [0.055, 0.022, 0.024], [0.04, 0.042, 0.026], [0.05, 0.036, 0.026], [0.032, 0.038, 0.044]];

/**
 * The stands round the hall (TIERS): stepped rows of concrete, stair aisles with a light on every
 * step, a walkway behind each tier with entrances in the wall, the balconies' fronts with groups of
 * LED dashes and a steel railing, the upper dark ring's columns; a crowd on the seats (from `atlas`,
 * loadHallAssets's crowd, or cut-outs without it) and their phones. Returns the seats (`seats`), the
 * crowd and an update for each frame.
 */
function buildStands(scene, { small, steel, atlas }) {
  const pos = [];
  const nor = [];
  const uvs = [];
  const info = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  /** One quad, `n` its normal, uv as [u0, u1, v0, v1], its kind (see the shader) and tier + row share. */
  const quad = (p, n, [u0, u1, v0, v1], kind, at) => {
    let q = p;
    let t = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    e1.subVectors(p[1], p[0]);
    e2.subVectors(p[3], p[0]);
    if (e1.cross(e2).dot(n) < 0) {
      q = [p[0], p[3], p[2], p[1]];
      t = [t[0], t[3], t[2], t[1]];
    }
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(q[i].x, q[i].y, q[i].z);
      nor.push(n.x, n.y, n.z);
      uvs.push(...t[i]);
      info.push(kind, at);
    }
  };
  const P = (r, a, y) => new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
  const UP = new THREE.Vector3(0, 1, 0);
  const inward = (a) => new THREE.Vector3(-Math.cos(a), 0, -Math.sin(a));
  /** A band of a ring from angle a0 to a1, flat at height y from r0 to r1 (u: metres round, v: out). */
  const flat = (r0, r1, a0, a1, y, kind, at) => {
    const n = Math.max(1, Math.ceil(((a1 - a0) * r1) / 1.4));
    for (let i = 0; i < n; i++) {
      const b0 = a0 + ((a1 - a0) * i) / n;
      const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
      quad([P(r0, b0, y), P(r0, b1, y), P(r1, b1, y), P(r1, b0, y)], UP, [b0 * r0, b1 * r0, 0, 1], kind, at);
    }
  };
  /** The same band upright at radius r from y0 to y1, facing the ring (u: metres round, v: up). */
  const wall = (r, a0, a1, y0, y1, kind, at) => {
    const n = Math.max(1, Math.ceil(((a1 - a0) * r) / 1.2));
    for (let i = 0; i < n; i++) {
      const b0 = a0 + ((a1 - a0) * i) / n;
      const b1 = a0 + ((a1 - a0) * (i + 1)) / n;
      quad([P(r, b0, y0), P(r, b1, y0), P(r, b1, y1), P(r, b0, y1)], inward((b0 + b1) / 2), [b0 * r, b1 * r, 0, 1], kind, at);
    }
  };
  // kinds: 0 a row's tread, 1 a riser, 2 the lower bowl's front wall, 3 an aisle's step, 4 its riser
  // (lit), 5 a walkway, 6 the dark back wall and columns, 7 a balcony's front (LED dashes, entrances)
  const seats = { pos: [], side: [], tier: [], row: [] };
  const rails = [];
  const bar = (a, b, rad) => {
    const d = new THREE.Vector3().subVectors(b, a);
    const g = new THREE.CylinderGeometry(rad, rad, d.length(), 5, 1, true);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.clone().normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    rails.push(g.toNonIndexed());
  };
  for (const t of TIERS) {
    const aisle = Array.from({ length: t.aisles }, (_, j) => ((j + 0.5 + t.k * 0.31) / t.aisles) * Math.PI * 2);
    if (t.k) {
      const base = TIERS[t.k - 1].yTop;
      // the walkway behind the tier below, the balcony's front over it, a railing along its top
      flat(TIERS[t.k - 1].r1, t.r0, 0, Math.PI * 2, base, 5, t.k);
      wall(t.r0, 0, Math.PI * 2, base, t.y0, 7, t.k);
      const n = Math.round((Math.PI * 2 * t.r0) / 1.6);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        bar(P(t.r0 + 0.12, a, t.y0), P(t.r0 + 0.12, a, t.y0 + 1.05), 0.025);
      }
      for (const h of [0.55, 1.05]) rails.push(new THREE.TorusGeometry(t.r0 + 0.12, h > 1 ? 0.03 : 0.02, 5, 200).rotateX(Math.PI / 2).translate(0, t.y0 + h, 0).toNonIndexed());
    }
    const hw = (r) => AISLE_W / 2 / r; // half an aisle's angle at radius r
    for (let i = 0; i < t.rows; i++) {
      const r0 = t.r0 + i * t.depth;
      const r1 = r0 + t.depth;
      const mid = r0 + t.depth / 2;
      const y = t.y0 + i * t.rise;
      const yPrev = i ? y - t.rise : t.k ? y : 0; // a balcony's first row starts level
      const at = t.k + i / t.rows;
      // between each two aisles: the row's tread and the riser in front of it, and its seats
      for (let j = 0; j < t.aisles; j++) {
        const a0 = aisle[j] + hw(mid);
        const a1 = aisle[(j + 1) % t.aisles] + (j === t.aisles - 1 ? Math.PI * 2 : 0) - hw(mid);
        flat(r0, r1, a0, a1, y, 0, at);
        if (yPrev < y) wall(r0, a0, a1, yPrev, y, i ? 1 : 2, at);
        const rs = r0 + t.depth * 0.42;
        const len = (a1 - a0) * rs;
        const n = Math.floor(len / SEAT_W);
        for (let s = 0; s < n; s++) {
          const a = a0 + ((len - n * SEAT_W) / 2 + (s + 0.5) * SEAT_W) / rs;
          const p = P(rs, a, y);
          seats.pos.push(p.x, p.y, p.z);
          seats.side.push(Math.cos(a) < -0.3 ? -1 : Math.cos(a) > 0.3 ? 1 : 0);
          seats.tier.push(t.k);
          seats.row.push(i);
        }
      }
      // the aisles: two steps to a row, each lit along its nose; the rows' ends beside them
      for (const c of aisle) {
        const b0 = c - hw(mid);
        const b1 = c + hw(mid);
        const ya = (y + yPrev) / 2;
        if (yPrev < y) {
          quad([P(r0, b0, yPrev), P(r0, b1, yPrev), P(r0, b1, ya), P(r0, b0, ya)], inward(c), [0, AISLE_W, 0, 1], 4, at);
          quad([P(mid, b0, ya), P(mid, b1, ya), P(mid, b1, y), P(mid, b0, y)], inward(c), [0, AISLE_W, 0, 1], 4, at);
          for (const [b, s] of [[b0, 1], [b1, -1]]) quad([P(r0, b, ya), P(mid, b, ya), P(mid, b, y), P(r0, b, y)], new THREE.Vector3(-Math.sin(b) * s, 0, Math.cos(b) * s), [0, 1, 0, 1], 1, at);
        }
        quad([P(r0, b0, ya), P(r0, b1, ya), P(mid, b1, ya), P(mid, b0, ya)], UP, [0, AISLE_W, 0, 0.5], 3, at);
        quad([P(mid, b0, y), P(mid, b1, y), P(r1, b1, y), P(r1, b0, y)], UP, [0, AISLE_W, 0.5, 1], 3, at);
      }
    }
    // a handrail up the middle of every aisle (none on the lower bowl in front of the wide shot's lens)
    for (const c of aisle) {
      if (t.k === 0 && Math.sin(c) > 0.2) continue;
      bar(P(t.r0 + 0.3, c, t.y0 + 0.9), P(t.r1 - 0.3, c, t.yTop + 0.9), 0.022);
    }
  }
  // behind the last row: a dark wall, and the upper ring's columns fading up into the haze
  const last = TIERS[TIERS.length - 1];
  wall(last.r1, 0, Math.PI * 2, last.yTop, last.yTop + 7, 6, last.k);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const w = 0.5 / last.r1;
    const r0 = last.r1 - 0.6;
    const [y0, y1] = [last.yTop, last.yTop + 9];
    quad([P(r0, a - w, y0), P(r0, a + w, y0), P(r0, a + w, y1), P(r0, a - w, y1)], inward(a), [0, 1, 0, 1], 6, last.k);
    for (const s of [-1, 1]) quad([P(r0, a + s * w, y0), P(last.r1, a + s * w, y0), P(last.r1, a + s * w, y1), P(r0, a + s * w, y1)], new THREE.Vector3(-Math.sin(a) * s, 0, Math.cos(a) * s), [0, 1, 0, 1], 6, last.k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 2));

  const POOLS = small ? 0 : 16;
  const light = {
    uRed: { value: RED }, uGreen: { value: GREEN }, uExc: { value: new THREE.Vector2(0.35, 0.35) }, uGain: { value: 1.35 },
    ...(POOLS ? { uPools: { value: Array.from({ length: POOLS }, () => new THREE.Vector4(0, -99, 0, 1)) }, uPoolCol: { value: Array.from({ length: POOLS }, () => new THREE.Color(0, 0, 0)) } } : {}),
  };
  const common = { fogColor: { value: new THREE.Color(0x030305) }, mirrorPass: MIRROR_PASS, uTime: TIME };
  // the haze between, and the dimmer picture in the wet floor
  const HAZE = `
    col = mix(col, fogColor, 1.0 - exp(-vD * 0.02));
    col *= 1.0 - mirrorPass * 0.45;`;
  const mat = new THREE.ShaderMaterial({
    defines: { POOLS },
    uniforms: { ...light, ...common },
    vertexShader: `attribute vec2 aInfo; varying vec3 vW; varying vec3 vN; varying vec2 vUv; flat varying vec2 vInfo; varying float vD;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vN = normal;
        #ifdef USE_INSTANCING
        w = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vN = mat3(instanceMatrix) * normal;
        #endif
        vW = w.xyz;
        vUv = uv;
        vInfo = aInfo;
        vec4 mv = viewMatrix * w;
        vD = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 fogColor; uniform float mirrorPass;
      varying vec3 vW; varying vec3 vN; varying vec2 vUv; flat varying vec2 vInfo; varying float vD;
      ${HALL_LIGHT}
      ${HASH}
      void main() {
        float kind = vInfo.x;
        float tier = floor(vInfo.y);
        vec3 n = normalize(vN);
        // dark concrete, each stretch of a row a touch different
        vec3 albedo = vec3(0.042, 0.042, 0.046) * (0.8 + 0.4 * hash(vec2(floor(vUv.x / 3.0), floor(vInfo.y * 40.0))));
        vec3 emit = vec3(0.0);
        vec3 warm = vec3(1.0, 0.7, 0.42);
        if (kind < 0.5) {
          albedo *= 1.0 + 1.4 * (1.0 - smoothstep(0.0, 0.05, vUv.y)); // the steel nosing at its front
        } else if (kind < 1.5) {
          albedo *= 0.6;
        } else if (kind < 2.5) {
          albedo = vec3(0.025);
        } else if (kind < 3.5) {
          albedo *= 1.3;
          emit = warm * 0.05 * (1.0 - fract(vUv.y * 2.0)); // the light of the step above
        } else if (kind < 4.5) {
          albedo *= 0.5;
          emit = warm * (0.03 + 0.45 * smoothstep(0.8, 0.92, vUv.y) * (1.0 - smoothstep(0.97, 1.0, vUv.y))) * (tier < 0.5 ? 1.0 : 0.45);
        } else if (kind < 5.5) {
          albedo *= 1.1;
        } else if (kind < 6.5) {
          albedo = vec3(0.018, 0.019, 0.022);
        } else {
          albedo = vec3(0.03, 0.03, 0.034);
          // the steel cap along its top, and groups of LED dashes under it, red left and green right
          albedo += vec3(0.12) * step(0.95, vUv.y);
          float aa = fwidth(vUv.x);
          float g = mod(vUv.x + tier * 3.7, 12.0);
          float f = mod(g, 1.25);
          float ay = fwidth(vUv.y);
          float dash = (1.0 - smoothstep(3.75 - aa, 3.75, g)) * smoothstep(0.0, aa, f) * (1.0 - smoothstep(0.9 - aa, 0.9, f))
            * smoothstep(0.8 - ay, 0.8, vUv.y) * (1.0 - smoothstep(0.88, 0.88 + ay, vUv.y));
          emit += (vW.x < 0.0 ? uRed * 1.5 : uGreen * 1.1) * dash * smoothstep(2.0, 5.0, abs(vW.x));
          // the entrances in the middle tier's wall: dark, a warm light deep inside
          float door = step(tier, 1.5) * step(mod(vUv.x, 19.0), 2.4) * step(vUv.y, 0.7);
          albedo = mix(albedo, vec3(0.0), door);
          emit += door * warm * 0.08 * smoothstep(0.1, 0.65, vUv.y);
        }
        vec3 col = albedo * hallLight(vW, n) * 6.0 + emit;
        ${HAZE}
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const stands = new THREE.Mesh(geo, mat);
  stands.layers.enable(MIRROR);
  scene.add(stands);
  const railing = new THREE.Mesh(mergeGeometries(rails), steel);
  railing.layers.enable(MIRROR);
  scene.add(railing);

  // the crowd: someone on most seats, the empty ones show as seats (a phone draws fewer people, thinner
  // in the upper tiers, and leaves the seats it skips bare). From the atlas: people in their poses as the
  // hall's mood says; without it, cut-outs drawn in the shader
  const count = seats.tier.length;
  const full = [];
  const empty = [];
  const shown = small ? [0.75, 0.4, 0.25] : [1, 1, 1];
  // the far stand behind the board (0 at the sides, 1 straight across from the camera): a real crowd
  // there is never a full grid, it has empty seats, gaps of a few seats and half-empty rows
  const smooth = THREE.MathUtils.smoothstep;
  const farOf = (x, z) => {
    const r = Math.hypot(x, z);
    return smooth(-z / r, 0.2, 0.8) * (1 - smooth(-x / r, 0.1, 0.65) - smooth(x / r, 0.1, 0.65));
  };
  const seed = (a, b, c) => {
    const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
    return v - Math.floor(v);
  };
  const farness = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const [x, z] = [seats.pos[i * 3], seats.pos[i * 3 + 2]];
    const far = (farness[i] = farOf(x, z));
    const block = Math.floor((Math.atan2(z, x) * Math.hypot(x, z)) / 1.6); // stretches of four seats
    const gap = far > 0 && seed(seats.tier[i], seats.row[i] >> 1, block) < 0.08 ? 0.4 : 0;
    if (Math.random() < 0.07 + far * (0.03 + gap)) empty.push(i);
    else if (Math.random() < shown[seats.tier[i]]) full.push(i);
  }
  const mood = { uRoar: { value: 0.3 }, uMove: { value: 1 } };

  /** The people from the atlas: a billboard each, turned round the vertical to the camera, lit through
   *  its normal map by the hall's light; red fans mostly on the left, green on the right, no one next to
   *  their own copy. Each holds a pose (a set of one to four pictures, see SETS) and changes it only when
   *  their side's mood does (see pose()), over half a second to a second, one after another; the shader
   *  blends the old picture into the new one and moves it up or down as they rise or sit. A set of
   *  several pictures (clapping, arms pumping or waving, a fist going up) cross-fades from one to the
   *  next, slowly, each person at their own speed and phase. Their heads come from a second atlas at
   *  about twice the texels (not on phones). At rest they live a little: they breathe, sway, now and
   *  then lean in, turn to a neighbour or look at a phone. */
  const atlasPeople = () => {
    const { cells } = atlas;
    const n = full.length;
    // the atlas's people and frames (cell = person * FR + frame); a pose's frame by its name
    const kinds = cells.filter((c) => c.person != null);
    const PEOPLE = Math.max(...kinds.map((c) => c.person)) + 1;
    const FR = Math.max(...kinds.map((c) => c.frame)) + 1;
    if (cells.some((c, i) => c.person != null && i !== c.person * FR + c.frame)) console.warn('crowd atlas: cells out of order');
    const fr = (pose, or = 0) => kinds.find((c) => c.person === 0 && c.pose === pose)?.frame ?? or;
    // the poses: [pictures (frame names, cycled), seconds a cycle (each person a little quicker or slower)]
    const sit = fr('seated');
    const stand = fr('standing', sit);
    const up = fr('standing_cheer', stand);
    const SETS = {
      sit: [[sit]], lean: [[fr('seated_lean', sit)]], talk: [[fr('seated_talk', sit)]], sitPhone: [[fr('seated_phone', sit)]],
      dejected: [[fr('seated_dejected', fr('seated_lean', sit))]],
      sitClap: [[fr('seated_clap_open', fr('seated_clap')), fr('seated_clap')], 1.15],
      sitCheer: [[fr('seated_cheer'), fr('seated_pump', fr('seated_cheer'))], 1.8],
      stand: [[stand]], standPhone: [[fr('standing_phone', stand)]], armsUp: [[up]],
      standClap: [[fr('standing_clap_open', fr('standing_clap', stand)), fr('standing_clap', stand)], 1.2],
      pump: [[up, fr('standing_pump', up)], 1.9],
      wave: [[fr('wave_l', up), up, fr('wave_r', up), up], 2.9],
      fist: [[fr('standing_fist', up), fr('standing_fist_low', up)], 1.5],
    };
    const S = {};
    Object.keys(SETS).forEach((k, i) => (S[k] = i));
    const setList = Object.values(SETS);
    // their table for the shader: row 0 the frames (up to four), row 1 how many, the cycle, the share of
    // each step spent blending into the next
    const setTable = new Float32Array(setList.length * 8);
    setList.forEach(([frames, cycle = 1], i) => {
      setTable.set([0, 1, 2, 3].map((k) => frames[Math.min(k, frames.length - 1)]), i * 4);
      setTable.set([frames.length, cycle, 0.3, 0], (setList.length + i) * 4);
    });
    const setTex = new THREE.DataTexture(setTable, setList.length, 2, THREE.RGBAFormat, THREE.FloatType);
    setTex.needsUpdate = true;
    const calmSets = new Set([S.sit, S.lean, S.talk, S.sitPhone]);
    const fanOf = (k) => FANS[k].filter((p) => p < PEOPLE);
    const fans = { red: fanOf('red'), green: fanOf('green'), none: Array.from({ length: PEOPLE }, (_, p) => p).filter((p) => !FANS.red.includes(p) && !FANS.green.includes(p)) };
    // the cells for the shader: row 0 the uv rect, row 1 the size in metres and the anchor, row 2 where
    // the head lies in the cell, row 3 the head's uv rect in the heads atlas
    const heads = !!atlas.heads;
    const table = new Float32Array(cells.length * 16);
    cells.forEach((c, i) => {
      table.set(c.uv, i * 4);
      table.set([...c.size, ...c.anchor], (cells.length + i) * 4);
      table.set(c.head ?? [2, 2, 3, 3], (cells.length * 2 + i) * 4);
      table.set(c.headUv ?? [0, 0, 0, 0], (cells.length * 3 + i) * 4);
    });
    const cellTex = new THREE.DataTexture(table, cells.length, 4, THREE.RGBAFormat, THREE.FloatType);
    cellTex.needsUpdate = true;
    const pos = new Float32Array(n * 3);
    const look = new Float32Array(n * 4); // brightness, mirrored (-1) or not, a phase, a size
    const dye = new Float32Array(n * 3); // a dark hue their clothes take on, so no two copies match
    const vary = new Float32Array(n * 4); // a light shirt (1) or not, the light where they sit, a hue for the skin, a hue for the hair
    const act = new Float32Array(n * 4); // the pose they come from, the one they go to, when the change starts, who they are
    const who = new Uint8Array(n);
    const draw = new Float32Array(n * 4);
    const idle = new Uint8Array(n); // their pose at rest
    const now = new Uint8Array(n); // the pose they are in (or going to)
    const side = new Int8Array(n);
    const any = (l) => l[Math.floor(Math.random() * l.length)];
    // no one beside or straight behind their own copy: the last few people along the row and the row in
    // front, by stretches of the row
    const near = new Map();
    const key = (s, dr, a) => `${seats.tier[s]}:${seats.row[s] + dr}:${a}`;
    full.forEach((s, i) => {
      // a little off the seat's middle, so the rows do not read as a grid; in the far stand more so,
      // each row slid along a little against the next
      const [x, y, z] = seats.pos.slice(s * 3, s * 3 + 3);
      const rad = Math.hypot(x, z);
      const far = farness[s];
      const along = (Math.random() - 0.5) * (0.2 + 0.14 * far) + (seed(seats.tier[s], seats.row[s], 7) - 0.5) * 0.3 * far;
      const out = 1 + ((Math.random() - 0.5) * 0.16) / rad;
      pos.set([(x - (z / rad) * along) * out, y - Math.random() * (0.05 + 0.06 * far), (z + (x / rad) * along) * out], i * 3);
      side[i] = seats.side[s];
      const [red, green] = FAN_SHARE[seats.side[s] + 1];
      const a = Math.round((Math.atan2(z, x) * rad) / 0.5);
      const taken = new Set([-2, -1, 0, 1, 2].flatMap((da) => [near.get(key(s, 0, a + da)), near.get(key(s, -1, a + da))]));
      for (let tries = 0; tries < 12; tries++) {
        const r = Math.random();
        who[i] = r < red ? any(fans.red) : r < red + green ? any(fans.green) : any(fans.none);
        if (!taken.has(who[i])) break;
      }
      near.set(key(s, 0, a), who[i]);
      // a touch under life size (the seats are tight), each a little different; most a dark mass, some
      // caught bright by the lamps; in the far stand children and tall ones too
      const lit = Math.random();
      const bright = 0.55 + 0.7 * lit * lit + Math.random() * 0.1;
      const size = 0.76 + Math.random() * 0.2 + (Math.random() - 0.5) * 0.2 * far;
      look.set([THREE.MathUtils.lerp(bright, 0.5 + 0.9 * lit * lit * lit + Math.random() * 0.1, far), Math.random() < 0.5 ? 1 : -1, Math.random(), size], i * 4);
      dye.set(DYES[Math.floor(Math.random() * DYES.length)], i * 3);
      vary.set([Math.random() < 0.22 + 0.1 * far ? 1 : 0, Math.random(), Math.random(), Math.random()], i * 4);
      draw.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
      idle[i] = restPose(draw[i * 4], Math.random());
    });
    /** A pose at rest: mostly sitting back, some leaning in, turned to a neighbour, or on a phone. */
    function restPose(a, r) {
      if (a < 0.03) return S.sitPhone;
      if (r < 0.08) return S.lean;
      if (r < 0.15) return S.talk;
      return S.sit;
    }
    const quad = new THREE.PlaneGeometry(1, 1).translate(0.5, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('iPos', new THREE.InstancedBufferAttribute(pos, 3));
    geo.setAttribute('iLook', new THREE.InstancedBufferAttribute(look, 4));
    geo.setAttribute('iDye', new THREE.InstancedBufferAttribute(dye, 3));
    geo.setAttribute('iVary', new THREE.InstancedBufferAttribute(vary, 4));
    geo.setAttribute('iAct', new THREE.InstancedBufferAttribute(act, 4).setUsage(THREE.DynamicDrawUsage));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      defines: { POOLS, SOFT: small ? 0 : 1, HEADS: heads ? 1 : 0, FR: `${FR}.0`, HEADS_W: `${atlas.headsSize?.[0] ?? 2048}.0`, HEADS_H: `${atlas.headsSize?.[1] ?? 1024}.0` },
      uniforms: { ...light, ...common, ...mood, uCells: { value: cellTex }, uSets: { value: setTex }, uMap: { value: atlas.map }, uNormal: { value: atlas.normal }, uHeads: { value: atlas.heads ?? null } },
      alphaToCoverage: !small,
      side: THREE.DoubleSide, // a mirrored one turns its back
      vertexShader: `attribute vec3 iPos; attribute vec4 iLook; attribute vec4 iAct; attribute vec3 iDye; attribute vec4 iVary; uniform sampler2D uCells; uniform sampler2D uSets; uniform float uTime; uniform float uMove;
        varying vec4 vUv; varying vec4 vLoc; varying float vD; flat varying float vK; flat varying vec3 vRight; flat varying vec3 vToCam; flat varying vec3 vDye; flat varying vec4 vVary;
        flat varying vec3 vKey; flat varying vec3 vAmb; flat varying vec3 vRim; flat varying vec3 vToRig; flat varying vec3 vFace; flat varying vec4 vHaze;
        #if HEADS
        varying vec4 vHead; flat varying vec4 vHuv0; flat varying vec4 vHuv1;
        #endif
        ${HALL_LIGHT}
        // a pose's pictures at this moment: the frame shown, the next one and how far the cross-fade into
        // it has gone (a set cycles through its frames, each person at their own speed and phase)
        vec3 frames(float s, float ph) {
          vec4 f = texelFetch(uSets, ivec2(int(s + 0.5), 0), 0);
          vec4 p = texelFetch(uSets, ivec2(int(s + 0.5), 1), 0);
          if (p.x < 1.5) return vec3(f.x, f.x, 0.0);
          float u = fract(uTime * uMove / (p.y * (0.85 + 0.3 * fract(ph * 7.31))) + ph) * p.x; // (still for less motion)
          float i = floor(u);
          float j = mod(i + 1.0, p.x);
          float a = i < 0.5 ? f.x : i < 1.5 ? f.y : i < 2.5 ? f.z : f.w;
          float b = j < 0.5 ? f.x : j < 1.5 ? f.y : j < 2.5 ? f.z : f.w;
          return vec3(a, b, smoothstep(0.5 - p.z, 0.5 + p.z, u - i));
        }
        void main() {
          // the change of pose: the old picture fades into the new one while both slide towards the new
          // height (rising or sitting down); the quad covers both. Holding a pose, its pictures cross-fade
          // one into the next
          float ph = iLook.z;
          float k = smoothstep(iAct.z, iAct.z + 0.55 + 0.45 * ph, uTime);
          float base = floor(iAct.w + 0.5) * FR;
          vec3 fa = frames(iAct.x, ph);
          vec3 fb = frames(iAct.y, ph);
          float change = step(0.0001, k) * step(k, 0.9999);
          float c0 = base + (change > 0.5 ? (fa.z < 0.5 ? fa.x : fa.y) : k < 0.5 ? fa.x : fb.x);
          float c1 = base + (change > 0.5 ? (fb.z < 0.5 ? fb.x : fb.y) : k < 0.5 ? fa.y : fb.y);
          float m = change > 0.5 ? k : k < 0.5 ? fa.z : fb.z;
          float mid = step(0.0001, m) * step(m, 0.9999);
          vec4 uv0 = texelFetch(uCells, ivec2(int(c0 + 0.5), 0), 0);
          vec4 sa0 = texelFetch(uCells, ivec2(int(c0 + 0.5), 1), 0);
          vec4 uv1 = texelFetch(uCells, ivec2(int(c1 + 0.5), 0), 0);
          vec4 sa1 = texelFetch(uCells, ivec2(int(c1 + 0.5), 1), 0);
          vec2 s0 = sa0.xy * iLook.w;
          vec2 s1 = sa1.xy * iLook.w;
          vec2 lo0 = -sa0.zw * s0, hi0 = (1.0 - sa0.zw) * s0;
          vec2 lo1 = -sa1.zw * s1, hi1 = (1.0 - sa1.zw) * s1;
          float dy0 = change * m * (hi1.y - hi0.y) * 0.35;
          float dy1 = change * (1.0 - m) * (hi0.y - hi1.y) * 0.35;
          vec2 lo = mix(m < 0.5 ? lo0 : lo1, min(lo0 + vec2(0.0, dy0), lo1 + vec2(0.0, dy1)), mid);
          vec2 hi = mix(m < 0.5 ? hi0 : hi1, max(hi0 + vec2(0.0, dy0), hi1 + vec2(0.0, dy1)), mid);
          vec2 q = mix(lo, hi, position.xy); // metres from the anchor
          vec2 l0 = (q - vec2(0.0, dy0)) / s0 + sa0.zw;
          vec2 l1 = (q - vec2(0.0, dy1)) / s1 + sa1.zw;
          vUv = vec4(mix(uv0.xy, uv0.zw, l0), mix(uv1.xy, uv1.zw, l1));
          vLoc = vec4(l0, l1);
          vK = mid > 0.5 ? m : step(0.5, m) * 2.0; // 2: only the second picture, 0: only the first
          #if HEADS
          // where in the head's box this corner is (inside 0..1 shows the sharper head), for both pictures
          vec4 h0 = texelFetch(uCells, ivec2(int(c0 + 0.5), 2), 0);
          vec4 h1 = texelFetch(uCells, ivec2(int(c1 + 0.5), 2), 0);
          vHead = vec4((l0 - h0.xy) / (h0.zw - h0.xy), (l1 - h1.xy) / (h1.zw - h1.xy));
          vHuv0 = texelFetch(uCells, ivec2(int(c0 + 0.5), 3), 0);
          vHuv1 = texelFetch(uCells, ivec2(int(c1 + 0.5), 3), 0);
          #endif
          // alive: breathing, a slow sway of their own (no bouncing)
          float t = uTime + ph * 60.0;
          float sway = uMove * 0.012 * sin(t * 0.37) * smoothstep(0.3, 1.0, q.y);
          vec2 toCam = normalize(cameraPosition.xz - iPos.xz + vec2(0.0001));
          vec3 right = vec3(toCam.y, 0.0, -toCam.x);
          vec3 w = iPos + right * (q.x + sway) * iLook.y + vec3(0.0, q.y * (1.0 + 0.004 * uMove * sin(t * 1.5)), 0.0);
          vRight = right * iLook.y;
          vToCam = vec3(toCam.x, 0.0, toCam.y);
          vDye = iDye;
          vVary = iVary;
          // the light on this person, once for them all (the picture's normals shade it per pixel):
          // the truss's white from above and in front, brightest in the pools the lamps leave on the
          // stands (patches that drift slowly round the hall) and on the first rows; the half's colour
          // (red left, green right) as a wash and on their edges, not dyed into skin and clothes; the far
          // stand dark between its pools; higher up, everything sinks into the coloured haze
          float r = length(iPos.xz);
          vec2 d = iPos.xz / r;
          float redW = smoothstep(0.1, 0.65, -d.x);
          float greenW = smoothstep(0.1, 0.65, d.x);
          float far = smoothstep(0.2, 0.8, -d.y) * (1.0 - redW - greenW);
          vec3 sideCol = uRed * redW * (0.55 + uExc.x) + uGreen * greenW * (0.45 + uExc.y) * 0.75 + vec3(0.55, 0.58, 0.7) * (1.0 - redW - greenW) * 0.35;
          vFace = normalize(vec3(-d.x, 0.35, -d.y));
          vec3 head = iPos + vec3(0.0, 1.0, 0.0);
          float rise = smoothstep(1.0, 17.0, iPos.y);
          vToRig = normalize(vec3(-d.x * max(r - 9.0, 1.0), 9.5 - head.y, -d.y * max(r - 9.0, 1.0)));
          float ang = atan(iPos.z, iPos.x);
          float pool = 0.5 + 0.5 * sin(ang * 11.0 + iPos.y * 0.45 + uTime * 0.12) * sin(ang * 5.0 - iPos.y * 0.6 + 1.7 - uTime * 0.09);
          float front = exp(-max(r - ${STANDS_R.toFixed(2)}, 0.0) * 0.32) * (1.0 - far);
          float deep = smoothstep(${STANDS_R.toFixed(2)}, ${(STANDS_R + 14).toFixed(2)}, r);
          float each = mix(0.7 + 0.6 * iVary.y, 0.5 + 1.1 * iVary.y * iVary.y, far);
          float keyK = (0.34 + 1.0 * pool * pool + front * 0.8) * (1.0 - rise * 0.3) * mix(1.0, 0.8 + 0.6 * pool, far) * each * iLook.x;
          vec3 hall = hallLight(head, vFace); // the dim ambient, the half's light low down, the fans' pools
          float hl = dot(hall, vec3(0.3333));
          vKey = vec3(1.0, 0.93, 0.85) * keyK * 1.05 + mix(vec3(hl), hall, 0.45) * 9.0 * iLook.x;
          vAmb = (vec3(0.022, 0.023, 0.03) + sideCol * 0.05 * (1.0 - rise * 0.3)) * iLook.x;
          vRim = sideCol * (0.3 + 0.35 * front + 0.25 * pool) * (1.0 - far * 0.5) * iLook.x;
          // the haze: how much (the far stand and the upper tiers most), and its colour (the half's,
          // lighter where a lamp's beam goes through)
          float hz = clamp(0.05 + rise * 0.24 + far * (0.08 + 0.16 * deep) + deep * 0.08, 0.0, 0.55);
          vHaze = vec4((vec3(0.024, 0.026, 0.034) + sideCol * 0.045) * (0.45 + 1.5 * pool), hz);
          vec4 mv4 = viewMatrix * vec4(w, 1.0);
          vD = -mv4.z;
          gl_Position = projectionMatrix * mv4;
        }`,
      fragmentShader: `uniform sampler2D uMap; uniform sampler2D uNormal; uniform sampler2D uHeads; uniform vec3 fogColor; uniform float mirrorPass;
        varying vec4 vUv; varying vec4 vLoc; varying float vD; flat varying float vK; flat varying vec3 vRight; flat varying vec3 vToCam; flat varying vec3 vDye; flat varying vec4 vVary;
        flat varying vec3 vKey; flat varying vec3 vAmb; flat varying vec3 vRim; flat varying vec3 vToRig; flat varying vec3 vFace; flat varying vec4 vHaze;
        #if HEADS
        varying vec4 vHead; flat varying vec4 vHuv0; flat varying vec4 vHuv1;
        #endif
        float inside(vec2 l) { return step(0.0, l.x) * step(l.x, 1.0) * step(0.0, l.y) * step(l.y, 1.0); }
        // a picture's colour: inside its head's box from the sharper heads atlas (with explicit gradients:
        // the box's edge runs through a pixel block)
        #if HEADS
        vec4 pic(vec2 uv, vec2 hl, vec4 huv) {
          vec2 g = mix(huv.xy, huv.zw, hl);
          vec2 gx = dFdx(hl) * (huv.zw - huv.xy), gy = dFdy(hl) * (huv.zw - huv.xy);
          vec2 ux = dFdx(uv), uy = dFdy(uv);
          // (a texel and a half inside the box: its edge texels blur into the gutter)
          vec2 e = vec2(1.5 / HEADS_W, 1.5 / HEADS_H) / (huv.zw - huv.xy);
          vec4 c;
          if (inside((hl - e) / (1.0 - 2.0 * e)) > 0.5) c = textureGrad(uHeads, g, gx, gy);
          else c = textureGrad(uMap, uv, ux, uy);
          return c;
        }
        #define PIC0 pic(vUv.xy, vHead.xy, vHuv0)
        #define PIC1 pic(vUv.zw, vHead.zw, vHuv1)
        #else
        #define PIC0 texture2D(uMap, vUv.xy)
        #define PIC1 texture2D(uMap, vUv.zw)
        #endif
        void main() {
          vec4 a;
          vec3 nt;
          if (vK > 1.5) {
            a = PIC1;
            nt = texture2D(uNormal, vUv.zw).xyz;
          } else if (vK < 0.0001) {
            a = PIC0;
            nt = texture2D(uNormal, vUv.xy).xyz;
          } else {
            // between two pictures: both, each only inside its own cell
            vec4 a0 = PIC0;
            vec4 a1 = PIC1;
            a0.a *= inside(vLoc.xy) * (1.0 - vK);
            a1.a *= inside(vLoc.zw) * vK;
            float t = a1.a / max(a0.a + a1.a, 0.0001);
            a = vec4(mix(a0.rgb, a1.rgb, t), min(1.0, a0.a + a1.a));
            nt = mix(texture2D(uNormal, vUv.xy).xyz, texture2D(uNormal, vUv.zw).xyz, t);
          }
          #if SOFT
          if (a.a < 0.1) discard;
          #else
          if (a.a < 0.5) discard;
          #endif
          // most clothes go darker and take this person's own dark hue; now and then a light shirt stays
          // light; skin (unlike the clothes and the fans' colours) a shade down, a little warmer or
          // cooler from one to the next, so no face is a pale mask
          float lum = dot(a.rgb, vec3(0.33));
          float cloth = 1.0 - smoothstep(0.2, 0.45, (a.r - a.b) / (a.r + 0.02));
          vec3 dark = mix(a.rgb * mix(1.0, 0.6, smoothstep(0.2, 0.6, lum)), vDye * (0.6 + lum * 2.2), 0.35) * 1.5;
          // (dark skin keeps more of its light, or it sinks into a featureless black)
          vec3 c = mix(a.rgb * mix(vec3(1.0, 0.86, 0.78), vec3(0.82, 0.8, 0.84), vVary.z) * 0.3 * mix(1.8, 1.0, smoothstep(0.03, 0.3, lum)), mix(dark, a.rgb * 0.9, vVary.x), cloth);
          c = mix(vec3(dot(c, vec3(0.3333))), c, mix(1.0, 0.72, cloth)); // the fans' colours muted, as cloth in a dark hall
          c = min(c, vec3(mix(0.24, 1.0, cloth)));
          // the normal in the picture's frame: x along it, y up, z towards the camera
          vec3 n = nt * 2.0 - 1.0;
          vec3 N = normalize(vRight * n.x + vec3(0.0, n.y, 0.0) + vToCam * n.z);
          // skin takes the light from above harder than cloth (faces modelled by it: brows, nose, chin)
          float wrap = max(dot(N, vToRig) * mix(0.8, 0.6, cloth) + mix(0.2, 0.4, cloth), 0.0);
          float edge = pow(clamp(1.0 - abs(n.z), 0.0, 1.0), 2.0);
          vec3 col = c * (vAmb + vKey * (wrap + max(N.y, 0.0) * 0.35)) + vRim * (edge * (0.4 + 0.6 * max(dot(N, vFace), 0.0)) + 0.06) * (0.5 + lum);
          col = mix(col, vHaze.rgb, vHaze.a);
          ${HAZE}
          gl_FragColor = vec4(col, a.a);
        }`,
    });
    const stretch = 1 / Math.cos(THREE.MathUtils.degToRad(atlas.elev ?? 12)); // the pictures are seen from above
    const off = new Float32Array(n * 2);
    const holds = new Uint8Array(n);
    /** Person i to pose `s`, from `at` on; returns true if anything changed. */
    const placed = new Uint8Array(n);
    const set = (i, s, at, reduced) => {
      const was = act[i * 4 + 1];
      if (placed[i] && s === was) return false;
      act.set([reduced || !placed[i] ? s : was, s, reduced || !placed[i] ? -1 : at, who[i]], i * 4);
      placed[i] = 1;
      now[i] = s;
      // the phone: in the hand in the picture (a pose without one leaves its light where it was, to fade)
      const k = cells[who[i] * FR + setList[s][0][0]];
      holds[i] = k.torch ? 1 : 0;
      if (k.torch) {
        const sz = look[i * 4 + 3];
        off[i * 2] = (k.torch[0] - k.anchor[0]) * k.size[0] * sz * look[i * 4 + 1];
        off[i * 2 + 1] = (k.torch[1] - k.anchor[1]) * k.size[1] * sz;
      } else if (!off[i * 2 + 1]) off[i * 2 + 1] = (k.headTop - 0.2) * look[i * 4 + 3] * stretch;
      return true;
    };
    /** On their feet: arms up (held, pumping, waving slowly), a fist going up, clapping or filming. */
    const cheer = (a, d) => {
      if (a < 0.16) return S.standPhone;
      if (d < 0.26) return S.wave;
      if (d < 0.44) return S.armsUp;
      if (d < 0.58) return S.pump;
      if (d < 0.74) return S.fist;
      return S.standClap;
    };
    /** Person i's pose for their side's mood: `lvl` 0 calm .. 1 their hero ahead, `mode` 'win' | 'lose' | ''. */
    const choose = (i, lvl, mode) => {
      const [a, b, c, d] = draw.subarray(i * 4, i * 4 + 4);
      const rest = idle[i];
      const cur = now[i];
      // a few in the back rows and the far stand stand the whole time (not on the losing side)
      const s = full[i];
      const stander = b > 0.994 - 0.02 * farness[s] - 0.0012 * seats.row[s];
      if (mode === 'lose') {
        // seated, nobody cheers: hands on heads, leaning in, talking it over
        if (c < 0.16) return S.dejected;
        if (c < 0.26) return S.lean;
        if (c < 0.33) return S.talk;
        return rest === S.sitPhone || rest === S.talk ? S.sit : rest;
      }
      // the winner's half: about seven in ten on their feet
      if (mode === 'win') return b < 0.72 ? cheer(a, d) : c < 0.6 ? S.sitClap : c < 0.8 ? S.sitCheer : rest;
      // their hero ahead: up to seven in ten stand (each at their own level, so they rise together and
      // sit back down one by one as it settles); the rest clap or cheer in their seats
      const standAt = b < 0.7 ? 0.5 + 0.45 * (b / 0.7) : 2;
      const up = cur === S.stand || cur === S.standPhone || cur === S.armsUp || cur === S.pump || cur === S.wave || cur === S.fist || cur === S.standClap;
      if (lvl > standAt || (up && lvl > standAt - 0.08)) return cheer(a, d);
      if (stander) return lvl > 0.6 ? cheer(a, d) : S.stand;
      const seatAt = 0.2 + 0.55 * c;
      const active = cur === S.sitClap || cur === S.sitCheer;
      if (lvl > seatAt || (active && lvl > seatAt - 0.08)) return d < 0.6 || lvl < 0.5 ? S.sitClap : S.sitCheer;
      if (a < 0.03 + lvl * 0.05) return S.sitPhone;
      return rest;
    };
    // the mood of each half (red, the ends and the far stand, green): it rises at once with its side's
    // excitement and settles slowly, so the stand sits back down person by person over several seconds
    const halves = [-1, 0, 1].map((s) => ({ s, lvl: 0, mode: null }));
    let winLatch = null;
    let lifeAt = 0;
    let lastT = null;
    let lookAt = -1;
    let first = true;
    const pose = (t, roar, exc, reduced, winner) => {
      // who won: as the scene says, or (until it does) the half that roars when the hall is on its feet
      if (roar < 0.95) winLatch = null;
      else if (winner) winLatch = winner;
      else if (!winLatch && Math.abs(exc.red - exc.blue) > 0.2) winLatch = exc.red > exc.blue ? 'red' : 'blue';
      const lvlOf = (e) => THREE.MathUtils.clamp((e - 0.42) / 0.5, 0, 1) * (roar < 0.25 ? 0.85 : 1);
      const red = lvlOf(exc.red);
      const green = lvlOf(exc.blue);
      const dt = lastT == null ? 0 : Math.max(0, t - lastT);
      lastT = t;
      let changed = first; // (the phones take their places the first time)
      first = false;
      let moved = false;
      for (const h of halves) {
        const raw = h.s < 0 ? red : h.s > 0 ? green : 0.5 * Math.max(red, green);
        const win = winLatch ? (h.s === 0 ? '' : (h.s < 0) === (winLatch === 'red') ? 'win' : 'lose') : '';
        const lvl = winLatch && h.s === 0 ? Math.max(raw, 0.35) : raw;
        const was = h.lvl;
        // (held a couple of seconds at its height, then down a little at a time)
        if (lvl >= h.lvl - 0.02) h.peakAt = t;
        h.lvl = reduced ? lvl : Math.max(lvl, h.lvl - (t - (h.peakAt ?? 0) > 2.5 ? dt * 0.09 : 0));
        const rising = h.lvl > was + 1e-4 || (win === 'win' && h.mode !== 'win');
        const modeChanged = win !== h.mode;
        h.mode = win;
        if (!modeChanged && Math.abs(h.lvl - was) < 1e-4) continue;
        h.rising = rising;
        moved = true;
      }
      // everyone against their half's mood, ten times a second; each changes in their own time (up within
      // a second or so, down more slowly)
      if (moved && t - lookAt > 0.1) {
        lookAt = t;
        for (let i = 0; i < n; i++) {
          const h = halves[side[i] + 1];
          const s = choose(i, h.lvl, h.mode);
          if (s === now[i]) continue;
          const late = look[i * 4 + 2];
          changed = set(i, s, t + (h.rising ? 0.1 + 1.1 * late * late : 0.2 + 1.2 * late), reduced) || changed;
        }
      }
      // at rest, now and then someone leans in, turns to a neighbour, sits back or checks a phone
      if (!reduced && t - lifeAt > 0.5) {
        lifeAt = t;
        for (let j = 0; j < n / 150; j++) {
          const i = Math.floor(Math.random() * n);
          const h = halves[side[i] + 1];
          if (h.mode || h.lvl > 0.15 || !calmSets.has(now[i])) continue;
          idle[i] = restPose(draw[i * 4] < 0.1 && Math.random() < 0.3 ? 0 : 1, Math.random());
          changed = set(i, idle[i], t + Math.random(), reduced) || changed;
        }
      }
      if (changed) geo.attributes.iAct.needsUpdate = true;
      return changed;
    };
    // everyone in their seat to begin with
    for (let i = 0; i < n; i++) set(i, idle[i], 0, true);
    geo.attributes.iAct.needsUpdate = true;
    return { mesh: new THREE.Mesh(geo, mat), pos, off, holds, pose, mayHold: (i) => draw[i * 4] < 0.1 };
  };

  // the cut-outs: a person turned to the camera, seated, standing or with the arms up. Who is up: the
  // more the hall roars (and their side is excited) the more stand, and of those some with their arms
  // up; the upper tiers stay down longer
  const POSE = `
    float sideExc = iData.y < -0.5 ? uExc.x : iData.y > 0.5 ? uExc.y : 0.5 * (uExc.x + uExc.y);
    float up = clamp(uRoar * (1.0 - iData.z * 0.25) + sideExc * 0.3 - 0.1, 0.0, 1.0);
    float stand = step(iData.x, up * 0.55);
    float arms = step(iData.w, up * 0.5) * stand + step(iData.w, up * 0.08) * (1.0 - stand);`;
  const cutOuts = () => {
    const iPos = new Float32Array(full.length * 3);
    const iData = new Float32Array(full.length * 4); // a draw, the side (-1 red, 0 the ends, 1 green), the tier, a draw
    full.forEach((s, i) => {
      iPos.set(seats.pos.slice(s * 3, s * 3 + 3), i * 3);
      iData.set([Math.random(), seats.side[s], seats.tier[s], Math.random()], i * 4);
    });
    const card = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const crowdGeo = new THREE.InstancedBufferGeometry();
    crowdGeo.index = card.index;
    crowdGeo.setAttribute('position', card.attributes.position);
    crowdGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(iPos, 3));
    crowdGeo.setAttribute('iData', new THREE.InstancedBufferAttribute(iData, 4));
    crowdGeo.instanceCount = full.length;
    const crowdMat = new THREE.ShaderMaterial({
      defines: { POOLS, SOFT: small ? 0 : 1 },
      uniforms: { ...light, ...common, ...mood },
      alphaToCoverage: !small,
      vertexShader: `attribute vec3 iPos; attribute vec4 iData; uniform float uRoar; uniform float uMove; uniform float uTime;
        varying vec2 vP; flat varying vec4 vData; varying vec3 vLight; flat varying vec3 vRim; varying float vD; flat varying vec2 vPose;
        ${HALL_LIGHT}
        void main() {
          ${POSE}
          float big = 0.92 + 0.16 * fract(iData.x * 37.0);
          float h = (stand > 0.5 ? 2.25 : 1.6) * big;
          float w = 0.78 * big;
          vec2 toCam = normalize(cameraPosition.xz - iPos.xz + vec2(0.0001));
          vec3 right = vec3(toCam.y, 0.0, -toCam.x);
          float bob = uMove * arms * (0.5 + 0.5 * sin(uTime * 2.6 + iData.x * 40.0)) * 0.05;
          vP = vec2(position.x * w, position.y * h) / big;
          vec3 p = iPos + right * position.x * w + vec3(0.0, position.y * h + bob, 0.0);
          vData = iData;
          vPose = vec2(stand, arms);
          vec3 face = normalize(vec3(-iPos.x, 0.0, -iPos.z));
          float low = exp(-iPos.y * 0.1 - max(length(iPos.xz) - 14.0, 0.0) * 0.03);
          vLight = (hallLight(iPos + vec3(0.0, 1.0, 0.0), normalize(face + vec3(0.0, 0.5, 0.0))) + vec3(0.03, 0.029, 0.027) * low * uGain) * (0.75 + 0.5 * fract(iData.w * 53.0));
          vRim = iData.y < -0.5 ? uRed : iData.y > 0.5 ? uGreen : vec3(0.5, 0.5, 0.55);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          vD = -mv.z;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 fogColor; uniform float mirrorPass; uniform float uTime; uniform float uMove;
        varying vec2 vP; flat varying vec4 vData; varying vec3 vLight; flat varying vec3 vRim; varying float vD; flat varying vec2 vPose;
        ${HASH}
        float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        float seg(vec2 p, vec2 a, vec2 b, float r) { vec2 pa = p - a; vec2 ba = b - a; return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0)) - r; }
        void main() {
          float s = vData.x * 91.0;
          float stand = vPose.x;
          float arms = vPose.y;
          vec2 p = vP;
          float wide = 0.9 + 0.25 * hash(vec2(s, 1.0));
          // the body: a person on a seat (the hips at 0.45 m), or standing (at 0.95)
          float sh = 0.95 + stand * 0.48;              // the shoulders' height
          vec2 hc = vec2(0.0, sh + 0.2);               // the head's centre
          float taper = mix(0.78, 1.0, smoothstep(sh - 0.45, sh - 0.1, p.y));
          float torso = box(vec2(p.x / (wide * taper), p.y - (sh - 0.22)), vec2(0.22, 0.23), 0.11);
          float legs = stand > 0.5 ? min(seg(p, vec2(-0.1, 0.05), vec2(-0.09, 0.95), 0.08), seg(p, vec2(0.1, 0.05), vec2(0.09, 0.95), 0.08))
                                   : box(p - vec2(0.0, 0.32), vec2(0.18 * wide, 0.18), 0.08);
          float head = (length((p - hc) / vec2(0.105, 0.128)) - 1.0) * 0.105;
          float neck = box(p - vec2(0.0, sh), vec2(0.045, 0.06), 0.02);
          float sway = uMove * sin(uTime * 1.4 + s) * 0.05;
          vec2 l0 = vec2(-0.22 * wide, sh - 0.06);
          vec2 r0 = vec2(0.22 * wide, sh - 0.06);
          vec2 le = vec2(-0.32 + sway, sh + 0.28);
          vec2 re = vec2(0.32 + sway, sh + 0.28);
          float armsD = arms > 0.5
            ? min(min(seg(p, l0, le, 0.05), seg(p, le, le + vec2(0.07, 0.27), 0.045)), min(seg(p, r0, re, 0.05), seg(p, re, re + vec2(-0.07, 0.27), 0.045)))
            : min(seg(p, l0, vec2(-0.26 * wide, sh - 0.45), 0.055), seg(p, r0, vec2(0.26 * wide, sh - 0.45), 0.055));
          float d = min(min(min(torso, legs), min(neck, armsD)), head);
          #if SOFT
          float a = clamp(0.5 - d / max(fwidth(d), 0.0001), 0.0, 1.0);
          if (a < 0.01) discard;
          #else
          float a = 1.0;
          if (d > 0.0) discard;
          #endif
          // dark clothes mostly, now and then the corner's shirt; six skin tones; dark hair, now and then fair
          float c = hash(vec2(s, 2.0));
          vec3 cloth = c < 0.25 ? vec3(0.02, 0.022, 0.03) : c < 0.45 ? vec3(0.05, 0.05, 0.055) : c < 0.58 ? vec3(0.03, 0.035, 0.06) : c < 0.64 ? vec3(0.09) : c < 0.7 ? vec3(0.18, 0.175, 0.17) : c < 0.78 ? vec3(0.06, 0.02, 0.02) : c < 0.9 ? vec3(0.05, 0.045, 0.03) : vRim * 0.14 + 0.01;
          float k = hash(vec2(s, 3.0));
          vec3 skin = k < 0.2 ? vec3(0.6, 0.38, 0.28) : k < 0.4 ? vec3(0.45, 0.28, 0.18) : k < 0.55 ? vec3(0.28, 0.16, 0.1) : k < 0.7 ? vec3(0.13, 0.07, 0.045) : k < 0.85 ? vec3(0.52, 0.36, 0.26) : vec3(0.36, 0.22, 0.14);
          vec3 hair = hash(vec2(s, 4.0)) < 0.8 ? vec3(0.015, 0.012, 0.01) : vec3(0.12, 0.08, 0.04);
          vec3 albedo = cloth;
          if (head < 0.0 || (arms > 0.5 && armsD < 0.0 && p.y > sh + 0.45)) albedo = skin;
          if (head < 0.0 && p.y > hc.y + 0.118 * (0.25 + 0.3 * hash(vec2(s, 5.0)))) albedo = hair;
          // lit from above and from the ring, the side's colour on the rim
          float shade = 0.55 + 0.45 * smoothstep(0.0, sh + 0.3, p.y);
          float rim = (1.0 - smoothstep(0.0, 0.04, -d)) * smoothstep(sh - 0.4, sh + 0.2, p.y);
          vec3 col = albedo * vLight * 6.0 * shade + vRim * vLight * rim * 0.12;
          ${HAZE}
          gl_FragColor = vec4(col, a);
        }`,
    });
    return { mesh: new THREE.Mesh(crowdGeo, crowdMat), pos: iPos, data: iData };
  };
  const people = atlas ? atlasPeople() : cutOuts();
  people.mesh.frustumCulled = false; // (not in the floor's mirror: thousands of people there cost frames and show as a blur)
  scene.add(people.mesh);

  // the empty seats: a pan and a back of dark plastic
  const seatGeo = mergeGeometries([new THREE.BoxGeometry(0.46, 0.06, 0.4).translate(0, 0.42, 0.02), new THREE.BoxGeometry(0.46, 0.4, 0.05).rotateX(-0.12).translate(0, 0.64, 0.22)]);
  seatGeo.setAttribute('aInfo', new THREE.Float32BufferAttribute(new Float32Array(seatGeo.attributes.position.count * 2).fill(1), 2));
  const seatMesh = new THREE.InstancedMesh(seatGeo, mat, empty.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);
  const at = new THREE.Vector3();
  empty.forEach((s, i) => {
    at.fromArray(seats.pos, s * 3);
    q.setFromAxisAngle(UP, Math.atan2(at.x, at.z)); // its back away from the ring
    seatMesh.setMatrixAt(i, m4.compose(at, q, one));
  });
  seatMesh.layers.enable(MIRROR);
  scene.add(seatMesh);

  // phones: screens held up, lit and steady (filming), never blinking; they come on and go out slowly.
  // From the atlas, they are the people holding one up, at the phone in their picture
  const phoneN = Math.min(full.length, small ? 300 : 1200);
  const order = full.map((_, i) => i).sort(() => Math.random() - 0.5);
  const pick = [...new Set([...order.filter((i) => people.mayHold?.(i)), ...order])].slice(0, phoneN);
  const pPos = new Float32Array(phoneN * 3);
  const glow = new Float32Array(phoneN);
  pick.forEach((i, n) => pPos.set(people.pos.slice(i * 3, i * 3 + 3), n * 3));
  const phoneGeo = new THREE.BufferGeometry();
  phoneGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  phoneGeo.setAttribute('aGlow', new THREE.BufferAttribute(glow, 1));
  const pOff = new Float32Array(phoneN * 2); // from the atlas: the phone from the person's feet, along the picture and up
  if (atlas) phoneGeo.setAttribute('aOff', new THREE.BufferAttribute(pOff, 2));
  else {
    const pData = new Float32Array(phoneN * 4);
    pick.forEach((i, n) => pData.set(people.data.slice(i * 4, i * 4 + 4), n * 4));
    phoneGeo.setAttribute('iData', new THREE.BufferAttribute(pData, 4));
  }
  const phones = new THREE.Points(phoneGeo, new THREE.ShaderMaterial({
    defines: { ATLAS: atlas ? 1 : 0 },
    uniforms: { ...light, ...common, ...mood, uSize: { value: 3 } },
    vertexShader: `attribute float aGlow; uniform vec2 uExc; uniform float uRoar; uniform float uSize; varying float vGlow;
      #if ATLAS
      attribute vec2 aOff;
      #else
      attribute vec4 iData;
      #endif
      void main() {
        #if ATLAS
        // at the phone in the person's picture, a hand's breadth before it
        vec2 toCam = normalize(cameraPosition.xz - position.xz + vec2(0.0001));
        vec3 p = position + vec3(toCam.y, 0.0, -toCam.x) * aOff.x + vec3(toCam.x * 0.12, aOff.y, toCam.y * 0.12);
        #else
        ${POSE}
        // held up in front of the face, or over the head with the arms up
        vec3 p = position + vec3(0.0, 1.12 + stand * 0.48 + arms * 0.45, 0.0) - normalize(vec3(position.x, 0.0, position.z)) * 0.25;
        #endif
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vGlow = aGlow * exp(mv.z * 0.012);
        gl_PointSize = uSize * (aGlow > 2.0 ? 2.4 : 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float mirrorPass; varying float vGlow;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = (1.0 - smoothstep(0.15, 0.55, d)) + 0.25 * pow(max(0.0, 1.0 - d), 2.0); // a hard point in a little glow
        gl_FragColor = vec4(vec3(0.9, 0.95, 1.0) * vGlow * a * (1.0 - mirrorPass * 0.6), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }));
  phones.frustumCulled = false;
  phones.layers.enable(MIRROR);
  scene.add(phones);
  const steady = pick.map(() => !atlas && Math.random() < 0.4);
  // and in the far stand, a few held up the whole time, little points in its dark
  const keep = pick.map((i) => Math.random() < 0.07 + 0.12 * farness[full[i]]);
  const shine = pick.map(() => 0.8 + Math.random() * 0.5); // each screen its own brightness

  return {
    seats: { count, pos: Float32Array.from(seats.pos), side: Int8Array.from(seats.side), tier: Uint8Array.from(seats.tier), row: Uint8Array.from(seats.row) },
    crowd: people.mesh,
    /** Where the fans' beams land on the stands: [{ at: Vector3, color: Color }]. */
    setPools(list) {
      if (!POOLS) return;
      list.slice(0, POOLS).forEach((b, i) => {
        light.uPools.value[i].set(b.at.x, b.at.y, b.at.z, 3.2);
        light.uPoolCol.value[i].copy(b.color).multiplyScalar(0.08);
      });
    },
    /** A phone's light, in pixels. */
    setPhoneSize(px) {
      phones.material.uniforms.uSize.value = px;
    },
    update(t, dt, exc, roar, reduced, winner) {
      light.uExc.value.set(exc.red, exc.blue);
      mood.uRoar.value = roar;
      mood.uMove.value = reduced ? 0 : 1;
      if (people.pose?.(t, roar, exc, reduced, winner)) {
        // new poses: the phones follow the people holding one
        pick.forEach((i, n) => {
          pOff.set(people.off.subarray(i * 2, i * 2 + 2), n * 2);
          steady[n] = people.holds[i] === 1;
        });
        phoneGeo.attributes.aOff.needsUpdate = true;
      }
      const k = reduced ? 1 : Math.min(1, dt * 1.2);
      for (let i = 0; i < phoneN; i++) {
        const want = (steady[i] ? 2.0 : keep[i] ? 2.6 : 0) * shine[i];
        glow[i] += (want - glow[i]) * k;
      }
      phoneGeo.attributes.aGlow.needsUpdate = true;
    },
  };
}
// ------------------------------------------------------------------ the room

/**
 * The ring in the kit's baked steel: six posts, six brackets, six apron sides, the steps, the canvas
 * and its emblem, each where the code's own part would stand (R the ring's radius). The kit's neutral
 * lights take their half's colour (`led`, `panel`: red left, green right); the posts light the flats
 * seen from `eye` (the main camera) and from round the hall, and the others get a flush steel cover
 * (`cover`) over their channel; then every piece is merged into one mesh a material, so the whole ring
 * is a handful of draws.
 */
function kitRing(kit, { R, led, panel, eye, cover }) {
  const APO = R * Math.cos(Math.PI / 6);
  const at = (k, r) => new THREE.Vector3(r * Math.cos((k * Math.PI) / 3), 0, r * Math.sin((k * Math.PI) / 3));
  const byMat = new Map();
  const mid = new THREE.Vector3();
  const put = (mat, g) => {
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  };
  /** A piece of the kit at p, turned rotY; `unlit(name)`: a post strip left dark, covered instead. */
  const place = (name, p, rotY, unlit = () => false) => {
    const o = kit[name].clone();
    o.position.copy(p);
    o.rotation.y = rotY;
    o.updateMatrixWorld(true);
    o.traverse((m) => {
      if (!m.isMesh) return;
      if (unlit(m.name)) {
        put(cover, stripCover(m).applyMatrix4(m.matrixWorld));
        return;
      }
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      g.computeBoundingBox();
      const side = g.boundingBox.getCenter(mid).x < 0 ? 'red' : 'green';
      put({ LED_NEUTRAL: led[side], LED_RED: led.red, LED_GREEN: led.green, GLOW_NEUTRAL: panel[side] }[m.material.name] ?? m.material, g);
    });
  };
  // the post's eight flats, by their angle from its +z (the ring's centre) round +y
  const FLATS = { In: 0, InR: 1, R: 2, OutR: 3, Out: 4, OutL: -3, L: -2, InL: -1 };
  /** A dark strip's channel closed by a steel plate flush with its bezel (18 mm proud, 3 cm round it). */
  const stripCover = (m) => {
    const box = new THREE.Box3().setFromBufferAttribute(m.geometry.attributes.position);
    const size = box.getSize(new THREE.Vector3());
    const a = (FLATS[m.name.slice('PostLED_'.length)] * Math.PI) / 4;
    const n = new THREE.Vector3(Math.sin(a), 0, Math.cos(a));
    return new THREE.PlaneGeometry(Math.hypot(size.x, size.z) + 0.064, size.y + 0.13).rotateY(a).translate(...box.getCenter(mid).addScaledVector(n, 0.013).toArray());
  };
  for (let k = 0; k < 6; k++) {
    // the post's strips: the flat to the ring, the two outer diagonals (a strip faces the camera from
    // anywhere round the hall) and the flat that looks most towards the main camera (`eye`)
    const p = at(k, R - 0.08);
    const rot = Math.atan2(-p.x, -p.z); // +z towards the ring's centre
    const look = Math.atan2(eye.x - p.x, eye.z - p.z) - rot;
    const toEye = Object.keys(FLATS).reduce((best, n) => (Math.cos((FLATS[n] * Math.PI) / 4 - look) > Math.cos((FLATS[best] * Math.PI) / 4 - look) ? n : best));
    const lit = new Set(['PostLED_In', 'PostLED_OutL', 'PostLED_OutR', `PostLED_${toEye}`]);
    place('Post', p, rot, (n) => n.startsWith('PostLED_') && !lit.has(n));
    const c = at(k, R);
    place('Bracket', c, Math.atan2(c.x, c.z));
    const a = at(k + 0.5, APO);
    place('ApronSide', a, Math.atan2(a.x, a.z));
  }
  place('Steps', new THREE.Vector3(0, 0, APO), 0);
  place('Canvas', new THREE.Vector3(), 0);
  place('Emblem', new THREE.Vector3(), 0);
  const ring = new THREE.Group();
  for (const [mat, geos] of byMat) {
    const m = new THREE.Mesh(mergeGeometries(geos), mat);
    m.name = mat.name;
    ring.add(m);
  }
  return ring;
}

/** Quads into one geometry: each [p0, p1, p2, p3] (counter-clockwise seen from `out`), uv 0..1 over it
 *  (or `uv` [u0, u1, v0, v1]). */
function quadGeo(list) {
  const pos = [];
  const uv = [];
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (const { p, out, uvr = [0, 1, 0, 1] } of list) {
    let q = p;
    e1.subVectors(p[1], p[0]);
    e2.subVectors(p[3], p[0]);
    const flip = out && e1.cross(e2).dot(out) < 0;
    const [u0, u1, v0, v1] = uvr;
    let t = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    if (flip) {
      q = [p[0], p[3], p[2], p[1]];
      t = [t[0], t[3], t[2], t[1]];
    }
    for (const i of [0, 1, 2, 0, 2, 3]) {
      pos.push(q[i].x, q[i].y, q[i].z);
      uv.push(...t[i]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/**
 * Builds the hall into `scene`. `opts`: { R (the ring's radius), FLOOR (the canvas's height), small,
 * ring ('red' | 'green'), eye (where the main camera stands: the posts light the flat it sees), kit and
 * crowd (loadHallAssets's; null builds those parts in code) }.
 */
export function buildRoom(scene, renderer, { R, FLOOR, small, ring, eye, kit = null, crowd = null }) {
  const heavy = !small;
  const COS30 = Math.cos(Math.PI / 6);
  const APO = R * COS30; // the ring's apothem: from the centre to the middle of a side
  const corner = (k, r = R) => new THREE.Vector3(r * Math.cos((k * Math.PI) / 3), FLOOR, r * Math.sin((k * Math.PI) / 3));
  /** A point d metres out from side k's line (k to k + 1), s of the way along it, at height y. */
  const onSide = (k, s, d, y) => {
    const r = (APO + d) / COS30;
    const a = corner(k, r);
    const b = corner((k + 1) % 6, r);
    return a.lerp(b, s).setY(y);
  };
  const reflect = (o) => {
    o.traverse((x) => x.layers.enable(MIRROR));
    return o;
  };
  const add = (o, { cast = false, receive = true, mirror = false } = {}) => {
    o.traverse((x) => {
      if (x.isMesh) {
        x.castShadow = cast;
        x.receiveShadow = receive;
      }
    });
    if (mirror) reflect(o);
    scene.add(o);
    return o;
  };
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const polished = polishedEnvironment(renderer); // what polished metal mirrors
  const glow = (color, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
  const brushed = tex(steelTex(256, 256, 70), { repeat: [2, 2] });
  const steel = std({ color: 0x9ea4ae, map: brushed, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.3 });
  const darkSteel = std({ color: 0xa4a9b2, map: brushed, metalness: 0.75, roughness: 0.38, envMapIntensity: 1.6 });
  const rubber = std({ color: 0x0b0c0e, metalness: 0, roughness: 0.7 });
  const led = { red: glow(RED, 1.3), green: glow(GREEN, 0.95) };
  const sideOf = (x) => (x < 0 ? 'red' : 'green');

  // ---- the ring's deck: black under the canvas, the apron round it
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, FLOOR - 0.02, 6, 1, false, Math.PI / 6), rubber);
  deck.position.y = (FLOOR - 0.02) / 2;
  add(deck);

  // ---- the ring's steel: the kit's baked posts, apron, brackets, steps and canvas when it loaded, the
  // panels behind its grilles lit in each half's colour; else the code's own
  if (kit) {
    // the panels behind the grilles: the light seen through their mesh (drawn in the map, so the mesh
    // holds where the grille's own wires fade with distance), in the half's colour
    const panel = Object.fromEntries(['red', 'green'].map((sd) => {
      const m = kit.ApronSide.getObjectByName('ApronGlow_L').material.clone();
      m.emissive.copy(sd === 'red' ? RED : GREEN).multiplyScalar(sd === 'red' ? 1.1 : 0.75);
      return [sd, m];
    }));
    // its LED strips (u across each): a white-hot core in the colour's glow, the colour itself deep at
    // the edges so the tone mapping keeps red red
    const strip = Object.fromEntries([['red', RED, 1.45], ['green', GREEN, 1.1]].map(([sd, c, k]) => [sd, new THREE.MeshBasicMaterial({ map: stripCore(c), color: new THREE.Color(k, k, k) })]));
    // the dark strips' covers: brushed steel, flush with the bezels
    const cover = std({ color: 0x7a8088, map: brushed, metalness: 0.9, roughness: 0.3, envMapIntensity: 1.7 });
    const steelRing = add(kitRing(kit, { R, led: strip, panel, eye, cover }), { cast: heavy, mirror: true });
    // the gold: polished, mirroring a sharper, more contrasted hall (bright lamps, dark gaps), so it reads
    // as metal and its chamfers flash, not as yellow paint
    const gold = steelRing.getObjectByName('GOLD')?.material;
    if (gold) shoulder(Object.assign(gold, { envMap: polished, envMapIntensity: 2.8, roughness: 0.6, emissiveIntensity: 0.03 }));
    // the canvas's plates mirror the same sharp hall: black with points of light, not a grey sheen
    Object.assign(steelRing.getObjectByName('CANVAS').material, { envMap: polished, envMapIntensity: 1.1 });
    // the canvas's plates tile: grime over the whole of it, darker and duller in the blotches; the
    // ring's colour a breath in the steel; round each post its strips' colour on the polished plates
    const grime = { value: grimeTex(small ? 512 : 1024) };
    const ringTint = { value: ring === 'green' ? new THREE.Color(0.95, 1.05, 0.99) : new THREE.Color(1.05, 0.96, 0.98) };
    const posts = { value: Array.from({ length: 6 }, (_, k) => new THREE.Vector2(Math.cos((k * Math.PI) / 3), Math.sin((k * Math.PI) / 3)).multiplyScalar(R - 0.08)) };
    const postCol = { value: posts.value.map((p) => sideColor(p.x).clone().multiplyScalar(p.x < 0 ? 0.36 : 0.26)) };
    steelRing.getObjectByName('CANVAS').material.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tGrime: grime, uRingTint: ringTint, uPosts: posts, uPostCol: postCol });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vGrime;\nvarying vec2 vXZ;')
        .replace('#include <fog_vertex>', `#include <fog_vertex>\nvXZ = (modelMatrix * vec4(transformed, 1.0)).xz;\nvGrime = vXZ / ${(2 * R + 0.2).toFixed(1)} + 0.5;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform sampler2D tGrime;\nuniform vec3 uRingTint;\nuniform vec2 uPosts[6];\nuniform vec3 uPostCol[6];\nvarying vec2 vGrime;\nvarying vec2 vXZ;')
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
          vec3 gm = texture2D(tGrime, vGrime).rgb;
          float grime = gm.r;
          diffuseColor.rgb *= (0.28 + grime * 0.42) * uRingTint;
          // the middle, under the key, polished wet by the fighters' feet; the edges duller
          float mid = exp(-dot(vXZ, vXZ) / 9.0);
          roughnessFactor = clamp((roughnessFactor + (0.5 - grime) * 0.3) * mix(1.0, 0.55, mid), 0.12, 0.62);
          // dust: a dry grey film, no metal in it; the soles' rubber marks: black, a little glossy
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05, 0.047, 0.043), gm.g * 0.6);
          roughnessFactor = mix(mix(roughnessFactor, 0.72, gm.g * 0.6), 0.42, gm.b * 0.6);
          metalnessFactor *= 1.0 - gm.g * 0.5 - gm.b * 0.7;
          diffuseColor.rgb *= 1.0 - gm.b * 0.7;`)
        .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
          vec3 spill = vec3(0.0);
          for (int k = 0; k < 6; k++) {
            vec2 q = vXZ - uPosts[k];
            spill += uPostCol[k] * exp(-dot(q, q) / 2.0);
          }
          reflectedLight.indirectSpecular += spill * mix(0.5, 1.6, 1.0 - roughnessFactor);
          // the key's warm sheen on the wet middle
          reflectedLight.indirectSpecular += vec3(1.0, 0.84, 0.66) * 0.14 * mid * (1.0 - roughnessFactor);`);
    };
    // the steps' noses: a polished steel rod on each tread's front edge and on the landing's, that the
    // lamps catch from anywhere in the hall
    {
      const n = 6;
      const lipY = FLOOR - 0.05;
      const rods = Array.from({ length: n + 1 }, (_, i) => {
        const y = i ? lipY - (lipY / (n + 0.4)) * i + 0.006 : lipY + 0.018;
        const z = APO + (i ? 0.46 + 0.3 * i - 0.012 : 0.47);
        return new THREE.CylinderGeometry(0.011, 0.011, 2.46, 8).rotateZ(Math.PI / 2).translate(0, y, z);
      });
      add(new THREE.Mesh(mergeGeometries(rods), shoulder(std({ color: 0xe2e6ec, metalness: 1, roughness: 0.15, envMapIntensity: 2.2 }))), { mirror: true });
    }
    // the posts' caps: polished faceted steel over the kit's dark ones, a lip, two chamfers and a low
    // pyramid on top, each facet flat so it flashes as the lamps catch it; under the lip a thin ring of
    // the corner's light
    {
      const A = 0.34; // the post's apothem
      const rc = (ap) => ap / Math.cos(Math.PI / 8);
      const prof = [[A + 0.052, 2.652], [A + 0.056, 2.66], [A + 0.056, 2.72], [A + 0.012, 2.79], [A - 0.04, 2.83], [A - 0.13, 2.865], [0.001, 2.885]].map(([ap, y]) => new THREE.Vector2(rc(ap), y));
      const capGeo = new THREE.LatheGeometry(prof, 8).rotateY(Math.PI / 8).toNonIndexed();
      capGeo.computeVertexNormals();
      const ringGeo = new THREE.CylinderGeometry(rc(A + 0.05), rc(A + 0.05), 0.012, 8, 1, true).rotateY(Math.PI / 8).translate(0, 2.645, 0);
      const caps = [];
      const glowRing = { red: [], green: [] };
      for (let k = 0; k < 6; k++) {
        const p = new THREE.Vector3(Math.cos((k * Math.PI) / 3), 0, Math.sin((k * Math.PI) / 3)).multiplyScalar(R - 0.08);
        const rot = Math.atan2(-p.x, -p.z);
        caps.push(capGeo.clone().rotateY(rot).translate(p.x, 0, p.z));
        glowRing[sideOf(p.x)].push(ringGeo.clone().rotateY(rot).translate(p.x, 0, p.z));
      }
      // turned steel: fine rings, smudges and scratches in its roughness (the reflections break up as on real metal)
      const cm = capMaps(small ? 256 : 512);
      add(new THREE.Mesh(mergeGeometries(caps), shoulder(std({ color: 0xbcc2ca, map: cm.map, roughnessMap: cm.rough, metalness: 1, roughness: 1, flatShading: true, envMap: polished, envMapIntensity: 1.35 }))), { cast: heavy, mirror: true });
      for (const sd of ['red', 'green']) add(new THREE.Mesh(mergeGeometries(glowRing[sd]), glow(sd === 'red' ? RED : GREEN, sd === 'red' ? 1.3 : 0.95)), { mirror: true });
    }
  } else {
    // ---- the canvas: hex plates of dark steel, the emblem inlaid in gold
    const pm = plateMaps(small ? 1024 : 2048, R + 0.05, ring);
    const canvasTop = new THREE.Mesh(new THREE.CircleGeometry(R + 0.05, 6).rotateX(-Math.PI / 2), std({
      map: pm.map, roughnessMap: pm.rough, metalnessMap: pm.rough, normalMap: pm.normal, normalScale: new THREE.Vector2(0.9, 0.9),
      emissive: 0xffffff, emissiveMap: pm.emissive, emissiveIntensity: 0.14, roughness: 1, metalness: 1, envMapIntensity: 1.15,
    }));
    canvasTop.position.y = FLOOR;
    add(canvasTop, { receive: true, mirror: true });

    // ---- the apron: a flat riveted lip round the canvas, then a skirt slanting out to the floor, each
    // half side a steel frame round a mesh grille lit from behind; LED lines along the canvas's edge and
    // the lip's front; chunky steel brackets at the corners. Each half of a side takes its half's colour.
    const LIP = [0.03, 0.44]; // the lip, out from the side line
    const LIP_Y = FLOOR - 0.05;
    const SKIRT = [0.44, 0.78]; // the skirt runs from the lip's front, low, out to the floor
    const SKIRT_Y = [FLOOR - 0.13, 0.02];
    {
      const lip = [];
      const skirt = { red: [], green: [] };
      const lines = { red: [], green: [] };
      const soft = { red: [], green: [] };
      const fronts = [];
      const up = new THREE.Vector3(0, 1, 0);
      for (let k = 0; k < 6; k++) for (const [s0, s1] of [[0, 0.5], [0.5, 1]]) {
        const mid = onSide(k, (s0 + s1) / 2, 0, 0);
        const side = sideOf(mid.x);
        const out = mid.clone().setY(0).normalize();
        const P = (s, d, y) => onSide(k, s, d, y);
        lip.push({ p: [P(s0, LIP[0], LIP_Y), P(s1, LIP[0], LIP_Y), P(s1, LIP[1], LIP_Y), P(s0, LIP[1], LIP_Y)], out: up, uvr: [0, 1, 0, 1] });
        // the lip's front, and the canvas's edge: thin faces carrying the LED lines
        fronts.push({ p: [P(s0, LIP[1], SKIRT_Y[0]), P(s1, LIP[1], SKIRT_Y[0]), P(s1, LIP[1], LIP_Y), P(s0, LIP[1], LIP_Y)], out });
        lines[side].push({ p: [P(s0, LIP[1] + 0.004, LIP_Y - 0.065), P(s1, LIP[1] + 0.004, LIP_Y - 0.065), P(s1, LIP[1] + 0.004, LIP_Y - 0.03), P(s0, LIP[1] + 0.004, LIP_Y - 0.03)], out });
        lines[side].push({ p: [P(s0, LIP[0] + 0.012, LIP_Y + 0.005), P(s1, LIP[0] + 0.012, LIP_Y + 0.005), P(s1, LIP[0] + 0.012, FLOOR - 0.012), P(s0, LIP[0] + 0.012, FLOOR - 0.012)], out });
        soft[side].push({ p: [P(s0, LIP[0] + 0.01, LIP_Y + 0.002), P(s1, LIP[0] + 0.01, LIP_Y + 0.002), P(s1, LIP[0] + 0.1, LIP_Y + 0.002), P(s0, LIP[0] + 0.1, LIP_Y + 0.002)], out: up });
        skirt[side].push({ p: [P(s0, SKIRT[1], SKIRT_Y[1]), P(s1, SKIRT[1], SKIRT_Y[1]), P(s1, SKIRT[0], SKIRT_Y[0]), P(s0, SKIRT[0], SKIRT_Y[0])], out: out.clone().add(up) });
      }
      const lipTex = plateTex();
      lipTex.wrapS = lipTex.wrapT = THREE.RepeatWrapping;
      lipTex.repeat.set(2, 1);
      add(new THREE.Mesh(quadGeo(lip), std({ color: 0x8a9099, map: lipTex, metalness: 0.85, roughness: 0.38, envMapIntensity: 1.2 })), { mirror: true });
      add(new THREE.Mesh(quadGeo(fronts), darkSteel), { mirror: true });
      const sk = skirtMaps();
      for (const side of ['red', 'green']) {
        const mat = std({ color: 0xb4b9c2, map: sk.map, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1, emissive: (side === 'red' ? RED : GREEN).clone(), emissiveMap: sk.emissive, emissiveIntensity: side === 'red' ? 0.8 : 0.5 });
        add(new THREE.Mesh(quadGeo(skirt[side]), mat), { mirror: true, receive: false });
        add(new THREE.Mesh(quadGeo(lines[side]), led[side]), { mirror: true, receive: false });
        add(new THREE.Mesh(quadGeo(soft[side]), new THREE.MeshBasicMaterial({ color: (side === 'red' ? RED : GREEN).clone().multiplyScalar(0.22), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })), { receive: false });
      }
      // the corner brackets: chunky riveted steel, the full height of the apron
      const bracketTex = plateTex(256, 256);
      const bracketMat = std({ color: 0xd0d4dc, map: bracketTex, metalness: 0.8, roughness: 0.34, envMapIntensity: 2.2 });
      const parts = [];
      for (let k = 0; k < 6; k++) {
        const dir = corner(k, 1).setY(0).normalize();
        const r0 = (APO + 0.1) / COS30;
        const r1 = (APO + SKIRT[1] + 0.04) / COS30;
        const b = new RoundedBoxGeometry(0.5, FLOOR + 0.02, r1 - r0, 1, 0.06);
        b.rotateY(Math.atan2(dir.x, dir.z));
        b.translate(dir.x * (r0 + r1) / 2, (FLOOR + 0.02) / 2, dir.z * (r0 + r1) / 2);
        parts.push(b);
        // a heavy foot plate
        const f = new RoundedBoxGeometry(0.66, 0.09, 0.5, 1, 0.03);
        f.rotateY(Math.atan2(dir.x, dir.z));
        f.translate(dir.x * (r1 - 0.12), 0.045, dir.z * (r1 - 0.12));
        parts.push(f);
      }
      add(new THREE.Mesh(mergeGeometries(parts), bracketMat), { mirror: true, cast: false });
    }

    // ---- the steps up the near side, in its middle: diamond-plate treads, steel stringers with a line of
    // light down each, red on the left and green on the right
    {
      const g = new THREE.Group();
      const mid = onSide(1, 0.5, 0, 0);
      g.position.set(mid.x, 0, mid.z);
      g.rotation.y = Math.atan2(mid.x, mid.z); // +z away from the ring
      const tm = treadMaps();
      const tread = std({ color: 0xa8aeb8, map: tm.map, normalMap: tm.normal, metalness: 0.85, roughness: 0.34, envMapIntensity: 1.2 });
      const n = 6;
      const W = 1.7;
      const D = 0.3;
      for (let i = 0; i < n; i++) {
        const top = LIP_Y - (LIP_Y / (n + 0.4)) * (i + 1);
        const box = new THREE.Mesh(new THREE.BoxGeometry(W, top, D), [darkSteel, darkSteel, tread, darkSteel, darkSteel, darkSteel]);
        box.position.set(0, top / 2, LIP[1] + D * (i + 0.5));
        g.add(box);
        const nose = new THREE.Mesh(new THREE.BoxGeometry(W - 0.04, 0.02, 0.025), steel);
        nose.position.set(0, top, LIP[1] + D * (i + 1) - 0.012);
        g.add(nose);
      }
      // the landing on the lip, and the stringers
      const land = new THREE.Mesh(new THREE.BoxGeometry(W, 0.03, LIP[1] - LIP[0]), tread);
      land.position.set(0, LIP_Y + 0.012, (LIP[0] + LIP[1]) / 2);
      g.add(land);
      const run = D * n;
      const shape = new THREE.Shape([new THREE.Vector2(LIP[0], FLOOR + 0.03), new THREE.Vector2(LIP[0], 0), new THREE.Vector2(LIP[1] + run + 0.1, 0), new THREE.Vector2(LIP[1] + run + 0.1, 0.12)]);
      const sg = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: false }).rotateY(-Math.PI / 2); // the shape's x along +z, extruded towards -x
      for (const s of [-1, 1]) {
        const st = new THREE.Mesh(sg, darkSteel);
        st.position.x = s > 0 ? W / 2 + 0.16 : -W / 2;
        g.add(st);
        // the line of light along its top, down the slope
        const a = new THREE.Vector3(s * (W / 2 + 0.08), FLOOR + 0.04, LIP[0] + 0.02);
        const b = new THREE.Vector3(s * (W / 2 + 0.08), 0.13, LIP[1] + run + 0.09);
        const d = new THREE.Vector3().subVectors(b, a);
        const line = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.02, d.length()), led[s < 0 ? 'red' : 'green']);
        line.position.copy(a).addScaledVector(d, 0.5);
        line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d.clone().normalize());
        g.add(line);
        const front = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.12, 0.02), led[s < 0 ? 'red' : 'green']);
        front.position.set(s * (W / 2 + 0.08), 0.065, LIP[1] + run + 0.1);
        g.add(front);
      }
      add(g, { mirror: true });
    }

    // ---- the posts: thick dark steel, chamfered, an LED strip set into every face, a lamp on the cap
    const postGeo = new RoundedBoxGeometry(0.5, FLOOR + 1.55, 0.5, 3, 0.07);
    const capGeo = new THREE.CylinderGeometry(0.22, 0.33, 0.2, 8, 1).rotateY(Math.PI / 8);
    const stripGeo = new THREE.BoxGeometry(0.07, 1.25, 0.02);
    const coreGeo = new THREE.BoxGeometry(0.026, 1.21, 0.022);
    const slotGeo = new THREE.BoxGeometry(0.12, 1.34, 0.012);
    const haloGeo = new THREE.PlaneGeometry(0.42, 1.6);
    const postMat = std({ color: 0xd8dce4, map: brushed, metalness: 0.8, roughness: 0.34, envMapIntensity: 2.2 });
    const capMat = std({ color: 0xffffff, map: brushed, metalness: 0.85, roughness: 0.32, envMapIntensity: 2.4, flatShading: true });
    const slotMat = std({ color: 0x050506, metalness: 0.5, roughness: 0.5 });
    // each strip: a white-hot core in its colour's glow, and a soft halo on the steel round it
    const core = { red: glow(new THREE.Color(1, 0.16, 0.14), 2.2), green: glow(new THREE.Color(0.18, 1, 0.22), 1.7) };
    const haloTex = softSpot(64, 1.4);
    const halo = Object.fromEntries(['red', 'green'].map((sd) => [sd, new THREE.MeshBasicMaterial({ map: haloTex, color: (sd === 'red' ? RED : GREEN).clone().multiplyScalar(sd === 'red' ? 0.2 : 0.14), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })]));
    for (let k = 0; k < 6; k++) {
      const p = corner(k, R - 0.08);
      const side = sideOf(p.x);
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      g.rotation.y = Math.atan2(-p.x, -p.z); // +z towards the ring's centre
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = (FLOOR + 1.55) / 2 + 0.1;
      g.add(post);
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = FLOOR + 1.75;
      g.add(cap);
      // the strips: on the face out to the hall and the face in to the ring; the two side posts also on
      // the face that looks towards the near stand (the wide camera's), which their outer face does not
      const rot = g.rotation.y;
      const faces = [Math.PI, 0];
      if (Math.abs(p.z) < 1) faces.push(-Math.sin(rot) > 0 ? Math.PI / 2 : -Math.PI / 2); // the world z of local +x is -sin(rot)
      for (const a of faces) {
        const slot = new THREE.Mesh(slotGeo, slotMat);
        slot.position.set(Math.sin(a) * 0.247, FLOOR + 0.85, Math.cos(a) * 0.247);
        slot.rotation.y = a;
        g.add(slot);
        const s = new THREE.Mesh(stripGeo, led[side]);
        s.position.set(Math.sin(a) * 0.245, FLOOR + 0.85, Math.cos(a) * 0.245);
        s.rotation.y = a;
        g.add(s);
        const c = new THREE.Mesh(coreGeo, core[side]);
        c.position.set(Math.sin(a) * 0.247, FLOOR + 0.85, Math.cos(a) * 0.247);
        c.rotation.y = a;
        g.add(c);
        const h = new THREE.Mesh(haloGeo, halo[side]);
        h.position.set(Math.sin(a) * 0.262, FLOOR + 0.85, Math.cos(a) * 0.262);
        h.rotation.y = a;
        g.add(h);
      }
      // the rope ends: steel rings on the inner face
      for (const h of ROPES) {
        const eye = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.016, 6, 12), steel);
        eye.position.set(0, FLOOR + h, 0.26);
        g.add(eye);
      }
      add(g, { cast: true, mirror: true });
    }
  }
  const postTops = Array.from({ length: 6 }, (_, k) => corner(k, R * 0.97).setY(FLOOR + 1.9));

  // ---- the ropes: braided steel, a little sag, black sleeves where they meet the code's posts
  {
    const braid = braidMaps(small ? 256 : 512);
    const ropeMat = std({ color: 0xb8bec6, metalness: 1, roughness: 1, map: braid.map, roughnessMap: braid.orm, aoMap: braid.orm, aoMapIntensity: 1, normalMap: braid.normal, normalScale: new THREE.Vector2(1, 1), envMap: polished, envMapIntensity: 1.9 });
    // where a texel of the braid is smaller than a pixel its bumps are averaged away: the sheen goes as
    // rough as they were, so the wide shot does not sparkle
    ropeMat.onBeforeCompile = (sh) => {
      sh.uniforms.uLoad = ROPE_LOAD.at;
      sh.uniforms.uLoadSide = ROPE_LOAD.side;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform vec4 uLoad[4];\nuniform vec4 uLoadSide[4];').replace('#include <begin_vertex>', `#include <begin_vertex>
        float dip = 0.0;
        for (int i = 0; i < 4; i++) {
          vec4 L = uLoad[i];
          if (L.w <= 0.0) continue;
          vec4 S = uLoadSide[i];
          vec2 dir = normalize(L.xz - S.xy);
          vec2 rel = transformed.xz - S.xy;
          float along = dot(rel, dir);
          float on = (1.0 - smoothstep(0.07, 0.13, length(rel - dir * along))) * (1.0 - smoothstep(0.07, 0.12, abs(transformed.y - L.y)));
          float at = dot(L.xz - S.xy, dir);
          float v = along < at ? (along - S.z) / max(0.05, at - S.z) : (S.w - along) / max(0.05, S.w - at);
          dip = max(dip, L.w * on * clamp(v, 0.0, 1.0));
        }
        transformed.y -= dip;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          vec2 fw = fwidth(vRoughnessMapUv) * ${small ? '256.0' : '512.0'};
          roughnessFactor = mix(roughnessFactor, 0.32, smoothstep(1.2, 9.0, max(fw.x, fw.y)));
        }`);
    };
    const ropes = [];
    const sleeves = [];
    for (let k = 0; k < 6; k++) {
      const a = corner(k, R - 0.08);
      const b = corner((k + 1) % 6, R - 0.08);
      const d = new THREE.Vector3().subVectors(b, a).normalize();
      // from the kit's turnbuckles (they end 0.54 m from the post's centre), or the code's rope eyes
      const a2 = a.clone().addScaledVector(d, kit ? 0.54 : 0.2);
      const b2 = b.clone().addScaledVector(d, kit ? -0.54 : -0.2);
      for (const h of ROPES) {
        const p0 = a2.clone().setY(FLOOR + h);
        const p2 = b2.clone().setY(FLOOR + h);
        const p1 = p0.clone().lerp(p2, 0.5).setY(FLOOR + h - 0.05); // a 2.5 cm sag in the middle
        const curve = new THREE.QuadraticBezierCurve3(p0, p1, p2);
        const tube = new THREE.TubeGeometry(curve, 32, 0.042, small ? 8 : 12);
        // u in lays of the braid along the rope, v once round it
        const uv = tube.attributes.uv;
        const lays = curve.getLength() / BRAID.lay;
        for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * lays);
        ropes.push(tube);
        if (!kit) for (const [from, s] of [[p0, 1], [p2, -1]]) {
          const c = new THREE.CylinderGeometry(0.056, 0.056, 0.24, 10);
          c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
          const at = from.clone().addScaledVector(d, 0.12 * s);
          c.translate(at.x, at.y, at.z);
          sleeves.push(c);
        }
      }
    }
    add(new THREE.Mesh(mergeGeometries(ropes), ropeMat), { cast: true, mirror: true });
    if (sleeves.length) add(new THREE.Mesh(mergeGeometries(sleeves), rubber), { mirror: true });
  }

  // ---- the floor: black polished concrete, wet, mirroring the ring and the lights
  const fm = floorMaps(small ? 256 : 512);
  // (a phone has no mirror: there the concrete is darker and its reflections fainter, so the puddles
  // do not turn to a grey cloud)
  const floorMat = std({ color: small ? 0x9a9a9a : 0xffffff, map: fm.map, roughnessMap: fm.rough, normalMap: fm.normal, normalScale: new THREE.Vector2(small ? 0.05 : 0.25, small ? 0.05 : 0.25), roughness: small ? 1.25 : 1, metalness: 0.2, envMapIntensity: small ? 0.1 : 0.5 });
  const mirror = heavy ? makeMirror(renderer, scene) : null;
  const floorU = { tMirror: { value: mirror?.texture ?? null }, mirrorMatrix: { value: mirror?.matrix ?? new THREE.Matrix4() }, mirrorK: { value: mirror ? 1 : 0 }, uRed: { value: RED }, uGreen: { value: GREEN } };
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floorU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 mirrorMatrix;\nvarying vec4 vMirror;\nvarying vec3 vWorld;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMirror = mirrorMatrix * modelMatrix * vec4(transformed, 1.0);\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMirror;\nuniform float mirrorK;\nuniform vec3 uRed;\nuniform vec3 uGreen;\nvarying vec4 vMirror;\nvarying vec3 vWorld;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular *= 0.4;')
      .replace('#include <opaque_fragment>', `
        float wet = 1.0 - smoothstep(0.05, 0.32, roughnessFactor);
        // the apron's light on the floor: each half's colour, falling off out to the stands, as patchy as
        // the concrete
        float rr = length(vWorld.xz);
        float fall = pow(clamp(1.0 - (rr - 5.6) / 7.0, 0.0, 1.0), 1.25) * smoothstep(0.5, 4.0, abs(vWorld.x));
        float grain = clamp(dot(diffuseColor.rgb, vec3(0.33)) * ${small ? '210.0' : '70.0'}, 0.7, 1.25); // (a phone's concrete is darker)
        outgoingLight += mix(vec3(0.5), vWorld.x < 0.0 ? uRed : uGreen * 0.7, 0.85) * ${small ? 0.075 : 0.09} * fall * grain;
        if (mirrorK > 0.0) {
          // the mirror: sharp in the puddles, stretched into streaks towards the viewer where it is only
          // damp, bent a little by the grit and the cracks; round the apron, where the ring's lights
          // fall in it, polished, the streaks clean
          float near = 1.0 - smoothstep(6.5, 8.5, rr);
          vec2 muv = vMirror.xy / vMirror.w + (normal.xy - normalize(vNormal).xy) * 0.06 * mix(1.0, 0.3, near);
          float lod = mix(mix(4.2, 0.3, wet), 0.6, near * 0.8);
          float len = mix(0.2, 0.03, wet) * mix(1.0, 0.6, near);
          vec3 refl = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 8; i++) {
            float f = float(i) / 7.0;
            float w = 1.0 - f * 0.8;
            refl += textureLod(tMirror, muv + vec2(0.0, (f - 0.12) * len), lod + f * 1.4).rgb * w;
            wsum += w;
          }
          refl = min(refl / wsum, vec3(4.0));
          vec3 V = normalize(vViewPosition);
          float fres = 0.3 + 0.7 * pow(1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0), 3.0);
          outgoingLight += refl * fres * mix(0.7, 1.9, wet) * mirrorK;
        }
        #include <opaque_fragment>`);
  };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(STANDS_R + 0.4, 96).rotateX(-Math.PI / 2), floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // ---- the light track: a big circle of dashed LED round the ring, red on the left, green on the right
  const TRACK_R = R + 2.75;
  {
    const core = [];
    const halo = [];
    const N = 46;
    for (let i = 0; i < N; i++) {
      const a0 = ((i + 0.18) / N) * Math.PI * 2;
      const a1 = ((i + 0.82) / N) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const x = Math.cos(am);
      if (Math.abs(x) < 0.05) continue; // where red meets green, a gap
      // the dash, and its glow on the floor: wider, and reaching a third of its length past each end
      for (const [list, w, over] of [[core, 0.045, 0], [halo, 0.32, 0.3]]) {
        const b0 = a0 - (a1 - a0) * over;
        const len = (a1 - a0) * (1 + 2 * over);
        const ring = new THREE.RingGeometry(TRACK_R - w, TRACK_R + w, 4, 1, -b0 - len, len);
        const n = ring.attributes.position.count;
        const col = new Float32Array(n * 3);
        const c = sideColor(x);
        const uvs = ring.attributes.uv;
        for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
        ring.setAttribute('color', new THREE.BufferAttribute(col, 3));
        // u across the band (0 at its inner edge, 1 at its outer), v along it (for the halo's falloff)
        for (let j = 0; j < n; j++) {
          const px = ring.attributes.position.getX(j);
          const py = ring.attributes.position.getY(j);
          const along = (THREE.MathUtils.euclideanModulo(Math.atan2(py, px) + b0 + len + 1e-4, Math.PI * 2) - 1e-4) / len;
          uvs.setXY(j, (Math.hypot(px, py) - (TRACK_R - w)) / (2 * w), 1 - Math.min(1, along));
        }
        list.push(ring);
      }
    }
    const coreGeo = mergeGeometries(core).rotateX(-Math.PI / 2);
    const haloGeo = mergeGeometries(halo).rotateX(-Math.PI / 2);
    const coreM = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.35, 1.0, 1.35) }));
    coreM.position.y = 0.012;
    scene.add(coreM);
    // the halo: soft across the band and soft at both ends, so the dashes glow, not their boxes
    const band = canvas(64, 64);
    {
      const bg = band.getContext('2d');
      const img = bg.createImageData(64, 64);
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
        const u = Math.abs(x / 63 - 0.5) * 2;
        const v = y / 63;
        const k = (1 - u) ** 2 * THREE.MathUtils.smoothstep(v, 0, 0.3) * THREE.MathUtils.smoothstep(1 - v, 0, 0.3);
        const i = (y * 64 + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = k * 255;
        img.data[i + 3] = 255;
      }
      bg.putImageData(img, 0, 0);
    }
    const haloM = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ vertexColors: true, map: tex(band, { srgb: false }), color: new THREE.Color(0.1, 0.1, 0.1), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    haloM.position.y = 0.01;
    scene.add(haloM);
    // a thin steel lip set into the concrete just inside it
    const lip = new THREE.Mesh(new THREE.RingGeometry(TRACK_R - 0.44, TRACK_R - 0.39, 160).rotateX(-Math.PI / 2), std({ color: 0x3a3d42, metalness: 1, roughness: 0.3, envMapIntensity: 1.4 }));
    lip.position.y = 0.008;
    scene.add(lip);
  }

  // ---- the railing in front of the stands: plain steel, posts every metre or so and two tubes
  const railMat = std({ color: 0x5a5f66, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.6 });
  {
    const parts = [];
    const n = Math.round((Math.PI * 2 * RAIL_R) / 1.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(new THREE.CylinderGeometry(0.028, 0.028, 1.02, 6).translate(Math.cos(a) * RAIL_R, 0.51, Math.sin(a) * RAIL_R));
    }
    for (const y of [0.5, 1.0]) parts.push(new THREE.TorusGeometry(RAIL_R, y > 0.9 ? 0.032 : 0.022, 6, 180).rotateX(Math.PI / 2).translate(0, y, 0));
    add(new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), railMat), { receive: false, mirror: true });
  }

  // ---- the truss: two true circles of segmented box truss over the ring, the inner one round the
  // scoreboard's top, the outer one out over the light track, joined by six spokes and hung from the
  // roof on chain motors; a coupler at every other joint between the segments
  // (a phone's tall shot stands lower and looks up: there the rig hangs higher, clear of its picture)
  const T = small ? { ...TRUSS, y: TRUSS.y + 0.7, yIn: TRUSS.yIn + 0.95 } : TRUSS;
  const trussMat = std({ color: 0x9aa0aa, metalness: 0.95, roughness: 0.32, envMapIntensity: 2.0 });
  const H = 0.21; // half the truss's section
  const Y = new THREE.Vector3(0, 1, 0);
  {
    const parts = [];
    const bar = (a, b, r, sides = 5) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const g = new THREE.CylinderGeometry(r, r, d.length(), sides, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, d.clone().normalize()));
      g.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
      parts.push(g);
    };
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    /** A straight run of box truss from a to b (its section square, `n` the side direction): four
     *  chords, a zigzag of braces on each face, a coupler round the chords at its start. */
    const run = (a, b, n, ends = true) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const len = d.length();
      const at = (s, cn, cu) => a.clone().addScaledVector(d, s / len).addScaledVector(n, cn * H).addScaledVector(Y, cu * H);
      for (const [cn, cu] of cs) bar(at(0, cn, cu), at(len, cn, cu), 0.026, 6);
      const panels = Math.max(1, Math.round(len / 0.5));
      for (let i = 0; i < panels; i++) {
        const s0 = (i / panels) * len;
        const s1 = ((i + 1) / panels) * len;
        for (let f = 0; f < 4; f++) {
          const [n0, u0] = cs[f];
          const [n1, u1] = cs[(f + 1) % 4];
          if (i % 2) bar(at(s0, n0, u0), at(s1, n1, u1), 0.011, 4);
          else bar(at(s0, n1, u1), at(s1, n0, u0), 0.011, 4);
        }
      }
      if (ends) for (const [cn, cu] of cs) {
        const c = new THREE.BoxGeometry(0.075, 0.075, 0.09);
        c.lookAt(d);
        const p = at(0.02, cn, cu);
        parts.push(c.translate(p.x, p.y, p.z));
      }
    };
    /** A ring of `segs` straight segments, each its own piece of truss. */
    const circle = (r, y, segs) => {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const n = new THREE.Vector3(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2));
        run(new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r), new THREE.Vector3(Math.cos(a1) * r, y, Math.sin(a1) * r), n, i % 2 === 0);
      }
    };
    circle(T.r, T.y, small ? 40 : 60);
    circle(T.rIn, T.yIn, small ? 28 : 40);
    for (let k = 0; k < 6; k++) {
      // the spokes at the corners' angles: none straight over the camera's head or behind the board
      const a = (k * Math.PI) / 3;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const n = new THREE.Vector3(-dir.z, 0, dir.x);
      run(dir.clone().multiplyScalar(T.rIn + H).setY(T.yIn), dir.clone().multiplyScalar(T.r - H).setY(T.y), n, false);
      // chains to the roof and their motors
      for (const [r, y] of [[T.r, T.y], [T.rIn, T.yIn]]) {
        const p = dir.clone().multiplyScalar(r);
        bar(p.clone().setY(y + H), p.clone().setY(y + 12), 0.012, 4);
        parts.push(new THREE.BoxGeometry(0.26, 0.4, 0.26).translate(p.x, y + 1.6, p.z));
      }
    }
    const truss = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      g.deleteAttribute('uv');
      return g;
    })), trussMat);
    add(truss, { receive: false, mirror: true });
  }

  // ---- LED blocks on the truss: panels of four cells, red over the left half and green over the right,
  // on the inner ring's far side (over the board, in the main view) and round the outer ring
  {
    const cells = canvas(256, 64);
    const cg = cells.getContext('2d');
    cg.fillStyle = '#000';
    cg.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 4; i++) {
      const gr = cg.createRadialGradient(32 + i * 64, 32, 2, 32 + i * 64, 32, 34);
      gr.addColorStop(0, '#fff');
      gr.addColorStop(0.45, '#d8d8d8');
      gr.addColorStop(1, '#3a3a3a');
      cg.fillStyle = gr;
      cg.fillRect(5 + i * 64, 8, 54, 48);
    }
    const cellTex = tex(cells, { srgb: false, aniso: 4 });
    const blocks = { red: [], green: [] };
    const place = (r, y, a) => {
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      if (Math.abs(dir.x) < 0.2) return;
      for (const s of [-1, 1]) {
        const g = new THREE.PlaneGeometry(1.25, 0.24);
        g.lookAt(dir.clone().multiplyScalar(s)); // one face in across the ring, one out to the stands
        const p = dir.clone().multiplyScalar(r + s * (H + 0.04)).setY(y - 0.04);
        blocks[sideOf(dir.x)].push(g.translate(p.x, p.y, p.z));
      }
    };
    for (const a of [0.42, 0.95]) for (const s of [1, -1]) place(T.rIn, T.yIn, s > 0 ? -a : Math.PI + a);
    for (const a of [0.3, 0.78, 1.25, 1.9, 2.36, 2.84, 3.6, 4.1, 5.3, 5.8]) place(T.r, T.y, -a);
    for (const side of ['red', 'green']) {
      const k = side === 'red' ? 1.5 : 1.1;
      add(new THREE.Mesh(mergeGeometries(blocks[side]), new THREE.MeshBasicMaterial({ map: cellTex, color: (side === 'red' ? RED : GREEN).clone().multiplyScalar(k).lerp(new THREE.Color(k, k, k), 0.12) })), { receive: false, mirror: true });
    }
  }

  // ---- moving heads under the truss: each a yoke, a head and a lens, its glare in the haze; some throw
  // a beam. heads[0..17] are the sides' places (headAt, scene3d's beams): on the inner ring, steep over
  // the canvas, except those over the near side, which hang from the outer ring above the camera; the
  // rest go round the outer ring
  const heads = [];
  const hang = (r, y, a, side = -1, f = -1) => {
    const h = { side, f, at: new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), k: 2 };
    heads.push(h);
    return h;
  };
  for (let k = 0; k < 6; k++) for (const f of [0.22, 0.5, 0.78]) {
    const a = ((k + f) * Math.PI) / 3;
    if (k === 1) hang(T.r, T.y + 0.5, a, k, f); // stood on the truss, out of the main view
    else hang(T.rIn, T.yIn - 0.5, a, k, f);
  }
  const extra = [];
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * Math.PI * 2 + 0.11;
    if (Math.abs(Math.atan2(Math.sin(a - Math.PI / 2), Math.cos(a - Math.PI / 2))) < 0.6) continue; // the near side's are headAt's
    extra.push(hang(T.r, T.y - 0.5, a));
  }
  const yokeGeo = mergeGeometries([
    new THREE.BoxGeometry(0.36, 0.06, 0.16).translate(0, 0.34, 0),
    new THREE.BoxGeometry(0.045, 0.32, 0.12).translate(0.18, 0.18, 0),
    new THREE.BoxGeometry(0.045, 0.32, 0.12).translate(-0.18, 0.18, 0),
    new THREE.CylinderGeometry(0.03, 0.03, 0.2, 6).translate(0, 0.46, 0), // the clamp up to the truss
  ]);
  const headGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.12, 0.15, 0.34, 16),
    new THREE.CylinderGeometry(0.155, 0.155, 0.04, 16).translate(0, -0.15, 0), // the lens's bezel
  ]);
  const lensGeo = new THREE.CircleGeometry(0.125, 20).rotateX(Math.PI / 2).translate(0, -0.172, 0);
  const yokes = new THREE.InstancedMesh(yokeGeo, darkSteel, heads.length);
  const bodies = new THREE.InstancedMesh(headGeo, std({ color: 0x2a2c31, metalness: 0.8, roughness: 0.3, envMapIntensity: 1.8 }), heads.length);
  const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), heads.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const lensCol = new THREE.Color();
  // the glare: a hot core, a soft halo and a faint six-point star, facing the camera, brightest when the
  // lens looks towards it
  const glare = (() => {
    const S = 128;
    const c = canvas(S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = (x + 0.5) / S - 0.5;
      const v = (y + 0.5) / S - 0.5;
      const d = Math.hypot(u, v) * 2;
      const a = Math.atan2(v, u);
      const star = Math.pow(Math.abs(Math.cos(a * 3)), 60) * Math.max(0, 1 - d) ** 2.2;
      const k = Math.min(1, 0.55 * Math.exp(-d * d * 70) + 0.4 * Math.exp(-d * 6.5) + 0.3 * star) * Math.max(0, 1 - d);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = k * 255;
      img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return tex(c, { srgb: false, aniso: 1 });
  })();
  const gPos = new Float32Array(heads.length * 3);
  const gDir = new Float32Array(heads.length * 3);
  const gCol = new Float32Array(heads.length * 3);
  const glareGeo = new THREE.InstancedBufferGeometry();
  {
    const quad = new THREE.PlaneGeometry(1, 1);
    glareGeo.index = quad.index;
    glareGeo.setAttribute('position', quad.attributes.position);
    glareGeo.setAttribute('uv', quad.attributes.uv);
  }
  glareGeo.setAttribute('iPos', new THREE.InstancedBufferAttribute(gPos, 3));
  glareGeo.setAttribute('iDir', new THREE.InstancedBufferAttribute(gDir, 3).setUsage(THREE.DynamicDrawUsage));
  glareGeo.setAttribute('iCol', new THREE.InstancedBufferAttribute(gCol, 3).setUsage(THREE.DynamicDrawUsage));
  glareGeo.instanceCount = heads.length;
  const glares = new THREE.Mesh(glareGeo, new THREE.ShaderMaterial({
    uniforms: { map: { value: glare }, uSize: { value: small ? 1.8 : 2.4 }, mirrorPass: MIRROR_PASS },
    vertexShader: `attribute vec3 iPos; attribute vec3 iDir; attribute vec3 iCol; uniform float uSize; varying vec2 vUv; varying vec3 vCol;
      void main() {
        vec3 toCam = normalize(cameraPosition - iPos);
        float k = 0.28 + 0.72 * smoothstep(-0.35, 0.9, dot(toCam, iDir));
        vCol = iCol * k;
        vec4 mv = viewMatrix * vec4(iPos + toCam * 0.35, 1.0);
        mv.xy += position.xy * uSize * (0.55 + 0.6 * k);
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform sampler2D map; uniform float mirrorPass; varying vec2 vUv; varying vec3 vCol;
      void main() {
        gl_FragColor = vec4(texture2D(map, vUv).rgb * vCol * (1.0 - mirrorPass * 0.5), 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  }));
  glares.frustumCulled = false;
  glares.layers.enable(MIRROR);
  scene.add(glares);
  const placeHeads = () => {
    heads.forEach((h, i) => {
      // the yoke turns about the vertical, the head tilts in it
      q.setFromAxisAngle(Y, Math.atan2(h.dir.x, h.dir.z));
      m4.compose(h.at, q, one);
      yokes.setMatrixAt(i, m4);
      q.setFromUnitVectors(DOWN, h.dir);
      m4.compose(h.at, q, one);
      bodies.setMatrixAt(i, m4);
      lenses.setMatrixAt(i, m4);
      lenses.setColorAt(i, lensCol.copy(h.color).multiplyScalar(Math.min(h.k * 0.4, 1.4))); // bright, not burnt out
      gDir.set([h.dir.x, h.dir.y, h.dir.z], i * 3);
    });
    yokes.instanceMatrix.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
    lenses.instanceMatrix.needsUpdate = true;
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
    glareGeo.attributes.iDir.needsUpdate = true;
  };
  // the idle heads look down at the ring, a little apart
  for (const h of heads) h.dir.set(-h.at.x * 0.3, -T.y, -h.at.z * 0.3).normalize();
  for (const m of [yokes, bodies]) add(m, { receive: false, mirror: true });
  add(lenses, { receive: false, mirror: true });
  /** The head at side k (0..5, the side from corner k to corner k+1), place f (0.22, 0.5 or 0.78). */
  const headAt = (k, f) => heads.find((h) => h.side === k && Math.abs(h.f - f) < 0.01);

  // ---- the hall's own beams: soft white cones falling steeply from the outer ring onto the floor round
  // the ring and the first rows of the stands, swaying slowly in the haze
  const fan = [];
  if (heavy) {
    extra.forEach((h, n) => {
      if (h.at.z > 2.5) return; // over the camera's own stand a beam would cross the whole picture
      // white, a breath of the half's colour in those over the sides (the haze there is lit red or green)
      const color = new THREE.Color(0xf3f1ec).lerp(h.at.x < 0 ? new THREE.Color(1, 0.35, 0.33) : new THREE.Color(0.4, 1, 0.5), THREE.MathUtils.smoothstep(Math.abs(h.at.x) / T.r, 0.3, 0.9) * 0.45);
      const m = new THREE.Mesh(new THREE.ConeGeometry(1.35, 1, 24, 1, true), volumeMaterial(color, 0.034, 0.92));
      scene.add(m);
      h.color.copy(color);
      h.k = 5;
      // where it lands: out from under the truss, on the floor before the stands or their first rows
      const a = Math.atan2(h.at.z, h.at.x) + (n % 2 ? 0.12 : -0.12);
      const r = [11.5, 13.2, 14.6][n % 3];
      fan.push({ m, h, a, r, y: standHeight(r), ph: n * 1.7, to: new THREE.Vector3() });
    });
  }
  // and from the inner ring's heads the board's beams leave free, a fan outwards over the floor towards
  // the lower bowl's first rows, as a rig over a ring throws them, fading out in the haze on the way
  if (heavy) {
    [[0, 0.22], [0, 0.78], [2, 0.22], [2, 0.78], [3, 0.78], [5, 0.22], [4, 0.5]].forEach(([k, f], n) => {
      const h = headAt(k, f);
      const color = new THREE.Color(0xf3f1ec).lerp(h.at.x < 0 ? new THREE.Color(1, 0.35, 0.33) : new THREE.Color(0.4, 1, 0.5), THREE.MathUtils.smoothstep(Math.abs(h.at.x) / T.rIn, 0.3, 0.9) * 0.35);
      const m = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1, 24, 1, true), volumeMaterial(color, 0.024, 0.45)); // bright at the lamp, gone before the crowd
      scene.add(m);
      h.color.copy(color);
      h.k = 5;
      const r = [STANDS_R + 1.2, STANDS_R + 2.6, STANDS_R + 0.4][n % 3];
      fan.push({ m, h, a: Math.atan2(h.at.z, h.at.x) + (n % 2 ? 0.08 : -0.08), r, y: standHeight(r), ph: 3 + n * 2.3, to: new THREE.Vector3() });
    });
  }
  const aimFan = (b, t) => {
    const a = b.a + Math.sin(t * 0.17 + b.ph) * 0.14;
    const r = b.r + Math.sin(t * 0.13 + b.ph * 2) * 0.9;
    b.to.set(Math.cos(a) * r, b.y, Math.sin(a) * r);
    const d = new THREE.Vector3().subVectors(b.h.at, b.to);
    const len = d.length();
    b.m.scale.set(1, len, 1);
    b.m.position.copy(b.to).addScaledVector(d, 0.5);
    b.m.quaternion.setFromUnitVectors(Y, d.normalize());
    b.h.dir.subVectors(b.to, b.h.at).normalize();
  };
  fan.forEach((b) => aimFan(b, 0));
  const pools = fan.filter((b) => b.r >= STANDS_R).map((b) => ({ at: b.to, color: b.h.color }));
  heads.forEach((h, i) => gPos.set([h.at.x, h.at.y - 0.2, h.at.z], i * 3));
  placeHeads();
  const lightFlares = () => {
    heads.forEach((h, i) => {
      const k = Math.min(1.9, 0.5 + h.k * 0.3); // the lamps that throw a beam burn brighter than those that glow
      gCol.set([h.color.r * k, h.color.g * k, h.color.b * k], i * 3);
      gDir.set([h.dir.x, h.dir.y, h.dir.z], i * 3);
    });
    glareGeo.attributes.iCol.needsUpdate = true;
    glareGeo.attributes.iDir.needsUpdate = true;
  };
  lightFlares();

  // ---- the stands, their crowd and its phones; the fans' pools of light on them
  const stands = buildStands(scene, { small, steel: railMat, atlas: crowd });
  stands.setPools(pools);
  stands.setPhoneSize(4 * renderer.getPixelRatio());

  // ---- lights: a white key on the canvas, a cool fill, and each half's colour low over the floor
  const key = new THREE.SpotLight(0xffe6c8, 5.0, 0, 0.45, 0.6, 0);
  key.position.set(0, TRUSS.y + 0.6, 1.2);
  key.target.position.set(0, FLOOR, 0.2);
  key.castShadow = heavy;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 16;
  scene.add(key, key.target);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const w = new THREE.SpotLight(0xf4f2ee, 3.4, 0, 0.36, 0.8, 0);
    w.position.set(Math.cos(a) * TRUSS.rIn, TRUSS.yIn - 0.4, Math.sin(a) * TRUSS.rIn);
    w.target.position.set(Math.cos(a) * 3.2, FLOOR, Math.sin(a) * 3.2); // each a quarter of the canvas, none on the middle
    scene.add(w, w.target);
  }
  const fill = new THREE.SpotLight(0xd8e0f0, 2.2, 0, 0.75, 0.9, 0);
  fill.position.set(0, TRUSS.y + 1, 7);
  fill.target.position.set(0, FLOOR, 0);
  scene.add(fill, fill.target);
  // every light also lights the mirror's picture
  const lightsToMirror = () => scene.traverse((o) => {
    if (o.isLight) o.layers.enable(MIRROR);
  });

  let mirrorOn = !!mirror;
  return {
    postTops,
    heads,
    headAt,
    placeHeads,
    key,
    /** Every seat of the stands: `pos` (x, y, z on its tread, under the sitter's hips), `side` (-1 red,
     *  0 the ends, 1 green), `tier` (0 the lower bowl, 1, 2) and `row` (from the front), `count` of them. */
    seats: stands.seats,
    /** The crowd drawn on them (one instanced cut-out a person), to be swapped for the impostor atlas. */
    crowd: stands.crowd,
    lightsToMirror,
    reflect,
    /** Turns the floor's mirror off (a slow device). */
    lighten() {
      mirrorOn = false;
      floorU.mirrorK.value = 0;
    },
    setSize(w, h) {
      mirror?.setSize(w * 0.5, h * 0.5);
    },
    /** Before the hall is drawn: the floor's mirror, from this camera. */
    beforeRender(camera) {
      if (!mirrorOn) return;
      MIRROR_PASS.value = 1;
      mirror.render(camera);
      MIRROR_PASS.value = 0;
    },
    /** Each frame: `exc` each side's excitement, `roar` the hall's (0 calm, 1 on its feet), `winner`
     *  ('red' | 'blue' at the verdict): its half jumps up, the other stays seated. */
    update(t, dt, exc, roar, reduced, winner = null) {
      TIME.value = reduced ? 0 : t; // the haze, the clapping, the phones' sway hold still
      if (!reduced) {
        fan.forEach((b) => aimFan(b, t));
        stands.setPools(pools);
      }
      lightFlares();
      stands.update(t, dt, exc, roar, reduced, winner);
    },
  };
}

// ------------------------------------------------------------------ the picture's last touch

/** After the tone mapping: deep but open blacks, a gentle S, saturation kept, a vignette and a little
 *  film grain. */
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: TIME, grain: { value: 0.018 }, aspect: { value: 1.6 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float aspect; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = max(c - 0.008, 0.0) / 0.992;                         // the blacks: black
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.22);               // a gentle S
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.18);                               // the colour a touch richer
      c = max(c, 0.0);
      c += vec3(-0.004, -0.001, 0.006) * (1.0 - l) * smoothstep(0.0, 0.25, l) + vec3(0.01, 0.004, -0.008) * l;
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0);
      c *= mix(1.0, 0.68, smoothstep(0.4, 0.95, length(d) * 1.25));
      float n = hash(vUv * vec2(1931.0, 1171.0) + fract(time * 7.13)) - 0.5;
      c += n * grain * (1.0 - l * 0.7);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

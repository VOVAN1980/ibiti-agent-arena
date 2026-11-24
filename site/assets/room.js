// The hall around the fight: a dark arena in haze, a hexagon ring of dark steel (six thick posts with
// an LED strip set into their faces, braided steel ropes, a canvas of embossed hex plates with the
// gold emblem in the middle, an apron of riveted steel panels with backlit mesh grilles and steps up
// the near side), a wet black floor that mirrors it all, ringed by a dashed light track, a circular
// box truss with moving heads and LED blocks above, a plain steel railing, and the stands: the owner's
// photos on a raked band with lit stair aisles. Red is the left half of the hall, green the right.
// The fighters, their desks, the referee and the scoreboard are scene3d.js's; this module only builds
// and runs the room.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MIRROR = 1; // the layer of what the wet floor mirrors
export const TIME = { value: 0 }; // shared by the shaders that move
const MIRROR_PASS = { value: 0 }; // 1 while the floor's mirror is drawn
export const TRUSS = { y: 10.2, r: 10.2, yIn: 8.8, rIn: 5.2 }; // the two rings of the lighting truss
export const STANDS_R = 13.5; // the first row of the stands
export const RAIL_R = STANDS_R - 0.1; // the steel railing in front of them
export const ROPES = [0.35, 0.72, 1.08, 1.45]; // the ropes' heights over the canvas

// The photos of the upper stands, made for this room: the red side (left), the green side (right) and
// the far end, in site/assets/arena/. Each goes on one panel of the raked band behind the railing,
// cropped to the part of the picture whose people suit the distance (`crop`: u0, u1, v0, v1 of the
// photo), mirrored where its near end must face the camera.
const STANDS = {
  photos: true,
  dir: new URL('./arena/', import.meta.url).href,
  // tier: the share of the raked band the photo covers (above it, the dark); sat: how much of the
  // photo's own colour stays; tint, tintK: the side's wash and how much of it; aisles: stair aisles
  red: { file: 'stands_red.webp', crop: [0.5, 1.0, 0.3, 1.0], flip: true, tier: 0.5, sat: 0.8, tint: [1, 0.1, 0.08], tintK: 0.4, aisles: 2 },
  green: { file: 'stands_green.webp', crop: [0.5, 1.0, 0.34, 1.0], flip: false, tier: 0.5, sat: 0.6, tint: [0.12, 1, 0.16], tintK: 0.45, aisles: 2, gain: 0.7 },
  far: { file: 'stands_far.webp', crop: [0.04, 0.96, 0.52, 0.8], flip: true, tier: 0.36, sat: 0.5, tint: [0.8, 0.78, 1], tintK: 0.55, aisles: 3, gain: 0.32, split: true }, // behind the ring: darker, nearly grey
};
const STANDS_GAIN = 1.6; // the haze and the distance dim them; this brings them back

const RED = new THREE.Color().setRGB(1, 0.012, 0.012); // linear: a pure, deep red
const GREEN = new THREE.Color().setRGB(0.02, 1, 0.07); // and a pure green
const WARM = new THREE.Color(0xfff1dc);
const sideColor = (x) => (x < 0 ? RED : GREEN);

// ------------------------------------------------------------------ noise and drawn textures

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

/** Braided steel: strands winding round the rope, as a tiling normal map (u along the rope). */
function braidNormal() {
  const S = 64;
  const h = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = (x / S + (y / S) * 2) % 1; // two strands per turn
    h[y * S + x] = Math.pow(Math.sin(Math.PI * ((a * 3) % 1)), 0.6);
  }
  return normalFrom(h, S, 2.6);
}

/** Polished dark concrete, wet: colour and roughness, slab seams every two metres. */
function floorMaps(size) {
  const n = fbm(size, 4, 6, 11);
  const p = fbm(size, 3, 4, 5);
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const r = canvas(size);
  const rg = r.getContext('2d');
  const rimg = rg.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const seam = x % (size / 2) < 2 || y % (size / 2) < 2 ? -5 : 0;
    const v = 34 + (n[i] - 0.5) * 18 + seam + (Math.random() - 0.5) * 3;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v + 0.5;
    img.data[i * 4 + 2] = v + 2;
    img.data[i * 4 + 3] = 255;
    // wet nearly everywhere; a few drier, duller patches
    const wet = Math.min(1, Math.max(0, (p[i] - 0.3) / 0.14));
    const rough = 0.42 - wet * 0.34 + (n[i] - 0.5) * 0.08 + (seam ? 0.15 : 0);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = Math.max(0, Math.min(255, rough * 255));
    rimg.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  return { map: tex(c, { repeat: [5, 5] }), rough: tex(r, { srgb: false, repeat: [5, 5] }) };
}

/** The emblem on a dark steel plate, for the desks' fronts and the scoreboard's sides. */
export function emblemPlate(w = 512, h = 512) {
  const c = steelTex(w, h, 30);
  const g = c.getContext('2d');
  const r = Math.min(w, h) * 0.34;
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

/** Until the photos of the stands are there: a dark crowd in `tiers` rows. */
function crowdTex(w, h, tiers) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#040405';
  g.fillRect(0, 0, w, h);
  const th = h / tiers;
  for (let t = 0; t < tiers; t++) {
    const y0 = h - (t + 1) * th;
    let x = Math.random() * th * 0.3;
    while (x < w) {
      x += th * (0.34 + Math.random() * 0.2);
      if (Math.random() < 0.08) continue;
      const sy = y0 + th * 0.5;
      const r = 70 + Math.random() * 60;
      g.fillStyle = `rgba(${r},${r * 0.8},${r * 0.7},.5)`;
      g.beginPath();
      g.ellipse(x, sy, th * 0.085, th * 0.1, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  return tex(c, { aniso: 4 });
}

// ------------------------------------------------------------------ the environment light

/** What the metal reflects: a dark hall, rings of white lamps above, the red side to the left and the
 *  green to the right, the stands' haze a dim warm grey. */
export function hallEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x0b0c10, side: THREE.BackSide }));
  env.add(room);
  const lamp = (w, h, color, k, at, rotX = Math.PI / 2, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...at);
    m.rotation.set(rotX, rotY, 0);
    env.add(m);
  };
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    lamp(0.7, 0.7, 0xffffff, 22, [Math.cos(a) * TRUSS.r, TRUSS.y - 0.5, Math.sin(a) * TRUSS.r]);
    if (i % 2) lamp(0.6, 0.6, 0xffffff, 18, [Math.cos(a) * TRUSS.rIn, TRUSS.yIn - 0.5, Math.sin(a) * TRUSS.rIn]);
  }
  lamp(14, 14, 0x202226, 1, [0, 12, 0]);
  // the sides: broad red and green glows low down (the apron, the floor's light track, the stands)
  lamp(40, 5, 0xff2020, 0.9, [-19.5, 2, 0], 0, Math.PI / 2);
  lamp(40, 5, 0x10f060, 0.45, [19.5, 2, 0], 0, Math.PI / 2);
  lamp(40, 8, 0x3a3634, 2.2, [0, 5, -19.5], 0, 0);
  lamp(40, 8, 0x2a2826, 2.2, [0, 5, 19.5], 0, 0);
  // below: the wet floor, giving back each half's colour and a grey haze between (what a vertical steel
  // face seen from above mirrors)
  lamp(20, 40, 0xff1a14, 0.7, [-10, -3, 0]);
  lamp(20, 40, 0x14ff3c, 0.35, [10, -3, 0]);
  lamp(8, 40, 0x6a6c72, 0.8, [0, -2.9, 0]);
  const pm = new THREE.PMREMGenerator(renderer);
  const t = pm.fromScene(env, 0.035).texture;
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

/** A light beam in haze: brightest in its core at the lamp, soft at its silhouette, fading out along
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
        float core = pow(abs(dot(vN, vView)), 3.0);
        float d = 1.0 - vH;                                        // 0 at the lamp, 1 where it lands
        float along = pow(clamp(1.0 - d / reach, 0.0, 1.0), 1.5) * smoothstep(0.0, 0.14, d);
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

// ------------------------------------------------------------------ the room

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
 * ring ('red' | 'green') }.
 */
export function buildRoom(scene, renderer, { R, FLOOR, small, ring }) {
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
  const glow = (color, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k) });
  const brushed = tex(steelTex(256, 256, 70), { repeat: [2, 2] });
  const steel = std({ color: 0x9ea4ae, map: brushed, metalness: 0.9, roughness: 0.32, envMapIntensity: 1.3 });
  const darkSteel = std({ color: 0xa4a9b2, map: brushed, metalness: 0.75, roughness: 0.38, envMapIntensity: 1.6 });
  const rubber = std({ color: 0x0b0c0e, metalness: 0, roughness: 0.7 });
  const led = { red: glow(RED, 1.75), green: glow(GREEN, 1.25) };
    const sideOf = (x) => (x < 0 ? 'red' : 'green');

  // ---- the canvas: hex plates of dark steel, the emblem inlaid in gold
  const pm = plateMaps(small ? 1024 : 2048, R + 0.05, ring);
  const canvasTop = new THREE.Mesh(new THREE.CircleGeometry(R + 0.05, 6).rotateX(-Math.PI / 2), std({
    map: pm.map, roughnessMap: pm.rough, metalnessMap: pm.rough, normalMap: pm.normal, normalScale: new THREE.Vector2(0.9, 0.9),
    emissive: 0xffffff, emissiveMap: pm.emissive, emissiveIntensity: 0.14, roughness: 1, metalness: 1, envMapIntensity: 1.15,
  }));
  canvasTop.position.y = FLOOR;
  add(canvasTop, { receive: true, mirror: true });
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.04, R + 0.04, FLOOR - 0.02, 6, 1, false, Math.PI / 6), rubber);
  deck.position.y = (FLOOR - 0.02) / 2;
  add(deck);

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
      const mat = std({ color: 0xb4b9c2, map: sk.map, metalness: 0.8, roughness: 0.4, envMapIntensity: 1.1, emissive: (side === 'red' ? RED : GREEN).clone(), emissiveMap: sk.emissive, emissiveIntensity: side === 'red' ? 1.25 : 0.8 });
      add(new THREE.Mesh(quadGeo(skirt[side]), mat), { mirror: true, receive: false });
      add(new THREE.Mesh(quadGeo(lines[side]), led[side]), { mirror: true, receive: false });
      add(new THREE.Mesh(quadGeo(soft[side]), new THREE.MeshBasicMaterial({ color: (side === 'red' ? RED : GREEN).clone().multiplyScalar(0.5), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })), { receive: false });
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
  const stripGeo = new THREE.BoxGeometry(0.13, 1.25, 0.02);
  const coreGeo = new THREE.BoxGeometry(0.045, 1.21, 0.022);
  const slotGeo = new THREE.BoxGeometry(0.2, 1.36, 0.012);
  const haloGeo = new THREE.PlaneGeometry(0.62, 1.7);
  const postMat = std({ color: 0xd8dce4, map: brushed, metalness: 0.8, roughness: 0.34, envMapIntensity: 2.2 });
  const capMat = std({ color: 0xffffff, map: brushed, metalness: 0.85, roughness: 0.32, envMapIntensity: 2.4, flatShading: true });
  const slotMat = std({ color: 0x050506, metalness: 0.5, roughness: 0.5 });
  // each strip: a white-hot core in its colour's glow, and a soft halo on the steel round it
  const core = { red: glow(new THREE.Color(1, 0.16, 0.14), 3.2), green: glow(new THREE.Color(0.18, 1, 0.22), 2.4) };
  const haloTex = softSpot(64, 1.4);
  const halo = Object.fromEntries(['red', 'green'].map((sd) => [sd, new THREE.MeshBasicMaterial({ map: haloTex, color: (sd === 'red' ? RED : GREEN).clone().multiplyScalar(sd === 'red' ? 0.55 : 0.4), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })]));
  const postTops = [];
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
    postTops.push(corner(k, R * 0.97).setY(FLOOR + 1.9));
  }

  // ---- the ropes: braided steel, a little sag, black sleeves where they meet the posts
  {
    const ropeMat = std({ color: 0x70757d, metalness: 0.95, roughness: 0.3, normalMap: braidNormal(), normalScale: new THREE.Vector2(1.4, 1.4), envMapIntensity: 2.6 });
    ropeMat.normalMap.wrapS = ropeMat.normalMap.wrapT = THREE.RepeatWrapping;
    ropeMat.normalMap.repeat.set(140, 1);
    const ropes = [];
    const sleeves = [];
    for (let k = 0; k < 6; k++) {
      const a = corner(k, R - 0.08);
      const b = corner((k + 1) % 6, R - 0.08);
      const d = new THREE.Vector3().subVectors(b, a).normalize();
      const a2 = a.clone().addScaledVector(d, 0.2);
      const b2 = b.clone().addScaledVector(d, -0.2);
      for (const h of ROPES) {
        const p0 = a2.clone().setY(FLOOR + h);
        const p2 = b2.clone().setY(FLOOR + h);
        const p1 = p0.clone().lerp(p2, 0.5).setY(FLOOR + h - 0.05); // a 2.5 cm sag in the middle
        ropes.push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 32, 0.042, 8));
        for (const [from, s] of [[p0, 1], [p2, -1]]) {
          const c = new THREE.CylinderGeometry(0.056, 0.056, 0.24, 10);
          c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d));
          const at = from.clone().addScaledVector(d, 0.12 * s);
          c.translate(at.x, at.y, at.z);
          sleeves.push(c);
        }
      }
    }
    add(new THREE.Mesh(mergeGeometries(ropes), ropeMat), { cast: true, mirror: true });
    add(new THREE.Mesh(mergeGeometries(sleeves), rubber), { mirror: true });
  }

  // ---- the floor: black polished concrete, wet, mirroring the ring and the lights
  const fm = floorMaps(small ? 256 : 512);
  const floorMat = std({ color: 0xffffff, map: fm.map, roughnessMap: fm.rough, roughness: 1, metalness: 0.2, envMapIntensity: 0.75 });
  const mirror = heavy ? makeMirror(renderer, scene) : null;
  const floorU = { tMirror: { value: mirror?.texture ?? null }, mirrorMatrix: { value: mirror?.matrix ?? new THREE.Matrix4() }, mirrorK: { value: mirror ? 1 : 0 } };
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floorU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 mirrorMatrix;\nvarying vec4 vMirror;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMirror = mirrorMatrix * modelMatrix * vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMirror;\nuniform float mirrorK;\nvarying vec4 vMirror;')
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular *= 0.4;')
      .replace('#include <opaque_fragment>', `
        if (mirrorK > 0.0) {
          vec2 muv = vMirror.xy / vMirror.w;
          float wet = 1.0 - smoothstep(0.08, 0.5, roughnessFactor);
          float lod = mix(3.2, 0.6, wet);
          // wet floors stretch what they mirror into streaks towards the viewer
          vec3 refl = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 7; i++) {
            float f = float(i) / 6.0;
            float w = 1.0 - f * 0.75;
            refl += textureLod(tMirror, muv + vec2(0.0, (f - 0.15) * 0.075 * (1.4 - wet)), lod + f * 1.6).rgb * w;
            wsum += w;
          }
          refl = min(refl / wsum, vec3(3.0));
          vec3 V = normalize(vViewPosition);
          float fres = 0.32 + 0.68 * pow(1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0), 2.0);
          outgoingLight += refl * fres * mix(0.8, 2.3, wet) * mirrorK;
        }
        #include <opaque_fragment>`);
  };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(STANDS_R + 0.4, 96).rotateX(-Math.PI / 2), floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // the light the apron spills on the floor
  const spot = softSpot(128, 1.6);
  {
    const geo = new THREE.RingGeometry(APO + 0.9, STANDS_R, 6, 12).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const r = Math.hypot(x, p.getZ(i));
      const fall = Math.pow(Math.max(0, 1 - (r - R * 1.0) / 6.5), 1.6);
      c.copy(sideColor(x)).multiplyScalar(fall * (x < 0 ? 0.22 : 0.09) * THREE.MathUtils.smoothstep(Math.abs(x), 0, 3.5));
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const spill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    spill.position.y = 0.006;
    spill.rotation.y = Math.PI / 6;
    scene.add(spill);
  }

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
      for (const [list, w] of [[core, 0.04], [halo, 0.24]]) {
        const ring = new THREE.RingGeometry(TRACK_R - w, TRACK_R + w, 1, 1, -a1, a1 - a0);
        const n = ring.attributes.position.count;
        const col = new Float32Array(n * 3);
        const c = sideColor(x);
        const uvs = ring.attributes.uv;
        for (let j = 0; j < n; j++) col.set([c.r, c.g, c.b], j * 3);
        ring.setAttribute('color', new THREE.BufferAttribute(col, 3));
        // across the band: 0 at its inner edge, 1 at its outer (for the halo's falloff)
        for (let j = 0; j < n; j++) {
          const px = ring.attributes.position.getX(j);
          const py = ring.attributes.position.getY(j);
          uvs.setXY(j, (Math.hypot(px, py) - (TRACK_R - w)) / (2 * w), 0.5);
        }
        list.push(ring);
      }
    }
    const coreGeo = mergeGeometries(core).rotateX(-Math.PI / 2);
    const haloGeo = mergeGeometries(halo).rotateX(-Math.PI / 2);
    const coreM = new THREE.Mesh(coreGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1.7, 1.25, 1.7) }));
    coreM.position.y = 0.012;
    scene.add(coreM);
    const band = canvas(64, 4);
    {
      const bg = band.getContext('2d');
      const gr = bg.createLinearGradient(0, 0, 64, 0);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.5, 'rgba(255,255,255,1)');
      gr.addColorStop(1, 'rgba(0,0,0,1)');
      bg.fillStyle = gr;
      bg.fillRect(0, 0, 64, 4);
    }
    const haloM = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ vertexColors: true, map: tex(band, { srgb: false }), color: new THREE.Color(0.3, 0.3, 0.3), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    haloM.position.y = 0.01;
    scene.add(haloM);
    // a thin groove just inside it
    const groove = new THREE.Mesh(new THREE.RingGeometry(TRACK_R - 0.42, TRACK_R - 0.39, 128).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1c1e22 }));
    groove.position.y = 0.008;
    scene.add(groove);
  }

  // ---- the railing in front of the stands: plain steel, posts every metre or so and two tubes
  const boards = new THREE.Group();
  {
    const railMat = std({ color: 0x5a5f66, metalness: 0.9, roughness: 0.34, envMapIntensity: 1.6 });
    const parts = [];
    const n = Math.round((Math.PI * 2 * RAIL_R) / 1.2);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      parts.push(new THREE.CylinderGeometry(0.028, 0.028, 1.02, 6).translate(Math.cos(a) * RAIL_R, 0.51, Math.sin(a) * RAIL_R));
    }
    for (const y of [0.5, 1.0]) parts.push(new THREE.TorusGeometry(RAIL_R, y > 0.9 ? 0.032 : 0.022, 6, 180).rotateX(Math.PI / 2).translate(0, y, 0));
    boards.add(new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g))), railMat));
    add(boards, { receive: false, mirror: true });
  }

  // ---- the truss: two concentric rings of box truss over the ring, joined by six spokes, hung from the
  // roof on chain motors
  const trussMat = std({ color: 0x8c929c, metalness: 0.92, roughness: 0.36, envMapIntensity: 2.2 });
  const H = 0.24; // half the truss's section
  {
    const parts = [];
    const bar = (a, b, r) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const g = new THREE.CylinderGeometry(r, r, d.length(), 5, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
      g.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
      parts.push(g);
    };
    const up = new THREE.Vector3(0, 1, 0);
    const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    /** A straight run of box truss from a to b (its section square, `n` the side direction). */
    const run = (a, b, n, chordR = 0.03) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const len = d.length();
      const at = (s, cn, cu) => a.clone().addScaledVector(d, s / len).addScaledVector(n, cn * H).addScaledVector(up, cu * H);
      for (const [cn, cu] of cs) bar(at(0, cn, cu), at(len, cn, cu), chordR);
      const panels = Math.max(1, Math.round(len / 0.55));
      for (let i = 0; i < panels; i++) {
        const s0 = (i / panels) * len;
        const s1 = ((i + 1) / panels) * len;
        for (let f = 0; f < 4; f++) {
          const [n0, u0] = cs[f];
          const [n1, u1] = cs[(f + 1) % 4];
          if (i % 2) bar(at(s0, n0, u0), at(s1, n1, u1), 0.012);
          else bar(at(s0, n1, u1), at(s1, n0, u0), 0.012);
        }
      }
    };
    const circle = (r, y, segs) => {
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const a = new THREE.Vector3(Math.cos(a0) * r, y, Math.sin(a0) * r);
        const b = new THREE.Vector3(Math.cos(a1) * r, y, Math.sin(a1) * r);
        const n = new THREE.Vector3(Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2));
        run(a, b, n);
      }
    };
    circle(TRUSS.r, TRUSS.y, small ? 36 : 56);
    circle(TRUSS.rIn, TRUSS.yIn, small ? 24 : 36);
    for (let k = 0; k < 6; k++) {
      const a = (k * Math.PI) / 3 + Math.PI / 6;
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const n = new THREE.Vector3(-dir.z, 0, dir.x);
      run(dir.clone().multiplyScalar(TRUSS.rIn + H).setY(TRUSS.yIn), dir.clone().multiplyScalar(TRUSS.r - H).setY(TRUSS.y), n);
      // chains to the roof and their motors
      for (const [r, y] of [[TRUSS.r, TRUSS.y], [TRUSS.rIn, TRUSS.yIn]]) {
        const p = dir.clone().multiplyScalar(r);
        bar(p.clone().setY(y + H), p.clone().setY(y + 9), 0.014);
        const motor = new THREE.BoxGeometry(0.24, 0.36, 0.24);
        motor.translate(p.x, y + 1.4, p.z);
        parts.push(motor);
      }
    }
    const truss = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      g.deleteAttribute('uv');
      return g;
    })), trussMat);
    add(truss, { receive: false, mirror: true });
  }

  // ---- LED blocks along the truss: rows of four on each ring, red over the left half, green over the
  // right, facing into the hall
  {
    const blocks = { red: [], green: [] };
    const place = (r, y, a, outward) => {
      const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const side = sideOf(dir.x);
      if (Math.abs(dir.x) < 0.25) return;
      const face = outward ? dir.clone() : dir.clone().negate();
      const t = new THREE.Vector3(-dir.z, 0, dir.x);
      for (let i = 0; i < 4; i++) {
        const g = new THREE.BoxGeometry(0.34, 0.15, 0.03);
        g.lookAt(face);
        const p = dir.clone().multiplyScalar(r + (outward ? H + 0.03 : -H - 0.03)).addScaledVector(t, (i - 1.5) * 0.42).setY(y - 0.02);
        g.translate(p.x, p.y, p.z);
        blocks[side].push(g);
      }
    };
    // a few groups only: two on the inner ring over each half, three along each half of the outer
    for (const a of [0.5, 0.8, 2.34, 2.64]) place(TRUSS.rIn, TRUSS.yIn, -a, true);
    for (const a of [0.35, 0.8, 1.25, 1.9, 2.35, 2.8]) place(TRUSS.r, TRUSS.y, -a, false);
    for (const side of ['red', 'green']) add(new THREE.Mesh(mergeGeometries(blocks[side]), glow(side === 'red' ? RED : GREEN, side === 'red' ? 1.8 : 1.3)), { receive: false, mirror: true });
  }

  // ---- moving heads under the truss: each a yoke, a head and a lens; some throw a beam. heads[0..17]
  // are the outer ring's at the sides' places (headAt), the rest fill both rings
  const heads = [];
  for (let k = 0; k < 6; k++) for (const f of [0.22, 0.5, 0.78]) {
    const a = ((k + f) * Math.PI) / 3;
    heads.push({ side: k, f, at: new THREE.Vector3(Math.cos(a) * TRUSS.r, TRUSS.y - 0.5, Math.sin(a) * TRUSS.r), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), k: 3 });
  }
  const extra = [];
  for (let i = 0; i < 18; i++) {
    const a = ((i + 0.5) / 18) * Math.PI * 2 + 0.07;
    extra.push({ side: -1, f: -1, at: new THREE.Vector3(Math.cos(a) * TRUSS.r, TRUSS.y - 0.5, Math.sin(a) * TRUSS.r), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), k: 2 });
  }
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * Math.PI * 2;
    extra.push({ side: -1, f: -1, at: new THREE.Vector3(Math.cos(a) * TRUSS.rIn, TRUSS.yIn - 0.5, Math.sin(a) * TRUSS.rIn), dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), k: 2 });
  }
  heads.push(...extra);
  const yokeGeo = mergeGeometries([
    new THREE.BoxGeometry(0.3, 0.05, 0.12).translate(0, 0.28, 0),
    new THREE.BoxGeometry(0.035, 0.25, 0.09).translate(0.15, 0.16, 0),
    new THREE.BoxGeometry(0.035, 0.25, 0.09).translate(-0.15, 0.16, 0),
  ]);
  const headGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.28, 14);
  const lensGeo = new THREE.CircleGeometry(0.085, 18).rotateX(Math.PI / 2).translate(0, -0.142, 0);
  const yokes = new THREE.InstancedMesh(yokeGeo, darkSteel, heads.length);
  const bodies = new THREE.InstancedMesh(headGeo, std({ color: 0x1c1d21, metalness: 0.7, roughness: 0.35, envMapIntensity: 1.5 }), heads.length);
  const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), heads.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const lensCol = new THREE.Color();
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
      lenses.setColorAt(i, lensCol.copy(h.color).multiplyScalar(h.k));
    });
    yokes.instanceMatrix.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
    lenses.instanceMatrix.needsUpdate = true;
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
  };
  // the idle heads look down at the ring, a little apart
  for (const h of heads) h.dir.set(-h.at.x * 0.3, -TRUSS.y, -h.at.z * 0.3).normalize();
  for (const m of [yokes, bodies]) add(m, { receive: false, mirror: true });
  add(lenses, { receive: false });
  /** The head at side k (0..5, the side from corner k to corner k+1), place f (0.22, 0.5 or 0.78). */
  const headAt = (k, f) => heads.find((h) => h.side === k && Math.abs(h.f - f) < 0.01);

  // ---- the hall's own beams: white ones fanning down from the outer ring onto the floor and the
  // stands, a few red ones on the left and green ones on the right, swaying slowly in the haze
  const fan = [];
  if (heavy) {
    const pick = [0, 2, 4, 5, 7, 9, 11, 13, 14, 16, 1, 3, 6, 8, 10, 12, 15, 17];
    pick.forEach((idx, n) => {
      const h = extra[idx];
      if (h.at.z > 2.5) return; // over the camera's own stand a beam would cross the whole picture
      const x = h.at.x;
      const coloured = n >= 12 && Math.abs(x) > 3;
      const color = coloured ? sideColor(x).clone().lerp(new THREE.Color(1, 1, 1), 0.15) : new THREE.Color(0xf3f1ec);
      const m = new THREE.Mesh(new THREE.ConeGeometry(1.15, 1, 24, 1, true), volumeMaterial(color, coloured ? 0.085 : 0.06, 0.9));
      scene.add(m);
      h.color.copy(color);
      h.k = 5;
      // where it lands: the floor between the ring and the stands, or the stands themselves
      // (outwards from the truss, as the target's fans: none crosses the ring)
      const a = Math.atan2(h.at.z, h.at.x) + (n % 2 ? 0.22 : -0.22);
      const r = [11.2, 15, 18][n % 3];
      fan.push({ m, h, a, r, y: Math.max(0, (r - STANDS_R - 0.15) * 0.74), ph: n * 1.7, to: new THREE.Vector3() });
    });
  }
  const aimFan = (b, t) => {
    const a = b.a + Math.sin(t * 0.17 + b.ph) * 0.22;
    const r = b.r + Math.sin(t * 0.13 + b.ph * 2) * 1.2;
    b.to.set(Math.cos(a) * r, b.y, Math.sin(a) * r);
    const d = new THREE.Vector3().subVectors(b.h.at, b.to);
    const len = d.length();
    b.m.scale.set(1, len, 1);
    b.m.position.copy(b.to).addScaledVector(d, 0.5);
    b.m.quaternion.setFromUnitVectors(Y, d.normalize());
    b.h.dir.subVectors(b.to, b.h.at).normalize();
  };
  fan.forEach((b) => aimFan(b, 0));
  placeHeads();
  // each lamp's glow in the haze, seen from any side (a lens only shows from below)
  const flareGeo = new THREE.BufferGeometry();
  const flarePos = new Float32Array(heads.length * 3);
  const flareCol = new Float32Array(heads.length * 3);
  heads.forEach((h, i) => flarePos.set([h.at.x, h.at.y - 0.18, h.at.z], i * 3));
  flareGeo.setAttribute('position', new THREE.BufferAttribute(flarePos, 3));
  flareGeo.setAttribute('color', new THREE.BufferAttribute(flareCol, 3));
  const flares = new THREE.Points(flareGeo, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: true, map: softSpot(64, 2.6), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  scene.add(flares);
  const lightFlares = () => {
    heads.forEach((h, i) => {
      const k = Math.min(2.2, 0.6 + h.k * 0.3);
      flareCol.set([h.color.r * k, h.color.g * k, h.color.b * k], i * 3);
    });
    flareGeo.attributes.color.needsUpdate = true;
  };
  lightFlares();

  // ---- the stands: right behind the railing the photos of the stands rise as one raked band of three
  // panels (the red side, the far end, the green side), each photo once across its panel, its colours
  // kept under a partial wash of its side's colour, faded into the dark above; a lit stair aisle runs
  // up where two panels meet (and through each panel), hiding the seams. Phone lights twinkle over them.
  const RAKE = 0.74; // rise per metre back
  const bdR0 = STANDS_R + 0.15;
  const bdY0 = -0.1;
  const bdH = 17;
  const bdR1 = bdR0 + bdH / RAKE;
  const PANELS = { far: [Math.PI * 0.74, Math.PI * 0.52], red: [Math.PI * 1.26, Math.PI * 0.58], green: [Math.PI * 0.16, Math.PI * 0.58] };
  {
    const fallback = crowdTex(1024, 512, 24);
    const loader = new THREE.TextureLoader();
    for (const [name, [start, len]] of Object.entries(PANELS)) {
      const geo = new THREE.CylinderGeometry(bdR1, bdR0, bdH, 64, 1, true, start, len);
      const cfg = STANDS[name];
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          map: { value: fallback }, crop: { value: new THREE.Vector4(0, 1, 0, 1) }, flip: { value: 0 }, gain: { value: STANDS_GAIN }, tier: { value: cfg.tier },
          sat: { value: cfg.sat }, tint: { value: new THREE.Color(...cfg.tint) }, tintK: { value: cfg.tintK }, aisles: { value: cfg.aisles }, split: { value: cfg.split ? 1 : 0 },
          fogColor: { value: new THREE.Color(0x07080b) }, red: { value: RED }, green: { value: GREEN }, mirrorPass: MIRROR_PASS,
        },
        vertexShader: `varying vec2 vUv; varying float vD; varying float vX;
          void main() { vUv = uv; vX = (modelMatrix * vec4(position, 1.0)).x; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D map; uniform vec4 crop; uniform float flip; uniform float gain; uniform float tier;
          uniform float sat; uniform vec3 tint; uniform float tintK; uniform float aisles; uniform float split; uniform vec3 fogColor;
          uniform vec3 red; uniform vec3 green; uniform float mirrorPass;
          varying vec2 vUv; varying float vD; varying float vX;
          void main() {
            float u = flip > 0.5 ? 1.0 - vUv.x : vUv.x;
            float v = vUv.y;
            float tv = clamp(v / tier, 0.0, 1.0);
            vec3 c = texture2D(map, vec2(mix(crop.x, crop.y, u), 1.0 - mix(crop.w, crop.z, tv))).rgb;
            // the colours: partly kept (skin, greys), partly washed in the side's colour
            float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
            c = mix(vec3(l), c, sat);
            vec3 wash = split > 0.5 ? mix(vec3(1.0, 0.16, 0.14), vec3(0.16, 1.0, 0.22), smoothstep(-6.0, 6.0, vX)) * mix(1.0, 0.25, 1.0 - smoothstep(0.0, 6.0, abs(vX))) + tint * (1.0 - smoothstep(0.0, 6.0, abs(vX))) * 0.7 : tint;
            c = mix(c, wash * l * 2.2, tintK) * gain;
            // above the photo: the dark of the upper stands, a balcony with its side's LED blocks
            float above = smoothstep(tier - 0.02, tier + 0.06, v);
            c *= 1.0 - above;
            float dash = step(0.4, fract(vUv.x * 40.0)) * step(0.3, fract(vUv.x * 5.0)) * step(fract(vUv.x * 5.0), 0.62) * smoothstep(tier + 0.008, tier + 0.012, v) * smoothstep(tier + 0.03, tier + 0.026, v);
            // stair aisles: where the panels meet (the edges) and up through the panel
            float x = vUv.x * aisles;
            float d = min(min(vUv.x, 1.0 - vUv.x) * aisles * 2.0, abs(fract(x + 0.5) - 0.5) * 2.0 + step(aisles, 1.5));
            float aisle = 1.0 - smoothstep(0.03, 0.05, d);
            float steps = (0.55 + 0.45 * step(0.5, fract(v * 46.0))) * (1.0 - smoothstep(0.003, 0.012, abs(d - 0.016))) * (1.0 - above);
            c = mix(c, vec3(0.006), aisle * 0.8) + vec3(1.0, 0.84, 0.62) * steps * 0.14;
            vec3 led = (vX < 0.0 ? red * 1.7 : green * 1.25) * dash * (1.0 - aisle);
            c += led * step(0.5, abs(vX) / 6.0);
            // the haze between: a little grey over the far rows
            float h = 1.0 - exp(-vD * 0.02);
            c = mix(c, fogColor, h * 0.4);
            c *= 1.0 - mirrorPass * 0.45; // in the wet floor: a dim smear, the ring's lights stay on top
            gl_FragColor = vec4(c, 1.0);
          }`,
        side: THREE.BackSide,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = bdY0 + bdH / 2;
      m.layers.enable(MIRROR); // the wet floor mirrors the stands' colours
      scene.add(m);
      if (STANDS.photos || window.ARENA_CONFIG?.standsPhotos) {
        loader.load(`${STANDS.dir}${cfg.file}`, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 8;
          mat.uniforms.map.value = t;
          mat.uniforms.crop.value.set(...cfg.crop);
          mat.uniforms.flip.value = cfg.flip ? 1 : 0;
          mat.uniforms.gain.value = STANDS_GAIN * (cfg.gain ?? 1);
        }, undefined, () => {});
      }
    }
  }

  // phone lights over the stands: small and white, a few held up steady (filming), more that flash now
  // and then
  const phoneN = small ? 50 : 130;
  const phonePos = new Float32Array(phoneN * 3);
  const phoneCol = new Float32Array(phoneN * 3);
  const phoneOf = [];
  const panelList = Object.values(PANELS);
  for (let i = 0; i < phoneN; i++) {
    const [start, len] = panelList[Math.floor(Math.random() * 3)];
    const th = start + (0.08 + Math.random() * 0.84) * len;
    const t = 0.02 + Math.pow(Math.random(), 1.4) * 0.55;
    const r = bdR0 + (bdR1 - bdR0) * t - 0.25;
    phonePos.set([r * Math.sin(th), bdY0 + bdH * t + 0.5, r * Math.cos(th)], i * 3);
    phoneOf.push({ side: Math.sin(th) < -0.3 ? 'red' : Math.sin(th) > 0.3 ? 'blue' : 'mid' });
  }
  const steady = phoneOf.map(() => Math.random() < 0.3);
  const phoneGeo = new THREE.BufferGeometry();
  phoneGeo.setAttribute('position', new THREE.BufferAttribute(phonePos, 3));
  phoneGeo.setAttribute('color', new THREE.BufferAttribute(phoneCol, 3));
  const phones = new THREE.Points(phoneGeo, new THREE.PointsMaterial({ size: 2.4 * renderer.getPixelRatio(), sizeAttenuation: false, map: softSpot(16, 1.2), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  scene.add(phones);
  const bowl = [];

  // ---- lights: a white key on the canvas, a cool fill, and each half's colour low over the floor
  const key = new THREE.SpotLight(0xfff3e2, 4.4, 0, 0.45, 0.6, 0);
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
    boards,
    bowl,
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
    update(t, dt, exc, reduced) {
      TIME.value = t;
      if (!reduced) fan.forEach((b) => aimFan(b, t));
      lightFlares();
      for (let i = 0; i < phoneN; i++) {
        let v;
        if (steady[i]) v = 0.75 + 0.2 * Math.sin(t * 0.7 + i);
        else {
          v = phoneCol[i * 3 + 2] * 0.72; // a flash dies fast
          const e = exc[phoneOf[i].side === 'mid' ? 'red' : phoneOf[i].side];
          if (!reduced && Math.random() < 0.0015 + e * 0.008) v = 2.6;
        }
        phoneCol.set([v * 0.94, v * 0.97, v], i * 3);
      }
      phoneGeo.attributes.color.needsUpdate = true;
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
      c = mix(vec3(l), c, 1.12);                               // the neon a touch richer
      c = max(c, 0.0);
      c += vec3(-0.004, -0.001, 0.006) * (1.0 - l) * smoothstep(0.0, 0.25, l) + vec3(0.01, 0.004, -0.008) * l;
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0);
      c *= mix(1.0, 0.68, smoothstep(0.4, 0.95, length(d) * 1.25));
      float n = hash(vUv * vec2(1931.0, 1171.0) + fract(time * 7.13)) - 0.5;
      c += n * grain * (1.0 - l * 0.7);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

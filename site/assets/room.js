// The hall around the fight, built to look like the arena on the home page: a dark room in haze, a
// hexagon ring with padded corner posts and satin ropes on a printed canvas, an apron of dark LED
// panels where the corners' red and green drift slowly, a steel box truss with moving heads above,
// a wet black floor that mirrors the lights, and stands of dark silhouettes with phone lights, rimmed
// red on the left and green on the right. The photo of the upper stands goes on three backdrop
// panels behind them (see STANDS below). The fighters, their desks, the referee and the scoreboard
// are scene3d.js's; this module only builds and runs the room.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const MIRROR = 1; // the layer of what the wet floor mirrors
export const TIME = { value: 0 }; // shared by the shaders that move
export const TRUSS = { y: 10.2, r: 10 }; // the lighting truss over the ring
export const STANDS_R = 11; // the first row of the stands
export const BOARD_R = STANDS_R - 0.5; // the LED boards in front of the stands

// The photos of the upper stands, made for this room: the red side (left), the green side (right) and
// the far end, as site/assets/arena/stands_red.png, stands_green.png and stands_far.png. Each goes
// on one panel of the raked band behind the front rows, its bottom on the fascia. Until they are
// there the panels show a drawn dark crowd. To use them: put the three files there and set this to
// true (or set ARENA_CONFIG.standsPhotos in config.js).
const STANDS = { photos: false, dir: new URL('./arena/', import.meta.url).href };
const STANDS_GAIN = 2.4; // the haze and the distance dim them; this brings them back to a dark crowd

const RED = new THREE.Color(0xff2a2a);
const GREEN = new THREE.Color(0x16e070);
const WARM = new THREE.Color(0xfff1dc);

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

/** The IBITI emblem, as printed ink: a hexagon in a double hairline with three thin bars, `size`
 *  across. */
function printEmblem(g, cx, cy, size, fill) {
  const k = size / 32;
  const hex = (s) => {
    g.beginPath();
    for (const [x, y] of [[0, -16], [14, -8], [14, 8], [0, 16], [-14, 8], [-14, -8]]) g.lineTo(x * k * s, y * k * s);
    g.closePath();
  };
  g.save();
  g.translate(cx, cy);
  g.fillStyle = fill;
  g.strokeStyle = fill;
  g.lineJoin = 'miter';
  g.lineWidth = 0.9 * k;
  hex(0.97);
  g.stroke();
  g.lineWidth = 0.42 * k;
  hex(0.86);
  g.stroke();
  for (const y of [-4.6, 0, 4.6]) g.fillRect(-5.2 * k, (y - 0.55) * k, 10.4 * k, 1.1 * k);
  g.restore();
}

/** A fine basket weave, as a tiling normal map (`cells` threads across). */
function weaveNormal(size = 128, cells = 16) {
  const h = new Float32Array(size * size);
  const cw = size / cells;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = Math.floor(x / cw);
    const j = Math.floor(y / cw);
    const fx = (x % cw) / cw;
    const fy = (y % cw) / cw;
    const along = (i + j) % 2 ? Math.sin(Math.PI * fy) : Math.sin(Math.PI * fx);
    h[y * size + x] = along * (0.85 + Math.random() * 0.15);
  }
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * 1.4;
    const dy = (at(x, y + 1) - at(x, y - 1)) * 1.4;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * size + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
    img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
    img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return tex(c, { srgb: false, repeat: [52, 52] });
}

/** The ring's canvas: near-black woven cloth, scuffed where the fighters walk, a thin border, and the
 *  emblem printed in the middle in dark antique gold, its ink worn away in patches. Returns the colour,
 *  roughness (green) / metalness (blue) and weave maps. */
function canvasMaps(size, ring) {
  const green = ring === 'green';
  const c = canvas(size);
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const n = fbm(256, 6, 4, green ? 7 : 3);
  const base = green ? [27, 30, 29] : [31, 29, 31];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = (y * size + x) * 4;
    const big = (n[((y >> 3) & 255) * 256 + ((x >> 3) & 255)] - 0.5) * 9;
    const v = big + (Math.random() - 0.5) * 3;
    img.data[i] = base[0] + v;
    img.data[i + 1] = base[1] + v;
    img.data[i + 2] = base[2] + v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const s = size / 1024;
  const hex = (r) => {
    g.beginPath();
    for (let k = 0; k < 6; k++) g.lineTo(size / 2 + r * Math.cos((k * Math.PI) / 3), size / 2 + r * Math.sin((k * Math.PI) / 3));
    g.closePath();
  };
  // scuffed in the middle, where the fighters walk; soft blots, no lines
  const wear = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.32);
  wear.addColorStop(0, 'rgba(255,255,255,.03)');
  wear.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = wear;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 70; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const r = (20 + Math.random() * 110) * s;
    const blot = g.createRadialGradient(x, y, 0, x, y, r);
    blot.addColorStop(0, Math.random() < 0.55 ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.02)');
    blot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = blot;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // the border: a thin worn line inside the edge, the edge itself darker where the cloth turns down
  g.strokeStyle = 'rgba(150,125,80,.16)';
  g.lineWidth = 3 * s;
  hex(size * 0.468);
  g.stroke();
  g.strokeStyle = 'rgba(0,0,0,.5)';
  g.lineWidth = 16 * s;
  hex(size * 0.5 - 8 * s);
  g.stroke();
  // the emblem, printed: drawn alone, its ink eaten by a scuffed-print mask, then laid on the cloth
  const es = Math.round(size * 0.3);
  const em = canvas(es);
  const eg = em.getContext('2d');
  const ink = eg.createLinearGradient(0, 0, es, es);
  ink.addColorStop(0, '#7e6026');
  ink.addColorStop(0.55, '#6c511d');
  ink.addColorStop(1, '#5e4618');
  printEmblem(eg, es / 2, es / 2, es * 0.96, ink);
  {
    const wearN = fbm(128, 5, 4, green ? 13 : 17);
    const d = eg.getImageData(0, 0, es, es);
    for (let y = 0; y < es; y++) for (let x = 0; x < es; x++) {
      const i = (y * es + x) * 4;
      if (!d.data[i + 3]) continue;
      const v = wearN[(Math.floor((y / es) * 128) * 128) + Math.floor((x / es) * 128)];
      const keep = Math.min(1, Math.max(0, (v - 0.3) / 0.12)) * (0.75 + Math.random() * 0.25);
      d.data[i + 3] *= keep;
    }
    eg.putImageData(d, 0, 0);
  }
  g.globalAlpha = 0.8;
  g.drawImage(em, (size - es) / 2, (size - es) / 2);
  g.globalAlpha = 1;
  // roughness in green, metalness in blue: the cloth is matte, the ink a worn metallic print
  const rs = size / 2;
  const rc = canvas(rs);
  const rg = rc.getContext('2d');
  rg.fillStyle = 'rgb(0,236,0)';
  rg.fillRect(0, 0, rs, rs);
  const rem = canvas(es);
  const rcg = rem.getContext('2d');
  rcg.drawImage(em, 0, 0);
  rcg.globalCompositeOperation = 'source-in';
  rcg.fillStyle = 'rgb(0,120,80)'; // rough 0.47, metal 0.31: a dull gold that only gleams in the key
  rcg.fillRect(0, 0, es, es);
  rg.drawImage(rem, (rs - es / 2) / 2, (rs - es / 2) / 2, es / 2, es / 2);
  return { map: tex(c, { aniso: 12 }), rough: tex(rc, { srgb: false }), weave: weaveNormal(128, 16) };
}

/** Polished dark concrete, slab seams every two metres, wet in patches: colour and roughness. */
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
    const seam = x % (size / 2) < 2 || y % (size / 2) < 2 ? -6 : 0;
    const v = 15 + (n[i] - 0.5) * 14 + seam + (Math.random() - 0.5) * 3;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v + 0.5;
    img.data[i * 4 + 2] = v + 2;
    img.data[i * 4 + 3] = 255;
    // puddles: low roughness; the dry floor still a little polished
    const wet = Math.min(1, Math.max(0, (p[i] - 0.42) / 0.14));
    const rough = 0.62 - wet * 0.5 + (n[i] - 0.5) * 0.12 + (seam ? 0.15 : 0);
    rimg.data[i * 4] = rimg.data[i * 4 + 1] = rimg.data[i * 4 + 2] = Math.max(0, Math.min(255, rough * 255));
    rimg.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  rg.putImageData(rimg, 0, 0);
  return { map: tex(c, { repeat: [5, 5] }), rough: tex(r, { srgb: false, repeat: [5, 5] }) };
}

/** Until the photos of the stands are there: a dark crowd in `tiers` rows, faces and shoulders as dim
 *  warm and grey specks on black, the rows' edges faint, fading into the dark further up. */
function crowdTex(w, h, tiers) {
  const c = canvas(w, h);
  const g = c.getContext('2d');
  g.fillStyle = '#040405';
  g.fillRect(0, 0, w, h);
  const th = h / tiers;
  for (let t = 0; t < tiers; t++) {
    const y0 = h - (t + 1) * th;
    const far = t / tiers;
    g.fillStyle = 'rgba(255,255,255,.02)';
    g.fillRect(0, y0 + th * 0.93, w, Math.max(1, th * 0.03));
    let x = Math.random() * th * 0.3;
    while (x < w) {
      x += th * (0.34 + Math.random() * 0.2);
      if (Math.random() < 0.08) continue;
      if (((x / w) * 12) % 1 < 0.025) continue; // the aisles
      const dim = (1 - far * 0.6) * (0.6 + Math.random() * 0.4);
      const sx = x + (Math.random() - 0.5) * th * 0.08;
      const sy = y0 + th * (0.5 + (Math.random() - 0.5) * 0.12);
      const grey = 22 + Math.random() * 30;
      g.fillStyle = `rgba(${grey},${grey},${grey + 3},${0.9 * dim})`;
      g.beginPath();
      g.ellipse(sx, sy + th * 0.3, th * 0.17, th * 0.2, 0, Math.PI, 0);
      g.fill();
      const lit = Math.random() < 0.04 ? 1.8 : 1;
      const r = (95 + Math.random() * 70) * lit;
      g.fillStyle = `rgba(${r},${r * 0.74},${r * 0.6},${(0.35 + Math.random() * 0.4) * dim})`;
      g.beginPath();
      g.ellipse(sx, sy, th * 0.085, th * 0.1, 0, 0, Math.PI * 2);
      g.fill();
      if (Math.random() < 0.03) {
        g.fillStyle = `rgba(150,150,155,${0.35 * dim})`;
        g.fillRect(sx - th * 0.1, sy + th * 0.16, th * 0.2, th * 0.12);
      }
    }
  }
  // further up, the dark and the haze take them
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, 'rgba(3,3,4,.9)');
  fade.addColorStop(0.5, 'rgba(3,3,4,.3)');
  fade.addColorStop(1, 'rgba(3,3,4,0)');
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  return tex(c, { repeat: [1, 1], aniso: 4 });
}

// ------------------------------------------------------------------ the environment light

/** What the metal reflects: a black hall, rows of white lamps above, the red side to the left and
 *  the green to the right. */
export function hallEnvironment(renderer) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(40, 20, 40), new THREE.MeshBasicMaterial({ color: 0x050608, side: THREE.BackSide }));
  env.add(room);
  const lamp = (w, h, color, k, at, rotX = Math.PI / 2, rotY = 0) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
    m.position.set(...at);
    m.rotation.set(rotX, rotY, 0);
    env.add(m);
  };
  for (let i = -2; i <= 2; i++) for (const z of [-5, 5]) lamp(0.5, 0.3, 0xffffff, 14, [i * 4, 9.5, z]);
  lamp(30, 0.5, 0xff2a2a, 1.2, [-19.5, 3, 0], 0, Math.PI / 2);
  lamp(30, 0.5, 0x16e070, 1.2, [19.5, 3, 0], 0, Math.PI / 2);
  lamp(40, 3, 0x0c0d10, 1, [0, 0, -19.5], 0, 0);
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

/**
 * Builds the hall into `scene`. `opts`: { R (the ring's radius), FLOOR (the canvas's height), small,
 * ring ('red' | 'green'), ticker: [outer texture, inner texture] }.
 */
export function buildRoom(scene, renderer, { R, FLOOR, small, ring, ticker }) {
  const heavy = !small;
  const corner = (k, r = R) => new THREE.Vector3(r * Math.cos((k * Math.PI) / 3), FLOOR, r * Math.sin((k * Math.PI) / 3));
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
  const glow = (color, k) => new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: true });
  const steel = std({ color: 0x8d939e, metalness: 0.92, roughness: 0.3 });
  const darkSteel = std({ color: 0x3a3f48, metalness: 0.88, roughness: 0.38 });
  const rubber = std({ color: 0x0b0c0e, metalness: 0, roughness: 0.7 });
  const cornerOf = (k) => (k === 3 ? 'red' : k === 0 ? 'green' : null);

  // ---- the canvas
  const cm = canvasMaps(small ? 1024 : 2048, ring);
  const canvasTop = new THREE.Mesh(new THREE.CircleGeometry(R + 0.05, 6).rotateX(-Math.PI / 2), std({ map: cm.map, roughnessMap: cm.rough, metalnessMap: cm.rough, normalMap: cm.weave, normalScale: new THREE.Vector2(0.45, 0.45), roughness: 1, metalness: 1, envMapIntensity: 0.5 }));
  canvasTop.position.y = FLOOR;
  add(canvasTop, { receive: true, mirror: true });
  // the platform under it, and a rubber lip along the edge
  const deck = new THREE.Mesh(new THREE.CylinderGeometry(R, R, FLOOR - 0.02, 6, 1, false, Math.PI / 6), rubber);
  deck.position.y = (FLOOR - 0.02) / 2;
  add(deck);
  for (let k = 0; k < 6; k++) {
    const a = corner(k, R + 0.06);
    const b = corner((k + 1) % 6, R + 0.06);
    const d = new THREE.Vector3().subVectors(b, a);
    const lip = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, d.length(), 2, 8), rubber);
    lip.position.copy(a).addScaledVector(d, 0.5);
    lip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    add(lip, { mirror: true });
  }

  // ---- the apron: dark cloth on top, a band of LED panels, a black kick plate; the corners' colours
  // drift along the band, red from the left, green from the right
  {
    const pos = [];
    const uv = [];
    let run = 0;
    for (let k = 0; k < 6; k++) {
      const a = corner(k, R + 0.07);
      const b = corner((k + 1) % 6, R + 0.07);
      const len = a.distanceTo(b);
      const quad = [[a, 0, run], [b, 0, run + len], [b, 1, run + len], [a, 1, run]];
      for (const i of [0, 1, 2, 0, 2, 3]) {
        const [p, top, u] = quad[i];
        pos.push(p.x, top ? FLOOR + 0.01 : 0, p.z);
        uv.push(u, top);
      }
      run += len;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: { time: TIME, red: { value: RED }, green: { value: GREEN } },
      vertexShader: `varying vec2 vUv; varying vec3 vW;
        void main() { vUv = uv; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: `uniform float time; uniform vec3 red; uniform vec3 green; varying vec2 vUv; varying vec3 vW;
        void main() {
          float v = vUv.y;
          vec3 col = vec3(0.006, 0.006, 0.008);                       // the kick plate
          col = mix(col, vec3(0.012, 0.012, 0.014), step(0.8, v));       // the cloth skirt
          float trim = smoothstep(0.012, 0.0, abs(v - 0.79)) + smoothstep(0.012, 0.0, abs(v - 0.2));
          col += vec3(0.16, 0.12, 0.05) * trim;                          // brushed gold trims
          float band = step(0.22, v) * step(v, 0.77);
          vec2 cell = fract(vec2(vUv.x * 24.0, (v - 0.22) / 0.55 * 9.0));
          float dotl = smoothstep(0.48, 0.18, length(cell - 0.5));
          float side = smoothstep(-3.0, 3.0, vW.x);
          vec3 hue = mix(red, green, side);
          float drift = 0.5 + 0.5 * sin(vUv.x * 0.42 - time * 0.45 + side * 3.14159);
          float pulse = pow(drift, 3.0) * 0.85 + 0.12;
          float rows = 0.75 + 0.25 * sin((v - 0.22) * 40.0 + time * 0.8 - vUv.x * 0.3);
          col += hue * band * (dotl * pulse * rows * 1.05 + 0.012);
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.DoubleSide,
    });
    add(new THREE.Mesh(geo, mat), { mirror: true, receive: false });
  }

  // ---- the posts: steel, a padded cover in the corner's colour, an LED strip on the corners
  const padMat = {
    red: new THREE.MeshPhysicalMaterial({ color: 0x5e0a10, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
    green: new THREE.MeshPhysicalMaterial({ color: 0x07391d, roughness: 0.42, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.35 }),
    none: new THREE.MeshPhysicalMaterial({ color: 0x15161a, roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.4 }),
  };
  const strip = { red: glow(0xff2020, 5), green: glow(0x10ff6a, 4.2), none: glow(0xdfe6f2, 0.32) };
  const padGeo = new RoundedBoxGeometry(0.3, 1.28, 0.3, 3, 0.07);
  const stripGeo = new THREE.BoxGeometry(0.05, 1.02, 0.012);
  const postTops = [];
  for (let k = 0; k < 6; k++) {
    const side = cornerOf(k) ?? 'none';
    const p = corner(k, R - 0.08);
    const g = new THREE.Group();
    g.position.set(p.x, 0, p.z);
    g.rotation.y = Math.atan2(-p.x, -p.z); // +z towards the ring's centre
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, FLOOR + 1.72, 16), steel);
    post.position.y = (FLOOR + 1.72) / 2;
    g.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 16), darkSteel);
    cap.position.y = FLOOR + 1.74;
    g.add(cap);
    const pad = new THREE.Mesh(padGeo, padMat[side]);
    pad.position.set(0, FLOOR + 0.95, 0.04);
    g.add(pad);
    for (const z of [0.196, -0.116]) {
      const s = new THREE.Mesh(stripGeo, strip[side]);
      s.position.set(0, FLOOR + 0.95, z);
      g.add(s);
    }
    // the rope ends: steel eyes into the pad
    for (const h of [0.55, 1.0, 1.45]) {
      const eye = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.014, 6, 12), steel);
      eye.position.set(0, FLOOR + h, 0.2);
      g.add(eye);
    }
    add(g, { cast: true, mirror: true });
    postTops.push(corner(k, R * 0.97).setY(FLOOR + 1.9));
  }

  // ---- the ropes: satin, a little sag, the colour of the corner on its two sides
  const ropeMats = {
    red: new THREE.MeshPhysicalMaterial({ color: 0x7a0e14, roughness: 0.34, sheen: 1, sheenColor: new THREE.Color(0xff6a6a), sheenRoughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 2 }),
    green: new THREE.MeshPhysicalMaterial({ color: 0x0c5a2c, roughness: 0.34, sheen: 1, sheenColor: new THREE.Color(0x6affb0), sheenRoughness: 0.25, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 2 }),
    none: new THREE.MeshPhysicalMaterial({ color: 0xb4b8c2, roughness: 0.32, sheen: 1, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2, envMapIntensity: 2 }),
  };
  const ropeGeos = { red: [], green: [], none: [] };
  const strapGeos = [];
  for (let k = 0; k < 6; k++) {
    const side = k === 2 || k === 3 ? 'red' : k === 5 || k === 0 ? 'green' : 'none';
    const a = corner(k, R - 0.08);
    const b = corner((k + 1) % 6, R - 0.08);
    const d = new THREE.Vector3().subVectors(b, a).normalize();
    const a2 = a.clone().addScaledVector(d, 0.2);
    const b2 = b.clone().addScaledVector(d, -0.2);
    for (const h of [0.55, 1.0, 1.45]) {
      const p0 = a2.clone().setY(FLOOR + h);
      const p2 = b2.clone().setY(FLOOR + h);
      const p1 = p0.clone().lerp(p2, 0.5).setY(FLOOR + h - 0.05);
      ropeGeos[side].push(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(p0, p1, p2), 28, 0.032, 8));
    }
    // the strap that ties the three ropes in the middle of the side
    const mid = a.clone().lerp(b, 0.5);
    const strapG = new THREE.BoxGeometry(0.07, 1.0, 0.075);
    strapG.translate(0, FLOOR + 1.0 - 0.05, 0);
    strapG.rotateY(Math.atan2(d.x, d.z));
    strapG.translate(mid.x, 0, mid.z);
    strapGeos.push(strapG);
  }
  for (const [side, list] of Object.entries(ropeGeos)) add(new THREE.Mesh(mergeGeometries(list), ropeMats[side]), { cast: true, mirror: true });
  add(new THREE.Mesh(mergeGeometries(strapGeos), rubber), { cast: true, mirror: true });

  // ---- the steps up to the red and the green corners
  for (const k of [3, 0]) {
    const out = corner(k).setY(0).normalize();
    const g = new THREE.Group();
    g.position.copy(out).multiplyScalar(R + 0.1);
    g.rotation.y = Math.atan2(out.x, out.z); // +z away from the ring
    const tread = std({ color: 0x15171b, metalness: 0.6, roughness: 0.45 });
    for (let i = 0; i < 3; i++) {
      const y = FLOOR - 0.2 * (i + 1) + 0.2;
      const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.05, 0.34), tread);
      box.position.set(0, y - 0.025, 0.17 + i * 0.32);
      g.add(box);
      const riser = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 0.02), rubber);
      riser.position.set(0, y - 0.12, 0.33 + i * 0.32);
      g.add(riser);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.012, 0.02), glow(k === 3 ? 0xff3030 : 0x20ff80, 1.6));
      nose.position.set(0, y + 0.002, 0.33 + i * 0.32);
      g.add(nose);
    }
    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.04, FLOOR, 1.0), darkSteel);
      side.position.set(0.57 * s, FLOOR / 2, 0.5);
      g.add(side);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.25, 10), steel);
      rail.position.set(0.57 * s, FLOOR + 0.62, 0.45);
      rail.rotation.x = 0.85;
      g.add(rail);
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.0, 8), steel);
      stand.position.set(0.57 * s, 0.6, 0.92);
      g.add(stand);
    }
    add(g, { cast: true, mirror: true });
  }

  // ---- the floor: black polished concrete, wet in patches, mirroring the ring and the lights
  const fm = floorMaps(small ? 256 : 512);
  const floorMat = std({ color: 0xffffff, map: fm.map, roughnessMap: fm.rough, roughness: 1, metalness: 0.1, envMapIntensity: 0.6 });
  const mirror = heavy ? makeMirror(renderer, scene) : null;
  const floorU = { tMirror: { value: mirror?.texture ?? null }, mirrorMatrix: { value: mirror?.matrix ?? new THREE.Matrix4() }, mirrorK: { value: mirror ? 1 : 0 } };
  floorMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, floorU);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform mat4 mirrorMatrix;\nvarying vec4 vMirror;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvMirror = mirrorMatrix * modelMatrix * vec4(transformed, 1.0);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tMirror;\nuniform float mirrorK;\nvarying vec4 vMirror;')
      // the lamps' own glints in the puddles would burn out: the wet look is the mirror's
      .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\nreflectedLight.directSpecular *= 0.25;')
      .replace('#include <opaque_fragment>', `
        if (mirrorK > 0.0) {
          vec2 muv = vMirror.xy / vMirror.w;
          float wet = 1.0 - smoothstep(0.12, 0.55, roughnessFactor);
          float lod = mix(4.0, 1.0, wet);
          // wet floors stretch what they mirror into streaks towards the viewer
          vec3 refl = vec3(0.0);
          float wsum = 0.0;
          for (int i = 0; i < 7; i++) {
            float f = float(i) / 6.0;
            float w = 1.0 - f * 0.8;
            refl += textureLod(tMirror, muv + vec2(0.0, (f - 0.25) * 0.05 * (1.2 - wet)), lod + f * 1.5).rgb * w;
            wsum += w;
          }
          refl = min(refl / wsum, vec3(1.6));
          vec3 V = normalize(vViewPosition);
          float fres = 0.22 + 0.78 * pow(1.0 - clamp(dot(normalize(normal), V), 0.0, 1.0), 2.0);
          outgoingLight += refl * fres * mix(0.25, 1.1, wet) * mirrorK;
        }
        #include <opaque_fragment>`);
  };
  const floor = new THREE.Mesh(new THREE.CircleGeometry(STANDS_R + 0.4, 96).rotateX(-Math.PI / 2), floorMat);
  floor.receiveShadow = true;
  scene.add(floor);

  // the light the apron spills on the floor, and pools under the lamps
  const spot = softSpot(128, 1.6);
  {
    const geo = new THREE.RingGeometry(R + 0.07, R + 2.2, 6, 6).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const r = Math.hypot(x, p.getZ(i));
      const fall = Math.pow(Math.max(0, 1 - (r - R * 0.93) / 1.8), 2.6);
      c.copy(RED).lerp(GREEN, THREE.MathUtils.smoothstep(x, -3, 3)).multiplyScalar(fall * 0.07);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const spill = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    spill.position.y = 0.006;
    spill.rotation.y = 0; // RingGeometry's six corners already sit at the ring's corners
    scene.add(spill);
  }
  const pools = [];
  const pool = (x, z, size, color, k, y = 0.008) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: spot, color: new THREE.Color(color).multiplyScalar(k), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    m.position.set(x, y, z);
    scene.add(m);
    pools.push(m);
    return m;
  };
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 12;
    const x = Math.cos(a) * (R + 3.0);
    const z = Math.sin(a) * (R + 3.0);
    pool(x, z, 2.6, WARM, 0.05);
  }

  // ---- the LED boards in front of the stands, the arena's words running on them
  const boards = new THREE.Group();
  {
    const geo = new THREE.CylinderGeometry(BOARD_R, BOARD_R, 0.6, 128, 1, true);
    for (const [map, side] of [[ticker[0], THREE.FrontSide], [ticker[1], THREE.BackSide]]) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, side, color: new THREE.Color(0.26, 0.26, 0.26) }));
      m.position.y = 0.5;
      boards.add(m);
    }
    for (const y of [0.19, 0.81]) {
      const rail = new THREE.Mesh(new THREE.TorusGeometry(BOARD_R, 0.035, 6, 160), darkSteel);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = y;
      boards.add(rail);
    }
    add(boards, { receive: false });
  }

  // ---- the truss: a hexagon of box truss over the ring, hung from the roof on chain motors
  const trussMat = std({ color: 0x6d727c, metalness: 0.9, roughness: 0.42, envMapIntensity: 4 });
  {
    const parts = [];
    const bar = (a, b, r) => {
      const d = new THREE.Vector3().subVectors(b, a);
      const g = new THREE.CylinderGeometry(r, r, d.length(), 6, 1, true);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()));
      g.translate(a.x + d.x / 2, a.y + d.y / 2, a.z + d.z / 2);
      parts.push(g);
    };
    const h = 0.23;
    const up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < 6; k++) {
      const a = corner(k, TRUSS.r).setY(TRUSS.y);
      const b = corner((k + 1) % 6, TRUSS.r).setY(TRUSS.y);
      const d = new THREE.Vector3().subVectors(b, a);
      const len = d.length();
      d.normalize();
      const n = new THREE.Vector3().crossVectors(d, up).normalize();
      const chord = (s, cn, cu) => a.clone().addScaledVector(d, s).addScaledVector(n, cn * h).addScaledVector(up, cu * h);
      const cs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      for (const [cn, cu] of cs) bar(chord(0, cn, cu), chord(len, cn, cu), 0.026);
      const panels = Math.round(len / 0.5);
      for (let i = 0; i < panels; i++) {
        const s0 = (i / panels) * len;
        const s1 = ((i + 1) / panels) * len;
        for (let f = 0; f < 4; f++) {
          const [n0, u0] = cs[f];
          const [n1, u1] = cs[(f + 1) % 4];
          if (i % 2) bar(chord(s0, n0, u0), chord(s1, n1, u1), 0.011);
          else bar(chord(s0, n1, u1), chord(s1, n0, u0), 0.011);
        }
      }
      // the chain up to the roof, and its motor
      bar(a.clone().setY(TRUSS.y + h), a.clone().setY(TRUSS.y + 7), 0.012);
      const motor = new THREE.BoxGeometry(0.22, 0.34, 0.22);
      motor.translate(a.x, TRUSS.y + 1.6, a.z);
      parts.push(motor);
      const block = new THREE.BoxGeometry(0.56, 0.56, 0.56);
      block.translate(a.x, TRUSS.y, a.z);
      parts.push(block);
    }
    const truss = new THREE.Mesh(mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => {
      g.deleteAttribute('uv');
      return g;
    })), trussMat);
    add(truss, { receive: false, mirror: true });
  }

  // ---- moving heads under the truss: each a yoke, a head and a lens; some throw a beam
  const heads = [];
  for (let k = 0; k < 6; k++) for (const f of [0.22, 0.5, 0.78]) {
    const a = corner(k, TRUSS.r);
    const b = corner((k + 1) % 6, TRUSS.r);
    const p = a.lerp(b, f).setY(TRUSS.y - 0.42);
    heads.push({ side: k, f, at: p, dir: new THREE.Vector3(0, -1, 0), color: new THREE.Color(1, 1, 1), k: 1.2 });
  }
  const yokeGeo = mergeGeometries([
    new THREE.BoxGeometry(0.26, 0.05, 0.11).translate(0, 0.26, 0),
    new THREE.BoxGeometry(0.03, 0.23, 0.08).translate(0.13, 0.15, 0),
    new THREE.BoxGeometry(0.03, 0.23, 0.08).translate(-0.13, 0.15, 0),
  ]);
  const headGeo = new THREE.CylinderGeometry(0.08, 0.105, 0.26, 14);
  const lensGeo = new THREE.CircleGeometry(0.07, 18).rotateX(Math.PI / 2).translate(0, -0.132, 0);
  const yokes = new THREE.InstancedMesh(yokeGeo, darkSteel, heads.length);
  const bodies = new THREE.InstancedMesh(headGeo, std({ color: 0x141518, metalness: 0.6, roughness: 0.4 }), heads.length);
  const lenses = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffffff }), heads.length);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const DOWN = new THREE.Vector3(0, -1, 0);
  const one = new THREE.Vector3(1, 1, 1);
  const placeHeads = () => {
    heads.forEach((h, i) => {
      // the yoke turns about the vertical, the head tilts in it
      const yaw = Math.atan2(h.dir.x, h.dir.z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
      m4.compose(h.at, q, one);
      yokes.setMatrixAt(i, m4);
      q.setFromUnitVectors(DOWN, h.dir);
      m4.compose(h.at, q, one);
      bodies.setMatrixAt(i, m4);
      lenses.setMatrixAt(i, m4);
      lenses.setColorAt(i, new THREE.Color().copy(h.color).multiplyScalar(h.k));
    });
    yokes.instanceMatrix.needsUpdate = true;
    bodies.instanceMatrix.needsUpdate = true;
    lenses.instanceMatrix.needsUpdate = true;
    if (lenses.instanceColor) lenses.instanceColor.needsUpdate = true;
  };
  // the idle heads look down at the ring, a little apart
  for (const h of heads) h.dir.set(-h.at.x * 0.25, -TRUSS.y, -h.at.z * 0.25).normalize();
  placeHeads();
  for (const m of [yokes, bodies]) add(m, { receive: false, mirror: true });
  add(lenses, { receive: false }); // a lens in the wet floor would be a blinding blot
  /** The head at side k (0..5, the side from corner k to corner k+1), place f (0.22, 0.5 or 0.78). */
  const headAt = (k, f) => heads.find((h) => h.side === k && Math.abs(h.f - f) < 0.01);
  // blinders along the truss, facing the stands: the rows of lamps one sees over an arena
  {
    const at = [];
    for (let k = 0; k < 6; k++) {
      const a = corner(k, TRUSS.r + 0.24);
      const b = corner((k + 1) % 6, TRUSS.r + 0.24);
      for (let i = 1; i < 14; i++) if (i % 3) at.push({ p: a.clone().lerp(b, i / 14).setY(TRUSS.y - 0.1), out: a.clone().lerp(b, i / 14).setY(0).normalize() });
    }
    const lamp = new THREE.InstancedMesh(new THREE.CircleGeometry(0.035, 10), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff0d8).multiplyScalar(1.9), side: THREE.DoubleSide }), at.length);
    const rim = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.06), darkSteel, at.length);
    at.forEach(({ p, out }, i) => {
      m4.compose(p, q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), out.clone().setY(-0.35).normalize()), one);
      lamp.setMatrixAt(i, m4);
      rim.setMatrixAt(i, m4);
    });
    add(lamp, { receive: false, mirror: true });
    add(rim, { receive: false, mirror: true });
  }

  // ---- the stands: a few raked concrete rows round the floor with dark silhouettes in them, a
  // fascia with a band of LED over them, and behind it the upper stands as one raked backdrop (a
  // picture, see STANDS)
  const FRONT = small ? 3 : 4;
  const STEP_R = 0.92;
  const STEP_Y = 0.52;
  const lastY = 0.1 + (FRONT - 1) * STEP_Y;
  const fasciaR = STANDS_R + FRONT * STEP_R - 0.2;
  const fasciaY = lastY + 1.35;
  {
    const prof = [new THREE.Vector2(STANDS_R - 0.2, -0.05)];
    for (let k = 0; k < FRONT; k++) {
      const r = STANDS_R + k * STEP_R;
      const y = 0.1 + k * STEP_Y;
      prof.push(new THREE.Vector2(r - 0.2, y), new THREE.Vector2(r + STEP_R - 0.2, y));
    }
    prof.push(new THREE.Vector2(fasciaR, fasciaY), new THREE.Vector2(fasciaR + 0.6, fasciaY));
    const geo = new THREE.LatheGeometry(prof, 120);
    add(new THREE.Mesh(geo, std({ color: 0x0c0d10, roughness: 0.9, metalness: 0.05, envMapIntensity: 0.3, side: THREE.DoubleSide })), { receive: true });
    // aisle lights on the steps, warm and low
    const aisle = [];
    for (let s = 0; s < 18; s++) {
      const a = (s / 18) * Math.PI * 2 + 0.09;
      for (let k = 1; k < FRONT; k++) {
        const r = STANDS_R + k * STEP_R - 0.21;
        aisle.push(new THREE.Vector3(Math.cos(a) * r, 0.1 + k * STEP_Y - 0.14, Math.sin(a) * r));
      }
    }
    const dots = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 0.025, 0.02), glow(0xffa84a, 1.6), aisle.length);
    aisle.forEach((p, i) => {
      m4.compose(p, q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(p.x, p.z)), one);
      dots.setMatrixAt(i, m4);
    });
    scene.add(dots);
  }

  /** A continuous band of LED round the hall at radius r: red on the left, green on the right, a dim
   *  warm white at the far end, through dark in between (red never runs into green). */
  const ribbon = (r, y, hgt, k, rTop = r) => {
    const geo = new THREE.CylinderGeometry(rTop, r, hgt, 192, 1, true);
    const p = geo.attributes.position;
    const col = new Float32Array(p.count * 3);
    const c = new THREE.Color();
    const w = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / r;
      const z = p.getZ(i) / r;
      const sideK = THREE.MathUtils.smoothstep(Math.abs(x), 0.45, 0.85);
      const far = THREE.MathUtils.smoothstep(-z, 0.75, 0.98);
      c.copy(x < 0 ? RED : GREEN).multiplyScalar(sideK).add(w.copy(WARM).multiplyScalar(far * 0.35));
      c.multiplyScalar(k);
      col.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    m.position.y = y;
    scene.add(m);
    return m;
  };
  ribbon(fasciaR - 0.02, fasciaY - 0.16, 0.12, 1.1);

  // the upper stands: a raked band of three panels behind the fascia (the red side, the far end, the
  // green side), a drawn dark crowd on them until the photos are there
  const backdrop = {};
  const RAKE = 0.62; // rise per metre back
  const bdR0 = fasciaR + 0.6;
  const bdH = 15;
  const bdR1 = bdR0 + bdH / RAKE;
  {
    const slant = Math.hypot(bdH, bdR1 - bdR0);
    const crowdMap = crowdTex(small ? 1024 : 2048, small ? 512 : 1024, 24);
    const panels = { far: [Math.PI * 0.75, Math.PI * 0.5, 0xe4e4ea], red: [Math.PI * 1.25, Math.PI * 0.62, 0xffd2cc], green: [Math.PI * 0.13, Math.PI * 0.62, 0xd0ffe0] };
    for (const [name, [start, len, tint]] of Object.entries(panels)) {
      const geo = new THREE.CylinderGeometry(bdR1, bdR0, bdH, 64, 1, true, start, len);
      const map = crowdMap.clone();
      // seen from inside the circle a picture reads backwards: mirror it; and keep the people round
      const arc = (len * (bdR0 + bdR1)) / 2;
      map.repeat.set(-Math.max(1, Math.round((arc * crowdMap.image.height) / (crowdMap.image.width * slant))), 1);
      const mat = new THREE.MeshBasicMaterial({ map, side: THREE.BackSide, fog: true, color: new THREE.Color(tint).multiplyScalar(STANDS_GAIN) });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = fasciaY + bdH / 2;
      scene.add(m);
      backdrop[name] = m;
    }
    if (STANDS.photos || window.ARENA_CONFIG?.standsPhotos) {
      const loader = new THREE.TextureLoader();
      for (const name of ['red', 'green', 'far']) {
        loader.load(`${STANDS.dir}stands_${name}.png`, (t) => {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = 4;
          t.wrapS = THREE.RepeatWrapping;
          t.repeat.x = -1;
          const mat = backdrop[name].material;
          mat.map = t;
          mat.color.setScalar(STANDS_GAIN);
          mat.needsUpdate = true;
        }, undefined, () => {});
      }
    }
    // a second band of LED along a balcony part way up
    const t = 0.42;
    const rAt = (u) => bdR0 + (bdR1 - bdR0) * u - 0.05;
    ribbon(rAt(t), fasciaY + bdH * t, 0.1, 0.55, rAt(t + 0.1 / bdH));
  }

  // the fans in the front rows: dark people with no colours of their own; their side's light only as a
  // soft glow on what faces the ring, in the first rows
  const bowl = [];
  for (let k = 0; k < FRONT; k++) {
    const r = STANDS_R + 0.3 + k * STEP_R;
    const base = 0.1 + k * STEP_Y;
    let a = Math.random() * 0.5;
    while (a < Math.PI * 2 - 0.3 / r) {
      a += (0.5 + Math.random() * 0.26) / r;
      const rr = r + (Math.random() - 0.5) * 0.3;
      const x = rr * Math.cos(a);
      const z = rr * Math.sin(a);
      if (z > 0 && Math.abs(Math.atan2(x, z)) < 0.85 && k > 1) continue; // behind the camera the stands stay open
      if (Math.abs(Math.sin(a * 9 - 0.81)) < 0.06) continue; // the aisles
      if (Math.random() < 0.1) continue; // an empty seat here and there
      bowl.push({ x, z, base, k, side: x < -2 ? 'red' : x > 2 ? 'blue' : 'mid', ph: Math.random() * 6.28, sp: 0.7 + Math.random() * 0.6 });
    }
  }
  const bodyGeo = new THREE.CapsuleGeometry(0.2, 0.32, 3, 8).scale(1.25, 1, 0.7).translate(0, 0.46, 0);
  const headGeo2 = new THREE.SphereGeometry(0.115, 10, 7).scale(0.92, 1.08, 1);
  const fanMat = std({ color: 0x08090b, roughness: 0.85, metalness: 0, envMapIntensity: 0.15 });
  fanMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace('#include <opaque_fragment>', `
        #ifdef USE_COLOR
          vec3 toRing = normalize((viewMatrix * vec4(0.0, 1.6, 0.0, 1.0)).xyz + vViewPosition);
          outgoingLight += vColor * pow(max(dot(normal, toRing), 0.0), 1.8);
        #endif
        #include <opaque_fragment>`);
  };
  const crowd = new THREE.InstancedMesh(bodyGeo, fanMat, bowl.length);
  const heads2 = new THREE.InstancedMesh(headGeo2, fanMat, bowl.length);
  const armsGeo = mergeGeometries([-1, 1].map((s) => new THREE.CapsuleGeometry(0.055, 0.36, 2, 6).rotateZ(-0.32 * s).translate(0.3 * s, 0.98, 0)));
  const armed = bowl.filter(() => Math.random() < 0.25);
  const arms = new THREE.InstancedMesh(armsGeo, fanMat, Math.max(1, armed.length));
  const c = new THREE.Color();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();
  bowl.forEach((p, i) => {
    p.h = 0.85 + Math.random() * 0.3;
    p.q = new THREE.Quaternion().setFromEuler(new THREE.Euler((Math.random() - 0.5) * 0.2, Math.atan2(-p.x, -p.z) + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.2));
    // the side's glow: only in the first rows, which the ring's light reaches
    const rimK = p.k < 3 ? (0.045 - p.k * 0.014) * (0.4 + Math.random() * 0.6) : 0;
    if (p.side === 'red') c.setRGB(1, 0.16, 0.12);
    else if (p.side === 'blue') c.setRGB(0.14, 1, 0.45);
    else c.setRGB(0.55, 0.58, 0.66);
    c.multiplyScalar(rimK);
    p.rim = c.clone();
    p.w = 0.85 + Math.random() * 0.3;
    m4.compose(pos.set(p.x, p.base, p.z), p.q, scl.set(p.w, p.h, p.w * (0.9 + Math.random() * 0.2)));
    crowd.setMatrixAt(i, m4);
    crowd.setColorAt(i, c);
    p.head = new THREE.Vector3(0, 0.93 * p.h, 0).applyQuaternion(p.q);
    m4.compose(pos.set(p.x + p.head.x, p.base + p.head.y, p.z + p.head.z), p.q, scl.setScalar(0.85 + Math.random() * 0.3));
    heads2.setMatrixAt(i, m4);
    heads2.setColorAt(i, c);
  });
  armed.forEach((p, i) => arms.setColorAt(i, p.rim));
  for (const m of [crowd, heads2, arms]) m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(crowd, heads2, arms);

  // phone lights: small and white, a few held up steady (filming), more that flash now and then; in
  // the front rows and up in the stands behind
  const phoneN = small ? 70 : 170;
  const phonePos = new Float32Array(phoneN * 3);
  const phoneCol = new Float32Array(phoneN * 3);
  const phoneOf = [];
  const PANELS = [[Math.PI * 0.75, Math.PI * 0.5], [Math.PI * 1.25, Math.PI * 0.62], [Math.PI * 0.13, Math.PI * 0.62]];
  for (let i = 0; i < phoneN; i++) {
    if (i % 3 === 0) {
      const p = bowl[Math.floor(Math.random() * bowl.length)];
      phoneOf.push(p);
      phonePos.set([p.x * 0.985, p.base + 1.12 + Math.random() * 0.15, p.z * 0.985], i * 3);
    } else {
      const [start, len] = PANELS[Math.floor(Math.random() * 3)];
      const th = start + Math.random() * len;
      const t = 0.03 + Math.pow(Math.random(), 1.3) * 0.7;
      const r = bdR0 + (bdR1 - bdR0) * t - 0.15;
      phonePos.set([r * Math.sin(th), fasciaY + bdH * t + 0.1, r * Math.cos(th)], i * 3);
      phoneOf.push({ side: Math.sin(th) < -0.3 ? 'red' : Math.sin(th) > 0.3 ? 'blue' : 'mid' });
    }
  }
  const steady = phoneOf.map(() => Math.random() < 0.3);
  const phoneGeo = new THREE.BufferGeometry();
  phoneGeo.setAttribute('position', new THREE.BufferAttribute(phonePos, 3));
  phoneGeo.setAttribute('color', new THREE.BufferAttribute(phoneCol, 3));
  const phones = new THREE.Points(phoneGeo, new THREE.PointsMaterial({ size: 2.6 * renderer.getPixelRatio(), sizeAttenuation: false, map: softSpot(16, 1.2), vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  scene.add(phones);

  // ---- lights
  const key = new THREE.SpotLight(0xfff3e2, 6, 0, 0.4, 0.3, 0);
  key.position.set(0, TRUSS.y + 0.6, 1.2);
  key.target.position.set(0, FLOOR, 0.2);
  key.castShadow = heavy;
  key.shadow.mapSize.set(1536, 1536);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 5;
  key.shadow.camera.far = 16;
  scene.add(key, key.target);
  const fill = new THREE.SpotLight(0xd8e0f0, 1.1, 0, 0.62, 0.9, 0);
  fill.position.set(0, TRUSS.y + 1, -0.5);
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
      if (mirrorOn) mirror.render(camera);
    },
    update(t, dt, exc, reduced) {
      TIME.value = t;
      // the fans move with their side's mood
      const arr = crowd.instanceMatrix.array;
      const harr = heads2.instanceMatrix.array;
      for (let i = 0; i < bowl.length; i++) {
        const p = bowl[i];
        const e = exc[p.side === 'mid' ? (i % 2 ? 'red' : 'blue') : p.side];
        p.y = p.base + (reduced ? 0 : Math.max(0, Math.sin(t * 3.1 * p.sp + p.ph)) * (0.015 + e * 0.13));
        arr[i * 16 + 13] = p.y;
        harr[i * 16 + 13] = p.y + p.head.y;
      }
      crowd.instanceMatrix.needsUpdate = true;
      heads2.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < armed.length; i++) {
        const p = armed[i];
        const e = exc[p.side === 'mid' ? 'red' : p.side];
        const up = !reduced && Math.sin(t * 1.7 * p.sp + p.ph * 3) > 1.35 - e * 0.9;
        m4.compose(pos.set(p.x, p.y, p.z), p.q, up ? scl.set(p.w, p.h, p.w) : scl.set(0, 0, 0));
        arms.setMatrixAt(i, m4);
      }
      arms.instanceMatrix.needsUpdate = true;
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

/** After the tone mapping: deep blacks, a gentle curve, cool shadows and warm highlights, a vignette
 *  and a little film grain. */
export const GradeShader = {
  uniforms: { tDiffuse: { value: null }, time: TIME, grain: { value: 0.022 }, aspect: { value: 1.6 } },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; uniform float aspect; varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = max(c - 0.02, 0.0) / 0.98;                          // the blacks: black
      c = mix(c * c / 0.14, c, smoothstep(0.0, 0.14, c));      // a steep toe: shadows sink
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.18);               // a gentle S
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 0.96);
      c += vec3(-0.006, -0.002, 0.008) * (1.0 - l) * smoothstep(0.0, 0.25, l) + vec3(0.012, 0.004, -0.01) * l;
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0) / max(aspect, 1.0);
      c *= mix(1.0, 0.42, smoothstep(0.28, 0.85, length(d) * 1.25));
      float n = hash(vUv * vec2(1931.0, 1171.0) + fract(time * 7.13)) - 0.5;
      c += n * grain * (1.0 - l * 0.7);
      gl_FragColor = vec4(c, 1.0);
    }`,
};

// The atmosphere of the arena, on top of the 3D scene: light beams you can see in the haze, the
// haze itself, two big screens with live close-ups of the fighters, pyrotechnics (spark fountains
// from the corner posts, flame jets, confetti), fans' flags and glow sticks. Phones get a lighter
// version: no live screens, fewer particles.
import * as THREE from 'three';

const COLOR = { red: 0xef4444, blue: 0x3b82f6, gold: 0xf5b301 };

/** A light beam that fades along its length and at its edges, as light does in haze. */
export function beamMaterial(color, opacity) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, opacity: { value: opacity } },
    vertexShader: `varying float vH; varying vec3 vN; varying vec3 vView;
      void main() {
        vH = uv.y;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        vN = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 color; uniform float opacity; varying float vH; varying vec3 vN; varying vec3 vView;
      void main() {
        float edge = pow(abs(dot(vN, vView)), 1.6);
        float fall = mix(0.18, 1.0, vH * vH) * smoothstep(1.0, 0.82, vH); // fades at the lamp too, no hard tip
        gl_FragColor = vec4(color * opacity * edge * fall * 3.0, 1.0);
      }`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function softDot(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  r.addColorStop(0, inner);
  r.addColorStop(1, outer);
  g.fillStyle = r;
  g.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

/** Haze drifting over the ring: the beams show in it, the lights glow through it. */
export function buildHaze(scene, small) {
  const tex = softDot();
  const puffs = [];
  for (let i = 0; i < (small ? 12 : 26); i++) {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0x8fa3d8, transparent: true, opacity: 0.025 + Math.random() * 0.03, blending: THREE.AdditiveBlending, depthWrite: false }));
    const s = 5 + Math.random() * 6;
    m.scale.set(s, s * 0.6, 1);
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 7;
    puffs.push({ m, a, r, y: 2 + Math.random() * 5, sp: (Math.random() - 0.5) * 0.05 });
    scene.add(m);
  }
  return {
    update(t) {
      for (const p of puffs) {
        const a = p.a + t * p.sp;
        p.m.position.set(Math.cos(a) * p.r, p.y + Math.sin(t * 0.2 + p.a) * 0.3, Math.sin(a) * p.r);
      }
    },
  };
}

/** The card a big screen shows when it has no live picture: the corner's colour and the arena's name. */
function standby(side) {
  const c = document.createElement('canvas');
  c.width = 448;
  c.height = 252;
  const g = c.getContext('2d');
  const bg = g.createLinearGradient(0, 0, 448, 252);
  bg.addColorStop(0, side === 'red' ? '#450a0a' : '#0b1e4d');
  bg.addColorStop(1, '#05070d');
  g.fillStyle = bg;
  g.fillRect(0, 0, 448, 252);
  g.textAlign = 'center';
  g.fillStyle = side === 'red' ? '#f87171' : '#60a5fa';
  g.font = '800 30px Orbitron, Inter, sans-serif';
  g.fillText(side === 'red' ? 'RED CORNER' : 'BLUE CORNER', 224, 112);
  g.fillStyle = '#f5b301';
  g.font = '700 20px Orbitron, Inter, sans-serif';
  g.fillText('IBITI AGENT ARENA', 224, 156);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Two big screens above the side stands, each with a live close-up of one fighter. */
export function buildScreens(scene, renderer, stations, small, M) {
  const screens = [];
  const faces = [];
  for (const side of ['red', 'blue']) {
    const s = side === 'red' ? -1 : 1;
    const g = new THREE.Group();
    g.position.set(14.5 * s, 5.2, -4.5);
    g.rotation.y = -0.62 * s;
    scene.add(g);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(6.6, 3.9, 0.3), M.black);
    g.add(frame);
    const rim = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.08, 0.32), M.glow(COLOR[side], 2.2));
    rim.position.y = -2.0;
    g.add(rim);
    let map = null;
    let cam = null;
    if (!small) {
      const rt = new THREE.WebGLRenderTarget(448, 252, { samples: 2 });
      map = rt.texture;
      cam = new THREE.PerspectiveCamera(32, 16 / 9, 0.1, 60);
      screens.push({ rt, cam, side });
    }
    if (!map) map = standby(side); // phones: a still card instead of the live picture
    const face = new THREE.Mesh(new THREE.PlaneGeometry(6.3, 3.55), new THREE.MeshBasicMaterial({ map }));
    face.position.z = 0.16;
    g.add(face);
    faces.push(face);
  }
  const at = new THREE.Vector3();
  const look = new THREE.Vector3();
  let n = 0;
  return {
    /** Renders one of the two close-ups this frame (they take turns, to keep the cost low). */
    update() {
      if (!screens.length) return;
      const sc = screens[n++ % screens.length];
      const st = stations[sc.side];
      if (!st.g.visible) return;
      st.g.localToWorld(at.set(0.15, 1.95, 2.35));
      st.g.localToWorld(look.set(0, 1.55, 0));
      sc.cam.position.copy(at);
      sc.cam.lookAt(look);
      // the screens must not film themselves (a picture drawn into itself)
      for (const f of faces) f.visible = false;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(sc.rt);
      renderer.render(scene, sc.cam);
      renderer.setRenderTarget(prev);
      for (const f of faces) f.visible = true;
    },
  };
}

/** Spark fountains from the corner posts, flame jets, and confetti that settles on the ring. */
export function buildPyro(scene, small, floor) {
  // sparks
  const N = small ? 500 : 1400;
  const pos = new Float32Array(N * 3).fill(-100);
  const col = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  const life = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const sparks = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.2, vertexColors: true, map: softDot(32), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  scene.add(sparks);
  let next = 0;
  const emitters = [];
  const WARM = [[3.6, 2.4, 0.7], [3.8, 3.0, 1.4], [3.3, 1.6, 0.4], [3.8, 3.5, 2.6]];
  // flame jets
  const flames = [];
  const flameMat = beamMaterial(0xff7a1a, 0.9);
  // confetti
  const CN = small ? 220 : 520;
  const conf = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.12), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }), CN);
  const cs = Array.from({ length: CN }, () => ({ p: new THREE.Vector3(0, -50, 0), v: 0, sw: Math.random() * 6, spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6), r: new THREE.Euler(), on: false }));
  const confColors = [0xf5b301, 0xffd666, 0xef4444, 0x3b82f6, 0xffffff];
  const c = new THREE.Color();
  cs.forEach((_, i) => conf.setColorAt(i, c.setHex(confColors[i % confColors.length])));
  conf.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(conf);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const one = new THREE.Vector3(1, 1, 1);

  function flame(at, until) {
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1, 18, 1, true), flameMat);
    m.rotation.x = Math.PI; // the wide end up: fire leaves the nozzle and spreads
    m.position.copy(at);
    scene.add(m);
    flames.push({ m, at: at.clone(), until });
  }

  return {
    /** kind 'round': a short burst from every post; 'win': fountains, flames and confetti on the winner's side. */
    fire(kind, posts, now) {
      const dur = kind === 'win' ? 2.8 : 1.1;
      for (const p of posts) emitters.push({ at: p.clone(), until: now + dur, rate: kind === 'win' ? 420 : 300 });
      for (const p of posts) flame(p.clone().setY(p.y + 0.2), now + (kind === 'win' ? 1.8 : 0.8));
      if (kind === 'win') {
        cs.forEach((k) => {
          const a = Math.random() * Math.PI * 2;
          const r = Math.random() * 6.5;
          k.p.set(Math.cos(a) * r, 9 + Math.random() * 4, Math.sin(a) * r);
          k.v = 0.9 + Math.random() * 0.9;
          k.on = true;
        });
      }
    },
    update(t, dt) {
      // emit
      for (let e = emitters.length - 1; e >= 0; e--) {
        const em = emitters[e];
        if (t > em.until) {
          emitters.splice(e, 1);
          continue;
        }
        for (let k = 0; k < em.rate * dt; k++) {
          const i = next++ % N;
          pos.set([em.at.x, em.at.y, em.at.z], i * 3);
          const a = Math.random() * Math.PI * 2;
          const s = 0.6 + Math.random() * 1.6;
          vel.set([Math.cos(a) * s * 0.5, 5 + Math.random() * 4, Math.sin(a) * s * 0.5], i * 3);
          col.set(WARM[i % WARM.length], i * 3);
          life[i] = 1 + Math.random() * 0.8;
        }
      }
      // move
      for (let i = 0; i < N; i++) {
        if (life[i] <= 0) continue;
        life[i] -= dt;
        vel[i * 3 + 1] -= 9.8 * dt;
        for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i * 3 + k] * dt;
        if (pos[i * 3 + 1] < floor) vel[i * 3 + 1] *= -0.3;
        if (life[i] <= 0) pos[i * 3 + 1] = -100;
        const fade = Math.max(0, Math.min(1, life[i]));
        col[i * 3] *= 0.995 + 0.005 * fade;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
      // flames
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        const left = f.until - t;
        if (left <= 0) {
          scene.remove(f.m);
          f.m.geometry.dispose();
          flames.splice(i, 1);
          continue;
        }
        const h = (2.4 + Math.sin(t * 40 + i) * 0.35) * Math.min(1, left * 3);
        f.m.scale.set(1, h, 1);
        f.m.position.set(f.at.x, f.at.y + h / 2, f.at.z);
      }
      // confetti
      let moved = false;
      cs.forEach((k, i) => {
        if (!k.on) return;
        moved = true;
        if (k.p.y > floor + 0.02) {
          k.p.y -= k.v * dt;
          k.p.x += Math.sin(t * 2 + k.sw) * 0.4 * dt;
          k.p.z += Math.cos(t * 1.7 + k.sw) * 0.4 * dt;
          k.r.set(k.r.x + k.spin.x * dt, k.r.y + k.spin.y * dt, k.r.z + k.spin.z * dt);
        } else {
          k.p.y = Math.hypot(k.p.x, k.p.z) < 6 ? floor + 0.02 : 0.02;
          k.r.set(-Math.PI / 2, k.r.y, 0);
        }
        m4.compose(k.p, q.setFromEuler(k.r), one);
        conf.setMatrixAt(i, m4);
      });
      if (moved) conf.instanceMatrix.needsUpdate = true;
    },
    /** Clear the confetti off the ring (a new fight or a replay). */
    sweep() {
      cs.forEach((k, i) => {
        k.on = false;
        m4.makeTranslation(0, -50, 0);
        conf.setMatrixAt(i, m4);
      });
      conf.instanceMatrix.needsUpdate = true;
    },
  };
}

/** Flags held up in the stands, waving; red on the red side, blue on the blue side. */
export function buildFlags(scene, fans, small) {
  const flagTex = {};
  for (const side of ['red', 'blue']) {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 80;
    const g = c.getContext('2d');
    g.fillStyle = side === 'red' ? '#dc2626' : '#2563eb';
    g.fillRect(0, 0, 128, 80);
    g.fillStyle = 'rgba(255,255,255,.9)';
    g.fillRect(0, 34, 128, 12);
    g.fillStyle = '#f5b301';
    g.fillRect(0, 30, 128, 4);
    flagTex[side] = new THREE.CanvasTexture(c);
    flagTex[side].colorSpace = THREE.SRGBColorSpace;
  }
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x9aa4b8, roughness: 0.6 });
  const flags = [];
  const holders = fans.filter(() => Math.random() < (small ? 0.006 : 0.012));
  for (const p of holders) {
    const g = new THREE.Group();
    g.quaternion.copy(p.q);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.7, 6), poleMat);
    pole.position.set(0.3, 1.5, 0);
    g.add(pole);
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.66, 6, 1), new THREE.MeshStandardMaterial({ map: flagTex[p.side], side: THREE.DoubleSide, roughness: 0.8 }));
    cloth.geometry.translate(0.52, 0, 0);
    cloth.position.set(0.3, 2.0, 0);
    g.add(cloth);
    scene.add(g);
    flags.push({ g, cloth, p, ph: Math.random() * 6 });
  }
  return {
    update(t, exc) {
      for (const f of flags) {
        const e = exc[f.p.side];
        f.g.position.set(f.p.x, f.p.y ?? f.p.base, f.p.z);
        f.cloth.rotation.y = Math.sin(t * (2 + e * 3) + f.ph) * (0.35 + e * 0.6);
        f.cloth.rotation.z = Math.sin(t * 1.3 + f.ph) * 0.08;
      }
    },
  };
}

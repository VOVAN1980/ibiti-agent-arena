// The fighters and the referee as humanoid robots. Our own robots (built in Blender for the arena,
// baked PBR maps): the fighters are heavy boxer robots (layered plates in the corner's colour, chipped
// down to the steel, with rivets, bolts, panel lines and vents over a dark mechanical frame, exposed
// servos, one narrow visor slit, leather gloves, cloth shorts), the referee a broad android in black
// titanium and gold, a glowing gold V visor over a faceplate, gold ear rings and a gold bow tie. Pistons at a
// fighter's elbows and knees slide in and out as the joints bend (aimed here every frame), its visor
// and back lights breathe a little. They ride the skeleton of the X Bot model from Mixamo (Adobe; free
// to use in one's own projects, commercial ones included): the same bones, rest pose and clips, so they
// walk and stand with its animations. Everything else (sitting at the desk, typing, arms up, the
// fight at the end, the referee's verdict) is posed here through the skeleton, from the scene's pose values, and
// the hands reach the keyboard or the head by solving the arm (two-bone IK).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const ROBOT = { red: 'robot-red', blue: 'robot-green', ref: 'robot-ref' }; // the green corner's key is "blue"
const MOVES = new URL('./arena/models/robot-moves.glb', import.meta.url).href; // standing and walking, for all three
const robotUrl = (name, lite) => new URL(`./arena/models/${name}${lite ? '-lite' : ''}.glb`, import.meta.url).href;
const SCALE = 1.12;
// the eyes on the armoured robots' visors: centre, outward normal and the slit's direction, in the
// model's own metres at rest (a fighter's helmet is a little larger than the referee's)
const EYES = {
  fighter: [[[0.0357, 1.669, 0.1332], [0.1776, -0.0298, 0.9836], [-0.9753, -0.1448, 0.1667]], [[-0.0357, 1.669, 0.1332], [-0.1957, -0.0301, 0.9802], [-0.9753, 0.1448, -0.1667]]],
  ref: [[[0.0238, 1.6735, 0.1257], [0.1819, 0.0188, 0.9831], [-0.9817, 0, 0.1906]], [[-0.0238, 1.6735, 0.1257], [-0.2013, 0.0186, 0.9793], [-0.9817, 0, -0.1906]]],
};
const GLOW = { red: 0xff0a12, blue: 0x00e62e, ref: 0xf2cf6e }; // a deep red and a pure green: never orange
const EYE_SIZE = { fighter: [0.074, 0.0062], ref: [0.05, 0.0048] }; // the two halves meet: one narrow slit across the visor
// a fighter's pistons (left side; mirrored): [bone, mount] for the housing and for the rod, the housing's
// and the rod's radius, the housing's longest length; in the model's own metres at rest (the elbow's
// housing rides the forearm, clear of the shoulder's lames)
const PISTONS = [
  [['LeftForeArm', [0.57, 1.5328, -0.0143]], ['LeftArm', [0.34, 1.5328, -0.0143]], 0.0115, 0.0052, 0.085],
  [['LeftUpLeg', [0.1811, 0.6337, 0.0416]], ['LeftLeg', [0.1811, 0.4037, 0.0416]], 0.0125, 0.0058, 0.1],
];
const PISTON_GEO = new THREE.CylinderGeometry(1, 1, 1, 10, 1).rotateX(Math.PI / 2).translate(0, 0, 0.5); // unit length along +z
const Z1 = new THREE.Vector3(0, 0, 1);
const _pa = new THREE.Vector3();
const _pb = new THREE.Vector3();
const _pt = new THREE.Vector3();
const SPREAD = 0.2; // a fighter's arms hang a little out from its bulk (radians, outwards), less as they rise

/** The robots' models: our three armoured robots (the lighter set on phones). However long they
 *  take, the hall waits for them (a slow line, a busy computer); a failed load is tried again. */
export async function loadXbot(lite = false) {
  const loader = new GLTFLoader();
  const kinds = ['red', 'blue', 'ref'];
  for (let attempt = 1; ; attempt++) {
    try {
      const [moves, ...got] = await Promise.all([loader.loadAsync(MOVES), ...kinds.map((k) => loader.loadAsync(robotUrl(ROBOT[k], lite)))]);
      for (const g of got) g.animations = moves.animations; // the X Bot's own clips, shared by the three
      return { robots: Object.fromEntries(kinds.map((k, i) => [k, got[i]])) };
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qp = new THREE.Quaternion();
const _qr = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _e = new THREE.Euler();

function boneBy(model, suffix) {
  let found = null;
  model.traverse((o) => {
    if (!found && o.isBone && o.name.endsWith(suffix)) found = o;
  });
  return found;
}

/** Turn a bone so that it points along `dirWorld`, blending `k` of the way from its current pose. */
function aim(bone, axis, dirWorld, k) {
  bone.parent.getWorldQuaternion(_qp).invert();
  _v.copy(dirWorld).applyQuaternion(_qp).normalize();
  _q.setFromUnitVectors(axis, _v);
  bone.quaternion.slerp(_q, k);
  bone.updateMatrixWorld(true);
}

/** The arm's two directions so that the hand reaches `target`, the elbow bending towards `pole`. */
function solveArm(shoulder, target, l1, l2, pole, upper, fore) {
  const d = _v.subVectors(target, shoulder);
  const dist = Math.min(d.length(), (l1 + l2) * 0.999);
  const u = d.normalize().clone();
  const cosA = (l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const w = pole.clone().addScaledVector(u, -pole.dot(u)).normalize();
  upper.copy(u).multiplyScalar(Math.cos(a)).addScaledVector(w, Math.sin(a)).normalize();
  const elbow = shoulder.clone().addScaledVector(upper, l1);
  fore.subVectors(shoulder.clone().addScaledVector(u, dist), elbow).normalize();
}

export function makeXRobot(kind, models) {
  const gltf = models.robots[kind];
  const model = SkeletonUtils.clone(gltf.scene);
  model.scale.setScalar(SCALE);
  const color = GLOW[kind];
  const parts = {}; // a fighter's boxing gloves, and its bare armoured hands for typing at the desk
  let lights = null; // the small back lights (their glow breathes)
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // a posed skinned mesh can leave its bind-pose box
    if (o.name === 'Gloves' || o.name === 'Hands') parts[o.name] = o;
    // the baked plates as they are; the small lights (the back pack's) in the corner's colour
    if (o.material.name === 'Glow') {
      o.material = o.material.clone();
      o.material.color.setHex(0x000000);
      o.material.emissive.setHex(kind === 'ref' ? 0xffb83d : color); // the referee's visor and ear rings: a warm, clean gold
      o.material.emissiveIntensity = kind === 'ref' ? 1.7 : 2.4;
      lights = o.material;
    } else if (kind === 'ref') {
      // the referee's black titanium: satin, not a mirror the spotlights blind you in
      o.material.envMapIntensity = 0.4;
      o.material.roughness = 1.7; // scales the baked roughness up (three clamps it at 1)
    } else o.material.envMapIntensity = 0.9;
  });
  const root = new THREE.Group(); // moved and turned by the scene
  const lift = new THREE.Group(); // up and down: sitting, jumping
  root.add(lift);
  lift.add(model);

  const B = {};
  for (const n of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'HeadTop_End', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']) B[n] = boneBy(model, n);
  root.updateMatrixWorld(true);
  const wp = (b) => b.getWorldPosition(new THREE.Vector3());
  const axis = (b, child) => child.position.clone().normalize();
  const AX = {
    Spine: axis(B.Spine, B.Spine1), Spine1: axis(B.Spine1, B.Spine2), Spine2: axis(B.Spine2, B.Neck), Head: axis(B.Head, B.HeadTop_End),
    LeftArm: axis(B.LeftArm, B.LeftForeArm), LeftForeArm: axis(B.LeftForeArm, B.LeftHand), RightArm: axis(B.RightArm, B.RightForeArm), RightForeArm: axis(B.RightForeArm, B.RightHand),
    LeftUpLeg: axis(B.LeftUpLeg, B.LeftLeg), LeftLeg: axis(B.LeftLeg, B.LeftFoot), RightUpLeg: axis(B.RightUpLeg, B.RightLeg), RightLeg: axis(B.RightLeg, B.RightFoot),
  };
  const hipsY = wp(B.Hips).y;
  const shin = wp(B.LeftLeg).distanceTo(wp(B.LeftFoot)) + wp(B.LeftFoot).y;
  const L1 = wp(B.LeftArm).distanceTo(wp(B.LeftForeArm));
  const L2 = wp(B.LeftForeArm).distanceTo(wp(B.LeftHand)) + 0.06;

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 0.9 });
  let eyes = [];
  if (kind !== 'ref') {
    // one narrow slit of light across the visor, in two halves that meet in a shallow V (the referee's in gold), on the head bone
    const hs = 1 / B.Head.getWorldScale(new THREE.Vector3()).x;
    const toHead = (v) => B.Head.worldToLocal(model.localToWorld(new THREE.Vector3(...v)));
    const look = kind === 'ref' ? 'ref' : 'fighter';
    eyes = EYES[look].map(([c, n, a]) => {
      const at = toHead(c);
      const nz = toHead(c.map((x, i) => x + n[i])).sub(at).normalize();
      const ax = toHead(c.map((x, i) => x + a[i])).sub(at);
      ax.addScaledVector(nz, -ax.dot(nz)).normalize();
      const e = new THREE.Mesh(new THREE.BoxGeometry(EYE_SIZE[look][0], EYE_SIZE[look][1], 0.004), eyeMat);
      e.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(ax, new THREE.Vector3().crossVectors(nz, ax), nz));
      e.position.copy(at);
      e.scale.setScalar(hs);
      e.userData.base = hs; // the head bone's units: the scene scales the slits from this, not from 1
      B.Head.add(e);
      return e;
    });
  }

  // a fighter's elbow and knee pistons: a housing on the upper bone, a chrome rod on the lower one
  const pistons = [];
  if (kind !== 'ref') {
    const houseMat = new THREE.MeshStandardMaterial({ color: 0x2b2d32, metalness: 1, roughness: 0.42, envMapIntensity: 0.9 });
    const rodMat = new THREE.MeshStandardMaterial({ color: 0xd4d7dd, metalness: 1, roughness: 0.16, envMapIntensity: 0.9 });
    for (const [[ba, pa], [bb, pb], r, rr, hmax] of PISTONS) {
      for (const m of [1, -1]) {
        const flip = (n) => (m > 0 ? n : n.replace('Left', 'Right'));
        const A = boneBy(model, flip(ba));
        const Bn = boneBy(model, flip(bb));
        const at = (b, v) => b.worldToLocal(model.localToWorld(new THREE.Vector3(v[0] * m, v[1], v[2])));
        const k = model.scale.x / A.getWorldScale(new THREE.Vector3()).x; // the model's metres in the bone's units
        const house = new THREE.Mesh(PISTON_GEO, houseMat);
        const rod = new THREE.Mesh(PISTON_GEO, rodMat);
        house.position.copy(at(A, pa));
        rod.position.copy(at(Bn, pb));
        A.add(house);
        Bn.add(rod);
        for (const o of [house, rod]) o.frustumCulled = false;
        pistons.push({ A, Bn, house, rod, r: r * k, rr: rr * k, hmax: hmax * k });
      }
    }
  }
  const phase = kind === 'blue' ? 1.7 : 0;

  // its own animations: standing and walking
  const mixer = new THREE.AnimationMixer(model);
  const clip = (n) => gltf.animations.find((a) => a.name === n);
  const idle = mixer.clipAction(clip('idle'));
  const walk = mixer.clipAction(clip('walk'));
  idle.play();
  walk.play();
  walk.setEffectiveWeight(0);
  let walkW = 0;
  // its feet as it stands (the idle clip): the ankle's height and the way from the ankle to the ball of
  // the foot, in the robot's own units
  for (const n of ['LeftToeBase', 'RightToeBase']) B[n] = boneBy(model, n);
  mixer.update(0);
  root.updateMatrixWorld(true);
  const ankleY = wp(B.LeftFoot).y;
  const TOE = { Left: wp(B.LeftToeBase).sub(wp(B.LeftFoot)), Right: wp(B.RightToeBase).sub(wp(B.RightFoot)) };
  AX.LeftFoot = axis(B.LeftFoot, B.LeftToeBase);
  AX.RightFoot = axis(B.RightFoot, B.RightToeBase);
  const HIP_Y = wp(B.Hips).y;

  const rootQ = new THREE.Quaternion();
  const invQ = new THREE.Quaternion();
  const leanQ = new THREE.Quaternion();
  const dirs = { u: new THREE.Vector3(), f: new THREE.Vector3() };
  const ik = { u: new THREE.Vector3(), f: new THREE.Vector3() };
  const solved = [[new THREE.Vector3(), new THREE.Vector3()], [new THREE.Vector3(), new THREE.Vector3()]];
  const target = new THREE.Vector3();
  const shoulderAt = new THREE.Vector3();
  const rootAt = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();
  const poleV = new THREE.Vector3();
  let sitW = 0;
  let sitU = 0;
  const bulky = kind !== 'ref';
  if (parts.Hands) parts.Hands.visible = false;

  // the feet: planted on the ground where they stand, a step at a time when the body has turned or moved
  // away from them (in place of the walk clip, whose stride would slide)
  const feet = ['Left', 'Right'].map((side) => ({ side, s: side === 'Left' ? 1 : -1, at: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), yaw: 0, fromYaw: 0, toYaw: 0, u: 1, dur: 0.3, ready: false }));
  let plantW = 0;
  let lastStep = 0;
  const prevAt = new THREE.Vector3();
  let havePrev = false;
  const vel = new THREE.Vector3();
  let speed = 0;
  const handW = [0, 0];
  const footW = [0, 0];
  const shift = new THREE.Vector3(); // the hips over the standing foot while the other steps
  let gaitT = 0;
  const NO_RIG = {};

  /** The robot's yaw (about the hall's up) from a world quaternion. */
  const yawOf = (q) => {
    tmp2.set(0, 0, 1).applyQuaternion(q);
    return Math.atan2(tmp2.x, tmp2.z);
  };

  /** Pose the robot for this frame. c: the smoothed pose values; p: the pose; reach: where the hands go
   *  at the desk (two points, or 'head'); rig: what the scene asks of the body this frame, all optional:
   *  hands [right, left] { at (world), w, pole (on the robot's own axes) }, feet [left, right] { at (the
   *  ankle, world), w, yaw (world) }, body { x, y, z } (the hips moved, in metres on the robot's own
   *  axes), look (a world point the head turns to) and lookW, twist (the chest turned, radians), tilt (the head leaned to one side, radians), breath,
   *  stance (0..1: the feet set as a boxer's), feetFwd (the feet set this far ahead of the body, robot units), wide (the feet further apart), ground (the floor's height), air (off the ground: nothing
   *  planted), legs { hip, knee, w, left?: { hip, knee }, splay? } (the legs bent by angles: both alike, or the
   *  left its own way, spread apart by `splay`), hug (the hands round the shins). */
  function pose(c, p, t, walking, dt, reach, rig = NO_RIG) {
    root.updateMatrixWorld(true);
    const ws = root.getWorldScale(tmp).x; // world metres in one of the robot's own units
    root.getWorldPosition(rootAt);
    if (havePrev && dt > 0) {
      vel.subVectors(rootAt, prevAt).divideScalar(dt).setY(0);
      speed += (vel.length() - speed) * Math.min(1, dt * 12);
    }
    prevAt.copy(rootAt);
    havePrev = true;
    root.getWorldQuaternion(rootQ);
    invQ.copy(rootQ).invert();
    const rootYaw = yawOf(rootQ);

    // the walk clip only while it really goes somewhere, played as fast as the body moves (its stride
    // then matches the ground)
    const clipSpeed = 1.7 * ws; // the clip's own pace on the ground
    const moving = (walking || p.walkAnim) && !rig.air ? Math.min(1, Math.max(0, (speed / clipSpeed - 0.1) / 0.2)) : 0;
    walkW += (moving - walkW) * Math.min(1, dt * 7);
    walk.timeScale = Math.min(1.5, Math.max(0.3, speed / clipSpeed));
    walk.setEffectiveWeight(walkW);
    idle.setEffectiveWeight(1 - walkW);
    mixer.update(dt);
    gaitT = walk.time / walk.getClip().duration; // where in its stride (0: the left foot leaves the ground)

    // down into the chair (and up out of it) in an eased move of about 0.8 s, leaning forward over the
    // knees on the way
    const sitTo = p.seat && !walking ? 1 : 0;
    sitU = Math.min(1, Math.max(0, sitU + (sitTo ? 1 : -1) * dt / 0.8));
    sitW = sitU * sitU * (3 - 2 * sitU);
    const sitLean = Math.sin(Math.PI * sitW) * 0.32;
    if (parts.Gloves && parts.Hands) {
      // gloves on, except at the keyboard: there the armoured fingers type
      const bare = sitW > 0.5 && Array.isArray(reach);
      parts.Gloves.visible = !bare;
      parts.Hands.visible = bare;
    }
    const floor = c.floor || 0;
    const legs = rig.legs;
    const legsW = Math.max(sitW, floor, c.tuck || 0, legs?.w ?? 0); // seated, on the floor, or bent in the air
    const body = rig.body;
    lift.position.set(
      ((body?.x ?? 0) + shift.x) / ws,
      (shin + 0.03 - hipsY) * sitW + (0.2 - hipsY) * floor * (1 - sitW) + (p.seat ? 0 : c.bounce) + ((body?.y ?? 0) + shift.y) / ws,
      (body?.z ?? 0) / ws,
    );
    root.updateMatrixWorld(true);

    leanQ.setFromEuler(_e.set(c.lean, 0, 0));
    const toWorld = (v) => v.applyQuaternion(leanQ).applyQuaternion(rootQ);
    // the spine leans (and breathes), the chest turns, the head looks and shakes
    const breath = (rig.breath ?? 1) * Math.sin(t * (rig.breathRate ?? 1.9) + phase) * 0.025;
    const spineDir = UP.clone().applyEuler(_e.set(c.lean + sitLean + breath, 0, 0)).applyQuaternion(rootQ);
    const twist = (rig.twist ?? 0) / 3;
    for (const n of ['Spine', 'Spine1', 'Spine2']) {
      aim(B[n], AX[n], spineDir, 0.9);
      if (twist) B[n].rotateOnAxis(AX[n], twist);
    }
    let headPitch = c.lean + c.look;
    let headYaw = c.shake || 0;
    const lookW = rig.look ? rig.lookW ?? 1 : 0;
    if (lookW > 0) {
      // towards a point: its yaw from where the chest faces, its pitch from level
      B.Head.getWorldPosition(tmp);
      tmp2.subVectors(rig.look, tmp);
      const yaw = Math.max(-1.1, Math.min(1.1, turnDiff(Math.atan2(tmp2.x, tmp2.z), rootYaw + (rig.twist ?? 0))));
      const pitch = Math.max(-0.5, Math.min(0.8, -Math.atan2(tmp2.y, Math.hypot(tmp2.x, tmp2.z))));
      headYaw += yaw * lookW;
      headPitch = lerpN(headPitch, pitch, lookW);
    }
    const headDir = UP.clone().applyEuler(_e.set(headPitch, 0, 0)).applyQuaternion(rootQ);
    aim(B.Head, AX.Head, headDir, 0.9);
    if (headYaw) B.Head.rotateOnAxis(AX.Head, headYaw);
    if (rig.tilt) {
      // the head leans over to one side (radians; positive: the right ear down), about the way it faces
      B.Head.parent.getWorldQuaternion(_qp).invert();
      _v.set(0, 0, 1).applyEuler(_e.set(headPitch, 0, 0)).applyQuaternion(rootQ).applyQuaternion(_qp);
      B.Head.quaternion.premultiply(_q.setFromAxisAngle(_v, rig.tilt));
      B.Head.updateMatrixWorld(true);
    }

    // the arms: angles from the pose, blended towards a point the hand reaches (two-bone IK)
    for (const [i, side] of [[0, 'Right'], [1, 'Left']]) {
      const upper = B[`${side}Arm`];
      const fore = B[`${side}ForeArm`];
      const ax = i ? c.a1x : c.a0x;
      let az = i ? c.a1z : c.a0z;
      if (bulky) az += (i ? 1 : -1) * SPREAD * Math.max(0, Math.cos(az));
      const el = i ? c.e1 : c.e0;
      dirs.u.copy(DOWN).applyEuler(_e.set(ax, 0, az));
      dirs.f.copy(DOWN).applyEuler(_e.set(el, 0, 0)).applyEuler(_e.set(ax, 0, az));
      toWorld(dirs.u);
      toWorld(dirs.f);
      const h = rig.hands?.[i];
      let w = 0;
      if (reach) {
        if (reach === 'head') {
          B.Head.getWorldPosition(target).add(_v.set(side === 'Left' ? 0.13 : -0.13, 0.05, 0.06).applyQuaternion(rootQ));
        } else target.copy(reach[i]);
        poleV.set(side === 'Left' ? 0.7 : -0.7, -1, reach === 'head' ? 0.3 : -0.5);
        w = 1;
      } else if (h && h.w > 0.001) {
        target.copy(h.at);
        if (h.pole) poleV.copy(h.pole);
        else poleV.set(side === 'Left' ? 0.6 : -0.6, -1, -0.3);
        w = h.w;
      }
      // eased on and off (to the keys over about half a second, as it settles in its chair)
      handW[i] += ((reach ? 1 : w) - handW[i]) * Math.min(1, dt * (reach ? 6 : 14));
      if (w > 0.001) {
        upper.getWorldPosition(shoulderAt);
        fore.getWorldPosition(tmp);
        const l1 = shoulderAt.distanceTo(tmp);
        const l2 = tmp.distanceTo(B[`${side}Hand`].getWorldPosition(_v)) + 0.06 * ws;
        solveArm(shoulderAt, target, l1, l2, poleV.applyQuaternion(rootQ), solved[i][0], solved[i][1]);
      }
      if (handW[i] > 0.002) {
        dirs.u.lerp(solved[i][0], handW[i]).normalize();
        dirs.f.lerp(solved[i][1], handW[i]).normalize();
      }
      aim(upper, AX[`${side}Arm`], dirs.u, 1);
      aim(fore, AX[`${side}ForeArm`], dirs.f, 1);
    }

    // the legs: bent by angles (on the chair, on the floor, tucked in the air), else planted by IK
    if (legsW > 0.01) {
      for (const side of ['Left', 'Right']) {
        // the left leg may have its own angles (legs.left), and both may be spread apart (legs.splay)
        const L = side === 'Left' && legs?.left ? legs.left : legs;
        const hip = legs?.w ? L.hip : floor > 0.5 ? -2.05 : -1.5;
        const knee = legs?.w ? L.knee : floor > 0.5 ? 2.15 : 1.5;
        const splay = (legs?.w ? legs.splay ?? 0 : 0) * (side === 'Left' ? 1 : -1);
        const thigh = DOWN.clone().applyEuler(_e.set(hip, 0, splay)).applyQuaternion(rootQ);
        const shinDir = DOWN.clone().applyEuler(_e.set(hip + knee, 0, splay)).applyQuaternion(rootQ);
        aim(B[`${side}UpLeg`], AX[`${side}UpLeg`], thigh, legsW);
        aim(B[`${side}Leg`], AX[`${side}Leg`], shinDir, legsW);
      }
    }
    const ground = rig.ground ?? rootAt.y;
    const stance = rig.stance ?? 0;
    const tracking = walkW > 0.5 || !!rig.air || legsW > 0.5;
    plantW += ((tracking ? 0 : 1) - plantW) * Math.min(1, dt * 10);
    shift.multiplyScalar(Math.max(0, 1 - dt * 5));
    const restYaw = (f) => rootYaw + f.s * (0.08 + (rig.toeOut ?? 0)) * (1 - stance) - 0.3 * stance;
    for (const f of feet) {
      if (tracking || !f.ready) {
        // following the clip (or the pose), closely but never in a jump: ready to be planted where the
        // foot is when it stops
        B[`${f.side}Foot`].getWorldPosition(tmp);
        tmp.y = ground + ankleY * ws;
        if (f.ready) f.at.lerp(tmp, 1 - Math.exp(-dt * 30));
        else f.at.copy(tmp);
        f.yaw = rootYaw;
        f.u = 1;
        f.ready = true;
      }
    }
    if (!tracking) {
      // where each foot belongs under the body now: a little apart, or set as a boxer's (left ahead)
      const rest = (f, out) => out.set(f.s * (lerpN(0.1, 0.15, stance) + (rig.wide ?? 0)), 0, f.s * 0.085 * stance + (rig.feetFwd ?? 0)).applyQuaternion(rootQ).multiplyScalar(ws).add(rootAt).setY(ground + ankleY * ws).addScaledVector(vel, 0.16);
      const busy = feet.some((f) => f.u < 1);
      if (!busy && t - lastStep > 0.05) {
        // the foot furthest from its place steps, if it is far enough (or turned enough)
        let worst = null;
        let err = 0;
        for (const [i, f] of feet.entries()) {
          if (rig.feet?.[i]?.w > 0.001) continue;
          rest(f, tmp);
          const e = Math.hypot(tmp.x - f.at.x, tmp.z - f.at.z) / ws + Math.abs(turnDiff(restYaw(f), f.yaw)) * 0.16;
          if (e > err) {
            err = e;
            worst = f;
          }
        }
        if (worst && err > (rig.planted ?? 0.07)) {
          worst.from.copy(worst.at);
          rest(worst, worst.to);
          worst.fromYaw = worst.yaw;
          worst.toYaw = restYaw(worst);
          worst.u = 0;
          worst.dur = Math.min(0.42, 0.25 + err * 0.5);
        }
      }
      for (const f of feet) {
        if (f.u >= 1) continue;
        f.u = Math.min(1, f.u + dt / f.dur);
        const k = f.u * f.u * (3 - 2 * f.u);
        f.at.lerpVectors(f.from, f.to, k);
        f.at.y += Math.sin(f.u * Math.PI) * 0.07 * ws;
        f.yaw = f.fromYaw + turnDiff(f.toYaw, f.fromYaw) * k;
        // the hips over the other foot while this one is off the ground
        const other = feet[f.s > 0 ? 1 : 0];
        tmp.subVectors(other.at, rootAt).setY(0).applyQuaternion(invQ);
        const up = Math.sin(f.u * Math.PI);
        shift.x += (tmp.x * 0.3 - shift.x) * Math.min(1, dt * 12) * up;
        shift.y = -up * 0.02 * ws;
        if (f.u >= 1) lastStep = t;
      }
    }
    for (const [i, f] of feet.entries()) {
      const want = rig.feet?.[i];
      const w = want?.w ?? 0;
      footW[i] += (w - footW[i]) * Math.min(1, dt * 12);
      if (w > 0.001) {
        // the scene places this foot (on a rope, on the canvas): the planter takes it from there
        f.at.copy(want.at);
        f.yaw = want.yaw ?? rootYaw;
        f.u = 1;
      }
      const k = Math.max(footW[i], plantW) * (1 - legsW);
      if (k < 0.01) continue;
      const up = B[`${f.side}UpLeg`];
      const mid = B[`${f.side}Leg`];
      up.getWorldPosition(shoulderAt);
      mid.getWorldPosition(tmp);
      const l1 = shoulderAt.distanceTo(tmp);
      const l2 = tmp.distanceTo(B[`${f.side}Foot`].getWorldPosition(_v));
      // the knee forward, where the foot points, a little out
      const yaw = f.yaw;
      poleV.set(Math.sin(yaw) + f.s * 0.15 * Math.cos(yaw), 0.1, Math.cos(yaw) - f.s * 0.15 * Math.sin(yaw));
      solveArm(shoulderAt, f.at, l1, l2, poleV, ik.u, ik.f);
      aim(up, AX[`${f.side}UpLeg`], ik.u, k);
      aim(mid, AX[`${f.side}Leg`], ik.f, k);
      // the foot flat, pointing where it should
      tmp.copy(TOE[f.side]).applyAxisAngle(UP, turnDiff(yaw, rootYaw)).applyQuaternion(rootQ);
      aim(B[`${f.side}Foot`], AX[`${f.side}Foot`], tmp, k);
    }
    if (rig.hug) {
      // the hands round the shins (a tuck in the air)
      for (const side of ['Right', 'Left']) {
        B[`${side}Leg`].getWorldPosition(tmp);
        B[`${side}Foot`].getWorldPosition(target).lerp(tmp, 0.5);
        target.add(tmp.set(0, 0, 0.1 * ws).applyQuaternion(rootQ));
        B[`${side}Arm`].getWorldPosition(shoulderAt);
        B[`${side}ForeArm`].getWorldPosition(tmp);
        const l1 = shoulderAt.distanceTo(tmp);
        const l2 = tmp.distanceTo(B[`${side}Hand`].getWorldPosition(_v)) + 0.06 * ws;
        solveArm(shoulderAt, target, l1, l2, poleV.set(side === 'Left' ? 0.8 : -0.8, -0.2, -0.3).applyQuaternion(rootQ), ik.u, ik.f);
        aim(B[`${side}Arm`], AX[`${side}Arm`], ik.u, rig.hug);
        aim(B[`${side}ForeArm`], AX[`${side}ForeArm`], ik.f, rig.hug);
      }
    }

    // the pistons follow the joints: each part aimed at the other's mount, the rod as long as the gap
    if (pistons.length) {
      root.updateMatrixWorld(true);
      for (const q of pistons) {
        _pa.copy(q.house.position).applyMatrix4(q.A.matrixWorld);
        _pb.copy(q.rod.position).applyMatrix4(q.Bn.matrixWorld);
        _pt.copy(_pb);
        q.A.worldToLocal(_pt).sub(q.house.position);
        const d = _pt.length();
        q.house.quaternion.setFromUnitVectors(Z1, _pt.normalize());
        q.house.scale.set(q.r, q.r, Math.min(q.hmax, d * 0.58));
        _pt.copy(_pa);
        q.Bn.worldToLocal(_pt).sub(q.rod.position);
        q.rod.quaternion.setFromUnitVectors(Z1, _pt.normalize());
        q.rod.scale.set(q.rr, q.rr, d * 0.96);
      }
    }
    // alive: the visor's glow and the back lights breathe, slowly
    eyeMat.emissiveIntensity = 0.9 * (0.86 + 0.14 * Math.sin(t * 2.3 + phase));
    if (lights) lights.emissiveIntensity = kind === 'ref' ? 1.7 * (0.92 + 0.08 * Math.sin(t * 0.8)) : 2.4 * (0.7 + 0.3 * Math.sin(t * 1.4 + phase));
  }

  /** Where the walk is in its stride (0..1, 0 as the left foot leaves the ground) and how much it walks. */
  const gait = () => ({ phase: gaitT, w: walkW });
  return { root, kind: 'x', eyes, pose, gait, cur: {}, bones: B, feet, hipY: HIP_Y, ankleY, model };
}

const lerpN = (a, b, k) => a + (b - a) * k;
const turnDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

// The fighters as humanoid robots: the X Bot model from Mixamo (Adobe; free to use in one's own
// projects, commercial ones included), with a visor face and glowing eyes added, the joints in the
// corner's colour. It walks and stands with its own animations; everything else (sitting at the
// desk, typing, arms up, the loser's rage, the referee's signals) is posed here through its
// skeleton, from the same pose values the simple robots use, and the hands reach the keyboard or
// the head by solving the arm (two-bone IK).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/Xbot.glb';
const SCALE = 1.12;

export function loadXbot() {
  return Promise.race([
    new GLTFLoader().loadAsync(URL),
    new Promise((_, reject) => setTimeout(() => reject(new Error('the robot model took too long')), 15000)),
  ]);
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

export function makeXRobot(kind, gltf, colors) {
  const model = SkeletonUtils.clone(gltf.scene);
  model.scale.setScalar(SCALE);
  const color = kind === 'ref' ? 0xf5b301 : colors[kind];
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false; // a posed skinned mesh can leave its bind-pose box
    const joints = /joint/i.test(o.material.name);
    const m = o.material.clone();
    if (kind === 'ref') m.color.setHex(joints ? 0xf2f4f8 : 0x2b303c);
    else if (joints) {
      m.color.setHex(colors[kind]);
      m.emissive = new THREE.Color(colors[kind]).multiplyScalar(0.28);
    } else m.color.setHex(0xe3e8f0);
    m.metalness = joints ? 0.35 : 0.6;
    m.roughness = joints ? 0.42 : 0.32;
    m.envMapIntensity = 0.55;
    o.material = m;
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

  // a face: a dark visor with two glowing eyes, on the head bone, facing where the robot faces
  const headQ = B.Head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(headQ);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(headQ);
  const right = new THREE.Vector3().crossVectors(up, fwd);
  const s = 1 / B.Head.getWorldScale(new THREE.Vector3()).x;
  const face = new THREE.Group();
  face.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, fwd));
  face.position.copy(up).multiplyScalar(0.075 * s).addScaledVector(fwd, 0.128 * s); // on the front of the head, not inside it
  face.scale.setScalar(s);
  B.Head.add(face);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.085, 0.035), new THREE.MeshStandardMaterial({ color: 0x05070d, metalness: 1, roughness: 0.08 }));
  face.add(visor);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000, emissive: color, emissiveIntensity: 3 });
  const eyes = [-1, 1].map((k) => {
    const e = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.026, 0.012), eyeMat);
    e.position.set(0.045 * k, 0.004, 0.02);
    face.add(e);
    return e;
  });

  // its own animations: standing and walking
  const mixer = new THREE.AnimationMixer(model);
  const clip = (n) => gltf.animations.find((a) => a.name === n);
  const idle = mixer.clipAction(clip('idle'));
  const walk = mixer.clipAction(clip('walk'));
  idle.play();
  walk.play();
  walk.setEffectiveWeight(0);
  let walkW = 0;

  const rootQ = new THREE.Quaternion();
  const leanQ = new THREE.Quaternion();
  const dirs = { u: new THREE.Vector3(), f: new THREE.Vector3() };
  const target = new THREE.Vector3();
  const shoulderAt = new THREE.Vector3();
  let sitW = 0;

  /** Pose the robot for this frame (c: the smoothed pose values; p: the pose; reach: where the hands go). */
  function pose(c, p, t, walking, dt, reach) {
    walkW += ((walking || p.walkAnim ? 1 : 0) - walkW) * Math.min(1, dt * 6);
    walk.setEffectiveWeight(walkW);
    idle.setEffectiveWeight(1 - walkW);
    mixer.update(dt);

    sitW += ((p.seat && !walking ? 1 : 0) - sitW) * Math.min(1, dt * 7);
    const floor = c.floor || 0;
    const legsW = Math.max(sitW, floor);
    lift.position.y = (shin + 0.03 - hipsY) * sitW + (0.2 - hipsY) * floor * (1 - sitW) + (p.seat ? 0 : c.bounce);

    root.getWorldQuaternion(rootQ);
    leanQ.setFromEuler(_e.set(c.lean, 0, 0));
    const toWorld = (v) => v.applyQuaternion(leanQ).applyQuaternion(rootQ);
    // the spine leans, the head looks and shakes
    const spineDir = UP.clone().applyQuaternion(leanQ).applyQuaternion(rootQ);
    for (const n of ['Spine', 'Spine1', 'Spine2']) aim(B[n], AX[n], spineDir, 0.9);
    const headDir = UP.clone().applyEuler(_e.set(c.lean + c.look, 0, 0)).applyQuaternion(rootQ);
    aim(B.Head, AX.Head, headDir, 0.9);
    if (c.shake) B.Head.rotateOnAxis(AX.Head, c.shake);

    // the arms: angles as for the simple robots, or reaching a target (keyboard, head)
    for (const [i, side] of [[0, 'Right'], [1, 'Left']]) {
      const upper = B[`${side}Arm`];
      const fore = B[`${side}ForeArm`];
      if (reach) {
        if (reach === 'head') {
          B.Head.getWorldPosition(target).add(_v.set(side === 'Left' ? 0.13 : -0.13, 0.05, 0.06).applyQuaternion(rootQ));
        } else target.copy(reach[i]);
        upper.getWorldPosition(shoulderAt);
        const pole = new THREE.Vector3(side === 'Left' ? 0.7 : -0.7, -1, reach === 'head' ? 0.3 : -0.5).applyQuaternion(rootQ);
        solveArm(shoulderAt, target, L1, L2, pole, dirs.u, dirs.f);
      } else {
        const ax = i ? c.a1x : c.a0x;
        const az = i ? c.a1z : c.a0z;
        const el = i ? c.e1 : c.e0;
        dirs.u.copy(DOWN).applyEuler(_e.set(ax, 0, az));
        dirs.f.copy(DOWN).applyEuler(_e.set(el, 0, 0)).applyEuler(_e.set(ax, 0, az));
        toWorld(dirs.u);
        toWorld(dirs.f);
      }
      aim(upper, AX[`${side}Arm`], dirs.u, 1);
      aim(fore, AX[`${side}ForeArm`], dirs.f, 1);
    }

    // the legs: their own walk and stance, unless sitting (on the chair or on the floor)
    if (legsW > 0.01) {
      const hip = -1.5;
      const knee = floor > 0.5 ? 0.15 : 1.5;
      for (const side of ['Left', 'Right']) {
        const thigh = DOWN.clone().applyEuler(_e.set(hip, 0, 0)).applyQuaternion(rootQ);
        const shinDir = DOWN.clone().applyEuler(_e.set(hip + knee, 0, 0)).applyQuaternion(rootQ);
        aim(B[`${side}UpLeg`], AX[`${side}UpLeg`], thigh, legsW);
        aim(B[`${side}Leg`], AX[`${side}Leg`], shinDir, legsW);
      }
    }
  }

  return { root, kind: 'x', eyes, pose, cur: {} };
}

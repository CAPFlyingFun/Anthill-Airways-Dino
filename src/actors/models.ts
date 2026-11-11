// ============================================================================
// models.ts — the creatures, built from simple shapes in code.
// (Later these can be swapped for MeshyAI .glb models without changing the
// game logic, because everything else only talks to `root`, `bob` and legs.)
//
// Every creature faces +z ("forward"). Its 6 legs walk in a tripod gait:
// legs A (front-left, middle-right, back-left) swing while B rest, then swap.
// ============================================================================
import * as THREE from 'three';
import { lod } from '../core/lod';

export interface CreatureModel {
  root: THREE.Group;          // move/rotate this
  bob: THREE.Group;           // the body; bounces while walking; stacks attach here
  legs: THREE.Object3D[];     // leg pivots (procedural) or leg root bones (3D models)
  legBase: THREE.Quaternion[];// resting rotation of each leg
  legAxis: THREE.Vector3[];   // axis each leg swings around (in the leg's own space)
  legPhase: number[];         // 0 or PI (alternating gait)
  legAmp: number;             // how far legs swing (radians)
  legAmps?: number[];         // per-limb swing (humans: legs swing more than arms)
  stride?: number;            // body lengths per stride (humans take long strides)
  walkT: number;
  walkBlend: number;          // 0 = standing, 1 = full walk cycle
  height: number;             // world height of the body (for stacking things on top)
  length: number;             // nose-to-tail length
  wings: Wing[];              // wing root bones (only the housefly has them for now)
  flying: boolean;            // true = wings open and buzzing
  wingOpen: number;           // 0 folded .. 1 spread (eases between)
  biped?: Biped;              // people only: legs with knees, arms with elbows
  anim?: {                    // models with their own animations (the Dodo)
    mixer: THREE.AnimationMixer;
    walk: THREE.AnimationAction;
    run: THREE.AnimationAction;
  };
  holding?: boolean;          // people: carrying something (arms go out front)
  /** Extra per-frame animation (the Lava Rex: knees, tail, head, roar). */
  extra?: (dt: number) => void;
}

/** A joint we rotate: its rest rotation + the side-to-side axis (in its own space). */
export interface Joint {
  bone: THREE.Object3D;
  base: THREE.Quaternion;
  axis: THREE.Vector3;
}
/** A human leg (hip + knee) or arm (shoulder + elbow). */
export interface BipedLimb {
  arm: boolean;
  hip: Joint;           // hip or shoulder
  mid: Joint | null;    // knee or elbow
  phase: number;        // 0 or 0.5 of a cycle (left/right alternate)
}
/** People walk with their own gait (see animateBiped). */
export interface Biped {
  limbs: BipedLimb[];
  legLen: number;       // hip to sole
  step: number;         // how far the foot reaches forward/back of the hip
  holdBlend: number;    // 0 = arms swinging .. 1 = arms out front holding something
}

/** Hip swing (radians) at full stride. */
export const LEG_SWING = 0.42;

/** One wing bone, with the axes it opens and flaps around (in its own space). */
export interface Wing {
  bone: THREE.Object3D;
  base: THREE.Quaternion;
  up: THREE.Vector3;   // the body's vertical: opening the wing swings around this
  fwd: THREE.Vector3;  // the body's forward: the up/down beat swings around this
  side: number;        // -1 left, +1 right
}

/** Empty model shell; the builders below fill it in. */
export function newModel(height: number, length: number): CreatureModel {
  const m: CreatureModel = {
    root: new THREE.Group(), bob: new THREE.Group(), legs: [], legBase: [], legAxis: [], legPhase: [],
    legAmp: 0.5, walkT: Math.random() * 10, walkBlend: 0, height, length, wings: [], flying: false, wingOpen: 0,
  };
  m.root.add(m.bob);
  lod.add(m.root, Math.max(length, height)); // hide it when the camera can't see it
  return m;
}

const legGeo = new THREE.CylinderGeometry(0.04, 0.03, 0.8, 5);
legGeo.translate(0, -0.4, 0); // pivot at the top of the leg
const sphere = new THREE.SphereGeometry(1, 18, 14);
const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
const black = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.3 });

function ball(material: THREE.Material, r: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(sphere, material);
  m.position.set(x, y, z);
  m.scale.set(r * sx, r * sy, r * sz);
  m.castShadow = true;
  return m;
}

/** Adds 3 pairs of legs to `parent`. */
function addLegs(model: CreatureModel, parent: THREE.Object3D, material: THREE.Material, zs: number[], spread: number, legScale = 1) {
  zs.forEach((z, row) => {
    for (const side of [-1, 1]) {
      const swing = new THREE.Group(); // rotates around y to step forward/back
      swing.position.set(side * spread, 0, z);
      const tilt = new THREE.Group(); // tilts the leg out to the side
      tilt.rotation.z = side * 1.05;
      const leg = new THREE.Mesh(legGeo, material);
      leg.scale.setScalar(legScale);
      leg.castShadow = true;
      tilt.add(leg);
      swing.add(tilt);
      parent.add(swing);
      // Front legs point forward, back legs point back.
      const base = [-0.55, 0, 0.55][row] * side;
      swing.rotation.y = base;
      model.legs.push(swing);
      model.legBase.push(swing.quaternion.clone());
      model.legAxis.push(new THREE.Vector3(0, 1, 0));
      // Tripod gait: front-left, middle-right, back-left move together.
      const groupA = (row % 2 === 0) === (side === -1);
      model.legPhase.push(groupA ? 0 : Math.PI);
    }
  });
}

/** An ant. `cap` gives it the player's blue pilot cap and goggles. */
export function makeAnt(color = 0x8e2f14, cap = false): CreatureModel {
  const model = newModel(0.75 * 1.3, 1.6 * 1.3);
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 });
  model.bob.position.y = 0.45;
  const b = model.bob;

  b.add(ball(body, 0.42, 0, 0.12, -0.66, 0.9, 0.82, 1.15)); // abdomen (back end)
  b.add(ball(body, 0.12, 0, 0.04, -0.24));                  // waist
  b.add(ball(body, 0.24, 0, 0.05, 0.04, 0.9, 0.8, 1.2));    // thorax (middle)
  b.add(ball(body, 0.3, 0, 0.2, 0.5));                      // head
  for (const s of [-1, 1]) {
    b.add(ball(white, 0.095, s * 0.15, 0.28, 0.72));         // eyes
    b.add(ball(black, 0.05, s * 0.16, 0.29, 0.8));
    // antennae
    const ant = new THREE.Group();
    ant.position.set(s * 0.1, 0.44, 0.6);
    ant.rotation.set(0.75, 0, -s * 0.45);
    const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.5, 5), body);
    stalk.position.y = 0.25;
    ant.add(stalk);
    ant.add(ball(body, 0.06, 0, 0.5, 0));
    b.add(ant);
  }

  if (cap) {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x2d6cdf, roughness: 0.5 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.315, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), capMat);
    dome.position.set(0, 0.24, 0.48);
    dome.rotation.x = -0.2;
    dome.castShadow = true;
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.035, 18, 1, false, -Math.PI / 2, Math.PI), capMat);
    brim.position.set(0, 0.3, 0.6);
    brim.rotation.x = -0.15;
    const gogMat = new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.3, metalness: 0.4 });
    b.add(dome, brim);
    for (const s of [-1, 1]) {
      const gog = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.025, 6, 14), gogMat);
      gog.position.set(s * 0.11, 0.47, 0.62);
      gog.rotation.x = -0.9;
      b.add(gog);
    }
  }

  addLegs(model, b, body, [0.18, 0.04, -0.1], 0.16, 0.7);
  model.bob.position.y = 0.36;
  model.root.scale.setScalar(1.3); // chunkier ants read better from the camera angle
  return model;
}

/** A beetle (the customers, and the cart-puller in gate runs). */
export function makeBeetle(color: number): CreatureModel {
  const model = newModel(0.9, 1.3);
  const shellMat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  model.bob.position.y = 0.38;
  const b = model.bob;

  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), shellMat);
  shell.scale.set(0.85, 0.85, 1.05);
  shell.castShadow = true;
  b.add(shell);
  b.add(ball(darkMat, 0.5, 0, 0.0, 0, 0.82, 0.25, 1.0)); // belly
  const seam = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 1.05), darkMat);
  seam.position.set(0, 0.46, -0.05);
  seam.rotation.x = 0.0;
  b.add(seam);
  for (const [x, z] of [[0.2, 0.15], [-0.22, -0.2], [0.18, -0.32], [-0.15, 0.22]]) {
    b.add(ball(darkMat, 0.07, x, 0.36, z, 1, 0.5, 1)); // spots
  }
  b.add(ball(darkMat, 0.22, 0, 0.06, 0.56)); // head
  for (const s of [-1, 1]) {
    b.add(ball(white, 0.07, s * 0.1, 0.14, 0.72));
    b.add(ball(black, 0.04, s * 0.11, 0.15, 0.77));
  }
  addLegs(model, b, darkMat, [0.25, 0.02, -0.22], 0.3, 0.75);
  return model;
}

const swingQ = new THREE.Quaternion();
const openQ = new THREE.Quaternion();

/**
 * Stride length in body lengths, from TRADDOMIUM's fauna/gait.ts: insects
 * take SHORTER strides when they walk slower (Mendes et al. 2013), so slow
 * walkers step more often instead of looking like slow motion.
 * Full stride 0.4 bodies at 2.5 body-lengths/s, never under 35% of that.
 */
function strideLengths(bodyLengthsPerS: number) {
  return 0.4 * THREE.MathUtils.clamp(bodyLengthsPerS / 2.5, 0.35, 1);
}

/** Call every frame. `speed` is 0 when standing still (world units / s). */
export function animateCreature(m: CreatureModel, dt: number, speed: number) {
  // LOD: off-screen bugs skip their leg math entirely; far ones update every
  // third frame (with 3x the time step, so they still move at the right pace).
  if (!m.root.visible) return;
  if (m.root.userData.lodFar) {
    m.root.userData.lodDt = (m.root.userData.lodDt ?? 0) + dt;
    m.root.userData.lodN = ((m.root.userData.lodN ?? 0) + 1) % 3;
    if (m.root.userData.lodN !== 0) return;
    dt = m.root.userData.lodDt;
    m.root.userData.lodDt = 0;
  }
  const moving = speed > 0.1 && !m.flying;
  // Blend smoothly in/out of the walk so legs don't snap.
  m.walkBlend += ((moving ? 1 : 0) - m.walkBlend) * Math.min(1, dt * 10);
  // The gait runs on DISTANCE walked (TRADDOMIUM's rule): stop walking = feet stop.
  const bl = speed / m.length;
  if (moving) m.walkT += dt * ((Math.PI * 2 * bl) / (m.stride ?? strideLengths(bl)));

  if (m.biped) {
    animateBiped(m, m.biped, dt);
    return;
  }
  if (m.anim) {
    // Built-in clips: walk, or run when fast; nearly still when idle (the
    // file has no idle clip, and its rest pose has the wings stuck out).
    const a = m.anim;
    const running = speed > m.length * 2.2;
    const w = running ? 0 : 1;
    a.walk.setEffectiveWeight(a.walk.getEffectiveWeight() + (w - a.walk.getEffectiveWeight()) * Math.min(1, dt * 8));
    a.run.setEffectiveWeight(1 - a.walk.getEffectiveWeight());
    const pace = THREE.MathUtils.clamp(speed / (m.length * 1.1), 0.5, 2.2);
    a.walk.timeScale = a.run.timeScale = moving ? pace : 0.15;
    a.mixer.update(dt);
    return;
  }

  // Wings: open + buzz while flying, fold back down when landed.
  m.wingOpen += ((m.flying ? 1 : 0) - m.wingOpen) * Math.min(1, dt * 12);
  if (m.wings.length) {
    const beat = Math.sin(performance.now() * 0.06) * 0.55 * m.wingOpen;
    for (const w of m.wings) {
      openQ.setFromAxisAngle(w.up, -w.side * 1.0 * m.wingOpen);
      swingQ.setFromAxisAngle(w.fwd, w.side * beat);
      w.bone.quaternion.copy(w.base).multiply(openQ).multiply(swingQ);
    }
  }
  m.legs.forEach((leg, i) => {
    const angle = Math.sin(m.walkT + m.legPhase[i]) * (m.legAmps?.[i] ?? m.legAmp) * m.walkBlend;
    swingQ.setFromAxisAngle(m.legAxis[i], angle);
    leg.quaternion.copy(m.legBase[i]).multiply(swingQ);
  });
  const baseY = m.bob.userData.baseY ?? (m.bob.userData.baseY = m.bob.position.y);
  m.bob.position.y = baseY + Math.abs(Math.sin(m.walkT)) * 0.04 * m.walkBlend;
  m.extra?.(dt);
}

const jointQ = new THREE.Quaternion();
function turn(j: Joint, angle: number) {
  jointQ.setFromAxisAngle(j.axis, angle);
  j.bone.quaternion.copy(j.base).multiply(jointQ);
}

/**
 * A human walk cycle. `u` runs 0..1 per cycle (two steps):
 *   STANCE (first half): the foot is planted and moves straight back under
 *     the hip at exactly walking speed (so it never slides on the floor)
 *   SWING (second half): the knee bends to lift the foot as it swings forward
 * Arms swing opposite to the leg on their side with a soft elbow, or, while
 * carrying, reach out front with bent elbows to hold the stack.
 * Rotations: + around the side axis tips a limb BACKWARD, - FORWARD.
 */
function animateBiped(m: CreatureModel, b: Biped, dt: number) {
  b.holdBlend += ((m.holding ? 1 : 0) - b.holdBlend) * Math.min(1, dt * 8);
  const w = m.walkBlend;
  const hb = b.holdBlend;
  const cycle = m.walkT / (Math.PI * 2);
  for (const limb of b.limbs) {
    const u = (((cycle + limb.phase) % 1) + 1) % 1;
    // Foot position along the walk direction, -1 (behind) .. +1 (in front)
    const s = u < 0.5 ? 1 - 4 * u : -Math.cos((u - 0.5) * 2 * Math.PI);
    if (!limb.arm) {
      const reach = THREE.MathUtils.clamp((s * b.step) / b.legLen, -0.95, 0.95);
      turn(limb.hip, -Math.asin(reach) * w);
      // Knee lifts the foot during the swing (peaks mid-swing)
      if (limb.mid) turn(limb.mid, u < 0.5 ? 0.04 * w : Math.sin((u - 0.5) * 2 * Math.PI) * 1.05 * w);
    } else {
      // Swing: forward when the same-side leg is back (phase is offset by half)
      const swing = -s * 0.32 * w;
      turn(limb.hip, swing * (1 - hb) + HOLD_SHOULDER * hb);
      if (limb.mid) turn(limb.mid, -0.18 * (1 - hb) + HOLD_ELBOW * hb);
    }
  }
  // Two small bobs per cycle (one per step)
  const baseY = m.bob.userData.baseY ?? (m.bob.userData.baseY = m.bob.position.y);
  m.bob.position.y = baseY + Math.abs(Math.sin(m.walkT)) * m.height * 0.012 * w;
}
/** Carrying pose: upper arm a little forward, forearm out level to grip the stack. */
const HOLD_SHOULDER = -0.5;
const HOLD_ELBOW = -1.05;

/** Smoothly turn a creature to face a direction (x, z). */
export function faceToward(m: CreatureModel, dx: number, dz: number, dt: number, turnSpeed = 12) {
  if (dx * dx + dz * dz < 1e-6) return;
  const target = Math.atan2(dx, dz);
  let diff = target - m.root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way around
  m.root.rotation.y += diff * Math.min(1, dt * turnSpeed);
}

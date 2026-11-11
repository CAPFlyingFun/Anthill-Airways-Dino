// ============================================================================
// rex.ts — the LAVA REX: a procedural Tyrannosaurus built from simple shapes
// (until a real model is ready), with glowing lava cracks down its back.
//
// It plugs into the same CreatureModel as every other creature, so stepTo(),
// Worker and animateCreature() all work on it:
//   legs   = 2 hip pivots that swing forward/back (the generic leg code)
//   extra  = knees, a swaying tail, a bobbing head and the ROAR
//
// Everything is measured in body lengths (L), nose to tail tip, facing +z.
// ============================================================================
import * as THREE from 'three';
import { CreatureModel, newModel } from './models';

const sphere = new THREE.SphereGeometry(1, 16, 12);
const cone = new THREE.ConeGeometry(1, 1, 8);

/** A stretched sphere (ellipsoid) part. */
function blob(m: THREE.Material, rx: number, ry: number, rz: number, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(sphere, m);
  b.scale.set(rx, ry, rz);
  b.position.set(x, y, z);
  b.castShadow = true;
  return b;
}

export interface RexParts {
  head: THREE.Group;
  jaw: THREE.Group;
  neck: THREE.Group;
  tail: THREE.Group[];
  knees: THREE.Group[];
  /** Seconds left in the current roar (0 = not roaring). */
  roar: number;
  t: number;
  glow: THREE.MeshStandardMaterial;
}

/**
 * Build a Lava Rex `length` units from nose to tail tip.
 * `tame` gives it a saddle (once you've tamed it, ARK style).
 */
export function makeRex(length: number, tame = false): CreatureModel & { rex: RexParts } {
  const L = length;
  const model = newModel(0.45 * L, L) as CreatureModel & { rex: RexParts };
  const skin = new THREE.MeshStandardMaterial({ color: 0x2f2724, roughness: 0.85 });
  const belly = new THREE.MeshStandardMaterial({ color: 0x5a4136, roughness: 0.9 });
  const glow = new THREE.MeshStandardMaterial({ color: 0x5a1606, roughness: 0.6, emissive: 0xff5a12, emissiveIntensity: 1.4 });
  const tooth = new THREE.MeshStandardMaterial({ color: 0xf2ead8, roughness: 0.5 });
  const b = model.bob;
  b.position.y = -0.012 * L; // plant the feet on the ground

  // --- Body: a big barrel tipped slightly nose-up, belly underneath ---------
  const torso = blob(skin, 0.1 * L, 0.115 * L, 0.2 * L, 0, 0.31 * L, 0.04 * L);
  torso.rotation.x = -0.12;
  b.add(torso);
  b.add(blob(belly, 0.085 * L, 0.08 * L, 0.16 * L, 0, 0.27 * L, 0.07 * L));
  // Lava cracks + spikes along the spine
  for (let i = 0; i < 5; i++) {
    const z = -0.1 * L + i * 0.065 * L;
    const crack = blob(glow, 0.012 * L, 0.006 * L, 0.03 * L, 0, 0.42 * L - Math.abs(z - 0.02 * L) * 0.35, z);
    b.add(crack);
    const spike = new THREE.Mesh(cone, i % 2 ? glow : skin);
    spike.scale.set(0.018 * L, 0.05 * L, 0.018 * L);
    spike.position.set(0, 0.44 * L - Math.abs(z - 0.02 * L) * 0.35, z + 0.015 * L);
    spike.rotation.x = -0.4;
    b.add(spike);
  }
  if (tame) {
    // A riding saddle (red, with gold trim) = tamed
    const saddle = blob(new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 }), 0.07 * L, 0.025 * L, 0.08 * L, 0, 0.42 * L, 0.02 * L);
    b.add(saddle);
  }

  // --- Neck + head (the head group pivots for bobbing and the roar) ---------
  const neck = new THREE.Group();
  neck.position.set(0, 0.36 * L, 0.2 * L);
  b.add(neck);
  const neckMesh = blob(skin, 0.06 * L, 0.075 * L, 0.09 * L, 0, 0.02 * L, 0.03 * L);
  neckMesh.rotation.x = -0.6;
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.set(0, 0.06 * L, 0.08 * L);
  neck.add(head);
  head.add(blob(skin, 0.058 * L, 0.06 * L, 0.1 * L, 0, 0.01 * L, 0.06 * L)); // skull + snout
  head.add(blob(skin, 0.045 * L, 0.035 * L, 0.06 * L, 0, 0.0, 0.13 * L));    // nose
  for (const s of [-1, 1]) {
    head.add(blob(glow, 0.012 * L, 0.012 * L, 0.012 * L, s * 0.045 * L, 0.035 * L, 0.09 * L)); // glowing eyes
    head.add(blob(skin, 0.02 * L, 0.012 * L, 0.03 * L, s * 0.04 * L, 0.055 * L, 0.08 * L));  // brow ridge
  }
  // Upper teeth
  for (let i = 0; i < 4; i++) {
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(cone, tooth);
      t.scale.set(0.006 * L, 0.018 * L, 0.006 * L);
      t.rotation.x = Math.PI;
      t.position.set(s * 0.035 * L, -0.02 * L, 0.08 * L + i * 0.022 * L);
      head.add(t);
    }
  }
  // Lower jaw (opens for the roar)
  const jaw = new THREE.Group();
  jaw.position.set(0, -0.02 * L, 0.02 * L);
  head.add(jaw);
  jaw.add(blob(belly, 0.045 * L, 0.02 * L, 0.095 * L, 0, -0.012 * L, 0.08 * L));

  // --- Tiny arms --------------------------------------------------------------
  for (const s of [-1, 1]) {
    const arm = blob(skin, 0.014 * L, 0.014 * L, 0.045 * L, s * 0.075 * L, 0.27 * L, 0.2 * L);
    arm.rotation.x = 0.7;
    b.add(arm);
  }

  // --- Tail: 6 segments, each a child of the last so the sway ripples -------
  const tail: THREE.Group[] = [];
  let parent: THREE.Object3D = b;
  let r = 0.08;
  for (let i = 0; i < 6; i++) {
    const seg = new THREE.Group();
    seg.position.set(0, i === 0 ? 0.32 * L : -0.004 * L, i === 0 ? -0.14 * L : -0.075 * L);
    seg.rotation.x = 0.05; // droops a little toward the tip
    seg.add(blob(skin, r * L, r * 0.95 * L, 0.06 * L, 0, 0, -0.035 * L));
    if (i < 4) seg.add(blob(glow, 0.008 * L, 0.005 * L, 0.02 * L, 0, r * 0.95 * L, -0.03 * L));
    parent.add(seg);
    tail.push(seg);
    parent = seg;
    r *= 0.74;
  }

  // --- Legs: hip (swings) -> knee (bends) -> foot -----------------------------
  const knees: THREE.Group[] = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(s * 0.085 * L, 0.27 * L, -0.02 * L);
    b.add(hip);
    hip.add(blob(skin, 0.05 * L, 0.1 * L, 0.07 * L, 0, -0.06 * L, 0.02 * L)); // thigh
    const knee = new THREE.Group();
    knee.position.set(0, -0.13 * L, 0.035 * L);
    hip.add(knee);
    const shin = blob(skin, 0.026 * L, 0.07 * L, 0.03 * L, 0, -0.05 * L, -0.02 * L);
    shin.rotation.x = 0.35;
    knee.add(shin);
    const foot = blob(belly, 0.035 * L, 0.014 * L, 0.06 * L, 0, -0.115 * L, 0.0);
    knee.add(foot);
    for (const tx of [-1, 0, 1]) {
      const claw = new THREE.Mesh(cone, tooth);
      claw.scale.set(0.008 * L, 0.02 * L, 0.008 * L);
      claw.rotation.x = Math.PI / 2;
      claw.position.set(tx * 0.018 * L, -0.118 * L, 0.06 * L);
      knee.add(claw);
    }
    knees.push(knee);
    model.legs.push(hip);
    model.legBase.push(hip.quaternion.clone());
    model.legAxis.push(new THREE.Vector3(1, 0, 0)); // swing forward / back
    model.legPhase.push(s < 0 ? 0 : Math.PI);       // left, right, left, right
  }
  model.legAmp = 0.42;
  model.stride = 0.5; // body lengths per full stride (two steps)

  const parts: RexParts = { head, jaw, neck, tail, knees, roar: 0, t: Math.random() * 10, glow };
  model.rex = parts;

  // --- The extra animation: knees, tail sway, head bob, roar -----------------
  model.extra = (dt) => {
    parts.t += dt;
    const w = model.walkBlend;
    model.legs.forEach((_, i) => {
      // Knee bends while that foot swings forward (lifting it off the ground)
      const ph = model.walkT + model.legPhase[i];
      knees[i].rotation.x = 0.15 + Math.max(0, Math.cos(ph)) * 0.55 * w;
    });
    // Tail sways side to side (faster when walking); each segment lags the last
    tail.forEach((seg, i) => {
      seg.rotation.y = Math.sin(parts.t * (1.2 + w * 1.6) - i * 0.6) * (0.05 + 0.04 * w);
    });
    // Glow pulses like breathing lava
    glow.emissiveIntensity = 1.1 + Math.sin(parts.t * 2.2) * 0.35;
    // Head: bobs with the steps, or rears up for a ROAR
    if (parts.roar > 0) {
      parts.roar = Math.max(0, parts.roar - dt);
      const k = Math.sin(Math.min(1, (1.6 - parts.roar) / 1.6) * Math.PI); // 0 -> 1 -> 0
      neck.rotation.x = -0.45 * k;
      jaw.rotation.x = 0.75 * k + Math.sin(parts.t * 40) * 0.04 * k; // shaking jaw
      head.rotation.z = Math.sin(parts.t * 30) * 0.03 * k;
    } else {
      neck.rotation.x = Math.sin(model.walkT * 2) * 0.05 * w + Math.sin(parts.t * 0.8) * 0.03;
      jaw.rotation.x = 0.05 + Math.max(0, Math.sin(parts.t * 0.5)) * 0.05;
      head.rotation.z = 0;
    }
  };
  return model;
}

/** Start a roar (about 1.6 s). */
export function roar(m: CreatureModel & { rex: RexParts }) {
  if (m.rex.roar <= 0) m.rex.roar = 1.6;
}

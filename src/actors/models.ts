// ============================================================================
// models.ts — the creatures, built from simple shapes in code.
// (Later these can be swapped for MeshyAI .glb models without changing the
// game logic, because everything else only talks to `root`, `bob` and legs.)
//
// Every creature faces +z ("forward"). Its 6 legs walk in a tripod gait:
// legs A (front-left, middle-right, back-left) swing while B rest, then swap.
// ============================================================================
import * as THREE from 'three';

export interface CreatureModel {
  root: THREE.Group;      // move/rotate this
  bob: THREE.Group;       // the body; bounces while walking; stacks attach here
  legs: THREE.Object3D[];
  legBase: number[];      // resting angle of each leg
  legPhase: number[];     // 0 or PI (tripod groups)
  walkT: number;
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
      model.legBase.push(base);
      // Tripod gait: front-left, middle-right, back-left move together.
      const groupA = (row % 2 === 0) === (side === -1);
      model.legPhase.push(groupA ? 0 : Math.PI);
    }
  });
}

/** An ant. `cap` gives it the player's blue pilot cap and goggles. */
export function makeAnt(color = 0x8e2f14, cap = false): CreatureModel {
  const model: CreatureModel = { root: new THREE.Group(), bob: new THREE.Group(), legs: [], legBase: [], legPhase: [], walkT: Math.random() * 10 };
  const body = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 });
  model.bob.position.y = 0.45;
  model.root.add(model.bob);
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
  const model: CreatureModel = { root: new THREE.Group(), bob: new THREE.Group(), legs: [], legBase: [], legPhase: [], walkT: Math.random() * 10 };
  const shellMat = new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.5 });
  model.bob.position.y = 0.38;
  model.root.add(model.bob);
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

/** Call every frame. `speed` is 0 when standing still. */
export function animateCreature(m: CreatureModel, dt: number, speed: number) {
  const moving = speed > 0.1;
  m.walkT += dt * (moving ? 9 + speed * 1.2 : 0);
  m.legs.forEach((leg, i) => {
    const target = m.legBase[i] + (moving ? Math.sin(m.walkT + m.legPhase[i]) * 0.5 : 0);
    leg.rotation.y += (target - leg.rotation.y) * Math.min(1, dt * 20);
  });
  const baseY = m.bob.userData.baseY ?? (m.bob.userData.baseY = m.bob.position.y);
  m.bob.position.y = baseY + (moving ? Math.abs(Math.sin(m.walkT)) * 0.05 : 0);
}

/** Smoothly turn a creature to face a direction (x, z). */
export function faceToward(m: CreatureModel, dx: number, dz: number, dt: number, turnSpeed = 12) {
  if (dx * dx + dz * dz < 1e-6) return;
  const target = Math.atan2(dx, dz);
  let diff = target - m.root.rotation.y;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // shortest way around
  m.root.rotation.y += diff * Math.min(1, dt * turnSpeed);
}

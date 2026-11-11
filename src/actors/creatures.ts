// ============================================================================
// creatures.ts — loads the real 3D bug models (.glb) from public/models and
// makes walking copies of them.
//
// The models come from Thronemound (fire ant Queen / Major / Worker, larva,
// aphid, housefly, earthworm, props) and the TRADDOMIUM releases (Black Widow,
// Jumping Spider, and the Modelsv1 release: Huntsman, Wolf Spider and the
// Ant-Mimicking Spider). They're rigged but have no animations, so this file finds
// the leg bones automatically and swings them in code:
//
//   1. Find "limbs": chains of bones that branch off the body.
//   2. Legs = limbs whose tip ends near the ground and out to the side
//      (antennae point up, so they're skipped).
//   3. Each leg swings around the "up" axis, alternating left/right.
//
// If a model fails to load, the game falls back to the simple shape-built bugs.
// ============================================================================
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { CreatureModel, newModel } from './models';

export const CREATURES = [
  'worker', 'major', 'queen', 'larva', 'aphid', 'housefly', 'earthworm',
  'black-widow', 'jumping-spider', 'huntsman', 'wolf-spider', 'ant-mimic',
] as const;
export const PROPS = ['dirt-clod', 'rock-model', 'twig-model'] as const;
export type CreatureKind = (typeof CREATURES)[number];
export type PropKind = (typeof PROPS)[number];

// Models that face backward in their file get turned around.
const FLIP: Record<string, boolean> = {};

// Wing root bones, from TRADDOMIUM's docs/research/creature-lab/rigs.md
// (the housefly's pair rests folded back along the abdomen).
const WING_BONES: Record<string, string[]> = { housefly: ['Bone_022', 'Bone_024'] };

// Leg bones to ignore. TMB-Story's fix-jumping-spider-legs.mjs hides the
// Meshy spider's extra hind leg (Bone_058's chain); its bones are still in
// the file, so don't count it as a leg.
const SKIP_LEGS: Record<string, string[]> = { 'jumping-spider': ['Bone_058'] };

const templates = new Map<string, THREE.Group>();

/** Load every model once. `onProgress` drives the loading bar. */
export async function loadModels(onProgress: (done: number, total: number) => void) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const names = [...CREATURES, ...PROPS];
  let done = 0;
  await Promise.all(
    names.map(async (name) => {
      try {
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
        templates.set(name, normalize(gltf.scene, name));
      } catch (e) {
        console.warn(`Model "${name}" failed to load, using fallback`, e);
      }
      onProgress(++done, names.length);
    }),
  );
}

export function hasModel(name: string) {
  return templates.has(name);
}

/**
 * Make every model the same size (1 unit long), centered, standing on y = 0,
 * facing +z. Then the game can just scale it to the length it wants.
 */
function normalize(scene: THREE.Object3D, name: string): THREE.Group {
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh) {
      mesh.castShadow = true;
      mesh.frustumCulled = false; // skinned meshes can be culled wrongly after scaling
    }
  });
  if (FLIP[name]) scene.rotation.y = Math.PI;
  const wrap = new THREE.Group();
  wrap.add(scene);
  wrap.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  scene.scale.multiplyScalar(1 / Math.max(size.x, size.z));
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.x -= center.x;
  scene.position.z -= center.z;
  scene.position.y -= box.min.y;
  wrap.userData.height = box.max.y - box.min.y;
  return wrap;
}

/** A static prop (rock, twig, dirt clod), `length` units long. */
export function spawnProp(name: PropKind, length: number): THREE.Object3D | null {
  const t = templates.get(name);
  if (!t) return null;
  const p = t.clone();
  p.scale.setScalar(length);
  return p;
}

/** A walking creature, `length` units nose to tail. Null if the model is missing. */
export function spawnCreature(name: CreatureKind, length: number): CreatureModel | null {
  const t = templates.get(name);
  if (!t) return null;
  const inst = cloneSkinned(t) as THREE.Group;
  inst.scale.setScalar(length);
  const model = newModel((t.userData.height as number) * length, length);
  model.legAmp = 0.32;
  model.bob.add(inst);
  findLegs(model, SKIP_LEGS[name] ?? []);
  findWings(model, name);
  return model;
}

/** Hook up the named wing bones so they can open and buzz in flight. */
function findWings(model: CreatureModel, name: string) {
  const names = WING_BONES[name];
  if (!names) return;
  model.root.updateMatrixWorld(true);
  const wq = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  for (const n of names) {
    const bone = model.root.getObjectByName(n);
    if (!bone) continue;
    bone.getWorldQuaternion(wq);
    bone.getWorldPosition(pos);
    const inv = wq.clone().invert();
    model.wings.push({
      bone,
      base: bone.quaternion.clone(),
      up: new THREE.Vector3(0, 1, 0).applyQuaternion(inv).normalize(),
      fwd: new THREE.Vector3(0, 0, 1).applyQuaternion(inv).normalize(),
      side: pos.x < 0 ? -1 : 1,
    });
  }
}

/** Find the leg bones in a model's skeleton (see the notes at the top). */
function findLegs(model: CreatureModel, skip: string[] = []) {
  model.root.updateMatrixWorld(true);
  let skinned: THREE.SkinnedMesh | null = null;
  model.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) return;
  const bones = (skinned as THREE.SkinnedMesh).skeleton.bones;
  const boneKids = (b: THREE.Object3D) => b.children.filter((c) => (c as THREE.Bone).isBone);

  // A limb is a simple chain: each bone has at most one bone child.
  const chainFrom = (b: THREE.Object3D): THREE.Object3D[] | null => {
    const out = [b];
    let cur = b;
    for (;;) {
      const kids = boneKids(cur);
      if (kids.length === 0) return out;
      if (kids.length > 1) return null;
      cur = kids[0];
      out.push(cur);
    }
  };

  const root = new THREE.Vector3();
  const tip = new THREE.Vector3();
  type Leg = { bone: THREE.Object3D; x: number; z: number };
  const legs: Leg[] = [];
  for (const b of bones) {
    const parent = b.parent;
    if (skip.includes(b.name)) continue;
    if (!parent || !(parent as THREE.Bone).isBone || boneKids(parent).length < 2) continue;
    const chain = chainFrom(b);
    if (!chain || chain.length < 3) continue;
    b.getWorldPosition(root);
    chain[chain.length - 1].getWorldPosition(tip);
    const nearGround = tip.y < model.height * 0.35 && tip.y < root.y;
    const outToSide = Math.abs(tip.x) > model.length * 0.08; // tucked front legs count too (wolf spider)
    if (nearGround && outToSide) legs.push({ bone: b, x: root.x, z: root.z });
  }
  if (legs.length < 4) return; // couldn't find a sensible set; it'll just glide + bob

  const up = new THREE.Vector3(0, 1, 0);
  const wq = new THREE.Quaternion();
  for (const side of [-1, 1]) {
    legs
      .filter((l) => Math.sign(l.x) === side)
      .sort((a, b) => b.z - a.z) // front to back
      .forEach((l, i) => {
        l.bone.getWorldQuaternion(wq);
        model.legs.push(l.bone);
        model.legBase.push(l.bone.quaternion.clone());
        model.legAxis.push(up.clone().applyQuaternion(wq.invert()).normalize());
        model.legPhase.push(((i + (side > 0 ? 1 : 0)) % 2) * Math.PI); // alternating gait
      });
  }
}

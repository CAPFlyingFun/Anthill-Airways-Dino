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
import { BipedLimb, CreatureModel, Joint, LEG_SWING, newModel } from './models';
import { lod } from '../core/lod';

export const CREATURES = [
  'worker', 'major', 'queen', 'larva', 'aphid', 'housefly', 'earthworm',
  'black-widow', 'jumping-spider', 'huntsman', 'wolf-spider', 'ant-mimic',
] as const;
export const PROPS = ['dirt-clod', 'rock-model', 'twig-model'] as const;
/**
 * Humans (Act 2), from the TRADDOMIUM "Modelsv1" release, compressed to
 * phone size. Jack + Sarah are the TMB leads; the rest are crew/passengers.
 */
export const HUMANS = ['h-jack', 'h-sarah', 'h-director', 'h-exec', 'h-balance', 'h-ember', 'h-crew1', 'h-crew2', 'h-crew3', 'h-crew4'] as const;
export type HumanKind = (typeof HUMANS)[number];
/**
 * Act 3 (Dino Island), from the Beyond-Extinction repo's models folder,
 * shrunk to phone size: the Dodo (with its own Walking/Running animations),
 * the Dilophosaurus, 5 sea creatures, and 5 kinds of island trees.
 */
export const ISLAND = [
  'd-dodo', 'd-dilo',
  's-mosasaurus', 's-megalodon', 's-ichthyo', 's-sarco', 's-deino',
  't-palm', 't-fern', 't-banyan', 't-monkeypuzzle', 't-conifer',
] as const;
export type IslandKind = (typeof ISLAND)[number];
export type DinoKind = 'd-dodo' | 'd-dilo';
export type SeaKind = 's-mosasaurus' | 's-megalodon' | 's-ichthyo' | 's-sarco' | 's-deino';
export type TreeKind = 't-palm' | 't-fern' | 't-banyan' | 't-monkeypuzzle' | 't-conifer';
/** Built-in animations of models that have them (the Dodo). */
const clips = new Map<string, THREE.AnimationClip[]>();
/** Bump this whenever the people .glb files are replaced (busts phone caches). */
const HUMAN_REV = 2;
/** Same, for the island models. */
const ISLAND_REV = 1;
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

/** Load every bug + prop model once. `onProgress` drives the loading bar. */
export function loadModels(onProgress: (done: number, total: number) => void) {
  return loadList([...CREATURES, ...PROPS], onProgress);
}

let humansLoading: Promise<void> | null = null;
/**
 * The people (~11 MB) are only downloaded once you reach Act 2, so Act 1
 * starts fast on phones. Safe to call more than once.
 */
export function loadHumans(onProgress: (done: number, total: number) => void = () => {}) {
  humansLoading ??= loadList([...HUMANS], onProgress);
  return humansLoading;
}

let islandLoading: Promise<void> | null = null;
/** The island's dinos, sea creatures and trees (~5 MB): only when you go there. */
export function loadIsland(onProgress: (done: number, total: number) => void = () => {}) {
  islandLoading ??= loadList([...ISLAND], onProgress);
  return islandLoading;
}

async function loadList(names: string[], onProgress: (done: number, total: number) => void) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  await Promise.all(
    names.map(async (name) => {
      try {
        // People get a revision tag so phones re-download them when the files change.
        const rev = name.startsWith('h-') ? `?rev=${HUMAN_REV}` : (ISLAND as readonly string[]).includes(name) ? `?rev=${ISLAND_REV}` : '';
        const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb${rev}`);
        templates.set(name, normalize(gltf.scene, name));
        if (gltf.animations.length) clips.set(name, gltf.animations);
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
      // People: their exported materials are "metallic", which renders almost
      // black without reflections. Make them matte cloth/skin instead (and
      // drop the metal/roughness texture: less memory on phones).
      if (name.startsWith('h-')) {
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.metalnessMap?.dispose();
        m.metalnessMap = null;
        m.roughnessMap = null;
        m.metalness = 0;
        m.roughness = 0.85;
        m.needsUpdate = true;
      }
    }
  });
  // Trees never move, but they come rigged: swap each skinned mesh for a plain
  // one (no per-vertex bone math every frame = much cheaper on phones).
  if (name.startsWith('t-')) {
    scene.updateMatrixWorld(true);
    const swaps: THREE.SkinnedMesh[] = [];
    scene.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) swaps.push(o as THREE.SkinnedMesh);
    });
    for (const sk of swaps) {
      // In its rest pose a skinned mesh draws its vertices exactly where a
      // plain mesh would, so the plain one simply takes its place.
      const geo = sk.geometry.clone();
      geo.deleteAttribute('skinIndex');
      geo.deleteAttribute('skinWeight');
      const plain = new THREE.Mesh(geo, sk.material);
      plain.castShadow = true;
      plain.receiveShadow = true;
      plain.position.copy(sk.position);
      plain.quaternion.copy(sk.quaternion);
      plain.scale.copy(sk.scale);
      sk.parent!.add(plain);
      sk.removeFromParent();
    }
  }
  if (FLIP[name]) scene.rotation.y = Math.PI;
  const wrap = new THREE.Group();
  wrap.add(scene);
  wrap.updateMatrixWorld(true);
  const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
  // Bugs, dinos, sea creatures: 1 unit long. Humans + trees: 1 unit TALL.
  const tall = name.startsWith('h-') || name.startsWith('t-');
  scene.scale.multiplyScalar(1 / (tall ? size.y : Math.max(size.x, size.z)));
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
  lod.add(p, length);
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

// ============================================================================
// HUMANS: the models come in a T-pose (arms straight out). We find the leg
// and arm bones the same way as the bugs' legs, then:
//   • lower each arm to the side (a fixed rotation added to its rest pose)
//   • remember hip + knee and shoulder + elbow of each limb
// models.ts (animateBiped) then walks them: planted feet that don't slide,
// knees that lift the foot, arms that swing (or hold what they carry).
// ============================================================================

/** A walking human `height` units tall. Null if the model is missing. */
export function spawnHuman(name: HumanKind, height: number): CreatureModel | null {
  const t = templates.get(name);
  if (!t) return null;
  const inst = cloneSkinned(t) as THREE.Group;
  inst.scale.setScalar(height);
  const model = newModel(height, height * 0.3);
  model.length = height; // gait math uses body length; for people that's height
  model.bob.add(inst);
  findHumanLimbs(model);
  return model;
}

/**
 * A dinosaur, `length` nose to tail.
 *  • Dodo: plays its own Walking clip (faster/slower with its speed).
 *  • Dilophosaurus: no animations in the file, so it walks with the same
 *    two-legged gait as the people (planted feet, bending knees).
 */
export function spawnDino(name: DinoKind, length: number): CreatureModel | null {
  const t = templates.get(name);
  if (!t) return null;
  const inst = cloneSkinned(t) as THREE.Group;
  inst.scale.setScalar(length);
  const model = newModel((t.userData.height as number) * length, length);
  model.bob.add(inst);
  const list = clips.get(name);
  if (list?.length) {
    const mixer = new THREE.AnimationMixer(inst);
    const walk = mixer.clipAction(list.find((c) => /walk/i.test(c.name)) ?? list[0]);
    const run = mixer.clipAction(list.find((c) => /run/i.test(c.name)) ?? list[0]);
    walk.play();
    run.play();
    run.setEffectiveWeight(0);
    walk.time = Math.random() * walk.getClip().duration; // don't all step in sync
    model.anim = { mixer, walk, run };
  } else {
    findHumanLimbs(model);
  }
  return model;
}

/** A sea creature (swims in code: no legs to animate). */
export function spawnSea(name: SeaKind, length: number): CreatureModel | null {
  const t = templates.get(name);
  if (!t) return null;
  const inst = cloneSkinned(t) as THREE.Group;
  inst.scale.setScalar(length);
  const model = newModel((t.userData.height as number) * length, length);
  model.bob.add(inst);
  return model;
}

/** A tree, `height` tall (scenery: no animation). */
export function spawnTree(name: TreeKind, height: number): THREE.Object3D | null {
  const t = templates.get(name);
  if (!t) return null;
  const tree = t.clone(); // plain meshes now: a cheap clone sharing the geometry
  tree.scale.setScalar(height);
  tree.rotation.y = Math.random() * Math.PI * 2;
  lod.add(tree, height * 0.6);
  return tree;
}

function findHumanLimbs(model: CreatureModel) {
  model.root.updateMatrixWorld(true);
  let skinned: THREE.SkinnedMesh | null = null;
  model.root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !skinned) skinned = o as THREE.SkinnedMesh;
  });
  if (!skinned) return;
  const bones = (skinned as THREE.SkinnedMesh).skeleton.bones;
  const H = model.height;
  const kids = (b: THREE.Object3D) => b.children.filter((c) => (c as THREE.Bone).isBone);
  const chainFrom = (b: THREE.Object3D) => {
    const out = [b];
    let cur = b;
    for (;;) {
      const k = kids(cur);
      if (k.length !== 1) return { out, simple: k.length === 0 };
      cur = k[0];
      out.push(cur);
    }
  };
  const root = new THREE.Vector3();
  const tip = new THREE.Vector3();
  type Limb = { bone: THREE.Object3D; side: number; arm: boolean; drop?: number };
  const limbs: Limb[] = [];
  for (const b of bones) {
    const parent = b.parent;
    if (!parent || !(parent as THREE.Bone).isBone || kids(parent).length < 2) continue;
    const { out, simple } = chainFrom(b);
    if (out.length < 3) continue;
    b.getWorldPosition(root);
    out[out.length - 1].getWorldPosition(tip);
    const isLeg = tip.y < H * 0.2 && root.y > H * 0.35;
    // Arms end out to the side at shoulder height (hands may branch into fingers: not "simple").
    const isArm = Math.abs(tip.x - root.x) > H * 0.15 && tip.y > H * 0.6 && root.y > H * 0.6;
    if (isLeg && simple) limbs.push({ bone: b, side: Math.sign(tip.x) || 1, arm: false });
    else if (isArm) limbs.push({ bone: b, side: Math.sign(tip.x) || 1, arm: true });
  }
  // Keep the top-most bone of each arm chain (a shoulder AND an elbow can both qualify).
  const arms = limbs.filter((l) => l.arm);
  const topArms = arms.filter((a) => !arms.some((o) => o !== a && isAncestor(o.bone, a.bone)));
  // The top-most arm bone is the COLLARBONE, which starts at the neck. Bending
  // there folds the whole shoulder into the chest (the "crossed shoulders"
  // bug). Walk out to the real shoulder joint (the first bone that sits out
  // at the side of the body) and bend there instead.
  const center = new THREE.Vector3();
  model.root.getWorldPosition(center);
  for (const a of topArms) {
    let b = a.bone;
    for (;;) {
      b.getWorldPosition(root);
      const k = kids(b);
      if (Math.abs(root.x - center.x) >= H * 0.07 || k.length !== 1) break;
      b = k[0];
    }
    a.bone = b;
    // How far the arm already slopes down in its T-pose (rigs differ a bit),
    // measured from the shoulder to the wrist.
    let w = b;
    while (kids(w).length === 1) w = kids(w)[0];
    w.getWorldPosition(tip);
    a.drop = Math.atan2(root.y - tip.y, Math.abs(tip.x - root.x));
  }
  const legs = limbs.filter((l) => !l.arm);

  // 1) Lower each arm from the T-pose to hang at the side.
  const wq = new THREE.Quaternion();
  const fwd = new THREE.Vector3(0, 0, 1);
  const lower = new THREE.Quaternion();
  for (const a of topArms) {
    a.bone.getWorldQuaternion(wq);
    const fwdLocal = fwd.clone().applyQuaternion(wq.invert()).normalize();
    lower.setFromAxisAngle(fwdLocal, -a.side * (ARM_DOWN - (a.drop ?? 0)));
    a.bone.quaternion.multiply(lower);
  }
  model.root.updateMatrixWorld(true); // so elbows etc. see the lowered arms

  // 2) Every joint swings around the body's side-to-side axis (world X),
  //    expressed in that bone's own space.
  const side = new THREE.Vector3(1, 0, 0);
  const joint = (bone: THREE.Object3D): Joint => {
    bone.getWorldQuaternion(wq);
    return { bone, base: bone.quaternion.clone(), axis: side.clone().applyQuaternion(wq.invert()).normalize() };
  };
  const limbsOut: BipedLimb[] = [];
  let legLen = H * 0.48;
  for (const l of legs) {
    const { out } = chainFrom(l.bone);
    l.bone.getWorldPosition(root);
    out[out.length - 1].getWorldPosition(tip);
    legLen = root.y - tip.y; // hip to sole
    // Left leg + right arm move together, and vice versa.
    limbsOut.push({ arm: false, hip: joint(l.bone), mid: out[1] ? joint(out[1]) : null, phase: l.side > 0 ? 0 : 0.5 });
  }
  for (const a of topArms) {
    const elbow = kids(a.bone)[0];
    limbsOut.push({ arm: true, hip: joint(a.bone), mid: elbow ? joint(elbow) : null, phase: a.side > 0 ? 0.5 : 0 });
  }
  model.biped = { limbs: limbsOut, legLen, step: legLen * Math.sin(LEG_SWING), holdBlend: 0 };
  // Distance walked per full cycle (two steps) = 4 x the foot's reach, so the
  // planted foot moves back exactly as fast as the body moves forward.
  model.stride = (4 * model.biped.step) / model.length;
}

/** How far below horizontal the arms hang (radians, ~80°). */
const ARM_DOWN = 1.4;

function isAncestor(a: THREE.Object3D, b: THREE.Object3D) {
  for (let p = b.parent; p; p = p.parent) if (p === a) return true;
  return false;
}

// ============================================================================
// brain.ts — the customers' "insect brains", adapted from TRADDOMIUM's
// creature system (src/creatures/: species.ts, state.ts, intent.ts).
//
// What we borrow from TRADDOMIUM:
//   • The BEHAVIOUR vocabulary: idle, wander, flee, fly, hover, takeoff,
//     land, defend. A bug only uses the words its MEDIUM allows (a fly can
//     fly, a spider can't).
//   • TEMPERAMENT: passive (ignores you), skittish (flees when you get
//     close), defensive (turns to face you and rears up).
//   • PACE in body lengths per second, so a bigger bug moves faster.
//   • The housefly's flight: short hops, a brief hover, never a long cruise.
//
// What's game tuning (bugs shopping at a snack counter isn't biology 😄):
//   • Real aphids crawl at 0.57 bodies/s; that would take a minute to reach
//     the counter, so they get 1.2.
//   • Alarm distances are a few body lengths so it's fun near the counter.
//   • TRADDOMIUM has no spiders yet, so the Black Widow and Jumping Spider
//     are written in the same format here.
// ============================================================================
import * as THREE from 'three';
import { CreatureModel, animateCreature, faceToward } from './models';
import { CreatureKind } from './creatures';

export type Behaviour = 'idle' | 'wander' | 'flee' | 'takeoff' | 'fly' | 'hover' | 'land' | 'defend' | 'surface' | 'burrow';
export type Medium = 'ground' | 'plant' | 'air' | 'soil';
export type Temperament = 'passive' | 'skittish' | 'defensive';

export interface BugSpecies {
  id: CreatureKind;
  length: number;          // world units nose to tail
  medium: Medium;
  temperament: Temperament;
  walkBLs: number;         // walk pace, body lengths per second
  fleeBLs: number;         // flee pace, body lengths per second
  alarmLengths: number;    // how close you can get (in its body lengths) before it reacts
  alarmS: number;          // how long it stays alarmed
  hops?: boolean;          // moves in jumps (jumping spider)
  flight?: { hoverHeight: number; cruise: number; hoverBob: number };
}

export const BUGS: Record<string, BugSpecies> = {
  // TRADDOMIUM EARTHWORM: medium soil, skittish. Comes up out of the ground
  // (surface), pulls back in when you crowd it, and burrows away when done.
  // Real worms wander at 0.1 bodies/s; game tuning: 0.5.
  earthworm: {
    id: 'earthworm', length: 2.8, medium: 'soil', temperament: 'skittish',
    walkBLs: 0.5, fleeBLs: 0.8, alarmLengths: 0.9, alarmS: 1.5,
  },
  // TRADDOMIUM HOUSEFLY: medium air, skittish, alarm 3 s; short hops + brief hover.
  housefly: {
    id: 'housefly', length: 1.9, medium: 'air', temperament: 'skittish',
    walkBLs: 2.3, fleeBLs: 6, alarmLengths: 1.6, alarmS: 1.2,
    flight: { hoverHeight: 1.5, cruise: 5.5, hoverBob: 0.12 },
  },
  // TRADDOMIUM APHID: medium plant, passive (it just keeps sucking sap).
  aphid: {
    id: 'aphid', length: 1.7, medium: 'plant', temperament: 'passive',
    walkBLs: 1.2, fleeBLs: 1.8, alarmLengths: 0, alarmS: 0,
  },
  // Same format, new to the table: widows hold their ground and threat-display.
  'black-widow': {
    id: 'black-widow', length: 2.4, medium: 'ground', temperament: 'defensive',
    walkBLs: 1.3, fleeBLs: 2, alarmLengths: 1.3, alarmS: 1.5,
  },
  // Huntsmen are FAST and nervous: they bolt when you get close.
  huntsman: {
    id: 'huntsman', length: 3.0, medium: 'ground', temperament: 'skittish',
    walkBLs: 1.4, fleeBLs: 3.5, alarmLengths: 1.0, alarmS: 1.2,
  },
  // Wolf spiders are bold hunters: they stand their ground like the widow.
  'wolf-spider': {
    id: 'wolf-spider', length: 2.5, medium: 'ground', temperament: 'defensive',
    walkBLs: 1.6, fleeBLs: 3, alarmLengths: 1.2, alarmS: 1.6,
  },
  // The Ant-Mimicking Spider: looks like one of us... it's the colony's thief.
  'ant-mimic': {
    id: 'ant-mimic', length: 2.2, medium: 'ground', temperament: 'skittish',
    walkBLs: 1.5, fleeBLs: 3.4, alarmLengths: 0, alarmS: 0,
  },
  // Jumping spiders get around in quick hops and spring away when startled.
  'jumping-spider': {
    id: 'jumping-spider', length: 2.2, medium: 'ground', temperament: 'skittish',
    walkBLs: 1.5, fleeBLs: 3, alarmLengths: 1.3, alarmS: 1.4, hops: true,
  },
};

/** One customer's mind + body state. */
export interface Mind {
  species: BugSpecies;
  behaviour: Behaviour;
  alarmT: number;               // seconds left being alarmed
  lookT: number;                // countdown to the next idle glance around
  lookYaw: number;              // extra head turn while idling
  alt: number;                  // height off the ground (fliers)
  hop: { from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number } | null;
  hopRest: number;              // pause between hops
  t: number;                    // own clock (for bobbing)
}

export function newMind(species: BugSpecies): Mind {
  return {
    species, behaviour: species.medium === 'air' ? 'fly' : 'wander',
    alarmT: 0, lookT: 1 + Math.random() * 3, lookYaw: 0,
    alt: species.flight ? species.flight.hoverHeight + 1 : 0,
    hop: null, hopRest: 0, t: Math.random() * 10,
  };
}

const tmp = new THREE.Vector3();

/**
 * Think + move for one frame. Walks/hops/flies toward `target`, reacting
 * to the player at `threat`. Returns true when it has arrived and is calm.
 */
export function stepBug(m: CreatureModel, mind: Mind, target: THREE.Vector3, threat: THREE.Vector3, dt: number, leaving = false): boolean {
  const sp = mind.species;
  const p = m.root.position;
  mind.t += dt;

  // --- Sense: is the player too close? (TRADDOMIUM's senseAlarm, simplified)
  const gap = Math.hypot(threat.x - p.x, threat.z - p.z);
  if (!leaving && sp.alarmLengths > 0 && gap < sp.alarmLengths * sp.length) mind.alarmT = sp.alarmS;
  mind.alarmT = Math.max(0, mind.alarmT - dt);
  const alarmed = mind.alarmT > 0;

  // --- Decide: pick the behaviour word
  if (alarmed && sp.temperament === 'defensive') mind.behaviour = 'defend';
  else if (alarmed && sp.temperament === 'skittish') mind.behaviour = 'flee';
  else if (sp.medium === 'air') mind.behaviour = leaving ? 'takeoff' : 'fly';
  else mind.behaviour = 'wander';

  // --- Act
  if (mind.behaviour === 'defend') {
    // Hold position, face the threat, rear up on the back legs.
    faceToward(m, threat.x - p.x, threat.z - p.z, dt, 8);
    m.bob.rotation.x += (-0.35 - m.bob.rotation.x) * Math.min(1, dt * 10);
    animateCreature(m, dt, 0);
    return false;
  }
  m.bob.rotation.x += (0 - m.bob.rotation.x) * Math.min(1, dt * 8);

  // Where to go this frame: the target, or away from the player when fleeing.
  const goal = tmp.copy(target);
  if (mind.behaviour === 'flee' && sp.medium !== 'air') {
    const away = Math.max(gap, 0.001);
    goal.set(p.x + ((p.x - threat.x) / away) * 2, 0, p.z + ((p.z - threat.z) / away) * 2);
  }

  if (sp.medium === 'soil') return soilStep(m, mind, target, dt, leaving, alarmed);
  if (sp.flight) return flyStep(m, mind, goal, dt, leaving, alarmed);
  if (sp.hops) return hopStep(m, mind, goal, dt, alarmed);
  return walkStep(m, mind, goal, dt, alarmed);
}

function walkStep(m: CreatureModel, mind: Mind, goal: THREE.Vector3, dt: number, alarmed: boolean) {
  const sp = mind.species;
  const p = m.root.position;
  const dx = goal.x - p.x;
  const dz = goal.z - p.z;
  const d = Math.hypot(dx, dz);
  const speed = (alarmed ? sp.fleeBLs : sp.walkBLs) * sp.length;
  if (d < 0.06) {
    idleLook(m, mind, dt);
    animateCreature(m, dt, 0);
    return !alarmed;
  }
  const step = Math.min(d, speed * dt);
  p.x += (dx / d) * step;
  p.z += (dz / d) * step;
  faceToward(m, dx, dz, dt);
  animateCreature(m, dt, speed);
  return false;
}

/** Jumping spider: crouch, spring in an arc, land, pause, repeat. */
function hopStep(m: CreatureModel, mind: Mind, goal: THREE.Vector3, dt: number, alarmed: boolean) {
  const p = m.root.position;
  if (mind.hop) {
    const h = mind.hop;
    h.t = Math.min(1, h.t + dt / h.dur);
    p.lerpVectors(h.from, h.to, h.t);
    p.y = Math.sin(Math.PI * h.t) * (0.5 + h.from.distanceTo(h.to) * 0.25);
    animateCreature(m, dt, 0);
    if (h.t >= 1) {
      p.y = 0;
      mind.hop = null;
      mind.hopRest = alarmed ? 0.1 : 0.25 + Math.random() * 0.3;
    }
    return false;
  }
  const dx = goal.x - p.x;
  const dz = goal.z - p.z;
  const d = Math.hypot(dx, dz);
  mind.hopRest -= dt;
  faceToward(m, dx, dz, dt, 14);
  if (d < 0.15) {
    idleLook(m, mind, dt);
    animateCreature(m, dt, 0);
    return !alarmed;
  }
  animateCreature(m, dt, 0);
  if (mind.hopRest > 0) return false;
  const len = Math.min(d, alarmed ? 2.6 : 2.0);
  mind.hop = {
    from: p.clone(),
    to: new THREE.Vector3(p.x + (dx / d) * len, 0, p.z + (dz / d) * len),
    t: 0,
    dur: 0.22 + len * 0.08,
  };
  return false;
}

/** Housefly: flies in at cruise, hovers in line with a little bob, darts up when startled. */
function flyStep(m: CreatureModel, mind: Mind, goal: THREE.Vector3, dt: number, leaving: boolean, alarmed: boolean) {
  const f = mind.species.flight!;
  const p = m.root.position;
  m.flying = true;
  const dx = goal.x - p.x;
  const dz = goal.z - p.z;
  const d = Math.hypot(dx, dz);
  // Altitude: hover height in line; higher when startled; climb away when leaving.
  const wantAlt = leaving ? 9 : alarmed ? f.hoverHeight + 1.6 : f.hoverHeight + (d > 1 ? 0.6 : 0);
  mind.alt += (wantAlt - mind.alt) * Math.min(1, dt * (leaving ? 1.2 : 4));
  const speed = alarmed ? f.cruise * 1.4 : f.cruise;
  if (d > 0.05) {
    const step = Math.min(d, speed * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    faceToward(m, dx, dz, dt, 10);
  } else {
    idleLook(m, mind, dt);
  }
  // Hover bob + nose-down tilt while moving fast
  p.y = mind.alt + Math.sin(mind.t * 7) * f.hoverBob;
  m.bob.rotation.x = d > 0.3 ? 0.18 : 0;
  animateCreature(m, dt, 0);
  return d <= 0.05 && !alarmed && Math.abs(mind.alt - f.hoverHeight) < 0.25;
}

/** Earthworm: rise out of the soil, slither along, duck when startled, burrow away. */
function soilStep(m: CreatureModel, mind: Mind, goal: THREE.Vector3, dt: number, leaving: boolean, alarmed: boolean) {
  const p = m.root.position;
  // Depth: fully up normally, half-ducked when startled, all the way down when leaving.
  const wantY = leaving ? -2 : alarmed ? -0.35 : 0;
  mind.behaviour = leaving ? 'burrow' : p.y < -0.05 && !alarmed ? 'surface' : mind.behaviour;
  p.y += (wantY - p.y) * Math.min(1, dt * (leaving ? 1.5 : 3));
  // Wriggle: the body sways side to side as it crawls.
  m.bob.rotation.y = Math.sin(mind.t * 4) * 0.18;
  if (leaving) return p.y < -1.6;
  if (p.y < -0.6) return false; // still coming up
  const dx = goal.x - p.x;
  const dz = goal.z - p.z;
  const d = Math.hypot(dx, dz);
  if (d > 0.06) {
    const step = Math.min(d, mind.species.walkBLs * mind.species.length * dt);
    p.x += (dx / d) * step;
    p.z += (dz / d) * step;
    faceToward(m, dx, dz, dt, 4);
  }
  return d <= 0.06 && !alarmed && p.y > -0.05;
}

/** While waiting: every few seconds glance left or right, then back. */
function idleLook(m: CreatureModel, mind: Mind, dt: number) {
  mind.lookT -= dt;
  if (mind.lookT <= 0) {
    mind.lookT = 1.5 + Math.random() * 3;
    mind.lookYaw = mind.lookYaw === 0 ? (Math.random() < 0.5 ? -1 : 1) * (0.3 + Math.random() * 0.4) : 0;
  }
  m.bob.rotation.y += (mind.lookYaw - m.bob.rotation.y) * Math.min(1, dt * 4);
}

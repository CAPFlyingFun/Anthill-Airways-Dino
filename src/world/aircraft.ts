// ============================================================================
// aircraft.ts — the Anthill Airways fleet (Act 2), built from simple shapes.
//
//   Cessna 172  — the first plane: high wing, one propeller
//   Twin Prop   — a small commuter plane with two propellers
//   Learjet     — sleek business jet: swept wings, T-tail, rear engines
//   Airliner    — the big one: two underwing jet engines
//   Helicopter  — flies from its own helipad, takes off straight up
//
// Each model faces -x (nose west) with its cargo door on the +z side (the
// side facing the terminal window). Bags ride a belt from a pad inside the
// terminal to that door. When the hold is full, it flies a trip and pays for
// every bag when it lands back.
// ============================================================================
import * as THREE from 'three';
import { AircraftKind, FLEET } from '../data/config';
import { Flyers, Stack } from './items';
import { TextSprite, makePad } from './labels';
import { Zone, gridLayout } from './stations';

const mat = (color: number, roughness = 0.5, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
const WHITE = mat(0xf4f6f8, 0.35);
const BLUE = mat(0x2d6cdf, 0.4);
const RED = mat(0xc0392b, 0.45);
const GLASS = mat(0x1b2733, 0.15, 0.4);
const METAL = mat(0x8a949e, 0.4, 0.5);
const DARK = mat(0x222222, 0.6);

function box(w: number, h: number, d: number, m: THREE.Material, x = 0, y = 0, z = 0) {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
}

/** A tube along x (fuselage, engine...). */
function tube(r: number, len: number, m: THREE.Material, x: number, y: number, z = 0, r2 = r) {
  const t = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, 20), m);
  t.rotation.z = Math.PI / 2;
  t.position.set(x, y, z);
  return t;
}

/** A cone along x, pointing toward +x (dir 1) or -x (dir -1). */
function cone(r: number, len: number, m: THREE.Material, x: number, y: number, dir: 1 | -1, z = 0) {
  const c = new THREE.Mesh(new THREE.ConeGeometry(r, len, 20), m);
  c.rotation.z = -dir * Math.PI / 2;
  c.position.set(x, y, z);
  return c;
}

interface Built {
  group: THREE.Group;
  spinners: THREE.Object3D[];  // propellers (spin around x) / rotors (spin around y)
  rotor: boolean;              // helicopter: spinners turn around y
  door: THREE.Vector3;         // cargo door (local)
  halfSpan: number;            // how far the wings reach toward the terminal
  logoY: number;
}

function buildCessna(): Built {
  const g = new THREE.Group();
  const spinners: THREE.Object3D[] = [];
  g.add(tube(0.85, 5.2, WHITE, -0.6, 1.5));             // cabin
  g.add(cone(0.85, 4.2, WHITE, 4.1, 1.65, 1));           // tail cone
  g.add(cone(0.7, 1.2, WHITE, -3.8, 1.45, -1));          // nose cowl
  g.add(box(5.0, 0.22, 1.74, RED, -0.6, 1.15));          // red stripe down the side
  g.add(box(1.6, 0.14, 11.5, WHITE, -0.6, 2.42));        // high wing
  g.add(box(1.0, 0.3, 0.6, RED, -0.6, 2.42, 5.6));       // wing tips
  g.add(box(1.0, 0.3, 0.6, RED, -0.6, 2.42, -5.6));
  for (const z of [-2.2, 2.2]) {
    const strut = box(0.08, 1.9, 0.08, METAL, -0.4, 1.5, z);
    strut.rotation.x = z > 0 ? -0.7 : 0.7;
    g.add(strut);
  }
  g.add(box(1.4, 0.55, 1.75, GLASS, -1.4, 2.0));       // windshield / side windows
  const fin = box(1.4, 1.7, 0.12, RED, 5.6, 2.6);
  fin.rotation.z = -0.4;
  g.add(fin, box(1.1, 0.1, 3.4, WHITE, 5.8, 1.85));
  const prop = box(0.06, 2.0, 0.18, DARK, -4.45, 1.45);
  spinners.push(prop);
  g.add(prop);
  for (const [x, z] of [[-3.0, 0], [0.3, -1.1], [0.3, 1.1]]) {
    g.add(box(0.12, 0.7, 0.12, METAL, x, 0.5, z));
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 12), DARK);
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(x, 0.28, z);
    g.add(wheel);
  }
  return { group: g, spinners, rotor: false, door: new THREE.Vector3(1.6, 1.4, 0.85), halfSpan: 5.9, logoY: 3.2 };
}

function buildTwin(): Built {
  const g = new THREE.Group();
  const spinners: THREE.Object3D[] = [];
  g.add(tube(1.5, 12, WHITE, 0, 2.2));
  g.add(cone(1.5, 2.6, WHITE, -7.3, 2.2, -1));
  g.add(cone(1.5, 4.2, WHITE, 8.1, 2.5, 1));
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.52, 1.52, 12, 20, 1, true, Math.PI * 0.35, Math.PI * 0.3), BLUE);
  stripe.rotation.z = Math.PI / 2;
  stripe.position.y = 2.2;
  g.add(stripe);
  g.add(box(3.4, 0.22, 13, WHITE, 0, 1.5));
  const fin = box(2.2, 2.8, 0.22, RED, 8.8, 4.2);
  fin.rotation.z = -0.35;
  g.add(fin, box(1.8, 0.18, 4.8, WHITE, 9.2, 3.0));
  g.add(box(0.8, 0.45, 2.0, GLASS, -7.6, 2.9));
  for (let i = 0; i < 7; i++) g.add(box(0.36, 0.4, 0.06, GLASS, -4.5 + i * 1.4, 2.7, 1.48));
  for (const z of [-3.3, 3.3]) {
    g.add(tube(0.5, 2.4, METAL, -0.9, 1.4, z, 0.55));
    const prop = box(0.07, 2.4, 0.22, DARK, -2.2, 1.4, z);
    spinners.push(prop);
    g.add(prop);
  }
  for (const [x, z] of [[-5.8, 0], [0.8, -1.4], [0.8, 1.4]]) g.add(box(0.28, 0.8, 0.28, DARK, x, 0.4, z));
  return { group: g, spinners, rotor: false, door: new THREE.Vector3(5.5, 1.9, 1.5), halfSpan: 6.5, logoY: 4.4 };
}

function buildJet(): Built {
  const g = new THREE.Group();
  g.add(tube(1.15, 10, WHITE, 0.5, 2.0));
  g.add(cone(1.15, 3.6, WHITE, -6.3, 2.0, -1));           // long pointed nose
  g.add(cone(1.15, 3.4, WHITE, 7.2, 2.25, 1));
  const stripe = new THREE.Mesh(new THREE.CylinderGeometry(1.17, 1.17, 10, 20, 1, true, Math.PI * 0.4, Math.PI * 0.2), mat(0xd4af37, 0.3, 0.5));
  stripe.rotation.z = Math.PI / 2;
  stripe.position.set(0.5, 2.0, 0);
  g.add(stripe);
  // Swept wings (each half is turned back a little)
  for (const s of [-1, 1]) {
    const w = box(2.6, 0.18, 5.6, WHITE, 0.9, 1.2, s * 3.4);
    w.rotation.y = s * 0.35;
    g.add(w);
    const tip = box(0.7, 0.8, 0.1, BLUE, 1.9, 1.55, s * 6.1);
    g.add(tip);
  }
  // T-tail
  const fin = box(2.0, 3.0, 0.2, BLUE, 7.6, 3.9);
  fin.rotation.z = -0.5;
  g.add(fin, box(1.6, 0.16, 4.4, WHITE, 8.4, 5.3));
  // Engines on the rear fuselage
  for (const z of [-1.5, 1.5]) {
    g.add(tube(0.45, 2.4, METAL, 5.0, 2.6, z, 0.5));
    g.add(box(0.5, 0.2, 0.5, METAL, 5.0, 2.6, z * 0.75));
  }
  g.add(box(0.9, 0.4, 1.6, GLASS, -4.6, 2.6));
  for (let i = 0; i < 5; i++) {
    const win = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), GLASS);
    win.position.set(-2.6 + i * 1.3, 2.3, 1.16);
    g.add(win);
  }
  for (const [x, z] of [[-4.5, 0], [1.2, -1.2], [1.2, 1.2]]) g.add(box(0.24, 1.0, 0.24, DARK, x, 0.5, z));
  return { group: g, spinners: [], rotor: false, door: new THREE.Vector3(3.6, 1.8, 1.15), halfSpan: 6.3, logoY: 3.9 };
}

function buildLiner(): Built {
  const g = new THREE.Group();
  g.add(tube(2.3, 20, WHITE, 0, 3.0));
  const nose = new THREE.Mesh(new THREE.SphereGeometry(2.3, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), WHITE);
  nose.rotation.z = Math.PI / 2;
  nose.scale.set(1, 1.5, 1);
  nose.position.set(-10, 3.0, 0);
  g.add(nose, cone(2.3, 6.5, WHITE, 13.25, 3.5, 1));
  const belly = new THREE.Mesh(new THREE.CylinderGeometry(2.32, 2.32, 20, 24, 1, true, Math.PI * 0.6, Math.PI * 0.8), BLUE);
  belly.rotation.z = Math.PI / 2;
  belly.position.y = 3.0;
  g.add(belly);
  for (const s of [-1, 1]) {
    const w = box(4.4, 0.3, 9.6, WHITE, 1.5, 2.0, s * 6.2);
    w.rotation.y = s * 0.3;
    g.add(w);
    g.add(tube(0.95, 3.6, METAL, -0.6, 1.0, s * 5.0, 1.05));
    g.add(box(1.0, 0.8, 0.3, METAL, 0.2, 1.6, s * 5.0));
  }
  const fin = box(4.0, 5.2, 0.3, BLUE, 14.2, 6.8);
  fin.rotation.z = -0.55;
  g.add(fin, box(3.0, 0.24, 9.0, WHITE, 15.2, 4.2));
  g.add(box(1.2, 0.6, 3.2, GLASS, -11.3, 4.1));
  for (let i = 0; i < 14; i++) g.add(box(0.4, 0.5, 0.06, GLASS, -8 + i * 1.3, 3.8, 2.28));
  for (const [x, z] of [[-9, 0], [2, -2], [2, 2]]) g.add(box(0.4, 1.4, 0.4, DARK, x, 0.7, z));
  return { group: g, spinners: [], rotor: false, door: new THREE.Vector3(7.5, 2.4, 2.3), halfSpan: 11, logoY: 6.2 };
}

function buildHeli(): Built {
  const g = new THREE.Group();
  const spinners: THREE.Object3D[] = [];
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), RED);
  body.scale.set(2.2, 1.4, 1.3);
  body.position.y = 1.9;
  g.add(body);
  const bubble = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12, 0, Math.PI), GLASS);
  bubble.scale.set(1.3, 1.1, 1.2);
  bubble.rotation.y = Math.PI / 2;
  bubble.position.set(-1.4, 2.1, 0);
  g.add(bubble);
  g.add(tube(0.35, 5.5, RED, 4.2, 2.3, 0, 0.18));     // tail boom
  g.add(box(0.9, 1.4, 0.12, RED, 6.9, 2.9));           // tail fin
  const tail = box(0.1, 1.5, 0.18, DARK, 7.0, 3.0, 0.2); // tail rotor (spins around z...)
  tail.userData.tailRotor = true;
  spinners.push(tail);
  g.add(tail);
  g.add(box(0.5, 0.6, 0.5, METAL, 0, 3.4));            // mast
  const rotor = new THREE.Group();
  rotor.position.set(0, 3.75, 0);
  rotor.add(box(11, 0.06, 0.35, DARK), box(0.35, 0.06, 11, DARK));
  spinners.push(rotor);
  g.add(rotor);
  for (const z of [-1.0, 1.0]) {
    g.add(box(4.2, 0.12, 0.14, METAL, 0, 0.12, z));
    g.add(box(0.12, 0.8, 0.12, METAL, -0.9, 0.5, z), box(0.12, 0.8, 0.12, METAL, 0.9, 0.5, z));
  }
  return { group: g, spinners, rotor: true, door: new THREE.Vector3(0.6, 1.6, 1.3), halfSpan: 1.6, logoY: 4.6 };
}

const BUILDERS: Record<AircraftKind, () => Built> = { cessna: buildCessna, twin: buildTwin, jet: buildJet, liner: buildLiner, heli: buildHeli };

// ----------------------------------------------------------------------------
export class Aircraft {
  group = new THREE.Group();   // moves (taxi / fly); the model sits inside
  cargo: Stack;                // bags waiting on the pad
  zone: Zone;
  hold = 0;
  kind!: AircraftKind;
  state: 'parked' | 'leaving' | 'away' | 'landing' = 'parked';
  fareBoost = 1;               // extra multiplier (not used yet; room for upgrades)
  onPayout: (bags: number) => void = () => {};
  onDepart: () => void = () => {};
  private built!: Built;
  private home = new THREE.Vector3();
  private t = 0;
  private beltT = 0;
  private flying = 0;
  private bagsAboard = 0;
  private fareAboard = 1;
  private door = new THREE.Object3D();
  private label = new TextSprite(0.7, '#ffffff');
  private logo = new TextSprite(0.8, '#2d6cdf');
  private belt = new THREE.Group();
  private spin = 0;

  constructor(private scene: THREE.Scene, private flyers: Flyers, private padX: number, private padZ: number, kind: AircraftKind, private windowZ: number) {
    scene.add(this.group, this.belt);
    this.group.add(this.door, this.label.sprite, this.logo.sprite);
    const pad = makePad(2.4, 2.4, kind === 'heli' ? 'TO HELI' : 'TO PLANE');
    pad.position.set(padX, 0.03, padZ);
    scene.add(pad);
    this.zone = new Zone(padX, padZ, 1.2, 1.2);
    const holder = new THREE.Group();
    holder.position.set(padX, 0, padZ);
    scene.add(holder);
    this.cargo = new Stack(holder, gridLayout(2, 2, 0.8, 0.5, 0.05), 40);
    this.setKind(kind);
  }

  get spec() {
    return FLEET[this.kind];
  }

  get holdMax() {
    return this.spec.hold;
  }

  /** Swap in a different aircraft (fleet upgrade). If it's away, the new one lands. */
  setKind(kind: AircraftKind) {
    if (this.built) this.group.remove(this.built.group);
    this.kind = kind;
    this.built = BUILDERS[kind]();
    this.built.group.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.castShadow = true;
    });
    this.group.add(this.built.group);
    // Park so the cargo door lines up with the belt, wings clear of the window.
    const d = this.built.door;
    this.home.set(this.padX - d.x, 0, kind === 'heli' ? this.windowZ - 5 : this.windowZ - this.built.halfSpan - 1.6);
    if (this.state === 'parked') this.group.position.copy(this.home);
    this.door.position.copy(d).add(new THREE.Vector3(0, 0, 0.3));
    this.label.sprite.position.set(d.x, this.built.logoY + 1.6, d.z + 0.5);
    this.logo.setText(kind === 'heli' ? '🚁 ANTHILL AIR' : '🐜 ANTHILL AIRWAYS');
    this.logo.sprite.position.set(d.x - (kind === 'heli' ? 0.6 : 3), this.built.logoY, d.z + 0.6);
    this.buildBelt();
    this.drawLabel();
  }

  /** The conveyor from the pad, out through the window, to the cargo door. */
  private buildBelt() {
    this.belt.clear();
    const z0 = this.padZ - 1.2;
    const z1 = this.home.z + this.built.door.z + 0.4;
    const len = z0 - z1;
    const mid = (z0 + z1) / 2;
    const top = this.built.door.y - 0.3;
    // A ramp that rises from the floor to the door
    const ramp = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.25, Math.hypot(len, top)), mat(0x2b2f33, 0.6));
    ramp.position.set(this.padX, top / 2, mid);
    ramp.rotation.x = -Math.atan2(top, len);
    ramp.castShadow = ramp.receiveShadow = true;
    const rail = mat(0xffc928, 0.5);
    this.belt.add(ramp);
    for (const dx of [-0.7, 0.7]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.35, Math.hypot(len, top)), rail);
      r.position.set(this.padX + dx, top / 2 + 0.15, mid);
      r.rotation.x = ramp.rotation.x;
      this.belt.add(r);
    }
  }

  private drawLabel() {
    const s = this.spec;
    const txt =
      this.state === 'parked' ? `${this.kind === 'heli' ? '🚁' : '✈️'} ${s.name}  🧳 ${this.hold}/${s.hold}`
        : this.state === 'away' ? `Back in ${Math.max(0, Math.ceil(s.flight - this.t))}s`
          : this.kind === 'heli' ? '🚁' : '✈️';
    this.label.setText(txt);
  }

  update(dt: number) {
    // Propellers / rotors: idle slowly when parked, full speed when flying.
    const rate = this.state === 'parked' ? (this.hold > 0 ? 3 : 0.6) : 45;
    this.spin += dt * rate;
    for (const s of this.built.spinners) {
      if (s.userData.tailRotor) s.rotation.z = this.spin * 1.5;
      else if (this.built.rotor) s.rotation.y = this.spin;
      else s.rotation.x = this.spin;
    }
    if (this.state === 'parked') return this.updateParked(dt);

    this.t += dt;
    const g = this.group.position;
    const heli = this.kind === 'heli';
    if (this.state === 'leaving') {
      if (heli) {
        // Spin up, lift straight up, then tilt forward and fly off.
        const u = Math.max(0, this.t - 1);
        g.y = u * u * 2.2;
        g.x = this.home.x - Math.max(0, this.t - 2.5) ** 2 * 5;
        this.group.rotation.z = Math.min(0.2, Math.max(0, this.t - 2.5) * 0.15);
      } else {
        // Roll toward -x faster and faster, then lift off.
        const k = this.kind === 'jet' ? 3.2 : this.kind === 'liner' ? 1.8 : 2.4;
        g.x = this.home.x - k * this.t * this.t;
        g.y = Math.max(0, this.t - 2.6) ** 2 * 1.4;
        this.group.rotation.z = -Math.min(0.25, Math.max(0, this.t - 2.6) * 0.15);
      }
      if (this.t > 6) {
        this.state = 'away';
        this.t = 0;
        this.group.visible = false;
      }
    } else if (this.state === 'away') {
      if (Math.floor(this.t) !== Math.floor(this.t - dt)) this.drawLabel();
      if (this.t >= this.spec.flight) {
        this.state = 'landing';
        this.t = 0;
        this.group.visible = true;
      }
    } else {
      const u = Math.min(1, this.t / 5);
      const k = (1 - u) * (1 - u);
      if (heli) {
        // Come in high from the east, slow down over the pad, settle.
        g.x = this.home.x + 50 * k * k;
        g.y = 22 * k;
        this.group.rotation.z = -0.15 * k;
      } else {
        g.x = this.home.x + 70 * k;
        g.y = 14 * k * k;
        this.group.rotation.z = 0.12 * k;
      }
      if (u >= 1) {
        g.copy(this.home);
        this.group.rotation.z = 0;
        this.state = 'parked';
        this.onPayout(this.bagsAboard);
        this.drawLabel();
      }
    }
  }

  private updateParked(dt: number) {
    // Belt: one bag at a time hops from the pad into the hold.
    this.beltT += dt;
    if (this.beltT >= 0.3 && this.hold + this.flying < this.holdMax && this.cargo.canPop()) {
      this.beltT = 0;
      const it = this.cargo.pop()!;
      const target = new THREE.Vector3();
      this.flying++;
      this.flyers.fly(it.mesh, () => this.door.getWorldPosition(target), () => {
        it.mesh.removeFromParent();
        this.flying--;
        this.hold++;
        this.drawLabel();
      }, 0.6, 1.4);
    }
    if (this.hold >= this.holdMax && this.flying === 0) {
      this.state = 'leaving';
      this.t = 0;
      this.bagsAboard = this.hold;
      this.fareAboard = this.spec.fare;
      this.hold = 0;
      this.onDepart();
      this.drawLabel();
    }
  }

  /** Fare multiplier of the trip that just landed. */
  get fare() {
    return this.fareAboard * this.fareBoost;
  }

  /** Where bills pop out when it pays (its cargo door). */
  get doorObj() {
    return this.door;
  }
}

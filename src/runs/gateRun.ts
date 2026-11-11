// ============================================================================
// gateRun.ts — the gate run: a beetle cart races down a path through rows of
// gates. Each row has two gates (left / right); you pass through one and its
// math is applied to your cargo count: +12, x2, -8, ÷2, or ? (a gamble).
// Puddles knock some cargo off. Whatever reaches the finish line is paid out.
//
// Tuning (see CONFIG.run and the docs): one x2 row and one ? row per run, so
// a great run lands around 2-3x the starting count, a bad one about 0.5x.
// ============================================================================
import * as THREE from 'three';
import { CONFIG } from '../data/config';
import { Sfx } from '../core/audio';
import { Hud } from '../ui/hud';
import { CreatureModel, animateCreature, makeBeetle } from '../actors/models';
import { spawnCreature } from '../actors/creatures';
import { ITEM_VALUE, ItemType, makeItem } from '../world/items';
import { RunTheme, makeVehicle } from '../world/stations';
import { TextSprite, gameText, roundRect } from '../world/labels';

type OpKind = '+' | '-' | 'x' | '/' | '?';
interface Op {
  kind: OpKind;
  v: number;
}
interface Gate {
  group: THREE.Group;
  op: Op;
  side: -1 | 1;
  panel: THREE.MeshBasicMaterial;
}
interface Row {
  z: number;
  gates: Gate[];
  passed: boolean;
}
interface Puddle {
  x: number;
  z: number;
  r: number;
  hit: boolean;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const isGood = (k: OpKind) => k === '+' || k === 'x';

/** Apply a gate's math to the current count. `luck` improves ? gate odds. */
function applyOp(count: number, op: Op, luck = 0): number {
  switch (op.kind) {
    case '+': return count + op.v;
    case '-': return Math.max(0, count - op.v);
    case 'x': return count * op.v;
    case '/': return Math.floor(count / op.v);
    case '?': return Math.random() < Math.min(0.8, 0.5 + luck * 0.04) ? count * 3 : Math.floor(count / 2);
  }
}

function opLabel(op: Op) {
  if (op.kind === '?') return '?';
  if (op.kind === '/') return `÷${op.v}`;
  return `${op.kind}${op.v}`;
}

export class GateRun {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  active = false;
  /** Luck stat points (set by main.ts before each run). */
  luck = 0;
  /** Haggling multiplier, for showing the right payout on the results card. */
  cashMult = 1;

  private rows: Row[] = [];
  private puddles: Puddle[] = [];
  private dynamic = new THREE.Group(); // everything rebuilt each run
  private cart = new THREE.Group();
  private cargo = new THREE.Group();
  private beetle: CreatureModel;
  private countLabel = new TextSprite(1.1);
  private startCount = 0;
  private count = 0;
  private shownCargo = -1;
  private x = 0;
  private z = 0;
  private speed = 0;
  private state: 'ready' | 'run' | 'done' = 'ready';
  private stateT = 0;
  private finishZ = 0;
  private onDone: (endCount: number) => void = () => {};
  private labelPop = 0;
  private theme: RunTheme = 'grass';
  private itemType: ItemType = 'snack';
  private vehicles: Record<RunTheme, { group: THREE.Group; deckY: number }>;

  constructor(private hud: Hud, private sfx: Sfx) {
    const s = this.scene;
    s.background = new THREE.Color(0x9fdcff);
    s.fog = new THREE.Fog(0x9fdcff, 40, 140);
    s.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, 1.7));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(6, 20, 10);
    s.add(sun);
    s.add(this.dynamic);

    // Both vehicles live on the cart; start() shows the one for the theme.
    this.vehicles = { grass: makeVehicle('grass'), gutter: makeVehicle('gutter') };
    this.cart.add(this.vehicles.grass.group, this.vehicles.gutter.group);
    this.cart.add(this.cargo);
    this.beetle = spawnCreature('aphid', 1.9) ?? makeBeetle(0x2a9d8f);
    this.beetle.root.position.set(0, 0, -1.9);
    this.beetle.root.rotation.y = Math.PI; // faces -z, the way we're racing
    this.cart.add(this.beetle.root);
    this.countLabel.sprite.position.set(0, 3.0, 0);
    this.cart.add(this.countLabel.sprite);
    s.add(this.cart);
  }

  // --------------------------------------------------------------------------
  /** Build a fresh course and start the run. */
  start(count: number, onDone: (endCount: number) => void, theme: RunTheme = 'grass', itemType: ItemType = 'snack') {
    this.onDone = onDone;
    this.theme = theme;
    this.itemType = itemType;
    this.vehicles.grass.group.visible = theme === 'grass';
    this.vehicles.gutter.group.visible = theme === 'gutter';
    const deck = this.vehicles[theme].deckY;
    this.cargo.position.y = deck - 0.1;
    // Grass: the aphid pulls the cart. Gutter: it rides at the front of the raft.
    this.beetle.root.position.set(0, theme === 'gutter' ? deck - 0.1 : 0, theme === 'gutter' ? -1.0 : -1.9);
    this.startCount = this.count = count;
    this.shownCargo = -1;
    this.x = 0;
    this.z = 0;
    this.speed = 0;
    this.state = 'ready';
    this.stateT = 0;
    this.active = true;
    this.buildCourse(count);
    this.cart.position.set(0, 0, 0);
    this.updateLabel();
    this.hud.setHint('Drag left / right to steer through the best gates!');
    const names: Partial<Record<ItemType, string>> = { snack: 'snack packs', wrap: 'leaf wraps', candy: 'candies' };
    this.hud.banner('Ready…', `${count} ${names[itemType] ?? 'items'} loaded`, 1100);
  }

  private buildCourse(S: number) {
    this.dynamic.clear();
    this.rows = [];
    this.puddles = [];
    const { rows, rowSpacing, firstRow, laneHalfWidth } = CONFIG.run;
    this.finishZ = -(firstRow + rows * rowSpacing) + 6;
    const length = -this.finishZ + 60;

    const gutter = this.theme === 'gutter';
    // Ground: a dirt lane (grass theme) or a rain gutter full of water (gutter theme)
    const lane = new THREE.Mesh(
      new THREE.PlaneGeometry(laneHalfWidth * 2 + 0.6, length),
      new THREE.MeshStandardMaterial(gutter ? { color: 0x4aa8ff, roughness: 0.1, metalness: 0.2 } : { color: 0xc99561 }),
    );
    lane.rotation.x = -Math.PI / 2;
    lane.position.set(0, 0.01, -length / 2 + 20);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(120, length + 80), new THREE.MeshStandardMaterial({ color: 0x79c257 }));
    grass.rotation.x = -Math.PI / 2;
    grass.position.set(0, 0, -length / 2 + 20);
    this.dynamic.add(grass, lane);
    if (gutter) {
      // Metal gutter walls on both sides
      const wallMat = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.35, metalness: 0.5 });
      for (const sx of [-1, 1]) {
        const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, length), wallMat);
        wall.position.set(sx * (laneHalfWidth + 0.6), 0.7, -length / 2 + 20);
        this.dynamic.add(wall);
      }
    }

    // Tall grass walls (instanced for speed)
    const bladeGeo = new THREE.ConeGeometry(0.35, 1, 5);
    bladeGeo.translate(0, 0.5, 0);
    const count = 900;
    const blades = new THREE.InstancedMesh(bladeGeo, new THREE.MeshStandardMaterial({ color: 0x4f9a35 }), count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      const side = i % 2 ? 1 : -1;
      const x = side * rand(laneHalfWidth + 1.2, laneHalfWidth + 14);
      const z = rand(-length + 20, 20);
      const h = rand(1.5, 4.5);
      m.makeScale(rand(0.8, 1.6), h, rand(0.8, 1.6)).setPosition(x, 0, z);
      blades.setMatrixAt(i, m);
    }
    this.dynamic.add(blades);

    // Which rows get the special gates
    const xRow = 1 + Math.floor(Math.random() * 3);
    let qRow = 1 + Math.floor(Math.random() * (rows - 1));
    if (qRow === xRow) qRow = rows - 1;

    for (let r = 0; r < rows; r++) {
      const z = -(firstRow + r * rowSpacing);
      const plus = () => ({ kind: '+' as const, v: Math.max(2, Math.round(S * rand(0.2, 0.45))) });
      const minus = () => ({ kind: '-' as const, v: Math.max(1, Math.round(S * rand(0.25, 0.45))) });
      let pair: Op[];
      if (r === xRow) pair = [{ kind: 'x', v: 2 }, Math.random() < 0.5 ? minus() : plus()];
      else if (r === qRow) pair = [{ kind: '?', v: 0 }, plus()];
      else {
        const roll = Math.random();
        pair = roll < 0.45 ? [plus(), minus()] : roll < 0.75 ? [plus(), { kind: '/', v: 2 }] : [plus(), plus()];
      }
      if (Math.random() < 0.5) pair.reverse();
      const row: Row = { z, passed: false, gates: [] };
      pair.forEach((op, i) => row.gates.push(this.makeGate(op, i === 0 ? -1 : 1, z)));
      this.rows.push(row);

      // A puddle halfway to the next row, now and then
      if (r < rows - 1 && Math.random() < 0.6) {
        const p: Puddle = { x: rand(-laneHalfWidth + 1, laneHalfWidth - 1), z: z - rowSpacing / 2, r: 1.1, hit: false };
        this.puddles.push(p);
        if (gutter) {
          // A floating twig to steer around
          const twig = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, p.r * 2.2, 8), new THREE.MeshStandardMaterial({ color: 0x6b4a2f }));
          twig.rotation.z = Math.PI / 2;
          twig.rotation.y = rand(-0.4, 0.4);
          twig.position.set(p.x, 0.15, p.z);
          this.dynamic.add(twig);
        } else {
          const puddle = new THREE.Mesh(
            new THREE.CircleGeometry(p.r, 24),
            new THREE.MeshStandardMaterial({ color: 0x4aa8ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.85 }),
          );
          puddle.rotation.x = -Math.PI / 2;
          puddle.position.set(p.x, 0.03, p.z);
          this.dynamic.add(puddle);
        }
      }
    }

    // Checkered finish line
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 32;
    const g = c.getContext('2d')!;
    for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) {
      g.fillStyle = (i + j) % 2 ? '#111' : '#fff';
      g.fillRect(i * 16, j * 16, 16, 16);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const finish = new THREE.Mesh(new THREE.PlaneGeometry(laneHalfWidth * 2 + 0.6, 1.2), new THREE.MeshBasicMaterial({ map: tex }));
    finish.rotation.x = -Math.PI / 2;
    finish.position.set(0, 0.04, this.finishZ);
    this.dynamic.add(finish);
    const finishSign = new TextSprite(1.6, '#ffd166');
    finishSign.setText('FINISH');
    finishSign.sprite.position.set(0, 4.2, this.finishZ);
    this.dynamic.add(finishSign.sprite);
  }

  private makeGate(op: Op, side: -1 | 1, z: number): Gate {
    const group = new THREE.Group();
    group.position.set(side * 1.75, 0, z);
    const good = isGood(op.kind);
    const color = op.kind === '?' ? 0x9b5de5 : good ? 0x2f9bff : 0xff4d4d;
    const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    for (const px of [-1.6, 1.6]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.6, 8), postMat);
      post.position.set(px, 1.3, 0);
      group.add(post);
    }
    const panel = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(3.1, 2.3), panel);
    glass.position.y = 1.35;
    group.add(glass);

    // Big label on the gate
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 160;
    const ctx = canvas.getContext('2d')!;
    roundRect(ctx, 8, 8, 240, 144, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.0)';
    ctx.fill();
    gameText(ctx, opLabel(op), 128, 84, 104);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.625), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    label.position.set(0, 1.4, 0.02);
    group.add(label);
    this.dynamic.add(group);
    return { group, op, side, panel };
  }

  // --------------------------------------------------------------------------
  private updateLabel() {
    this.countLabel.setText(String(this.count), this.count >= this.startCount ? '#ffffff' : '#ffb3b3');
    // Rebuild the visible cargo pile (capped so it doesn't get silly).
    const show = Math.min(this.count, 36);
    if (show === this.shownCargo) return;
    this.shownCargo = show;
    this.cargo.clear();
    for (let i = 0; i < show; i++) {
      const it = makeItem(this.itemType);
      const layer = Math.floor(i / 9);
      const k = i % 9;
      it.position.set(((k % 3) - 1) * 0.56, layer * 0.32, (Math.floor(k / 3) - 1) * 0.5);
      this.cargo.add(it);
    }
  }

  private changeCount(next: number, at: THREE.Vector3, text: string, good: boolean) {
    this.count = Math.min(9999, next);
    this.updateLabel();
    this.labelPop = 1;
    this.hud.floatAt(at, this.camera, text, good ? 'big good' : 'big bad');
  }

  update(dt: number, move: THREE.Vector2) {
    if (!this.active) return;
    const { speed, steerSpeed, laneHalfWidth } = CONFIG.run;
    this.stateT += dt;

    if (this.state === 'ready') {
      if (this.stateT > 1.1) {
        this.state = 'run';
        this.hud.banner('GO!', '', 700);
      }
    } else if (this.state === 'run') {
      this.speed = Math.min(speed, this.speed + speed * dt * 1.5);
    } else {
      this.speed = Math.max(0, this.speed - speed * dt * 1.2);
    }

    // Steering (only while racing)
    if (this.state === 'run') {
      this.x = THREE.MathUtils.clamp(this.x + move.x * steerSpeed * dt, -laneHalfWidth + 1, laneHalfWidth - 1);
    }
    this.z -= this.speed * dt;
    this.cart.position.set(this.x, 0, this.z);
    this.cart.rotation.z = -move.x * 0.08 * (this.state === 'run' ? 1 : 0); // lean into turns
    animateCreature(this.beetle, dt, this.speed);

    // Gates
    for (const row of this.rows) {
      if (row.passed || this.z > row.z) continue;
      row.passed = true;
      const side = this.x < 0 ? -1 : 1;
      const gate = row.gates.find((g) => g.side === side)!;
      const before = this.count;
      const after = applyOp(before, gate.op, this.luck);
      const good = after >= before;
      let text = opLabel(gate.op);
      if (gate.op.kind === '?') text = after >= before ? '? = x3!' : '? = ÷2';
      this.changeCount(after, new THREE.Vector3(this.x, 2.5, this.z), text, good);
      good ? this.sfx.gateGood() : this.sfx.gateBad();
      // Chosen gate flashes, the other fades
      for (const g of row.gates) {
        g.panel.opacity = g === gate ? 0.9 : 0.12;
        g.group.scale.setScalar(g === gate ? 1.12 : 0.9);
      }
    }

    // Puddles
    for (const p of this.puddles) {
      if (p.hit || Math.abs(this.z - p.z) > p.r || Math.abs(this.x - p.x) > p.r + 0.7) continue;
      p.hit = true;
      const loss = CONFIG.run.puddleLoss * Math.max(0.3, 1 - this.luck * 0.06);
      const lost = Math.max(1, Math.ceil(this.count * loss));
      this.changeCount(Math.max(0, this.count - lost), new THREE.Vector3(this.x, 2.5, this.z), `${this.theme === 'gutter' ? '🪵' : '💦'} -${lost}`, false);
      this.sfx.splash();
    }

    // Finish
    if (this.state === 'run' && this.z <= this.finishZ) {
      this.state = 'done';
      this.stateT = 0;
      this.hud.setHint(null);
      const earned = Math.round(this.count * ITEM_VALUE[this.itemType] * this.cashMult);
      window.setTimeout(() => {
        this.hud.showResults(this.startCount, this.count, earned).then(() => {
          this.active = false;
          this.onDone(this.count);
        });
      }, 700);
    }

    // Label pop animation
    this.labelPop = Math.max(0, this.labelPop - dt * 3);
    const s = 1 + this.labelPop * 0.5;
    this.countLabel.sprite.scale.set(this.countLabel.width * s, 1.1 * s, 1);

    // Camera: behind and above the cart, looking down the lane
    const want = new THREE.Vector3(this.x * 0.5, 7.5, this.z + 10);
    this.camera.position.lerp(want, Math.min(1, dt * 6));
    this.camera.lookAt(this.x * 0.4, 0.5, this.z - 8);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 55;
    this.camera.updateProjectionMatrix();
  }
}

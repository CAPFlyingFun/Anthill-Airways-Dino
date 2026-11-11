// ============================================================================
// baseWorld.ts — Zone 1 "Nest Entrance": builds the map, owns every station,
// and runs the main idle-arcade loop:
//
//   gather crumbs -> oven -> sell / gate run -> cash -> unlock tiles -> repeat
//
// The interaction rule is always the same: stand in a zone and items hop
// between stacks one at a time on a timer.
// ============================================================================
import * as THREE from 'three';
import { CONFIG, TUTORIAL, UNLOCKS } from '../data/config';
import { Sfx } from '../core/audio';
import { SaveData } from '../core/save';
import { Hud } from '../ui/hud';
import { Player } from '../actors/player';
import { Worker } from '../actors/worker';
import { Flyers } from './items';
import { TextSprite } from './labels';
import { Bakery, Blocker, CashPad, Counter, DispatchPad, ResourcePile, UnlockTile, Zone } from './stations';

// Size of the dirt yard you can walk around in.
const YARD = { minX: -14, maxX: 14, minZ: -13, maxZ: 11 };

export class BaseWorld {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
  flyers = new Flyers(this.scene);
  player: Player;
  piles: ResourcePile[] = [];
  bakery: Bakery;
  counter: Counter;
  cashPad: CashPad;
  dispatch: DispatchPad | null = null;
  workers: Worker[] = [];
  tiles: UnlockTile[] = [];

  /** Set by main.ts: called when the player taps LAUNCH RUN. */
  onLaunch: (count: number) => void = () => {};

  private sun = new THREE.DirectionalLight(0xffffff, 2.6);
  private camOffset = new THREE.Vector3(0, 14, 10.5);
  private timers = { pile: 0, ovenIn: 0, ovenOut: 0, sell: 0, cash: 0, load: 0 };
  private bounds: Blocker = { minX: YARD.minX + 0.6, maxX: YARD.maxX - 0.6, minZ: YARD.minZ + 0.6, maxZ: YARD.maxZ - 0.6 };

  constructor(private hud: Hud, private sfx: Sfx, public save: SaveData) {
    this.buildEnvironment();

    this.player = new Player(this.scene);
    this.piles.push(new ResourcePile(this.scene, -8, -5, this.flyers));
    this.bakery = new Bakery(this.scene, 0, -9, this.flyers);
    this.cashPad = new CashPad(this.scene, 6.7, 0.8);
    this.counter = new Counter(this.scene, 9, -3, this.flyers, this.cashPad);
    this.counter.onSale = () => this.tutorialDone(3);

    for (const def of UNLOCKS) {
      this.tiles.push(new UnlockTile(this.scene, def, save.paid[def.id] ?? 0));
    }
    // Re-apply everything bought in earlier sessions (no animations).
    for (const id of save.unlocked) this.applyUnlock(id, false);
    this.refreshTiles(false);

    this.hud.setZone(save.unlocked.includes('expand') ? 'Brood Tunnels · soon' : 'Nest Entrance');
    this.hud.setCash(save.cash);
    this.showTutorial();
    this.camera.position.copy(this.player.pos).add(this.camOffset);
    this.camera.lookAt(this.player.pos);
  }

  // --------------------------------------------------------------------------
  // World building
  // --------------------------------------------------------------------------
  private buildEnvironment() {
    const s = this.scene;
    s.background = new THREE.Color(0x8fd3ff);
    s.fog = new THREE.Fog(0x8fd3ff, 50, 120);

    s.add(new THREE.HemisphereLight(0xffffff, 0x8d6e4a, 1.6));
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -22;
    sc.right = 22;
    sc.top = 22;
    sc.bottom = -22;
    sc.near = 1;
    sc.far = 60;
    this.sun.shadow.bias = -0.0005;
    s.add(this.sun, this.sun.target);

    // Grass
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x79c257, roughness: 1 }));
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    s.add(grass);

    // Dirt yard with a speckled texture drawn on a canvas
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 512;
    const c = canvas.getContext('2d')!;
    c.fillStyle = '#c99561';
    c.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2600; i++) {
      const shade = Math.random() < 0.5 ? 'rgba(120,80,40,0.25)' : 'rgba(255,230,190,0.25)';
      c.fillStyle = shade;
      const r = Math.random() * 4 + 1;
      c.beginPath();
      c.arc(Math.random() * 512, Math.random() * 512, r, 0, Math.PI * 2);
      c.fill();
    }
    const dirtTex = new THREE.CanvasTexture(canvas);
    dirtTex.colorSpace = THREE.SRGBColorSpace;
    dirtTex.wrapS = dirtTex.wrapT = THREE.RepeatWrapping;
    dirtTex.repeat.set(3, 3);
    const w = YARD.maxX - YARD.minX;
    const d = YARD.maxZ - YARD.minZ;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshStandardMaterial({ map: dirtTex, roughness: 1 }));
    yard.rotation.x = -Math.PI / 2;
    yard.position.set((YARD.minX + YARD.maxX) / 2, 0.01, (YARD.minZ + YARD.maxZ) / 2);
    yard.receiveShadow = true;
    s.add(yard);

    // Path where customers walk in from the right
    const path = new THREE.Mesh(new THREE.PlaneGeometry(40, 6.5), new THREE.MeshStandardMaterial({ color: 0xb98a58, roughness: 1 }));
    path.rotation.x = -Math.PI / 2;
    path.position.set(YARD.maxX + 20, 0.008, -2.2);
    path.receiveShadow = true;
    s.add(path);

    // Twig fence around the yard (gap on the right for customers)
    this.fence(YARD.minX, YARD.minZ, YARD.maxX, YARD.minZ);
    this.fence(YARD.minX, YARD.minZ, YARD.minX, YARD.maxZ);
    this.fence(YARD.minX, YARD.maxZ, YARD.maxX, YARD.maxZ);
    this.fence(YARD.maxX, YARD.minZ, YARD.maxX, -6.2);
    this.fence(YARD.maxX, 1.2, YARD.maxX, YARD.maxZ);

    // Grass tufts scattered outside the yard (one InstancedMesh = fast)
    const tuftGeo = new THREE.ConeGeometry(0.18, 0.9, 5);
    tuftGeo.translate(0, 0.45, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0x4f9a35 }), 700);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scl = new THREE.Vector3();
    let n = 0;
    while (n < 700) {
      const x = (Math.random() - 0.5) * 110;
      const z = (Math.random() - 0.5) * 90 - 5;
      const inYard = x > YARD.minX - 1 && x < YARD.maxX + 1 && z > YARD.minZ - 1 && z < YARD.maxZ + 1;
      const onPath = x > YARD.maxX && Math.abs(z + 2.2) < 3.5;
      const onRunway = Math.abs(z + 30) < 6;
      if (inYard || onPath || onRunway) continue;
      pos.set(x, 0, z);
      q.setFromAxisAngle(new THREE.Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(), Math.random() * 0.3);
      const k = 0.6 + Math.random() * 1.4;
      scl.set(k, k, k);
      tufts.setMatrixAt(n++, m.compose(pos, q, scl));
    }
    tufts.castShadow = true;
    s.add(tufts);

    // Teaser: the old airstrip just past the fence (Act 2!)
    const runway = new THREE.Mesh(new THREE.BoxGeometry(160, 0.06, 11), new THREE.MeshStandardMaterial({ color: 0x55595f, roughness: 0.9 }));
    runway.position.set(0, 0.03, -30);
    runway.receiveShadow = true;
    s.add(runway);
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5 });
    for (let x = -78; x <= 78; x += 8) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(4, 0.08, 0.5), dashMat);
      dash.position.set(x, 0.04, -30);
      s.add(dash);
    }
    const tire = new THREE.Mesh(new THREE.TorusGeometry(5, 2.2, 16, 40), new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 }));
    tire.position.set(-24, 7.2, -23);
    tire.rotation.y = 0.7;
    tire.castShadow = true;
    s.add(tire);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(2.9, 2.9, 2.6, 24), new THREE.MeshStandardMaterial({ color: 0xb0b6bd, metalness: 0.6, roughness: 0.4 }));
    hub.rotation.z = Math.PI / 2;
    hub.rotation.y = 0.7 + Math.PI / 2;
    hub.position.copy(tire.position);
    s.add(hub);
    const sign = new TextSprite(2.2, '#ffd166');
    sign.setText('OLD AIRSTRIP');
    sign.sprite.position.set(6, 4, -26);
    s.add(sign.sprite);
  }

  /** Straight run of fence posts + two rails. */
  private fence(x1: number, z1: number, x2: number, z2: number) {
    const mat = new THREE.MeshStandardMaterial({ color: 0x7a4f27, roughness: 0.9 });
    const len = Math.hypot(x2 - x1, z2 - z1);
    const posts = Math.max(2, Math.round(len / 1.6) + 1);
    const postGeo = new THREE.CylinderGeometry(0.12, 0.14, 1.3, 6);
    for (let i = 0; i < posts; i++) {
      const t = i / (posts - 1);
      const p = new THREE.Mesh(postGeo, mat);
      p.position.set(x1 + (x2 - x1) * t, 0.65, z1 + (z2 - z1) * t);
      p.castShadow = true;
      this.scene.add(p);
    }
    for (const y of [0.45, 0.95]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, len), mat);
      rail.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
      rail.rotation.y = Math.atan2(x2 - x1, z2 - z1);
      rail.castShadow = true;
      this.scene.add(rail);
    }
  }

  // --------------------------------------------------------------------------
  // Unlocks
  // --------------------------------------------------------------------------
  private applyUnlock(id: string, animate: boolean) {
    const def = UNLOCKS.find((u) => u.id === id);
    if (!def) return;
    const [x, z] = def.pos;
    switch (id) {
      case 'pile2': {
        const pile = new ResourcePile(this.scene, x, z, this.flyers);
        this.piles.push(pile);
        if (animate) this.flyers.grow(pile.group);
        break;
      }
      case 'cashier':
        this.counter.hireCashier(animate);
        break;
      case 'dispatch':
        this.dispatch = new DispatchPad(this.scene, x, z);
        if (animate) this.flyers.grow(this.dispatch.group);
        break;
      case 'carry1':
        this.player.carryMax += CONFIG.player.carryPerUpgrade;
        break;
      case 'worker1':
      case 'worker2': {
        const w = new Worker(this.scene, x, z);
        this.workers.push(w);
        if (animate) this.flyers.grow(w.model.root);
        break;
      }
      case 'oven2':
        this.bakery.makeFaster();
        break;
      case 'expand':
        this.hud.setZone('Brood Tunnels · soon');
        if (animate) this.hud.banner('Nest Entrance complete! 🎉', 'Next zone: the Brood Tunnels (coming in Phase 3)', 5000);
        break;
    }
  }

  private unlock(tile: UnlockTile) {
    const id = tile.def.id;
    this.save.unlocked.push(id);
    delete this.save.paid[id];
    tile.mesh.visible = false;
    this.applyUnlock(id, true);
    this.sfx.unlocked();
    this.hud.floatAt(tile.mesh.position.clone().setY(1.5), this.camera, 'UNLOCKED!', 'big gold');
    this.tutorialDone(5);
    this.refreshTiles(true);
  }

  /** Show tiles whose requirements are met and that aren't bought yet. */
  private refreshTiles(animate: boolean) {
    for (const t of this.tiles) {
      const owned = this.save.unlocked.includes(t.def.id);
      const ready = t.def.requires.every((r) => this.save.unlocked.includes(r));
      const show = !owned && ready;
      if (show && !t.mesh.visible && animate) this.flyers.grow(t.mesh);
      t.mesh.visible = show;
    }
  }

  // --------------------------------------------------------------------------
  // Tutorial
  // --------------------------------------------------------------------------
  private showTutorial() {
    const i = this.save.tutorial;
    this.hud.setHint(i < TUTORIAL.length ? TUTORIAL[i] : null);
  }

  /** Mark tutorial step `step` done (only if it's the current one). */
  private tutorialDone(step: number) {
    if (this.save.tutorial === step) {
      this.save.tutorial++;
      this.showTutorial();
    }
  }

  // --------------------------------------------------------------------------
  // Money
  // --------------------------------------------------------------------------
  addCash(amount: number) {
    this.save.cash += amount;
    this.hud.setCash(this.save.cash);
  }

  /** Called by main.ts when a gate run finishes. */
  receiveRunPayout(endCount: number) {
    const earned = endCount * CONFIG.run.valuePerItem;
    this.addCash(earned);
    this.sfx.unlocked();
    this.hud.floatAt(this.player.pos.clone().setY(2.5), this.camera, `+$${earned}`, 'big gold');
  }

  // --------------------------------------------------------------------------
  // Per-frame update
  // --------------------------------------------------------------------------
  /** Runs `fn` every `interval` seconds while `active` is true. */
  private every(key: keyof BaseWorld['timers'], dt: number, active: boolean, interval: number, fn: () => void) {
    if (!active) {
      this.timers[key] = interval; // first item hops right away next time
      return;
    }
    this.timers[key] += dt;
    while (this.timers[key] >= interval) {
      this.timers[key] -= interval;
      fn();
    }
  }

  update(dt: number, move: THREE.Vector2) {
    const p = this.player.pos;
    const blockers: Blocker[] = [this.bakery.blocker, this.counter.blocker];
    if (this.dispatch) blockers.push(this.dispatch.blocker);
    this.player.update(dt, move, blockers, this.bounds);

    for (const pile of this.piles) pile.update(dt);
    this.bakery.update(dt);
    this.counter.update(dt, this.counter.sellZone.contains(p), this.sfx);
    this.dispatch?.update(dt);
    for (const w of this.workers) w.update(dt, this.piles, this.bakery, this.flyers);

    const iv = CONFIG.player.pickupInterval;
    const me = this.player;

    // 1) Crumb piles -> player
    const pile = this.piles.find((pl) => pl.zone.contains(p));
    this.every('pile', dt, !!pile && me.canTake('crumb'), iv, () => {
      if (pile && me.canTake('crumb') && this.flyers.transfer(pile.stack, me.stack)) {
        this.sfx.pickup();
        this.tutorialDone(0);
      }
    });

    // 2) Player crumbs -> oven IN
    const atIn = this.bakery.inZone.contains(p) && me.stack.topType === 'crumb';
    this.every('ovenIn', dt, atIn, iv, () => {
      if (me.stack.topType === 'crumb' && this.flyers.transfer(me.stack, this.bakery.input)) {
        this.sfx.drop();
        this.tutorialDone(1);
      }
    });

    // 3) Oven OUT -> player snacks
    const atOut = this.bakery.outZone.contains(p) && me.canTake('snack');
    this.every('ovenOut', dt, atOut, iv, () => {
      if (me.canTake('snack') && this.flyers.transfer(this.bakery.output, me.stack)) {
        this.sfx.pickup();
        this.tutorialDone(2);
      }
    });

    // 4) Player snacks -> counter shelf
    const atSell = this.counter.sellZone.contains(p) && me.stack.topType === 'snack';
    this.every('sell', dt, atSell, iv, () => {
      if (me.stack.topType === 'snack' && this.flyers.transfer(me.stack, this.counter.shelf)) this.sfx.drop();
    });

    // 5) Cash pad -> wallet
    const atCash = this.cashPad.zone.contains(p);
    this.every('cash', dt, atCash, 0.035, () => {
      const bill = this.cashPad.stack.pop();
      if (!bill) return;
      const target = new THREE.Vector3();
      this.flyers.fly(
        bill.mesh,
        () => target.copy(p).setY(1.2),
        () => {
          bill.mesh.removeFromParent();
          this.addCash(bill.value);
          this.sfx.cash();
          this.tutorialDone(4);
        },
        0.22,
        0.8,
      );
    });

    // 6) Player snacks -> gate-run cart
    const d = this.dispatch;
    const atLoad = !!d && d.zone.contains(p);
    this.every('load', dt, atLoad && me.stack.topType === 'snack', iv, () => {
      if (d && me.stack.topType === 'snack' && this.flyers.transfer(me.stack, d.cargo)) this.sfx.drop();
    });
    if (d && atLoad && d.cargo.count >= CONFIG.cart.minLaunch) {
      this.hud.setLaunch(d.cargo.count, () => {
        const count = d.cargo.count;
        d.cargo.clear();
        this.hud.setLaunch(null);
        this.onLaunch(count);
      });
    } else {
      this.hud.setLaunch(null);
    }

    // 7) Unlock tiles: stand on one to pour cash in
    for (const t of this.tiles) {
      if (!t.mesh.visible) continue;
      const affordable = this.save.cash >= 1;
      t.update(dt, affordable && this.save.cash >= t.remaining);
      if (affordable && t.zone.contains(p)) {
        const rate = Math.max(t.def.cost / CONFIG.unlockDrainTime, CONFIG.unlockMinRate);
        const pay = Math.min(this.save.cash, rate * dt, t.def.cost - t.paid);
        t.paid += pay;
        this.save.cash -= pay;
        this.save.paid[t.def.id] = t.paid;
        this.hud.setCash(this.save.cash);
        this.sfx.unlockTick();
        if (t.paid >= t.def.cost - 1e-6) this.unlock(t);
      }
    }

    this.flyers.update(dt);
    this.updateCamera(dt);
  }

  private updateCamera(dt: number) {
    const target = this.player.pos;
    const want = new THREE.Vector3().copy(target).add(this.camOffset);
    this.camera.position.lerp(want, Math.min(1, dt * 5));
    this.camera.lookAt(this.camera.position.x - this.camOffset.x, 0, this.camera.position.z - this.camOffset.z);
    // Keep the shadow box centered on the player.
    this.sun.position.set(target.x + 8, 20, target.z + 9);
    this.sun.target.position.copy(target);
  }

  resize(w: number, h: number) {
    this.camera.aspect = w / h;
    // Portrait phones need the camera further back to see enough of the yard.
    const portrait = w < h;
    this.camOffset.set(0, portrait ? 21 : 14.5, portrait ? 19 : 14);
    this.camera.fov = portrait ? 58 : 42;
    this.camera.updateProjectionMatrix();
  }
}

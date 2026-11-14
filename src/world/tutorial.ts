// ============================================================================
// tutorial.ts — 🎓 the guided first-time tutorial (colony only).
//
// A brand-new game opens with a welcome card: ▶️ Show me how, or Skip.
// The tutorial then walks you through the first area step by step:
//   • a short hint at the top says what to do (with a small "Skip" button),
//   • a bouncing yellow arrow + a glowing ring point at WHERE to do it,
//   • each step finishes by itself when you've done it.
// It ends when the second area (🗺️ Big Order: Tunnels) is unlocked, with a
// card saying everything else is in ⚙️ Settings → 📖 How to play
// (ui/howto.ts), where the tutorial can also be replayed.
//
// save.tutorial = index of the current step (TUTORIAL_DONE = finished/skipped).
// Steps 0-5 are the same as the old six hints, so a game that was mid-way
// through them just carries on.
// ============================================================================
import * as THREE from 'three';
import type { BaseWorld } from './baseWorld';
import type { Hud } from '../ui/hud';
import type { SaveData } from '../core/save';
import { UNLOCKS } from '../data/config';

/** save.tutorial value for "finished or skipped". */
export const TUTORIAL_DONE = 100;

interface Step {
  /** The hint text (may show a cost, so it's worked out each time). */
  text: () => string;
  /** Where the arrow points (null = no arrow). */
  target: () => THREE.Vector3 | null;
  /** Finished by itself? (Steps 0-4 are finished by actions: see did().) */
  done?: () => boolean;
}

export class Tutorial {
  /** The bouncing arrow + glowing ring over the current target. */
  private arrow = new THREE.Group();
  private ring: THREE.Mesh;
  private t = 0;
  private shown = '';
  private steps: Step[];
  /** The welcome card is up (the tutorial waits for an answer). */
  private asking = false;
  private tmp = new THREE.Vector3();
  /** 2D arrow at the screen edge when the target is off-screen. */
  private edge = document.createElement('div');

  constructor(private world: BaseWorld, private hud: Hud, private save: SaveData) {
    this.edge.className = 'tut-edge hidden';
    this.edge.innerHTML = '<b>➜</b>';
    document.getElementById('hud')?.appendChild(this.edge);
    // One-time update of older saves: they finished the old 6-hint tutorial
    // (or were past it), so they don't get the new steps or the welcome card.
    if (!save.paid['tut-v2']) {
      if (save.tutorial >= 6 || save.unlocked.length > 3) save.tutorial = TUTORIAL_DONE;
      save.paid['tut-v2'] = 1;
    }
    this.steps = this.makeSteps();
    this.buildArrow();
    this.ring = this.arrow.userData.ring as THREE.Mesh;
  }

  /** True while the tutorial is still running. */
  get running() {
    return this.save.tutorial < TUTORIAL_DONE;
  }

  // --------------------------------------------------------------------------
  // The steps
  // --------------------------------------------------------------------------
  private makeSteps(): Step[] {
    const w = this.world;
    const at = (z: { x: number; z: number } | null | undefined) => (z ? new THREE.Vector3(z.x, 0, z.z) : null);
    const crumbs = () => w.piles.find((p) => p.type === 'crumb') ?? w.piles[0];
    const owns = (id: string) => this.save.unlocked.includes(id);
    // "Unlock X" steps: the arrow shows X's tile, or (if it isn't out yet) the
    // tile you need to buy first.
    const unlockStep = (id: string, text: string): Step => ({
      text: () => `${text}${this.costOf(id)}`,
      target: () => this.pathTo(id),
      done: () => owns(id),
    });
    return [
      // 0-5: the basics (same order as the old hints)
      { text: () => '👆 Drag anywhere to walk. Go to the crumb pile 🍞 to pick up crumbs', target: () => at(crumbs()?.zone) },
      { text: () => '🔥 Carry the crumbs to the oven\'s IN pad', target: () => at(w.bakery?.inZone) },
      { text: () => '📦 The oven bakes snack packs. Pick them up from its OUT pad', target: () => at(w.bakery?.outZone) },
      { text: () => '🛒 Stand on SELL to stock the counter. Customers buy the snacks', target: () => at(w.counter?.sellZone) },
      { text: () => '💵 Customers paid! Walk over the cash to collect it', target: () => at(this.fullestPad()?.zone) },
      {
        text: () => '✨ Glowing tiles unlock new things. Stand on one: your cash pours in until it\'s bought',
        target: () => this.cheapestTile(),
        done: () => this.save.unlocked.length > 0,
      },
      // 6+: growing the colony
      unlockStep('cashier', '🧾 Hire a Cashier: she serves customers even when you\'re not at the counter'),
      unlockStep('worker1', '🐜 Hire a Worker Ant: he carries crumbs to the oven for you'),
      {
        text: () => '⬆️ Upgrade pads appeared by your buildings! Stand on a round ⬆️ pad to make it faster or earn more',
        target: () => w.ups?.nearestPad(w.player.pos) ?? null,
        done: () => Object.entries(this.save.upgrades).some(([k, v]) => k.startsWith('c1-') && v > 0),
      },
      unlockStep('runner', '🏃 A Runner Ant moves snacks from the oven to the counter'),
      unlockStep('banker', '💼 A Banker Ant collects the cash by himself: that\'s your idle income (+$/min)'),
      unlockStep('dispatch', '🚩 Unlock Gate Runs: a mini-game that multiplies your snacks'),
      {
        text: () => '🚩 Drop 5+ snacks on the cart pad, tap 🚀 LAUNCH RUN, then drag left/right through the best gates',
        target: () => at(w.dispatches[0]?.zone),
        done: () => (this.save.totals.runs ?? 0) > 0,
      },
      unlockStep('expand', '🗺️ Big goal: unlock Big Order: Tunnels to open a new area! The arrow shows what to buy next'),
    ];
  }

  /** " · $90" for a tile that's out (what's still left to pay). */
  private costOf(id: string) {
    const tile = this.world.tiles.find((t) => t.def.id === id);
    if (!tile || !tile.mesh.visible) return '';
    return ` · $${Math.ceil(tile.remaining).toLocaleString('en-US')}`;
  }

  /** The tile to stand on to get closer to unlocking `id` (follows its requirements). */
  private pathTo(id: string, depth = 0): THREE.Vector3 | null {
    if (depth > 6 || this.save.unlocked.includes(id)) return null;
    const tile = this.world.tiles.find((t) => t.def.id === id);
    if (tile?.mesh.visible) return tile.mesh.position.clone().setY(0);
    const def = UNLOCKS.find((d) => d.id === id);
    for (const r of def?.requires ?? []) {
      const p = this.pathTo(r, depth + 1);
      if (p) return p;
    }
    return null;
  }

  private cheapestTile() {
    let best: THREE.Vector3 | null = null;
    let cost = Infinity;
    for (const t of this.world.tiles) {
      if (t.mesh.visible && t.remaining < cost) {
        cost = t.remaining;
        best = t.mesh.position.clone().setY(0);
      }
    }
    return best;
  }

  private fullestPad() {
    const pads = this.world.cashPads;
    return pads.reduce((b, p) => (p.stack.count > (b?.stack.count ?? -1) ? p : b), pads[0] ?? null);
  }

  // --------------------------------------------------------------------------
  // The arrow
  // --------------------------------------------------------------------------
  private buildArrow() {
    // A flat down-arrow that always faces the camera (reads clearly from the
    // top-down view), drawn on top of everything.
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 160;
    const g = c.getContext('2d')!;
    g.beginPath();
    g.moveTo(40, 8); g.lineTo(88, 8); g.lineTo(88, 80); g.lineTo(118, 80);
    g.lineTo(64, 150); g.lineTo(10, 80); g.lineTo(40, 80); g.closePath();
    g.lineJoin = 'round';
    g.lineWidth = 12;
    g.strokeStyle = '#8a5a00';
    g.stroke();
    g.fillStyle = '#ffd23f';
    g.fill();
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    sprite.scale.set(1.1, 1.375, 1);
    sprite.center.set(0.5, 0); // (its tip is the bottom edge)
    sprite.renderOrder = 999;
    const pointer = new THREE.Group();
    pointer.add(sprite);
    pointer.name = 'pointer';
    // A glowing ring on the ground around the spot
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.0, 1.25, 40),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.12;
    ring.renderOrder = 997;
    this.arrow.add(pointer, ring);
    this.arrow.userData.ring = ring;
    this.arrow.visible = false;
    this.world.scene.add(this.arrow);
  }

  // --------------------------------------------------------------------------
  // Running it
  // --------------------------------------------------------------------------
  /** An action finished step `step` (only counts if it's the current one). */
  did(step: number) {
    if (this.save.tutorial === step) this.advance();
  }

  private advance() {
    this.save.tutorial++;
    if (this.save.tutorial >= this.steps.length) this.finish();
  }

  /** Coming back to the colony (or after a gate run): show the hint again. */
  refresh() {
    this.shown = '';
  }

  update(dt: number, active: boolean) {
    if (!active) {
      this.arrow.visible = false;
      this.edge.classList.add('hidden');
      return;
    }
    // A brand-new game: the welcome card first
    // (and only when no other card is up: one card at a time)
    const cardUp = !document.getElementById('guide')?.classList.contains('hidden');
    if (this.save.tutorial === 0 && !this.save.paid['tut-intro'] && !this.asking && !cardUp) this.intro();
    if (this.asking || !this.running) {
      this.arrow.visible = false;
      this.edge.classList.add('hidden');
      if (!this.running && this.shown) this.setHint(null);
      return;
    }
    // Skip steps that are already done (e.g. bought before they came up)
    let guard = 0;
    while (this.running && this.steps[this.save.tutorial]?.done?.() && guard++ < 30) this.advance();
    if (!this.running) return;
    const step = this.steps[this.save.tutorial];
    this.setHint(step.text());
    // The arrow
    const target = step.target();
    this.arrow.visible = !!target;
    if (target) {
      this.t += dt;
      this.tmp.copy(target);
      this.arrow.position.lerp(this.tmp, this.arrow.position.lengthSq() === 0 ? 1 : Math.min(1, dt * 8));
      const pointer = this.arrow.getObjectByName('pointer')!;
      pointer.position.y = 0.9 + Math.abs(Math.sin(this.t * 4)) * 0.45;
      const pulse = 1 + Math.sin(this.t * 4) * 0.08;
      this.ring.scale.set(pulse, pulse, pulse);
    }
    this.updateEdge(target);
  }

  /** Off-screen target: put the 2D arrow on the screen edge, pointing toward it. */
  private updateEdge(target: THREE.Vector3 | null) {
    if (!target) {
      this.edge.classList.add('hidden');
      return;
    }
    const v = this.tmp.copy(target).setY(1).project(this.world.camera);
    const behind = v.z > 1;
    let x = behind ? -v.x : v.x;
    let y = behind ? -v.y : v.y;
    const onScreen = !behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.85;
    this.edge.classList.toggle('hidden', onScreen);
    if (onScreen) return;
    // Push the point out to the edge of an inset box, along the line from the centre
    const k = 1 / Math.max(Math.abs(x) / 0.82, Math.abs(y) / 0.72, 1e-6);
    x *= k;
    y *= k;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.edge.style.left = `${((x + 1) / 2) * w}px`;
    this.edge.style.top = `${((1 - y) / 2) * h}px`;
    const angle = Math.atan2(-y * h, x * w); // (screen y grows downward)
    (this.edge.firstElementChild as HTMLElement).style.transform = `rotate(${angle}rad)`;
  }

  private setHint(text: string | null) {
    if (text === this.shown) return;
    this.shown = text ?? '';
    this.hud.setHint(text, text ? () => this.skip() : undefined);
  }

  /** The welcome card for a brand-new game. */
  private intro() {
    this.asking = true;
    this.save.paid['tut-intro'] = 1;
    this.hud.showGuide(
      '🐜 Welcome to Anthill Airways!',
      `<p>You're a little ant with big plans. Collect food, make snacks, sell them, and spend the cash on
       <b>new helpers, machines and whole new areas</b>, all the way up to your own airport ✈️, a dino island 🦖 and more.</p>
       <p>Want a quick walkthrough? A yellow arrow 🔽 shows you where to go.</p>`,
      [
        { label: '▶️ Show me how', cls: 'big-btn', onClick: () => (this.asking = false) },
        {
          label: 'Skip tutorial',
          cls: 'menu-btn',
          onClick: () => {
            this.asking = false;
            this.skip();
          },
        },
      ],
    );
  }

  /** Skip the rest (Settings → How to play has it all, and can replay it). */
  skip() {
    this.save.tutorial = TUTORIAL_DONE;
    this.arrow.visible = false;
    this.edge.classList.add('hidden');
    this.setHint(null);
    this.hud.banner('ℹ️ No problem!', 'How to play is in ⚙️ Settings anytime', 4000);
  }

  private finish() {
    this.save.tutorial = TUTORIAL_DONE;
    this.arrow.visible = false;
    this.edge.classList.add('hidden');
    this.setHint(null);
    this.hud.showGuide(
      '🎉 You\'ve got the basics!',
      `<p>The Tunnels are open: a new area with new food to sell. From here, keep doing what you've learned:</p>
       <ul>
         <li>💵 Sell, collect, and unlock the glowing tiles</li>
         <li>🐜 Hire helpers so the colony runs (and earns) by itself</li>
         <li>⬆️ Upgrade buildings and helpers on the round pads</li>
         <li>🛫 Tap the <b>Next</b> chip (top left) to see what's next on your route</li>
       </ul>
       <p>ℹ️ Everything else (gate runs, stats, offline earnings, new worlds) is in
       <b>⚙️ Settings → 📖 How to play</b>.</p>`,
      [{ label: '🚀 Let\'s go!', cls: 'big-btn' }],
    );
  }

  /** Settings → 📖 How to play → 🔁 Replay: start over (skipping what's already done). */
  replay() {
    this.save.tutorial = 0;
    this.save.paid['tut-intro'] = 1; // (no welcome card: they asked for it)
    this.refresh();
  }
}

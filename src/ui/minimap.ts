// ============================================================================
// minimap.ts — 🗺️ the little round map in the top right (🏝️ Anthill Island),
// after Beyond Extinction's: north up, centred on you (the blue arrow points
// where you face), the quest is a pulsing gold ring (or, when it's off the
// little map, a gold arrow on its edge pointing the way). Tap it for the whole
// map, with names; tap anywhere to close it.
//
// The world hands it a MapView (what's where right now) and it draws that on a
// canvas, a few times a second. World x = map right (east), world z = map down
// (south): the same way round as the game's own camera.
// ============================================================================

import { roundRect } from '../world/labels';

export interface MapRect { minX: number; maxX: number; minZ: number; maxZ: number }
export interface MapSeg { x0: number; z0: number; x1: number; z1: number }
export interface MapArea { rect: MapRect; fill: string; edge?: string; dashed?: boolean; label?: string }
export interface MapMarker { x: number; z: number; icon: string; label?: string; alert?: boolean }
export interface MapView {
  areas: MapArea[];                             // the ground: lawn, patio, house, street…
  trees: { x: number; z: number; r: number }[];
  fences: MapSeg[];
  markers: MapMarker[];                         // the stations (emoji)
  tiles: { x: number; z: number }[];            // glowing tiles you can buy
  player: { x: number; z: number; yaw: number }; // yaw = the model's rotation.y
  target: { x: number; z: number } | null;      // the quest
}

const GRASS = '#5f9f47';
const FENCE = 'rgba(255, 255, 255, 0.95)';
const GOLD = '#ffd23f';
const ME = '#2d8fdf';

export class Minimap {
  private root = document.createElement('div');
  private small = document.createElement('canvas');
  private big = document.createElement('div');
  private bigCanvas = document.createElement('canvas');
  private isBig = false;
  private t = 0;
  private acc = 1;

  /** `bounds`: the whole map (the big view fits it); `radius`: world units from you to the little map's edge. */
  constructor(parent: HTMLElement, private bounds: MapRect, private source: () => MapView, private radius = 15) {
    this.root.className = 'minimap';
    this.root.setAttribute('role', 'button');
    this.root.setAttribute('aria-label', 'Map (tap for the whole map)');
    this.root.appendChild(this.small);
    parent.appendChild(this.root);
    this.root.addEventListener('click', () => this.open(true));

    this.big.className = 'map-big hidden';
    this.big.innerHTML = '<div class="map-big-title">🗺️ Map <small>(tap to close)</small></div>';
    this.big.appendChild(this.bigCanvas);
    document.getElementById('hud')!.appendChild(this.big);
    this.big.addEventListener('click', () => this.open(false));
    window.addEventListener('resize', () => (this.acc = 1));
  }

  /** Open / close the whole map. */
  open(on: boolean) {
    this.isBig = on;
    this.big.classList.toggle('hidden', !on);
    this.acc = 1; // (draw right away)
  }

  get opened() {
    return this.isBig;
  }

  /** Call every frame (it redraws ~10 times a second). */
  update(dt: number) {
    this.t += dt;
    this.acc += dt;
    if (this.acc < 0.1) return;
    this.acc = 0;
    const view = this.source();
    if (this.root.offsetParent !== null) this.drawSmall(view);
    if (this.isBig) this.drawBig(view);
  }

  /** Size a canvas's pixels to its CSS box (sharp on a retina screen); returns the box. */
  private fit(c: HTMLCanvasElement, w: number, h: number) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    if (c.width !== W || c.height !== H) {
      c.width = W;
      c.height = H;
    }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return g;
  }

  // --------------------------------------------------------------------------
  // The little round map: a window around you
  // --------------------------------------------------------------------------
  private drawSmall(v: MapView) {
    const size = this.root.clientWidth;
    if (!size) return;
    const g = this.fit(this.small, size, size);
    const r = size / 2;
    const sc = r / this.radius;
    const px = v.player.x;
    const pz = v.player.z;
    const X = (x: number) => r + (x - px) * sc;
    const Z = (z: number) => r + (z - pz) * sc;
    g.clearRect(0, 0, size, size);
    g.save();
    try {
      g.beginPath();
      g.arc(r, r, r, 0, Math.PI * 2);
      g.clip();
      this.paintWorld(g, v, X, Z, sc, size / 104);
      // The quest: a ring on the map, or an arrow on the edge pointing the way
      if (v.target) {
        const dx = v.target.x - px;
        const dz = v.target.z - pz;
        const d = Math.hypot(dx, dz) * sc;
        if (d < r - 8) this.ring(g, X(v.target.x), Z(v.target.z), 6);
        else this.edgeArrow(g, r, Math.atan2(dz, dx), r - 9);
      }
      this.arrow(g, r, r, v.player.yaw, 8);
    } finally {
      g.restore();
    }
  }

  // --------------------------------------------------------------------------
  // The whole map (tap the little one)
  // --------------------------------------------------------------------------
  private drawBig(v: MapView) {
    const b = this.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxZ - b.minZ;
    const maxW = window.innerWidth * 0.92;
    const maxH = window.innerHeight * 0.78;
    const k = Math.min(maxW / bw, maxH / bh);
    const w = Math.round(bw * k);
    const h = Math.round(bh * k);
    this.bigCanvas.style.width = `${w}px`;
    this.bigCanvas.style.height = `${h}px`;
    const g = this.fit(this.bigCanvas, w, h);
    const X = (x: number) => (x - b.minX) * k;
    const Z = (z: number) => (z - b.minZ) * k;
    g.clearRect(0, 0, w, h);
    g.save();
    try {
      this.paintWorld(g, v, X, Z, k, Math.min(1.25, k / 4), true);
      if (v.target) this.ring(g, X(v.target.x), Z(v.target.z), 9);
      this.arrow(g, X(v.player.x), Z(v.player.z), v.player.yaw, 11);
    } finally {
      g.restore();
    }
  }

  /** The ground, trees, fences, tiles and stations (`labels`: names under them, big map). */
  private paintWorld(
    g: CanvasRenderingContext2D, v: MapView, X: (x: number) => number, Z: (z: number) => number,
    sc: number, k: number, labels = false,
  ) {
    g.fillStyle = GRASS;
    g.fillRect(-9999, -9999, 19999, 19999);
    for (const a of v.areas) {
      const x = X(a.rect.minX);
      const z = Z(a.rect.minZ);
      const w = (a.rect.maxX - a.rect.minX) * sc;
      const h = (a.rect.maxZ - a.rect.minZ) * sc;
      g.fillStyle = a.fill;
      g.fillRect(x, z, w, h);
      if (a.edge) {
        g.strokeStyle = a.edge;
        g.lineWidth = 1.5;
        g.setLineDash(a.dashed ? [4, 3] : []);
        g.strokeRect(x, z, w, h);
        g.setLineDash([]);
      }
    }
    g.fillStyle = '#3d7f30';
    for (const t of v.trees) {
      g.beginPath();
      g.arc(X(t.x), Z(t.z), t.r * sc, 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = FENCE;
    g.lineWidth = Math.max(1.5, 0.35 * sc);
    g.lineCap = 'round';
    g.beginPath();
    for (const f of v.fences) {
      g.moveTo(X(f.x0), Z(f.z0));
      g.lineTo(X(f.x1), Z(f.z1));
    }
    g.stroke();
    // Tiles to buy: little gold squares, gently pulsing
    const pulse = 0.75 + 0.25 * Math.sin(this.t * 4);
    for (const t of v.tiles) {
      const s = Math.max(5, 2.2 * sc) * (0.9 + 0.1 * pulse);
      g.fillStyle = `rgba(255, 210, 63, ${0.55 + 0.4 * pulse})`;
      g.strokeStyle = '#8a5a00';
      g.lineWidth = 1.2;
      roundRect(g, X(t.x) - s / 2, Z(t.z) - s / 2, s, s, 2); // (the game's own: older iPhones lack ctx.roundRect)
      g.fill();
      g.stroke();
    }
    // Area names (big map)
    if (labels) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.round(11 * k)}px "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif`;
      for (const a of v.areas) {
        if (!a.label) continue;
        this.text(g, a.label.toUpperCase(), X((a.rect.minX + a.rect.maxX) / 2), Z(a.rect.minZ) + 9 * k, 'rgba(255,255,255,0.9)');
      }
    }
    // The stations
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const icon = Math.round((labels ? 20 : 13) * k);
    for (const m of v.markers) {
      const x = X(m.x);
      const z = Z(m.z);
      g.font = `${icon}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      g.fillText(m.icon, x, z);
      if (m.alert) {
        const ax = x + icon * 0.45;
        const az = z - icon * 0.45;
        const ar = Math.max(4, icon * 0.28);
        g.fillStyle = '#e63946';
        g.beginPath();
        g.arc(ax, az, ar, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#fff';
        g.font = `900 ${Math.round(ar * 1.6)}px system-ui, sans-serif`;
        g.fillText('!', ax, az + 0.5);
      }
      if (labels && m.label) {
        g.font = `800 ${Math.round(11 * k)}px "Arial Rounded MT Bold", "Trebuchet MS", system-ui, sans-serif`;
        this.text(g, m.label, x, z + icon * 0.85, '#fff');
      }
    }
  }

  /** White text with a dark outline (readable on grass, patio or street). */
  private text(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string) {
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(0, 0, 0, 0.65)';
    g.lineJoin = 'round';
    g.strokeText(s, x, y);
    g.fillStyle = color;
    g.fillText(s, x, y);
  }

  /** You: an arrow pointing where you face. */
  private arrow(g: CanvasRenderingContext2D, x: number, z: number, yaw: number, s: number) {
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    g.beginPath();
    g.moveTo(x + fx * s, z + fz * s);
    g.lineTo(x - fx * s * 0.7 - fz * s * 0.75, z - fz * s * 0.7 + fx * s * 0.75);
    g.lineTo(x - fx * s * 0.35, z - fz * s * 0.35);
    g.lineTo(x - fx * s * 0.7 + fz * s * 0.75, z - fz * s * 0.7 - fx * s * 0.75);
    g.closePath();
    g.fillStyle = ME;
    g.strokeStyle = '#fff';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke();
    g.fill();
  }

  /** The quest: a pulsing gold ring. */
  private ring(g: CanvasRenderingContext2D, x: number, z: number, s: number) {
    const p = s + 2 * Math.sin(this.t * 5);
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(90, 58, 0, 0.8)';
    g.beginPath();
    g.arc(x, z, p + 1, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = GOLD;
    g.lineWidth = 2.5;
    g.beginPath();
    g.arc(x, z, p, 0, Math.PI * 2);
    g.stroke();
  }

  /** The quest is off the little map: a gold arrow on its edge, pointing the way. */
  private edgeArrow(g: CanvasRenderingContext2D, r: number, angle: number, at: number) {
    const x = r + Math.cos(angle) * at;
    const z = r + Math.sin(angle) * at;
    const bob = 1.5 * Math.sin(this.t * 6);
    g.save();
    g.translate(x + Math.cos(angle) * bob, z + Math.sin(angle) * bob);
    g.rotate(angle);
    g.beginPath();
    g.moveTo(7, 0);
    g.lineTo(-5, -6);
    g.lineTo(-2, 0);
    g.lineTo(-5, 6);
    g.closePath();
    g.fillStyle = GOLD;
    g.strokeStyle = '#8a5a00';
    g.lineWidth = 2;
    g.lineJoin = 'round';
    g.stroke();
    g.fill();
    g.restore();
  }
}

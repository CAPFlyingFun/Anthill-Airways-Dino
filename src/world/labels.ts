// ============================================================================
// labels.ts — text drawn onto canvases and used as textures:
//   TextSprite — floating label that always faces the camera
//   makePad    — the dashed "stand here" squares on the ground
// ============================================================================
import * as THREE from 'three';

export const GAME_FONT = '"Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws outlined "game style" text (white fill, dark outline). */
export function gameText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, fill = '#fff', stroke = '#2a2a2a') {
  ctx.font = `900 ${size}px ${GAME_FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = size * 0.18;
  ctx.strokeStyle = stroke;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

export class TextSprite {
  sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private text = '';

  constructor(private size = 1, private color = '#fff') {
    this.canvas.width = 256;
    this.canvas.height = 128;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(this.size * 2, this.size, 1);
    this.sprite.renderOrder = 10;
  }

  setText(text: string, color = this.color) {
    if (text === this.text) return;
    this.text = text;
    const c = this.ctx;
    c.clearRect(0, 0, 256, 128);
    if (text) gameText(c, text, 128, 66, 72, color);
    this.tex.needsUpdate = true;
  }
}

/** A dashed rounded square on the ground, like the "SELL" pad in idle games. */
export function makePad(width: number, depth: number, label = '', color = '#4fe3ff'): THREE.Mesh {
  const px = 96; // canvas pixels per world unit
  const cw = Math.round(width * px);
  const ch = Math.round(depth * px);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const c = canvas.getContext('2d')!;
  const inset = 10;
  roundRect(c, inset, inset, cw - inset * 2, ch - inset * 2, 28);
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.fill();
  c.setLineDash([26, 18]);
  c.lineWidth = 12;
  c.strokeStyle = color;
  c.stroke();
  if (label) gameText(c, label, cw / 2, ch / 2 + 4, Math.min(ch * 0.34, cw * 0.3), '#fff', 'rgba(0,0,0,0.55)');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2; // lie flat; the text's "up" points away from the camera
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  return mesh;
}

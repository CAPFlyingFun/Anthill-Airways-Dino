// ============================================================================
// labels.ts — text drawn onto canvases and used as textures:
//   TextSprite — floating label that always faces the camera
//   makePad    — the dashed "stand here" squares on the ground
// ============================================================================
import * as THREE from 'three';
import { Text, preloadFont } from 'troika-three-text';
// A chunky rounded font, bundled with the game (works offline). Fredoka, SIL Open Font License.
import FONT_URL from '@fontsource/fredoka/files/fredoka-latin-700-normal.woff?url';

export const GAME_FONT = '"Arial Rounded MT Bold", "Trebuchet MS", "Segoe UI", system-ui, sans-serif';

/**
 * TEXT SHARPNESS: every label is drawn on a canvas this many times bigger
 * than "1x", so text stays crisp on the iPhone's high-res screen even when
 * the camera is close. (2 = retina-sharp.)
 */
export const TEXT_RES = 2;

/** Wrap a canvas as a crisp, color-correct texture that stays sharp at an angle. */
export function sharpTexture(canvas: HTMLCanvasElement) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 16; // keeps ground text readable at a slant (three.js caps it to what the phone supports)
  return tex;
}

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

// ----------------------------------------------------------------------------
// GROUND TEXT: words painted on the floor (pads, unlock tiles). These used to
// be drawn into canvas images, which go blurry/pixelated when seen up close or
// at a low angle. Now they're SDF text: drawn from the font's shapes on the
// GPU, so they stay razor sharp at any distance, angle or zoom.
// ----------------------------------------------------------------------------
const ASCII = /^[\x20-\x7e]*$/;

/** Start loading the font early so the first labels appear right away. */
export function preloadGroundFont() {
  return new Promise<void>((resolve) => preloadFont({ font: FONT_URL, characters: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$:-,.!?&' }, resolve));
}

/** Can this label be drawn as ground text? (The font has no emoji.) */
export function isGroundTextable(text: string) {
  return ASCII.test(text);
}

/**
 * Flat, crisp text lying in its parent's XY plane (so it can sit on a pad
 * that's already rotated flat). Shrinks itself to fit `maxWidth`.
 */
export function groundText(text: string, size: number, color = '#ffffff', maxWidth = Infinity) {
  const t = new Text();
  t.font = FONT_URL;
  t.text = text;
  t.fontSize = size;
  t.color = color;
  t.anchorX = 'center';
  t.anchorY = 'middle';
  t.outlineWidth = size * 0.12;
  t.outlineColor = '#1a1a1a';
  t.outlineOpacity = 0.85;
  t.position.z = 0.012; // just above the pad
  t.renderOrder = 3;
  t.material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
  fitText(t, maxWidth);
  return t;
}

/** Set new text and re-fit it. */
export function setGroundText(t: Text, text: string, color?: THREE.ColorRepresentation, maxWidth = Infinity) {
  if (t.text === text && (color === undefined || t.color === color)) return;
  t.text = text;
  if (color !== undefined) t.color = color;
  fitText(t, maxWidth);
}

function fitText(t: Text, maxWidth: number) {
  t.sync(() => {
    const b = t.textRenderInfo?.blockBounds;
    if (!b) return;
    const w = b[2] - b[0];
    t.scale.setScalar(w > maxWidth ? maxWidth / w : 1);
  });
}

/** The biggest font size (up to `max`) at which `text` fits in `width` pixels. */
export function fitFont(ctx: CanvasRenderingContext2D, text: string, width: number, max: number) {
  let size = max;
  ctx.font = `900 ${size}px ${GAME_FONT}`;
  const w = ctx.measureText(text).width * 1.1; // + room for the outline
  if (w > width) size = Math.floor((size * width) / w);
  return size;
}

export class TextSprite {
  sprite: THREE.Sprite;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private tex: THREE.CanvasTexture;
  private text = '';
  private readonly H = 128 * TEXT_RES; // canvas height in pixels
  private readonly F = 72 * TEXT_RES;  // font size in pixels

  constructor(private size = 1, private color = '#fff') {
    this.canvas.width = this.H * 2;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.tex = sharpTexture(this.canvas);
    const mat = new THREE.SpriteMaterial({ map: this.tex, transparent: true, depthTest: false });
    this.sprite = new THREE.Sprite(mat);
    this.sprite.scale.set(this.size * 2, this.size, 1);
    this.sprite.renderOrder = 10;
  }

  /** World width of the label (it grows with longer text). */
  get width() {
    return this.size * (this.canvas.width / this.H);
  }

  setText(text: string, color = this.color) {
    if (text === this.text) return;
    this.text = text;
    const c = this.ctx;
    // Measure first, and widen the canvas so long labels ("GATE RUNS") never get cut off.
    c.font = `900 ${this.F}px ${GAME_FONT}`;
    const needed = Math.max(this.H * 2, Math.ceil(c.measureText(text).width + 40 * TEXT_RES));
    if (needed !== this.canvas.width) {
      this.canvas.width = needed;
      // A texture can't change size once uploaded, so swap in a fresh one.
      this.tex.dispose();
      this.tex = sharpTexture(this.canvas);
      (this.sprite.material as THREE.SpriteMaterial).map = this.tex;
      (this.sprite.material as THREE.SpriteMaterial).needsUpdate = true;
    }
    c.clearRect(0, 0, this.canvas.width, this.H);
    if (text) gameText(c, text, this.canvas.width / 2, this.H * 0.52, this.F, color);
    this.tex.needsUpdate = true;
    this.sprite.scale.set(this.width, this.size, 1);
  }
}

/**
 * Role titles ("🐜 WORKER", "⛏️ MINER"...): the same gold label floats over
 * every helper in every act. The ant world's units are bigger than the human
 * worlds', so each scale has its own size (they look the same on screen).
 */
export const TITLE = { ant: 1.0, human: 0.65 };
export function titleTag(model: { root: THREE.Object3D; height: number }, text: string, size: number) {
  const tag = new TextSprite(size, '#ffd166');
  tag.setText(text);
  // It rides along as a child of the model, so undo the model's own scale
  const s = model.root.scale.x || 1;
  tag.sprite.scale.divideScalar(s);
  tag.sprite.position.set(0, (model.height + size * 0.65) / s, 0);
  model.root.add(tag.sprite);
  // Remember it, so a helper's level can be added later ("🐜 WORKER · Lv 3")
  model.root.userData.title = { tag, text };
  return tag;
}

/** A dashed rounded square on the ground, like the "SELL" pad in idle games. */
export function makePad(width: number, depth: number, label = '', color = '#4fe3ff'): THREE.Mesh {
  const k = TEXT_RES;
  const px = 96 * k; // canvas pixels per world unit
  const cw = Math.round(width * px);
  const ch = Math.round(depth * px);
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const c = canvas.getContext('2d')!;
  const inset = 10 * k;
  roundRect(c, inset, inset, cw - inset * 2, ch - inset * 2, 28 * k);
  c.fillStyle = 'rgba(255,255,255,0.16)';
  c.fill();
  c.setLineDash([26 * k, 18 * k]);
  c.lineWidth = 12 * k;
  c.strokeStyle = color;
  c.stroke();
  // Emoji labels (🗑️) are painted into the image; words are crisp ground text (below).
  const crisp = !!label && isGroundTextable(label);
  if (label && !crisp) gameText(c, label, cw / 2, ch / 2 + 4 * k, fitFont(c, label, cw - inset * 4, Math.min(ch * 0.34, cw * 0.3)), '#fff', 'rgba(0,0,0,0.55)');
  const tex = sharpTexture(canvas);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2; // lie flat; the text's "up" points away from the camera
  mesh.position.y = 0.03;
  mesh.renderOrder = 1;
  if (crisp) mesh.add(groundText(label, Math.min(depth * 0.36, width * 0.34), '#ffffff', width * 0.88));
  return mesh;
}

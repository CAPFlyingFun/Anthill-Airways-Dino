// ============================================================================
// input.ts — floating joystick (touch or mouse) + WASD / arrow keys.
//
// How the floating joystick works:
//  1. Put your finger down anywhere: that spot becomes the joystick center.
//  2. Drag: the knob follows, clamped to a circle.
//  3. `move` is a vector from -1..1 on each axis (x = right, y = up the screen).
// ============================================================================
import * as THREE from 'three';

export class Input {
  /** Final movement vector for this frame (length 0..1). */
  move = new THREE.Vector2();

  private stick = new THREE.Vector2();
  private keys = new Set<string>();
  private pointerId: number | null = null;
  private originX = 0;
  private originY = 0;
  private readonly radius = 60; // px the knob can travel
  private base = document.getElementById('joyBase') as HTMLElement;
  private knob = document.getElementById('joyKnob') as HTMLElement;
  private firstTouchHandlers: (() => void)[] = [];

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      this.firstTouchHandlers.forEach((fn) => fn());
      this.firstTouchHandlers = [];
      if (this.pointerId !== null) return; // already steering with another finger
      this.pointerId = e.pointerId;
      this.originX = e.clientX;
      this.originY = e.clientY;
      target.setPointerCapture(e.pointerId);
      this.base.style.left = `${this.originX}px`;
      this.base.style.top = `${this.originY}px`;
      this.base.classList.remove('hidden');
      this.setKnob(0, 0);
    });

    target.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      if (len > this.radius) {
        dx = (dx / len) * this.radius;
        dy = (dy / len) * this.radius;
      }
      this.setKnob(dx, dy);
      // Screen y goes down, but "up the screen" should be +y for the game.
      this.stick.set(dx / this.radius, -dy / this.radius);
    });

    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.stick.set(0, 0);
      this.base.classList.add('hidden');
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => this.keys.add(e.key.toLowerCase()));
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Run a callback on the first touch/click (needed to start audio on iPhone). */
  onFirstTouch(fn: () => void) {
    this.firstTouchHandlers.push(fn);
  }

  private setKnob(dx: number, dy: number) {
    this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  /** Call once per frame before reading `move`. */
  update() {
    let kx = 0;
    let ky = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) kx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) kx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) ky += 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) ky -= 1;
    this.move.set(this.stick.x + kx, this.stick.y + ky);
    if (this.move.lengthSq() > 1) this.move.normalize();
    // Tiny dead zone so a resting thumb doesn't drift.
    if (this.move.lengthSq() < 0.01) this.move.set(0, 0);
  }
}

// ============================================================================
// input.ts — floating joystick (touch or mouse) + WASD / arrow keys.
//
// How the floating joystick works:
//  1. Put your finger down anywhere: that spot becomes the joystick center.
//  2. Drag: the knob follows, clamped to a circle.
//  3. `move` is a vector from -1..1 on each axis (x = right, y = up the screen).
//
// First person (`splitLook = true`), in portrait AND landscape:
//  • LEFT half of the screen  = the joystick (walk + strafe)
//  • RIGHT half of the screen = drag to look around (both at once is fine)
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
  /** First person: left half joystick, right half look-around. */
  splitLook = false;
  private lookId: number | null = null;
  private lookX = 0;
  private lookY = 0;
  private lookDX = 0; // pixels dragged since the last takeLook()
  private lookDY = 0;
  /** A TAP (a short touch that barely moved) at screen x, y: e.g. tapping a building
   *  opens its upgrade panel. Dragging still steers as usual. */
  onTap: ((x: number, y: number) => boolean | void) | null = null;
  /** When a tap last opened something (a panel): the phone's own "click" that follows
   *  a touch is swallowed, so it can't land on the panel that just appeared. */
  private tapOpened = -1e9;
  private tapAt = 0;     // when the steering / look finger went down
  private tapMoved = 0;  // how far it has wandered (px)
  private lookAt = 0;
  private lookMoved = 0;
  private lookX0 = 0;
  private lookY0 = 0;

  constructor(target: HTMLElement) {
    target.addEventListener('pointerdown', (e) => {
      this.firstTouchHandlers.forEach((fn) => fn());
      this.firstTouchHandlers = [];
      if (this.splitLook && e.clientX > target.clientWidth / 2) {
        // Right half: look around
        if (this.lookId !== null) return;
        this.lookId = e.pointerId;
        this.lookX = this.lookX0 = e.clientX;
        this.lookY = this.lookY0 = e.clientY;
        this.lookAt = performance.now();
        this.lookMoved = 0;
        target.setPointerCapture(e.pointerId);
        return;
      }
      if (this.pointerId !== null) return; // already steering with another finger
      this.pointerId = e.pointerId;
      this.originX = e.clientX;
      this.originY = e.clientY;
      this.tapAt = performance.now();
      this.tapMoved = 0;
      target.setPointerCapture(e.pointerId);
      this.base.style.left = `${this.originX}px`;
      this.base.style.top = `${this.originY}px`;
      this.base.classList.remove('hidden');
      this.setKnob(0, 0);
    });

    target.addEventListener('pointermove', (e) => {
      if (e.pointerId === this.lookId) {
        this.lookDX += e.clientX - this.lookX;
        this.lookDY += e.clientY - this.lookY;
        this.lookX = e.clientX;
        this.lookY = e.clientY;
        this.lookMoved = Math.max(this.lookMoved, Math.hypot(e.clientX - this.lookX0, e.clientY - this.lookY0));
        return;
      }
      if (e.pointerId !== this.pointerId) return;
      let dx = e.clientX - this.originX;
      let dy = e.clientY - this.originY;
      const len = Math.hypot(dx, dy);
      this.tapMoved = Math.max(this.tapMoved, len);
      if (len > this.radius) {
        dx = (dx / len) * this.radius;
        dy = (dy / len) * this.radius;
      }
      this.setKnob(dx, dy);
      // Screen y goes down, but "up the screen" should be +y for the game.
      this.stick.set(dx / this.radius, -dy / this.radius);
    });

    // A tap = up again within 0.35 s, having moved less than 12 px
    const isTap = (at: number, moved: number) => performance.now() - at < 350 && moved < 12;
    const end = (e: PointerEvent) => {
      if (e.pointerId === this.lookId) {
        this.lookId = null;
        if (e.type === 'pointerup' && isTap(this.lookAt, this.lookMoved) && this.onTap?.(e.clientX, e.clientY)) this.tapOpened = performance.now();
        return;
      }
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      this.stick.set(0, 0);
      this.base.classList.add('hidden');
      if (e.type === 'pointerup' && isTap(this.tapAt, this.tapMoved) && this.onTap?.(e.clientX, e.clientY)) this.tapOpened = performance.now();
    };
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
    // (pointerup comes just before touchend: cancelling the touchend stops the browser
    // from sending its "click" afterwards, which would hit the panel's backdrop or a button)
    target.addEventListener('touchend', (e) => {
      if (performance.now() - this.tapOpened < 400) e.preventDefault();
    }, { passive: false });

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

  /** Pixels dragged on the look side since last call (then resets). */
  takeLook() {
    const out = { dx: this.lookDX, dy: this.lookDY };
    this.lookDX = this.lookDY = 0;
    // Q / E turn on a keyboard
    if (this.keys.has('q')) out.dx -= 6;
    if (this.keys.has('e')) out.dx += 6;
    return out;
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

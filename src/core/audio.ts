// ============================================================================
// audio.ts — tiny sound effects made with the Web Audio API (no sound files).
// iPhone only allows audio after a touch, so `unlock()` is called on the
// first tap. Each sound is throttled so 30 pickups don't make a wall of noise.
// ============================================================================

export class Sfx {
  enabled = true;
  private ctx: AudioContext | null = null;
  private lastPlayed: Record<string, number> = {};

  unlock() {
    if (this.ctx) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
    }
  }

  /** Play one tone. `slideTo` bends the pitch over the sound's length. */
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, slideTo?: number, delay = 0) {
    if (!this.enabled || !this.ctx) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Returns false if this sound played less than `gapMs` ago. */
  private ready(name: string, gapMs: number) {
    const now = performance.now();
    if (now - (this.lastPlayed[name] ?? 0) < gapMs) return false;
    this.lastPlayed[name] = now;
    return true;
  }

  pickup() {
    if (this.ready('pickup', 45)) this.tone(520 + Math.random() * 260, 0.06, 'triangle', 0.07);
  }
  drop() {
    if (this.ready('drop', 45)) this.tone(380 + Math.random() * 120, 0.06, 'triangle', 0.06);
  }
  cash() {
    if (this.ready('cash', 50)) this.tone(1250 + Math.random() * 200, 0.08, 'sine', 0.06);
  }
  sale() {
    if (this.ready('sale', 120)) this.tone(880, 0.1, 'square', 0.04, 1320);
  }
  unlockTick() {
    if (this.ready('unlockTick', 70)) this.tone(660, 0.05, 'triangle', 0.05);
  }
  unlocked() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1, undefined, i * 0.08));
  }
  gateGood() {
    this.tone(500, 0.22, 'square', 0.06, 1100);
  }
  gateBad() {
    this.tone(320, 0.3, 'sawtooth', 0.06, 110);
  }
  splash() {
    this.tone(900, 0.2, 'sine', 0.06, 200);
  }
}

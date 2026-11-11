// ============================================================================
// hud.ts — the HTML overlay: cash counter, zone name, hints, buttons,
// floating "+5" numbers, banners and the results / settings screens.
// The 3D game never touches the DOM directly; it calls these methods.
// ============================================================================
import * as THREE from 'three';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export class Hud {
  private cashEl = $('cashValue');
  private cashPill = $('cash');
  private zoneEl = $('zone');
  private hintEl = $('hint');
  private launchBtn = $('launchBtn') as HTMLButtonElement;
  private bannerEl = $('banner');
  private floatsEl = $('floats');
  private shownCash = -1;
  private bannerTimer = 0;
  private launchHandler: (() => void) | null = null;
  private tmp = new THREE.Vector3();

  constructor() {
    this.launchBtn.addEventListener('click', () => this.launchHandler?.());
  }

  setCash(value: number) {
    const v = Math.floor(value);
    if (v === this.shownCash) return;
    if (v > this.shownCash && this.shownCash >= 0) {
      // Little bump animation whenever cash goes up
      this.cashPill.classList.remove('bump');
      void this.cashPill.offsetWidth; // restart the CSS animation
      this.cashPill.classList.add('bump');
    }
    this.shownCash = v;
    this.cashEl.textContent = v.toLocaleString();
  }

  setZone(text: string) {
    this.zoneEl.textContent = text;
  }

  setHint(text: string | null) {
    if (!text) {
      this.hintEl.classList.add('hidden');
      return;
    }
    this.hintEl.textContent = text;
    this.hintEl.classList.remove('hidden');
  }

  /** Show the launch button with the cargo count, or hide it with null. */
  setLaunch(count: number | null, onClick?: () => void) {
    if (count === null) {
      this.launchBtn.classList.add('hidden');
      this.launchHandler = null;
      return;
    }
    this.launchBtn.textContent = `🚀 LAUNCH RUN · ${count}`;
    this.launchBtn.classList.remove('hidden');
    this.launchHandler = onClick ?? null;
  }

  banner(title: string, sub = '', ms = 2600) {
    $('bannerTitle').textContent = title;
    $('bannerSub').textContent = sub;
    this.bannerEl.classList.remove('hidden', 'show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.add('hidden'), ms);
  }

  /** Floating text at a 3D point (e.g. "+12" over a gate). */
  floatAt(world: THREE.Vector3, camera: THREE.Camera, text: string, cls = '') {
    this.tmp.copy(world).project(camera);
    const x = ((this.tmp.x + 1) / 2) * window.innerWidth;
    const y = ((1 - this.tmp.y) / 2) * window.innerHeight;
    this.floatXY(x, y, text, cls);
  }

  floatXY(x: number, y: number, text: string, cls = '') {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.floatsEl.appendChild(el);
    window.setTimeout(() => el.remove(), 1100);
  }

  /** Results card after a gate run. Resolves when "Collect" is tapped. */
  showResults(start: number, end: number, earned: number): Promise<void> {
    $('resStart').textContent = String(start);
    $('resEnd').textContent = String(end);
    $('resEarned').textContent = `$${earned.toLocaleString()}`;
    const ratio = start > 0 ? end / start : 0;
    $('resGrade').textContent =
      ratio >= 3 ? 'LEGENDARY RUN! 🏆' : ratio >= 2 ? 'Great run! 🔥' : ratio >= 1 ? 'Nice run 👍' : 'Rough run 😅';
    const overlay = $('results');
    overlay.classList.remove('hidden');
    return new Promise((resolve) => {
      const btn = $('collectBtn');
      const done = () => {
        btn.removeEventListener('click', done);
        overlay.classList.add('hidden');
        resolve();
      };
      btn.addEventListener('click', done);
    });
  }

  /** Settings panel: sound toggle + reset (tap reset twice to confirm). */
  initSettings(opts: { sound: boolean; onSound: (on: boolean) => void; onReset: () => void }) {
    const panel = $('settings');
    const soundBtn = $('soundBtn');
    const resetBtn = $('resetBtn');
    let sound = opts.sound;
    let armed = false;
    const label = () => (soundBtn.textContent = `Sound: ${sound ? 'On 🔊' : 'Off 🔇'}`);
    label();
    $('settingsBtn').addEventListener('click', () => {
      armed = false;
      resetBtn.textContent = 'Reset progress';
      panel.classList.remove('hidden');
    });
    $('closeSettings').addEventListener('click', () => panel.classList.add('hidden'));
    soundBtn.addEventListener('click', () => {
      sound = !sound;
      label();
      opts.onSound(sound);
    });
    resetBtn.addEventListener('click', () => {
      if (!armed) {
        armed = true;
        resetBtn.textContent = 'Tap again to erase everything';
        return;
      }
      opts.onReset();
    });
  }
}

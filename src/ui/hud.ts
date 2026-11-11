// ============================================================================
// hud.ts — the HTML overlay: cash counter, zone name, hints, buttons,
// floating "+5" numbers, banners and the results / settings screens.
// The 3D game never touches the DOM directly; it calls these methods.
// ============================================================================
import * as THREE from 'three';
import { QUEEN_STATS, QUEEN_UNLOCK_LEVEL, STATS } from '../data/config';
import { Progress, QueenProgress } from '../core/progress';

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

  // ---- Inventory (ARK style) ----------------------------------------------
  private invKey = '';
  private static ICONS: Record<string, string> = { crumb: '🍞', snack: '🍪', leaf: '🍃', wrap: '🌯', sugar: '🧊', candy: '🍬', cash: '💵' };

  /** Show what you're carrying: one slot per item type + a weight bar. */
  setInventory(counts: Map<string, number>, used: number, max: number) {
    const key = [...counts].map(([t, n]) => `${t}${n}`).join() + `|${used}/${max}`;
    if (key === this.invKey) return; // nothing changed: skip the DOM work
    this.invKey = key;
    $('inv').classList.toggle('hidden', used === 0);
    $('invSlots').innerHTML = [...counts]
      .map(([t, n]) => `<div class="inv-slot">${Hud.ICONS[t] ?? '❔'}<b>${n}</b></div>`)
      .join('');
    const fill = $('invFill');
    fill.style.width = `${Math.min(100, (used / max) * 100)}%`;
    fill.classList.toggle('full', used >= max);
    $('invText').textContent = `${used}/${max}`;
  }

  // ---- Loading screen ------------------------------------------------------
  setLoading(fraction: number) {
    $('loadFill').style.width = `${Math.round(fraction * 100)}%`;
  }
  hideLoading() {
    $('loading').classList.add('hidden');
  }

  // ---- Level + stats (ARK style) ------------------------------------------
  private progress: Progress | null = null;
  private queen: QueenProgress | null = null;

  /** Hook up the level pill and the stats screen (yours + the Queen's). */
  initStats(progress: Progress, queen: QueenProgress) {
    this.progress = progress;
    this.queen = queen;
    const qRows = $('queenRows');
    for (const def of QUEEN_STATS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<div class="ic">${def.icon}</div>
        <div class="txt"><div class="nm">${def.name}</div><div class="ds" id="qds-${def.id}"></div></div>
        <div class="lv" id="qlv-${def.id}">0</div>
        <button id="qadd-${def.id}" aria-label="Give the Queen a point in ${def.name}">+</button>`;
      qRows.appendChild(row);
      row.querySelector('button')!.addEventListener('click', () => {
        if (queen.spend(def.id)) this.renderStats();
      });
    }
    const panel = $('stats');
    $('levelBtn').addEventListener('click', () => {
      this.renderStats();
      panel.classList.remove('hidden');
    });
    $('closeStats').addEventListener('click', () => panel.classList.add('hidden'));
    // Build one row per stat; the "+" button spends a point.
    const rows = $('statRows');
    for (const def of STATS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<div class="ic">${def.icon}</div>
        <div class="txt"><div class="nm">${def.name}</div><div class="ds" id="ds-${def.id}"></div></div>
        <div class="lv" id="lv-${def.id}">0</div>
        <button id="add-${def.id}" aria-label="Add a point to ${def.name}">+</button>`;
      rows.appendChild(row);
      row.querySelector('button')!.addEventListener('click', () => {
        if (progress.spend(def.id)) this.renderStats();
      });
    }
    this.renderLevel();
  }

  /** Refresh the small level pill (call whenever XP changes). */
  renderLevel() {
    const p = this.progress;
    if (!p) return;
    const s = p.save;
    $('lvlText').textContent = `Lv ${s.level}`;
    $('xpFill').style.width = `${Math.min(100, (s.xp / p.xpToNext()) * 100)}%`;
    const badge = $('ptsBadge');
    const pts = s.points + (s.queen.active ? s.queen.points : 0);
    badge.textContent = `+${pts}`;
    badge.classList.toggle('hidden', pts <= 0);
    if (!$('stats').classList.contains('hidden')) this.renderStats();
  }

  private renderStats() {
    const p = this.progress!;
    const s = p.save;
    $('statsTitle').textContent = `Level ${s.level}`;
    $('statsXpFill').style.width = `${Math.min(100, (s.xp / p.xpToNext()) * 100)}%`;
    $('statsXpText').textContent = `${Math.floor(s.xp)} / ${p.xpToNext()} XP`;
    $('statsPoints').textContent = s.points > 0 ? `${s.points} point${s.points > 1 ? 's' : ''} to spend!` : 'Level up to earn points';
    for (const def of STATS) {
      $(`lv-${def.id}`).textContent = String(p.stat(def.id));
      $(`ds-${def.id}`).textContent = `${def.per} · now ${p.describe(def.id)}`;
      ($(`add-${def.id}`) as HTMLButtonElement).disabled = s.points <= 0;
    }
    // The Queen's section
    const q = this.queen!;
    const qs = s.queen;
    $('queenSection').classList.toggle('locked', !qs.active);
    if (!qs.active) {
      $('queenTitle').textContent = '👑 Queen (locked)';
      $('queenXpFill').style.width = `${Math.min(100, (s.level / QUEEN_UNLOCK_LEVEL) * 100)}%`;
      $('queenXpText').textContent = `Lv ${s.level} / ${QUEEN_UNLOCK_LEVEL}`;
      $('queenPoints').textContent = `Reach Level ${QUEEN_UNLOCK_LEVEL} and the Queen starts collecting your cash!`;
    } else {
      $('queenTitle').textContent = `👑 Queen · Level ${qs.level}`;
      $('queenXpFill').style.width = `${Math.min(100, (qs.xp / q.xpToNext()) * 100)}%`;
      $('queenXpText').textContent = `${Math.floor(qs.xp)} / ${q.xpToNext()} XP`;
      $('queenPoints').textContent = qs.points > 0 ? `${qs.points} royal point${qs.points > 1 ? 's' : ''} to spend!` : 'She earns XP from the cash she collects';
    }
    for (const def of QUEEN_STATS) {
      $(`qlv-${def.id}`).textContent = String(q.stat(def.id));
      $(`qds-${def.id}`).textContent = `${def.per} · now ${q.describe(def.id)}`;
      ($(`qadd-${def.id}`) as HTMLButtonElement).disabled = !qs.active || qs.points <= 0;
    }
  }

  /** Version line + "Check for updates" button in Settings. */
  initVersion(label: string, onCheck: () => void) {
    $('versionText').textContent = label;
    $('updateBtn').addEventListener('click', onCheck);
  }
  setUpdateStatus(text: string) {
    $('updateStatus').textContent = text;
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

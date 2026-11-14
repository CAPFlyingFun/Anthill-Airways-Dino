// ============================================================================
// hud.ts — the HTML overlay: cash counter, zone name, hints, buttons,
// floating "+5" numbers, banners and the results / settings screens.
// The 3D game never touches the DOM directly; it calls these methods.
// ============================================================================
import type { BoardRow } from './departures';
import * as THREE from 'three';
import { CONFIG, GAME_SPEED, QUEEN_STATS, QUEEN_UNLOCK_LEVEL, SHARD_UPS, STAT_MAX, STATS, shardCost } from '../data/config';
import { Progress, QueenProgress } from '../core/progress';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

/** 1234 -> "1.2k", 2500000 -> "2.5M" */
function short(n: number) {
  if (n >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
}

/** ⬆️ One upgrade in a building's panel (built by world/upgradePad.ts). */
export interface UpRowModel {
  id: string;
  icon: string;
  name: string;
  sub: string;            // small line under the name ("All 2 crumb piles")
  level: string;          // "Lv 4/10", "MAX", "Not hired"
  pips: { filled: boolean; star: boolean }[]; // one per level (⭐ = milestone)
  now: string;            // what it does now ("x1.8 cook speed")
  next: string | null;    // ...after the next level (null = maxed)
  star: string;           // "⭐ Lv 5 is a milestone..." (or '')
  buys: { n: number; label: string; cost: number; ok: boolean }[];
}
/** ⬆️ What a building's panel shows. */
export interface UpPanelModel {
  tabs: { key: string; label: string; on: boolean }[];
  title: string;
  warn: string;           // ⚠️ what's wrong at this station right now ('' = nothing)
  cash: number;
  rows: UpRowModel[];
}
interface UpHandler {
  model: () => UpPanelModel | null;
  buy: (id: string, n: number) => void;
  tab: (key: string) => void;
  close: () => void;
}

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

  /** The hint at the top (null hides it). `onSkip` adds a small "Skip" button (the tutorial). */
  setHint(text: string | null, onSkip?: () => void) {
    if (!text) {
      this.hintEl.classList.add('hidden');
      return;
    }
    this.hintEl.textContent = text;
    this.hintEl.classList.toggle('tut', !!onSkip); // (the tutorial's hint sits lower)
    if (onSkip) {
      const b = document.createElement('button');
      b.className = 'hint-skip';
      b.textContent = 'Skip';
      b.setAttribute('aria-label', 'Skip the tutorial');
      b.addEventListener('click', onSkip);
      this.hintEl.appendChild(b);
    }
    this.hintEl.classList.remove('hidden');
  }

  // ---- ⬆️ Building upgrade panels -------------------------------------------------
  private upHandler: UpHandler | null = null;
  private upTimer = 0;
  private upClick: (() => void) | null = null;
  private upOwner: unknown = null; // (the world driving the ⬆️ button)
  private upRowsHtml = '';
  private upBound = false;
  private upOpenedAt = -1e9;
  /** Just opened? Then a click is the tail end of the tap that opened it, not a choice. */
  private upFresh = () => performance.now() - this.upOpenedAt < 450;

  /** Hook the panel's buttons up once (tabs, buy buttons, close, the backdrop). */
  private bindUpgrades() {
    if (this.upBound) return;
    this.upBound = true;
    $('upBtn').addEventListener('click', () => this.upClick?.());
    $('upClose').addEventListener('click', () => {
      if (!this.upFresh()) this.closeUpgrades();
    });
    $('upPanel').addEventListener('click', (e) => {
      if (e.target === $('upPanel') && !this.upFresh()) this.closeUpgrades(); // a tap on the dim backdrop
    });
    $('upTabs').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-tab]') as HTMLElement | null;
      if (!b || !this.upHandler || this.upFresh()) return;
      this.upHandler.tab(b.dataset.tab!);
      this.renderUpgrades(true);
    });
    $('upRows').addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-id]') as HTMLButtonElement | null;
      if (!b || b.disabled || !this.upHandler || this.upFresh()) return;
      this.upHandler.buy(b.dataset.id!, Number(b.dataset.n));
      this.renderUpgrades(true);
    });
  }

  /** The "⬆️ Oven" button by the 👁️ one, while you stand next to a building (null hides it). */
  setUpgradeButton(label: string | null, onClick?: () => void, glow = false, owner: unknown = null) {
    this.bindUpgrades();
    this.upOwner = owner;
    const b = $('upBtn');
    if (!label) {
      b.classList.add('hidden');
      this.upClick = null;
      return;
    }
    const text = `⬆️ ${label.replace(/(\p{L})(\p{L}*)/gu, (_m, a: string, r: string) => a + r.toLowerCase())}`;
    if (b.textContent !== text) b.textContent = text;
    b.classList.toggle('glow', glow); // (gold when you can afford a level)
    b.classList.remove('hidden');
    this.upClick = onClick ?? null;
  }

  /** A world you just left lets go of the ⬆️ button (unless the new one already took it). */
  releaseUpgradeButton(owner: unknown) {
    if (this.upOwner === owner) this.setUpgradeButton(null);
  }

  /** Open a building's upgrade panel. It refreshes itself while open (cash comes in). */
  openUpgrades(handler: UpHandler) {
    this.bindUpgrades();
    if (this.upHandler && this.upHandler !== handler) this.upHandler.close();
    this.upHandler = handler;
    this.upRowsHtml = '';
    this.upOpenedAt = performance.now();
    $('upPanel').classList.remove('hidden');
    this.renderUpgrades(true);
    window.clearInterval(this.upTimer);
    this.upTimer = window.setInterval(() => this.renderUpgrades(), 400);
  }

  closeUpgrades() {
    window.clearInterval(this.upTimer);
    $('upPanel').classList.add('hidden');
    const h = this.upHandler;
    this.upHandler = null;
    h?.close();
  }

  /** Draw the panel from its model. (Rows are only rebuilt when they change, so a
   *  button never disappears under your finger while cash ticks up.) */
  private renderUpgrades(force = false) {
    const m = this.upHandler?.model();
    if (!m) {
      this.closeUpgrades();
      return;
    }
    const cash = (n: number) => (n < 1e5 ? `$${Math.round(n).toLocaleString()}` : `$${short(n)}`);
    $('upCash').textContent = `💵 ${cash(m.cash)}`;
    $('upTitle').textContent = m.title;
    $('upTabs').innerHTML = m.tabs.length > 1 ? m.tabs.map((t) => `<button class="up-tab${t.on ? ' on' : ''}" data-tab="${t.key}">${t.label}</button>`).join('') : '';
    const warn = $('upWarn');
    warn.textContent = m.warn ? `⚠️ ${m.warn}` : '';
    warn.classList.toggle('hidden', !m.warn);
    const html = m.rows.length
      ? m.rows
        .map((r) => `<div class="up-row">
  <div class="up-head"><span class="up-ic">${r.icon}</span><div class="up-nm">${r.name}${r.sub ? `<small>${r.sub}</small>` : ''}</div><span class="up-lv">${r.level}</span></div>
  ${r.pips.length ? `<div class="up-pips">${r.pips.map((p) => `<i class="${p.filled ? 'on' : ''}${p.star ? ' star' : ''}">${p.star ? '⭐' : ''}</i>`).join('')}</div>` : ''}
  <div class="up-fx">${r.now}${r.next ? ` <b>→ ${r.next}</b>` : ' <b class="max">MAX</b>'}</div>
  ${r.star ? `<div class="up-star">${r.star}</div>` : ''}
  ${r.buys.length ? `<div class="up-buys">${r.buys.map((b) => `<button class="up-buy${b.ok ? ' ok' : ''}" data-id="${r.id}" data-n="${b.n}"${b.ok ? '' : ' disabled'}>${b.label}<span>${cash(b.cost)}</span></button>`).join('')}</div>` : ''}
</div>`)
        .join('')
      : '<div class="up-empty">Nothing to upgrade here yet.</div>';
    if (force || html !== this.upRowsHtml) {
      this.upRowsHtml = html;
      $('upRows').innerHTML = html;
    }
  }

  /**
   * A card with a title, some text (HTML) and buttons: the tutorial's welcome
   * and "you've got it" cards, and 📖 How to play. Any button closes it.
   */
  showGuide(title: string, html: string, buttons: { label: string; cls?: string; onClick?: () => void }[]) {
    const panel = $('guide');
    $('guideTitle').textContent = title;
    $('guideBody').innerHTML = html;
    $('guideBody').scrollTop = 0;
    const row = $('guideBtns');
    row.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = b.cls ?? 'menu-btn';
      el.textContent = b.label;
      el.addEventListener('click', () => {
        panel.classList.add('hidden');
        b.onClick?.();
      });
      row.appendChild(el);
    }
    panel.classList.remove('hidden');
  }

  /** Show the launch button with the cargo count, or hide it with null. */
  setLaunch(count: number | null, onClick?: () => void, label = '🚀 LAUNCH RUN') {
    document.body.classList.toggle('launch-on', count !== null);
    if (count === null) {
      this.launchBtn.classList.add('hidden');
      this.launchHandler = null;
      return;
    }
    // (🚩 and how much the cart can come back with: CONFIG.run.maxLoad x the load)
    this.launchBtn.innerHTML = `${label} · ${count}<small>🚩 cart holds up to ${Math.round(count * CONFIG.run.maxLoad)}</small>`;
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
  showResults(start: number, end: number, earned: number, contract?: { target: number; reached: number; filled: boolean }, full = false): Promise<void> {
    // 📦 The run's contract (if it had one)
    $('resContract').classList.toggle('hidden', !contract);
    if (contract) {
      const v = $('resContractVal');
      v.textContent = contract.filled ? `✅ ${contract.target} delivered · +50%` : `❌ ${contract.reached}/${contract.target}`;
      v.style.color = contract.filled ? '#2e9e4a' : '#c0392b';
    }
    $('resStart').textContent = String(start);
    $('resEnd').textContent = String(end);
    $('resEarned').textContent = `$${earned.toLocaleString()}`;
    const ratio = start > 0 ? end / start : 0;
    $('resGrade').textContent =
      full && ratio >= 3 ? 'FULL CART! 🏆' : ratio >= 3 ? 'LEGENDARY RUN! 🏆' : ratio >= 2 ? 'Great run! 🔥' : ratio >= 1 ? 'Nice run 👍' : 'Rough run 😅';
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

  // ---- Idle income --------------------------------------------------------
  /** "+$1.2k/min" under the cash pill (hidden until there's a rate). */
  setRate(perMin: number) {
    const el = $('rate');
    el.classList.toggle('hidden', perMin < 1);
    el.textContent = `+$${short(perMin)}/min`;
  }

  /** The "welcome back" card. Resolves 'run' (multiply it) or 'collect'. */
  showWelcome(awaySecs: number, countedSecs: number, share: number, amount: number): Promise<'run' | 'collect'> {
    const t = (secs: number) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      return h && !m ? `${h}h` : `${h ? `${h}h ` : ''}${m}m`; // "4h", "5h 36m", "12m"
    };
    // e.g. "You were away 9h 12m · 4h counted at 50%" (the cap + share are upgradable)
    const capped = countedSecs < awaySecs - 59;
    $('wbAway').textContent = `You were away ${t(awaySecs)}${capped ? ` · ${t(countedSecs)} counted` : ''} at ${Math.round(share * 100)}%`;
    $('wbAmount').textContent = `$${Math.round(amount).toLocaleString()}`;
    const overlay = $('welcome');
    overlay.classList.remove('hidden');
    return new Promise((resolve) => {
      const run = $('wbRun');
      const collect = $('wbCollect');
      const done = (choice: 'run' | 'collect') => () => {
        run.onclick = collect.onclick = null;
        overlay.classList.add('hidden');
        resolve(choice);
      };
      run.onclick = done('run');
      collect.onclick = done('collect');
    });
  }

  // ---- 🌋 Act 4: heat, the eruption card, the Obsidian Shrine ---------------
  private heatShown = -1;
  /** The heat bar (volcano). null hides it. */
  setHeat(v: number | null) {
    const el = $('heat');
    if (v === null) {
      if (this.heatShown !== -1) el.classList.add('hidden');
      this.heatShown = -1;
      return;
    }
    const pct = Math.round(v * 100);
    if (pct === this.heatShown) return;
    if (this.heatShown === -1) el.classList.remove('hidden');
    this.heatShown = pct;
    $('heatFill').style.width = `${pct}%`;
    el.classList.toggle('danger', v > 0.7);
  }

  /** "Erupt the volcano?" Resolves true if you confirm. */
  confirmEruption(shards: number, earned: number, eruptions: number, carried = 0): Promise<boolean> {
    $('erShards').textContent = `💎 ${shards}`;
    $('erEarned').textContent = `$${short(earned)} earned on the island + volcano since ${eruptions ? 'the last eruption' : 'you started'}${carried ? ` (+💎 ${carried} carried over from before the v0.25 update)` : ''}`;
    const overlay = $('erupt');
    overlay.classList.remove('hidden');
    return new Promise((resolve) => {
      const yes = $('erYes');
      const no = $('erNo');
      const done = (v: boolean) => () => {
        yes.onclick = no.onclick = null;
        overlay.classList.add('hidden');
        resolve(v);
      };
      yes.onclick = done(true);
      no.onclick = done(false);
    });
  }

  /** The Obsidian Shrine: spend 💎 shards on permanent upgrades. */
  initShrine(progress: Progress, visible: () => boolean) {
    const panel = $('shrine');
    const rows = $('shrineRows');
    for (const def of SHARD_UPS) {
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `<div class="ic">${def.icon}</div>
        <div class="txt"><div class="nm">${def.name}</div><div class="ds" id="sds-${def.id}"></div></div>
        <div class="lv" id="slv-${def.id}">0</div>
        <button class="shard-buy" id="sbuy-${def.id}" aria-label="Buy ${def.name}">💎</button>`;
      rows.appendChild(row);
      row.querySelector('button')!.addEventListener('click', () => {
        if (progress.buyUp(def.id)) this.renderShrine();
      });
    }
    this.shrineProgress = progress;
    this.shrineVisible = visible;
    $('shrineBtn').addEventListener('click', () => this.openShrine());
    $('closeShrine').addEventListener('click', () => panel.classList.add('hidden'));
  }
  private shrineProgress: Progress | null = null;
  private shrineVisible: () => boolean = () => false;

  openShrine() {
    this.renderShrine();
    $('stats').classList.add('hidden');
    $('shrine').classList.remove('hidden');
  }

  private renderShrine() {
    const p = this.shrineProgress;
    if (!p) return;
    const s = p.save;
    $('shrineCount').textContent = `💎 ${s.shards} shard${s.shards === 1 ? '' : 's'}${s.eruptions ? ` · 🌋 ${s.eruptions} eruption${s.eruptions > 1 ? 's' : ''}` : ''}`;
    for (const def of SHARD_UPS) {
      const lv = p.up(def.id);
      const maxed = lv >= def.max;
      $(`slv-${def.id}`).textContent = String(lv);
      $(`sds-${def.id}`).textContent = `${def.per} per level${maxed ? ' · MAX' : ''}`;
      const btn = $(`sbuy-${def.id}`) as HTMLButtonElement;
      btn.textContent = maxed ? 'MAX' : `💎 ${shardCost(lv)}`;
      btn.disabled = maxed || s.shards < shardCost(lv);
    }
  }

  // ---- Inventory (ARK style) ----------------------------------------------
  private invKey = '';
  private static ICONS: Record<string, string> = { crumb: '🍞', snack: '🍪', leaf: '🍃', wrap: '🌯', sugar: '🧊', candy: '🍬', cash: '💵', bag: '🧳', snackbox: '🍱', fruit: '🍈', smoothie: '🥤', meat: '🍖', egg: '🥚', ticket: '🎟️', obsidian: '🪨', gem: '💎', magma: '🔥', crystal: '🔶', laundry: '🧺', towel: '🧻', grocery: '🥬', tray: '🍽️' };

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
    // 🔄 The one free respec (set by core/migrate.ts for saves from before v0.25)
    $('respecBtn').addEventListener('click', () => {
      panel.classList.add('hidden');
      this.showGuide('🔄 Free respec', `<p>All your stat points (and the Queen's) and every 💎 Obsidian Shard you spent at the Shrine come back, so you can spend them again with the new numbers.</p><p>This free respec can be used <b>once</b>.</p>`, [
        {
          label: '🔄 Yes, give them back',
          cls: 'big-btn',
          onClick: () => {
            const n = progress.respec() + queen.respec();
            const shards = progress.respecShards();
            delete progress.save.paid['respec-free'];
            this.banner('🔄 Refunded!', `${n} points${shards ? ` + 💎 ${shards} shards` : ''} to spend again`, 3500);
            this.renderStats();
            panel.classList.remove('hidden');
          },
        },
        { label: 'Not now', cls: 'menu-btn', onClick: () => panel.classList.remove('hidden') },
      ]);
    });
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
    // (points only count if there's a stat left to put them in)
    const pts = (p.allMaxed ? 0 : s.points) + (s.queen.active && !this.queen?.allMaxed ? s.queen.points : 0);
    badge.textContent = `+${pts}`;
    badge.classList.toggle('hidden', pts <= 0);
    if (!$('stats').classList.contains('hidden')) this.renderStats();
  }

  private renderStats() {
    const p = this.progress!;
    const s = p.save;
    $('statsTitle').textContent = `Level ${s.level}`;
    $('respecBtn').classList.toggle('hidden', !s.paid['respec-free']);
    $('statsXpFill').style.width = `${Math.min(100, (s.xp / p.xpToNext()) * 100)}%`;
    $('statsXpText').textContent = `${Math.floor(s.xp)} / ${p.xpToNext()} XP`;
    $('statsPoints').textContent = p.allMaxed ? '🏆 Every stat is maxed!' : s.points > 0 ? `${s.points} point${s.points > 1 ? 's' : ''} to spend! (max ${STAT_MAX} each)` : 'Level up to earn points';
    $('shrineBtn').classList.toggle('hidden', !this.shrineVisible());
    $('shrineBtn').textContent = `💎 Obsidian Shrine · ${s.shards} shard${s.shards === 1 ? '' : 's'}`;
    for (const def of STATS) {
      const max = p.maxed(def.id);
      // Maxed: a green MAX badge and no + button
      $(`lv-${def.id}`).innerHTML = max ? `${p.stat(def.id)}<span class="maxed">MAX</span>` : String(p.stat(def.id));
      ($(`add-${def.id}`) as HTMLElement).style.visibility = max ? 'hidden' : '';
      $(`ds-${def.id}`).textContent = `${def.per} · now ${p.describe(def.id)}`;
      ($(`add-${def.id}`) as HTMLButtonElement).disabled = s.points <= 0 || max;
    }
    // The Queen's section
    const q = this.queen!;
    const qs = s.queen;
    $('queenSection').classList.toggle('locked', !qs.active);
    if (!qs.active) {
      $('queenTitle').textContent = '👑 Queen (locked)';
      $('queenXpFill').style.width = `${Math.min(100, (s.level / QUEEN_UNLOCK_LEVEL) * 100)}%`;
      $('queenXpText').textContent = `Lv ${s.level} / ${QUEEN_UNLOCK_LEVEL}`;
      $('queenPoints').textContent = `Reach Level ${QUEEN_UNLOCK_LEVEL} and the Queen is crowned: her points boost your Bankers + trash money!`;
    } else {
      $('queenTitle').textContent = `👑 Queen · Level ${qs.level}`;
      $('queenXpFill').style.width = `${Math.min(100, (qs.xp / q.xpToNext()) * 100)}%`;
      $('queenXpText').textContent = `${Math.floor(qs.xp)} / ${q.xpToNext()} XP`;
      $('queenPoints').textContent = qs.points > 0 ? `${qs.points} royal point${qs.points > 1 ? 's' : ''} to spend!` : 'She earns XP from the cash your Bankers collect';
    }
    for (const def of QUEEN_STATS) {
      const max = q.maxed(def.id);
      // Maxed: a green MAX badge and no + button
      $(`qlv-${def.id}`).innerHTML = max ? `${q.stat(def.id)}<span class="maxed">MAX</span>` : String(q.stat(def.id));
      ($(`qadd-${def.id}`) as HTMLElement).style.visibility = max ? 'hidden' : '';
      $(`qds-${def.id}`).textContent = `${def.per} · now ${q.describe(def.id)}`;
      ($(`qadd-${def.id}`) as HTMLButtonElement).disabled = !qs.active || qs.points <= 0 || max;
    }
  }

  // ---- ✈️ Departures board ------------------------------------------------------
  /** The "🛫 Next:" chip (null hides it, e.g. once the whole route is done). */
  setNext(text: string | null) {
    const b = $('nextBtn');
    b.classList.toggle('hidden', !text);
    if (text && b.textContent !== text) b.textContent = text;
  }

  /** Tap the chip -> the board. `rows()` is read fresh each time it opens. */
  initDepartures(rows: () => BoardRow[]) {
    const panel = $('departures');
    $('nextBtn').addEventListener('click', () => {
      $('boardRows').innerHTML = rows()
        .map((r) => {
          const st = r.status === 'departed' ? 'DEPARTED ✅' : r.status === 'next' ? 'NEXT' : 'LATER';
          const line = `<div class="board-row ${r.status}"><div class="ic">${r.stop.icon}</div><div class="nm">${r.stop.name}</div><div class="st">${st}</div></div>`;
          const more = r.status === 'next'
            ? `<div class="board-detail">${r.detail}<br>${r.ready !== r.steps ? `Steps done: ${r.ready}/${r.steps} (unlock everything it needs nearby)` : r.needLevel ? `🔒 Reach level ${r.needLevel} to open it (play, sell and unlock to earn XP)` : '✅ Ready to buy!'}</div>`
            : '';
          return line + more;
        })
        .join('');
      panel.classList.remove('hidden');
    });
    $('closeBoard').addEventListener('click', () => panel.classList.add('hidden'));
  }

  // ---- 📊 Lifetime stats ------------------------------------------------------
  /** `rows()` builds the list fresh each time the screen opens (null = a heading). */
  initTotals(rows: () => ({ icon: string; label: string; value: string } | string)[]) {
    const panel = $('totals');
    const render = () => {
      $('totalRows').innerHTML = rows()
        .map((r) => (typeof r === 'string'
          ? `<div class="tot-head">${r}</div>`
          : `<div class="tot-row"><div class="ic">${r.icon}</div><div class="nm">${r.label}</div><b>${r.value}</b></div>`))
        .join('');
    };
    $('totalsBtn').addEventListener('click', () => {
      render();
      $('stats').classList.add('hidden');
      panel.classList.remove('hidden');
    });
    $('totalsBack').addEventListener('click', () => {
      panel.classList.add('hidden');
      this.renderStats();
      $('stats').classList.remove('hidden');
    });
    $('closeTotals').addEventListener('click', () => panel.classList.add('hidden'));
  }

  /**
   * ✨ "New version ready" popup with a countdown. Resolves true when it should
   * update (Update now, or the countdown ran out) and false for Later.
   */
  showUpdate(version: string, seconds: number): Promise<boolean> {
    const overlay = $('update');
    $('upVersion').textContent = version ? `v${version}` : 'A new version';
    let left = seconds;
    const tick = () => ($('upCount').textContent = String(left));
    tick();
    overlay.classList.remove('hidden');
    return new Promise((resolve) => {
      let timer = 0;
      const done = (go: boolean) => () => {
        window.clearInterval(timer);
        $('upNow').onclick = $('upLater').onclick = null;
        if (!go) overlay.classList.add('hidden');
        else $('upCountLine').textContent = 'Updating… 🚀';
        resolve(go);
      };
      $('upNow').onclick = done(true);
      $('upLater').onclick = done(false);
      timer = window.setInterval(() => {
        left--;
        tick();
        if (left <= 0) done(true)(); // countdown over: update
      }, 1000);
    });
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
  /**
   * Save slots list. `slots` = summaries (null = empty). Tapping a slot plays
   * it; the 🗑️ erases it (tap twice).
   */
  renderSlots(
    slots: { n: number; here: boolean; info: { level: number; cash: number; act: string; lastSeen: number } | null }[],
    onPlay: (n: number) => void,
    onErase: (n: number) => void,
  ) {
    const list = $('slotList');
    list.innerHTML = '';
    for (const s of slots) {
      const row = document.createElement('div');
      row.className = `slot${s.here ? ' here' : ''}`;
      const when = s.info?.lastSeen ? new Date(s.info.lastSeen).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      row.innerHTML = `<span class="num">${s.n}</span><span class="info">${
        s.info ? `<b>Lv ${s.info.level} · ${s.info.act}</b><br>💵 ${Math.floor(s.info.cash).toLocaleString()}${when ? ` · ${when}` : ''}` : '<b>Empty</b><br>Tap to start a new game'
      }</span>${s.here ? '<span class="tag">PLAYING</span>' : ''}`;
      if (!s.here) row.addEventListener('click', () => onPlay(s.n));
      if (s.info && !s.here) {
        const del = document.createElement('button');
        del.className = 'erase';
        del.textContent = '🗑️';
        let armed = false;
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!armed) {
            armed = true;
            del.textContent = 'Erase?';
            return;
          }
          onErase(s.n);
        });
        row.appendChild(del);
      }
      list.appendChild(row);
    }
  }

  /** 🐢 / 🐇 Movement speed slider in Settings (0.2x - 3x, 1x = normal): how fast everyone walks. */
  initSpeed(value: number, onChange: (v: number) => void) {
    const slider = $('speedSlider') as HTMLInputElement;
    const label = $('speedLabel');
    slider.min = String(GAME_SPEED.min);
    slider.max = String(GAME_SPEED.max);
    slider.step = String(GAME_SPEED.step);
    const show = (v: number) => {
      label.textContent = `${v < 1 ? '🐢' : v > 1 ? '🐇' : '🐜'} Movement speed: ${v.toFixed(1)}x${v === 1 ? ' (normal)' : ''}`;
    };
    slider.value = String(value);
    show(value);
    slider.addEventListener('input', () => {
      // Snap to 1.0x near the middle so normal speed is easy to get back to
      let v = Math.round(Number(slider.value) * 10) / 10;
      if (Math.abs(v - 1) < 0.051) v = 1;
      show(v);
      onChange(v);
    });
    $('speedReset').addEventListener('click', () => {
      slider.value = '1';
      show(1);
      onChange(1);
    });
  }

  /** 🎵 Music + 🔊 Effects sliders (0..1). */
  initVolumes(music: number, sfx: number, onChange: (music: number, sfx: number) => void) {
    const m = $('musicVol') as HTMLInputElement;
    const s = $('sfxVol') as HTMLInputElement;
    const show = () => {
      $('musicVolTxt').textContent = `${Math.round(Number(m.value) * 100)}%`;
      $('sfxVolTxt').textContent = `${Math.round(Number(s.value) * 100)}%`;
    };
    m.value = String(music);
    s.value = String(sfx);
    show();
    const change = () => {
      show();
      onChange(Number(m.value), Number(s.value));
    };
    m.addEventListener('input', change);
    s.addEventListener('input', change);
  }

  initSettings(opts: { sound: boolean; onSound: (on: boolean) => void; onReset: () => void; onOpen?: () => void }) {
    const panel = $('settings');
    const soundBtn = $('soundBtn');
    const resetBtn = $('resetBtn');
    let sound = opts.sound;
    let armed = false;
    const label = () => (soundBtn.textContent = `Sound: ${sound ? 'On 🔊' : 'Off 🔇'}`);
    label();
    $('settingsBtn').addEventListener('click', () => {
      armed = false;
      resetBtn.textContent = 'Reset this slot';
      opts.onOpen?.();
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
        resetBtn.textContent = 'Tap again to erase this slot';
        return;
      }
      opts.onReset();
    });
  }
}

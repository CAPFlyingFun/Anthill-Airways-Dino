// ============================================================================
// homeMain.ts — starts 🏝️ ANTHILL ISLAND, the new one-island game (a test
// version for now: the backyard ant farm and the first café plot).
//
// A save slot whose campaign is 'anthill' plays this instead of the classic
// Anthill Airways. main.ts sets up what both games share (renderer, HUD,
// sounds, input, the save, Settings) and hands over here instead of building
// the classic worlds. Everything else lives in world/homeWorld.ts.
// ============================================================================
import * as THREE from 'three';
import type { Hud } from './ui/hud';
import type { Sfx } from './core/audio';
import type { Input } from './core/input';
import { SaveData, writeSave } from './core/save';
import type { Progress, QueenProgress } from './core/progress';
import { loadHumans, loadModels } from './actors/creatures';
import { HomeWorld } from './world/homeWorld';
import { lod } from './core/lod';
import { tickClock } from './core/clock';
import { income } from './core/income';
import { bump } from './core/totals';
import { pace } from './core/pace';
import { GAME_SPEED } from './data/config';
import { Updater, versionLabel } from './core/updater';
import { HOME_HOWTO_HTML, HOME_HOWTO_TITLE } from './ui/howto';
import { Minimap } from './ui/minimap';

export interface HomeContext {
  app: HTMLElement;
  renderer: THREE.WebGLRenderer;
  save: SaveData;
  hud: Hud;
  sfx: Sfx;
  input: Input;
  progress: Progress;
  queenProgress: QueenProgress;
}

export async function startHome({ app, renderer, save, hud, sfx, input, progress, queenProgress }: HomeContext) {
  // 1) The models: the bugs (your helper ants), then the people (you, the neighbors)
  await loadModels((d, t) => hud.setLoading((d / t) * 0.5));
  await loadHumans((d, t) => hud.setLoading(0.5 + (d / t) * 0.5));
  const home = new HomeWorld(hud, sfx, save, progress);

  // 2) The HUD: no world switching, route board or shrine in this game (yet)
  hud.setNext(null);
  document.getElementById('modeBtn')?.classList.add('hidden');
  hud.initStats(progress, queenProgress);
  hud.initShrine(progress, () => false);
  progress.onChange = () => hud.renderLevel();
  progress.onLevelUp = (level) => {
    sfx.levelUp();
    hud.banner(`LEVEL UP! Lv ${level}`, 'Tap your level (top left) to spend your point', 2600);
    writeSave(save);
  };

  // 🗺️ The minimap (top right, under the 👁️ 🎒 buttons): tap it for the whole map
  const map = new Minimap(document.getElementById('mapSlot')!, HomeWorld.MAP_BOUNDS, () => home.mapView());

  // 3) Tapping a building (or a helper) opens its ⬆️ panel
  const tapNdc = new THREE.Vector2();
  input.onTap = (x, y) => {
    const r = renderer.domElement.getBoundingClientRect();
    tapNdc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    return home.ups?.pick(tapNdc) ?? false;
  };

  // 4) First-person / third-person view
  const viewBtn = document.getElementById('viewBtn')!;
  const applyView = () => {
    const fp = save.view === 'first';
    home.player.setFirstPerson(fp);
    viewBtn.classList.toggle('on', fp);
    viewBtn.textContent = fp ? '🎥' : '👁️';
    viewBtn.setAttribute('aria-label', fp ? 'Switch to third-person view' : 'Switch to first-person view');
  };
  viewBtn.addEventListener('click', () => {
    save.view = save.view === 'first' ? 'third' : 'first';
    applyView();
    if (save.view === 'first') hud.banner('👁️ First person', 'Left side: walk · Right side: drag to look', 2600);
    writeSave(save);
  });
  applyView();

  // 5) ⚙️ Settings → 📖 How to play (this game's), with 🔁 Replay the tutorial
  document.getElementById('howtoBtn')!.addEventListener('click', () => {
    document.getElementById('settings')!.classList.add('hidden');
    hud.showGuide(HOME_HOWTO_TITLE, HOME_HOWTO_HTML, [
      {
        label: '🔁 Replay the tutorial',
        cls: 'menu-btn',
        onClick: () => {
          home.tutorial.replay();
          writeSave(save);
          hud.banner('🎓 Tutorial restarted', 'Follow the yellow arrow 🔽', 4000);
        },
      },
      { label: 'Close', cls: 'big-btn' },
    ]);
  });

  // 6) Full-screen canvas (measured from #app: iPhone home-screen apps can report a short innerHeight)
  let lastW = 0;
  let lastH = 0;
  const resize = () => {
    lastW = app.clientWidth;
    lastH = app.clientHeight;
    renderer.setSize(lastW, lastH, false);
    home.resize(lastW, lastH);
  };
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  // 7) Save every few seconds and whenever the app is hidden
  window.setInterval(() => writeSave(save), 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) writeSave(save);
  });

  // 8) The +$/min idle rate: only cash the helpers collect (the Banker ant), smoothed
  let prevCash = save.cash;
  let winEarned = 0;
  let winT = 0;
  let autoTotal = 0;
  hud.setRate(save.rate * 60);
  const trackIncome = (dt: number) => {
    bump('played', dt);
    const gained = save.cash - prevCash;
    if (gained > 0) bump('earned', gained);
    prevCash = save.cash;
    autoTotal += income.auto;
    winEarned += income.auto;
    income.auto = 0;
    winT += dt;
    if (winT >= 10) {
      save.rate = save.rate * 0.85 + (winEarned / winT) * 0.15;
      if (save.rate < 0.02) save.rate = 0;
      hud.setRate(save.rate * 60);
      winEarned = 0;
      winT = 0;
    }
  };

  // 9) 📊 Lifetime stats (Level panel → Lifetime stats)
  hud.initTotals(() => {
    const n = (k: string) => save.totals[k] ?? 0;
    const money = (v: number) => `$${Math.round(v).toLocaleString()}`;
    const secs = n('played');
    const h = save.home!;
    return [
      'ANTHILL ISLAND (TEST)',
      { icon: '💵', label: 'Cash earned', value: money(n('earned')) },
      { icon: '⏱️', label: 'Time played', value: `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m` },
      { icon: '⭐', label: 'Your level', value: String(save.level) },
      { icon: '🍪', label: 'Snack packs made', value: h.made.toLocaleString() },
      { icon: '🙋', label: 'Orders filled', value: h.orders.toLocaleString() },
      { icon: '☕', label: 'Café sales', value: h.cafeSales.toLocaleString() },
      { icon: '📦', label: 'Crate trips', value: h.crate.trips.toLocaleString() },
      { icon: '🐜', label: 'Ants working', value: String(home.workers.length + home.bankers.length) },
      { icon: '💤', label: 'Idle income now', value: `${money(save.rate * 60)}/min` },
    ];
  });

  // 10) 🐢 / 🐇 Movement speed (Settings slider, saved on this device)
  try {
    pace.move = THREE.MathUtils.clamp(Number(localStorage.getItem(GAME_SPEED.key)) || 1, GAME_SPEED.min, GAME_SPEED.max);
  } catch {
    /* ignore */
  }
  hud.initSpeed(pace.move, (v) => {
    pace.move = v;
    try {
      localStorage.setItem(GAME_SPEED.key, String(v));
    } catch {
      /* ignore */
    }
  });

  // 11) Auto-update: a newer build reloads into it (after saving)
  const updater = new Updater({
    canReload: () => true,
    beforeReload: () => writeSave(save),
    onStatus: (t) => hud.setUpdateStatus(t),
    confirm: (version) => hud.showUpdate(version, 10),
  });
  hud.initVersion(versionLabel(), () => updater.check(true));

  // 12) Auto quality: if it can't keep up, step down (shadows first, then pixels)
  const dpr = Math.min(window.devicePixelRatio, 2);
  const QUALITY = [
    { pixelRatio: dpr, shadow: 2048 },
    { pixelRatio: dpr, shadow: 1024 },
    { pixelRatio: Math.min(dpr, 1.75), shadow: 1024 },
    { pixelRatio: Math.min(dpr, 1.5), shadow: 512 },
  ];
  let quality = 0;
  let frameSum = 0;
  let frameCount = 0;
  let qualityWait = 4;
  const watchQuality = (rawMs: number) => {
    if (document.hidden) return;
    if (rawMs > 250) return; // (back from the background: that frame spans the time away)
    qualityWait -= rawMs / 1000;
    if (qualityWait > 0) return;
    frameSum += rawMs;
    if (++frameCount < 90) return;
    const avg = frameSum / frameCount;
    frameSum = frameCount = 0;
    if (avg > 25 && quality < QUALITY.length - 1) {
      quality++;
      renderer.setPixelRatio(QUALITY[quality].pixelRatio);
      home.setShadowSize(QUALITY[quality].shadow);
      resize();
      qualityWait = 3;
    }
  };

  // 13) The main loop. `?speed=4` fast-forwards (testing).
  const testSpeed = Math.min(10, Number(new URLSearchParams(location.search).get('speed')) || 1);
  // 🧪 Testing only: ?sim=1 runs without drawing (fast headless playthroughs)
  if (import.meta.env.DEV && new URLSearchParams(location.search).get('sim') === '1') renderer.render = () => {};
  let gameTime = 0;
  const steps = (dt: number) => {
    const n = Math.max(1, Math.ceil(dt / 0.05 - 1e-6));
    return Array.from({ length: n }, () => dt / n);
  };
  hud.hideLoading();
  let last = performance.now();
  const errors = new Set<string>();
  const frame = (now: number) => {
    requestAnimationFrame(frame); // (booked first: one bad frame can't stop the game)
    try {
      tick(now);
    } catch (e) {
      const msg = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      if (!errors.has(msg)) {
        errors.add(msg);
        console.error('Anthill Island frame error:', msg);
      }
    }
  };
  const tick = (now: number) => {
    const rawMs = now - last;
    last = now;
    const dt = Math.min(0.05, rawMs / 1000) * testSpeed;
    gameTime += dt;
    tickClock(rawMs / 1000, Math.min(0.05, rawMs / 1000));
    watchQuality(rawMs);
    sfx.setMusic('colony');
    trackIncome(Math.min(1, rawMs / 1000));
    if (app.clientWidth !== lastW || app.clientHeight !== lastH) resize();
    input.splitLook = save.view === 'first';
    input.update();
    const look = input.takeLook();
    home.player.look(look.dx, look.dy);
    for (const step of steps(dt)) home.update(step, input.move);
    lod.update(home.scene, home.camera, home.focus);
    renderer.render(home.scene, home.camera);
    map.update(Math.min(0.1, rawMs / 1000)); // (after the 3D frame: the map can never cost you one)
  };
  requestAnimationFrame(frame);

  // Handy for testing in the browser console (and the headless tests)
  (window as unknown as { game: unknown }).game = {
    home, save, progress, renderer, map,
    get time() { return gameTime; },
    get autoTotal() { return autoTotal; },
  };
}

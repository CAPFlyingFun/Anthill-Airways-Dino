// ============================================================================
// main.ts — starts the game: renderer, input, HUD, loading the 3D bug models,
// the two game modes (base = walking around the colony, run = gate run),
// XP/levels, saving, and the main loop.
// ============================================================================
import * as THREE from 'three';
import './style.css';
import { Input } from './core/input';
import { Sfx } from './core/audio';
import { clearSave, loadSave, writeSave } from './core/save';
import { Progress, QueenProgress } from './core/progress';
import { OFFLINE, QUEEN_UNLOCK_LEVEL } from './data/config';
import { Hud } from './ui/hud';
import { BaseWorld } from './world/baseWorld';
import { GateRun } from './runs/gateRun';
import { loadHumans, loadIsland, loadModels } from './actors/creatures';
import { AirportWorld } from './world/airportWorld';
import { IslandWorld } from './world/islandWorld';
import { lod } from './core/lod';
import { Updater, versionLabel } from './core/updater';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const save = loadSave();
// How long since the last save (= since you last played), for offline earnings.
const awayAtLaunch = save.lastSeen ? (Date.now() - save.lastSeen) / 1000 : 0;
const hud = new Hud();
const sfx = new Sfx();
sfx.enabled = save.sound;
const input = new Input(renderer.domElement);
input.onFirstTouch(() => sfx.unlock());
const progress = new Progress(save);
const queenProgress = new QueenProgress(save);

hud.initSettings({
  sound: save.sound,
  onSound: (on) => {
    save.sound = on;
    sfx.enabled = on;
    writeSave(save);
  },
  onReset: () => {
    clearSave();
    window.location.reload();
  },
});

async function start() {
  // 1) Load the real bug models (shows the loading bar).
  await loadModels((done, total) => hud.setLoading(done / total));

  // 2) Build both game modes.
  const base = new BaseWorld(hud, sfx, save, progress, queenProgress);
  const run = new GateRun(hud, sfx);
  // base = the ant colony, air = the airport (Act 2), run = a gate run
  // base = the ant colony, air = the airport (Act 2), island = Dino Island (Act 3), run = a gate run
  let mode: 'base' | 'air' | 'island' | 'run' = 'base';
  let airport: AirportWorld | null = null;
  let island: IslandWorld | null = null;
  type World = 'base' | 'air' | 'island';
  const modeBtn = document.getElementById('modeBtn')!;
  const fade = document.getElementById('fade')!;

  // 3) XP + level-ups
  hud.initStats(progress, queenProgress);
  progress.onChange = () => hud.renderLevel();
  queenProgress.onChange = () => hud.renderLevel();
  progress.onLevelUp = (level) => {
    sfx.unlocked();
    hud.banner(`LEVEL UP! Lv ${level}`, 'Tap your level (top left) to spend your point', 2600);
    if (level >= QUEEN_UNLOCK_LEVEL) base.activateQueen(true);
    writeSave(save);
  };

  // 4) Tapping LAUNCH RUN switches to the gate run; finishing switches back.
  base.onLaunch = (count, from) => {
    mode = 'run';
    run.luck = progress.luck;
    run.cashMult = progress.cashMult;
    run.start(
      count,
      (endCount) => {
        mode = 'base';
        base.receiveRunPayout(endCount, from.itemType);
        writeSave(save);
        if (pendingAway) {
          const secs = pendingAway;
          pendingAway = 0;
          offerOffline(secs);
        }
      },
      from.theme,
      from.itemType,
    );
  };

  // 4b) ACT 2: the airport. The people models download only once you get here.
  async function openAirport() {
    if (airport) return airport;
    await loadHumans();
    airport = new AirportWorld(hud, sfx, save, progress);
    airport.resize(app.clientWidth, app.clientHeight);
    airport.setShadowSize(QUALITY[quality].shadow);
    airport.player.setFirstPerson(save.view === 'first');
    modeBtn.classList.remove('hidden');
    hookAct3();
    return airport;
  }

  // ACT 3: Dino Island (its dinos, sea creatures + trees load the first time).
  async function openIsland() {
    if (island) return island;
    await openAirport(); // the island uses the airport's people
    await loadIsland();
    island = new IslandWorld(hud, sfx, save, progress);
    island.resize(app.clientWidth, app.clientHeight);
    island.setShadowSize(QUALITY[quality].shadow);
    island.player.setFirstPerson(save.view === 'first');
    // 🚤 Sea Safari: a gate run on the open sea, paid per tourist who makes it
    island.onSafari = (count) => {
      mode = 'run';
      hud.setLaunch(null);
      run.luck = progress.luck;
      run.cashMult = progress.cashMult;
      run.start(count, (end) => {
        mode = 'island';
        island!.enter(false);
        island!.receiveSafari(end);
        writeSave(save);
      }, 'ocean', 'ticket');
    };
    return island;
  }
  const islandOpen = () => save.unlocked.includes('a2-island');

  /** Fade out, swap worlds, fade in. The other worlds keep running behind. */
  let switching = false;
  async function switchWorld(to: World) {
    if (switching || mode === 'run' || mode === to) return;
    switching = true;
    closeWorldMenu();
    fade.classList.add('on');
    const from = mode as World;
    if (to === 'air') await openAirport();
    if (to === 'island') await openIsland();
    await new Promise((r) => setTimeout(r, 380));
    hud.setLaunch(null);
    // Leave the old world (it keeps running in the background)...
    if (from === 'base') base.active = false;
    else if (from === 'air') airport?.leave();
    else if (from === 'island') island?.leave();
    // ...and step into the new one.
    if (to === 'base') base.enter();
    else if (to === 'air') {
      airport!.enter(from === 'base'); // from the colony: zoom out of its planter box
      if (!save.airSeen) {
        save.airSeen = true;
        hud.banner('✈️ Welcome to the airport!', 'Your colony keeps working in the planter box by the window', 4500);
      }
    } else {
      island!.enter(true); // fly in over the island
      hud.banner('🏝️ Dino Island', 'Tourists fly in on Anthill Airways. Start with the Juice Bar!', 3500);
    }
    mode = to;
    save.world = to === 'base' ? 'ant' : to;
    refreshModeBtn();
    modeBtn.classList.remove('pulse');
    writeSave(save);
    fade.classList.remove('on');
    switching = false;
  }

  // The world button: before the island, it flips colony <-> airport. After,
  // it opens a little menu of all three worlds.
  const worldMenu = document.getElementById('worldMenu')!;
  function refreshModeBtn() {
    if (islandOpen()) {
      modeBtn.textContent = '🌍';
      modeBtn.setAttribute('aria-label', 'Travel to another world');
    } else {
      modeBtn.textContent = mode === 'air' ? '🐜' : '🧍';
      modeBtn.setAttribute('aria-label', mode === 'air' ? 'Back to the ant colony' : 'Go to the airport (human scale)');
    }
    worldMenu.querySelectorAll<HTMLButtonElement>('button[data-world]').forEach((b) => b.classList.toggle('here', b.dataset.world === mode));
  }
  function closeWorldMenu() {
    worldMenu.classList.add('hidden');
  }
  modeBtn.addEventListener('click', () => {
    if (!islandOpen()) {
      switchWorld(mode === 'air' ? 'base' : 'air');
      return;
    }
    refreshModeBtn();
    worldMenu.classList.toggle('hidden');
  });
  worldMenu.querySelectorAll<HTMLButtonElement>('button[data-world]').forEach((b) =>
    b.addEventListener('click', () => {
      const to = b.dataset.world as World;
      if (to === mode) closeWorldMenu();
      else switchWorld(to);
    }),
  );
  refreshModeBtn();

  // First-person / third-person view (both worlds; gate runs stay as they are).
  const viewBtn = document.getElementById('viewBtn')!;
  function applyView() {
    const fp = save.view === 'first';
    base.player.setFirstPerson(fp);
    airport?.player.setFirstPerson(fp);
    island?.player.setFirstPerson(fp);
    viewBtn.classList.toggle('on', fp);
    viewBtn.textContent = fp ? '🎥' : '👁️';
    viewBtn.setAttribute('aria-label', fp ? 'Switch to third-person view' : 'Switch to first-person view');
  }
  viewBtn.addEventListener('click', () => {
    save.view = save.view === 'first' ? 'third' : 'first';
    applyView();
    if (save.view === 'first') hud.banner('👁️ First person', 'Left side: walk · Right side: drag to look', 2600);
    writeSave(save);
  });
  applyView();

  base.onAct2 = async () => {
    hud.banner('Act 1 complete! ✈️🏆', 'Opening the airport…', 4000);
    await openAirport();
    modeBtn.classList.add('pulse');
    hud.banner('The airport is open! ✈️', 'Tap 🧍 (top left) to go human scale', 6000);
  };

  // ACT 3: buying "Big Order: Island" at the airport opens Dino Island.
  function hookAct3() {
    if (!airport) return;
    airport.onAct3 = async () => {
      hud.banner('🏝️ Island route chartered!', 'Loading Dino Island…', 4000);
      await openIsland();
      refreshModeBtn();
      modeBtn.classList.add('pulse');
      hud.banner('Dino Island is open! 🦖', 'Tap 🌍 (top left) to fly there', 6000);
    };
  }

  // 5) Size the canvas to the full screen. We measure the #app box (which is
  // fixed to all four screen edges) instead of window.innerHeight, because
  // iPhone home-screen apps can report a shorter innerHeight and leave a gap.
  let lastW = 0;
  let lastH = 0;
  function resize() {
    const w = app.clientWidth;
    const h = app.clientHeight;
    lastW = w;
    lastH = h;
    renderer.setSize(w, h, false); // false = keep the CSS size at 100%
    base.resize(w, h);
    run.resize(w, h);
    airport?.resize(w, h);
    island?.resize(w, h);
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  // Save every few seconds and whenever the app is hidden / closed.
  window.setInterval(() => writeSave(save), 5000);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      writeSave(save);
      hiddenAt = Date.now();
    } else if (hiddenAt) {
      // Back from the home screen / another app: pay for the time away.
      offerOffline((Date.now() - hiddenAt) / 1000);
      hiddenAt = 0;
    }
  });

  // ---- Idle income -----------------------------------------------------------
  // Measure income while playing: cash gained every 10 s (spending ignored),
  // smoothed. Gate run payouts don't count (they're not idle income).
  let prevCash = save.cash;
  let winEarned = 0;
  let winT = 0;
  hud.setRate(save.rate * 60);
  function trackIncome(dt: number) {
    if (mode === 'run') {
      prevCash = save.cash;
      return;
    }
    const gained = save.cash - prevCash;
    if (gained > 0) winEarned += gained;
    prevCash = save.cash;
    winT += dt;
    if (winT >= 10) {
      const r = winEarned / winT;
      save.rate = save.rate > 0 ? save.rate * 0.85 + r * 0.15 : r;
      hud.setRate(save.rate * 60);
      winEarned = 0;
      winT = 0;
    }
  }

  // ---- Offline earnings + the bonus gate run ---------------------------------
  let pendingAway = 0;
  let welcomeOpen = false;
  async function offerOffline(secs: number) {
    if (secs < OFFLINE.minAwaySecs) return;
    if (mode === 'run' || welcomeOpen || switching) {
      pendingAway += secs; // ask after the run
      return;
    }
    const capped = Math.min(secs, OFFLINE.maxHours * 3600);
    const amount = Math.floor(save.rate * capped * OFFLINE.share);
    if (amount < 1) return; // no income measured yet
    welcomeOpen = true;
    const choice = await hud.showWelcome(capped, amount);
    welcomeOpen = false;
    if (choice === 'collect') {
      payOffline(amount);
      return;
    }
    // Bonus run: cash bundles on a tougher course. The finish pays per bundle.
    const back = mode === 'air' ? 'air' : mode === 'island' ? 'island' : 'base';
    mode = 'run';
    hud.setLaunch(null);
    run.luck = progress.luck;
    const per = amount / OFFLINE.runBundles;
    run.start(
      OFFLINE.runBundles,
      (end) => {
        mode = back;
        if (back === 'air') airport?.enter(false);
        else if (back === 'island') island?.enter(false);
        else base.enter();
        payOffline(Math.max(amount * OFFLINE.keepMin, end * per));
      },
      'grass',
      'cash',
      { hard: true, valueEach: per, keepMin: amount * OFFLINE.keepMin, title: '💰 BONUS RUN' },
    );
  }
  function payOffline(amount: number) {
    save.cash += Math.round(amount);
    hud.setCash(save.cash);
    prevCash = save.cash; // not counted as idle income
    sfx.unlocked();
    writeSave(save);
    if (pendingAway) {
      const more = pendingAway;
      pendingAway = 0;
      offerOffline(more);
    }
  }

  // Auto-update: checks for a newer build and reloads into it (never mid gate run).
  const updater = new Updater({
    canReload: () => mode !== 'run' && !switching,
    beforeReload: () => writeSave(save),
    onStatus: (t) => hud.setUpdateStatus(t),
  });
  hud.initVersion(versionLabel(), () => updater.check(true));

  // 6) Auto quality. If the game can't keep up (slower than ~40 fps for a
  // couple of seconds), step down one level: fewer pixels, softer shadows.
  // It only ever steps DOWN, so it never flickers back and forth.
  // Shadows get cheaper first; resolution only drops a little (text stays sharp).
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
  let qualityWait = 4; // seconds to wait before judging (models are still warming up)
  function watchQuality(rawMs: number) {
    if (document.hidden) return;
    qualityWait -= rawMs / 1000;
    if (qualityWait > 0) return;
    frameSum += rawMs;
    if (++frameCount < 90) return;
    const avg = frameSum / frameCount;
    frameSum = frameCount = 0;
    if (avg > 25 && quality < QUALITY.length - 1) {
      quality++;
      renderer.setPixelRatio(QUALITY[quality].pixelRatio);
      base.setShadowSize(QUALITY[quality].shadow);
      airport?.setShadowSize(QUALITY[quality].shadow);
      island?.setShadowSize(QUALITY[quality].shadow);
      resize();
      qualityWait = 3;
    }
  }

  // Act 2 already reached in an earlier session: get the airport ready, and
  // go straight back to it if that's where you left off.
  if (save.world === 'island' && islandOpen()) {
    await loadHumans((d, t) => hud.setLoading((d / t) * 0.5));
    await loadIsland((d, t) => hud.setLoading(0.5 + (d / t) * 0.5));
    await switchWorld('island');
  } else if (save.unlocked.includes('expand3')) {
    if (save.world === 'air') {
      await loadHumans((d, t) => hud.setLoading(d / t)); // loading bar again, for the people
      await switchWorld('air');
      if (islandOpen()) void openIsland();
    } else {
      void openAirport().then(() => {
        if (islandOpen()) void openIsland(); // the island idles in the background too
        if (save.airSeen) return;
        // Finished Act 1 before the airport existed: point them to it.
        modeBtn.classList.add('pulse');
        hud.banner('The airport is open! ✈️', 'Tap 🧍 (top left) to go human scale', 6000);
      });
    }
  }

  hud.hideLoading();
  // Welcome back! (time since you last played)
  window.setTimeout(() => offerOffline(awayAtLaunch), 900);

  // 7) Main loop. `?speed=4` in the URL fast-forwards (handy for testing).
  const timeScale = Math.min(10, Number(new URLSearchParams(location.search).get('speed')) || 1);
  // The worlds you're NOT looking at keep running (idle game!), but only every
  // other frame, taking turns, with the time they missed (saves battery).
  const still = new THREE.Vector2();
  const bgDt = { base: 0, air: 0, island: 0 };
  let bgTurn = 0;
  function background(dt: number) {
    const others = (['base', 'air', 'island'] as const).filter((w) => w !== mode && (w === 'base' || (w === 'air' ? airport : island)));
    for (const w of others) bgDt[w] += dt;
    if (!others.length || ++bgTurn % 2) return;
    const w = others[(bgTurn >> 1) % others.length];
    const step = Math.min(bgDt[w], 0.15);
    bgDt[w] = 0;
    if (w === 'base') base.update(step, still);
    else if (w === 'air') airport?.update(step, still);
    else island?.update(step, still);
  }

  let last = performance.now();
  function frame(now: number) {
    const rawMs = now - last;
    const dt = Math.min(0.05, rawMs / 1000) * timeScale; // cap dt so a lag spike can't teleport things
    last = now;
    watchQuality(rawMs);
    trackIncome(Math.min(1, rawMs / 1000)); // real seconds (income per real second)
    // Rotating the phone: some browsers report the new size a moment late, so
    // check every frame and resize as soon as it changes (no squashed view).
    if (app.clientWidth !== lastW || app.clientHeight !== lastH) resize();
    input.splitLook = save.view === 'first' && mode !== 'run';
    input.update();
    const look = input.takeLook();
    if (mode === 'base') base.player.look(look.dx, look.dy);
    else if (mode === 'air') airport?.player.look(look.dx, look.dy);
    else if (mode === 'island') island?.player.look(look.dx, look.dy);
    if (mode === 'base') {
      base.update(dt, input.move);
      background(dt);
      lod.update(base.scene, base.camera, base.player.pos); // hide what the camera can't see
      renderer.render(base.scene, base.camera);
    } else if (mode === 'air' && airport) {
      airport.update(dt, input.move);
      background(dt);
      lod.update(airport.scene, airport.camera, airport.focus);
      renderer.render(airport.scene, airport.camera);
    } else if (mode === 'island' && island) {
      island.update(dt, input.move);
      background(dt);
      lod.update(island.scene, island.camera, island.focus);
      renderer.render(island.scene, island.camera);
    } else {
      run.update(dt, input.move);
      lod.update(run.scene, run.camera, run.camera.position);
      renderer.render(run.scene, run.camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for testing in the browser console: game.base.addCash(500), game.progress.addXp(100)
  (window as unknown as { game: unknown }).game = {
    base, run, save, progress, lod, renderer, quality: () => quality,
    get airport() { return airport; },
    get island() { return island; },
    switchWorld,
  };
}

start();

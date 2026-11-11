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
import { QUEEN_UNLOCK_LEVEL } from './data/config';
import { Hud } from './ui/hud';
import { BaseWorld } from './world/baseWorld';
import { GateRun } from './runs/gateRun';
import { loadHumans, loadModels } from './actors/creatures';
import { AirportWorld } from './world/airportWorld';
import { lod } from './core/lod';
import { Updater, versionLabel } from './core/updater';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const save = loadSave();
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
  let mode: 'base' | 'air' | 'run' = 'base';
  let airport: AirportWorld | null = null;
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
    return airport;
  }

  /** Fade out, swap worlds, fade in. The other world keeps running behind. */
  let switching = false;
  async function switchWorld(to: 'base' | 'air') {
    if (switching || mode === 'run' || mode === to) return;
    switching = true;
    fade.classList.add('on');
    const air = await openAirport();
    await new Promise((r) => setTimeout(r, 380));
    hud.setLaunch(null);
    if (to === 'air') {
      base.active = false;
      air.enter(true); // camera zooms out from the colony's planter box
      if (!save.airSeen) {
        save.airSeen = true;
        hud.banner('✈️ Welcome to the airport!', 'Your colony keeps working in the planter box by the window', 4500);
      }
    } else {
      air.leave();
      base.enter();
    }
    mode = to;
    save.world = to === 'air' ? 'air' : 'ant';
    modeBtn.textContent = to === 'air' ? '🐜' : '🧍';
    modeBtn.setAttribute('aria-label', to === 'air' ? 'Back to the ant colony' : 'Go to the airport (human scale)');
    modeBtn.classList.remove('pulse');
    writeSave(save);
    fade.classList.remove('on');
    switching = false;
  }
  modeBtn.addEventListener('click', () => switchWorld(mode === 'air' ? 'base' : 'air'));

  // First-person / third-person view (both worlds; gate runs stay as they are).
  const viewBtn = document.getElementById('viewBtn')!;
  function applyView() {
    const fp = save.view === 'first';
    base.player.setFirstPerson(fp);
    airport?.player.setFirstPerson(fp);
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
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));
  resize();

  // Save every few seconds and whenever the app is hidden / closed.
  window.setInterval(() => writeSave(save), 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) writeSave(save);
  });

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
      resize();
      qualityWait = 3;
    }
  }

  // Act 2 already reached in an earlier session: get the airport ready, and
  // go straight back to it if that's where you left off.
  if (save.unlocked.includes('expand3')) {
    if (save.world === 'air') {
      await loadHumans((d, t) => hud.setLoading(d / t)); // loading bar again, for the people
      await switchWorld('air');
    } else {
      void openAirport().then(() => {
        if (save.airSeen) return;
        // Finished Act 1 before the airport existed: point them to it.
        modeBtn.classList.add('pulse');
        hud.banner('The airport is open! ✈️', 'Tap 🧍 (top left) to go human scale', 6000);
      });
    }
  }

  hud.hideLoading();

  // 7) Main loop. `?speed=4` in the URL fast-forwards (handy for testing).
  const timeScale = Math.min(10, Number(new URLSearchParams(location.search).get('speed')) || 1);
  // The world you're NOT looking at keeps running (idle game!), but only every
  // other frame (with twice the time step) to save battery.
  const still = new THREE.Vector2();
  let bgDt = 0;
  let bgFrame = 0;
  function background(dt: number) {
    bgDt += dt;
    if (++bgFrame % 2) return;
    const step = Math.min(bgDt, 0.1);
    bgDt = 0;
    if (mode === 'base') airport?.update(step, still);
    else if (mode === 'air') base.update(step, still);
  }

  let last = performance.now();
  function frame(now: number) {
    const rawMs = now - last;
    const dt = Math.min(0.05, rawMs / 1000) * timeScale; // cap dt so a lag spike can't teleport things
    last = now;
    watchQuality(rawMs);
    // Rotating the phone: some browsers report the new size a moment late, so
    // check every frame and resize as soon as it changes (no squashed view).
    if (app.clientWidth !== lastW || app.clientHeight !== lastH) resize();
    input.splitLook = save.view === 'first' && mode !== 'run';
    input.update();
    const look = input.takeLook();
    if (mode === 'base') base.player.look(look.dx, look.dy);
    else if (mode === 'air') airport?.player.look(look.dx, look.dy);
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
    switchWorld,
  };
}

start();

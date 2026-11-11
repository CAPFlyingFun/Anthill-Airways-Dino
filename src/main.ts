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
import { loadModels } from './actors/creatures';
import { lod } from './core/lod';

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
  let mode: 'base' | 'run' = 'base';

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

  // 5) Size the canvas to the full screen. We measure the #app box (which is
  // fixed to all four screen edges) instead of window.innerHeight, because
  // iPhone home-screen apps can report a shorter innerHeight and leave a gap.
  function resize() {
    const w = app.clientWidth;
    const h = app.clientHeight;
    renderer.setSize(w, h, false); // false = keep the CSS size at 100%
    base.resize(w, h);
    run.resize(w, h);
  }
  window.addEventListener('resize', resize);
  window.visualViewport?.addEventListener('resize', resize);
  resize();

  // Save every few seconds and whenever the app is hidden / closed.
  window.setInterval(() => writeSave(save), 5000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) writeSave(save);
  });

  hud.hideLoading();

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
      resize();
      qualityWait = 3;
    }
  }

  // 7) Main loop. `?speed=4` in the URL fast-forwards (handy for testing).
  const timeScale = Math.min(10, Number(new URLSearchParams(location.search).get('speed')) || 1);
  let last = performance.now();
  function frame(now: number) {
    const rawMs = now - last;
    const dt = Math.min(0.05, rawMs / 1000) * timeScale; // cap dt so a lag spike can't teleport things
    last = now;
    watchQuality(rawMs);
    input.update();
    if (mode === 'base') {
      base.update(dt, input.move);
      lod.update(base.scene, base.camera, base.player.pos); // hide what the camera can't see
      renderer.render(base.scene, base.camera);
    } else {
      run.update(dt, input.move);
      lod.update(run.scene, run.camera, run.camera.position);
      renderer.render(run.scene, run.camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for testing in the browser console: game.base.addCash(500), game.progress.addXp(100)
  (window as unknown as { game: unknown }).game = { base, run, save, progress, lod, renderer, quality: () => quality };
}

start();

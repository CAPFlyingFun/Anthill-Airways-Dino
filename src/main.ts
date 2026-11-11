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
import { Progress } from './core/progress';
import { Hud } from './ui/hud';
import { BaseWorld } from './world/baseWorld';
import { GateRun } from './runs/gateRun';
import { loadModels } from './actors/creatures';

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
  const base = new BaseWorld(hud, sfx, save, progress);
  const run = new GateRun(hud, sfx);
  let mode: 'base' | 'run' = 'base';

  // 3) XP + level-ups
  hud.initStats(progress);
  progress.onChange = () => hud.renderLevel();
  progress.onLevelUp = (level) => {
    sfx.unlocked();
    hud.banner(`LEVEL UP! Lv ${level}`, 'Tap your level (top left) to spend your point', 2600);
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

  // 6) Main loop. `?speed=4` in the URL fast-forwards (handy for testing).
  const timeScale = Math.min(10, Number(new URLSearchParams(location.search).get('speed')) || 1);
  let last = performance.now();
  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000) * timeScale; // cap dt so a lag spike can't teleport things
    last = now;
    input.update();
    if (mode === 'base') {
      base.update(dt, input.move);
      renderer.render(base.scene, base.camera);
    } else {
      run.update(dt, input.move);
      renderer.render(run.scene, run.camera);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Handy for testing in the browser console: game.base.addCash(500), game.progress.addXp(100)
  (window as unknown as { game: unknown }).game = { base, run, save, progress };
}

start();

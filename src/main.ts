// ============================================================================
// main.ts — starts the game: renderer, input, HUD, the two game modes
// (base = walking around the colony, run = gate run), saving, and the loop.
// ============================================================================
import * as THREE from 'three';
import './style.css';
import { Input } from './core/input';
import { Sfx } from './core/audio';
import { clearSave, loadSave, writeSave } from './core/save';
import { Hud } from './ui/hud';
import { BaseWorld } from './world/baseWorld';
import { GateRun } from './runs/gateRun';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const save = loadSave();
const hud = new Hud();
const sfx = new Sfx();
sfx.enabled = save.sound;
const input = new Input(renderer.domElement);
input.onFirstTouch(() => sfx.unlock());

const base = new BaseWorld(hud, sfx, save);
const run = new GateRun(hud, sfx);
let mode: 'base' | 'run' = 'base';

// Tapping LAUNCH RUN switches to the gate run; finishing switches back.
base.onLaunch = (count) => {
  mode = 'run';
  run.start(count, (endCount) => {
    mode = 'base';
    base.receiveRunPayout(endCount);
    writeSave(save);
  });
};

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

function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  base.resize(w, h);
  run.resize(w, h);
}
window.addEventListener('resize', resize);
resize();

// Save every few seconds and whenever the app is hidden / closed.
window.setInterval(() => writeSave(save), 5000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) writeSave(save);
});

// Main loop
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000); // cap dt so a lag spike can't teleport things
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

// Handy for testing in the browser console: window.game.base.addCash(500)
(window as unknown as { game: unknown }).game = { base, run, save };

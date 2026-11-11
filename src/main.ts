// ============================================================================
// main.ts — starts the game: renderer, input, HUD, loading the 3D bug models,
// the two game modes (base = walking around the colony, run = gate run),
// XP/levels, saving, and the main loop.
// ============================================================================
import * as THREE from 'three';
import './style.css';
import { Input } from './core/input';
import { Sfx } from './core/audio';
import { SLOTS, Slot, activeSlot, clearSave, eraseSlot, loadSave, slotSummary, switchSlot, writeSave } from './core/save';
import { Progress, QueenProgress } from './core/progress';
import { GAME_SPEED, HOTEL_CFG, OFFLINE, QUEEN_UNLOCK_LEVEL, VOLCANO_CFG } from './data/config';
import { erupt, shardsFor } from './core/prestige';
import { pace } from './core/pace';
import { weather } from './core/weather';
import { Hud } from './ui/hud';
import { BaseWorld } from './world/baseWorld';
import { GateRun } from './runs/gateRun';
import { loadHumans, loadIsland, loadModels } from './actors/creatures';
import { AirportWorld } from './world/airportWorld';
import { IslandWorld } from './world/islandWorld';
import { VolcanoWorld } from './world/volcanoWorld';
import { HotelWorld } from './world/hotelWorld';
import { lod } from './core/lod';
import { Updater, versionLabel } from './core/updater';

const app = document.getElementById('app')!;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const save = loadSave();
// The colony's Conveyor Belt was removed (it starved the Runner Ant): refund it on old saves
if (save.unlocked.includes('conveyor')) {
  save.unlocked = save.unlocked.filter((id) => id !== 'conveyor');
  save.cash += 150;
}
delete save.paid['conveyor'];
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
  onOpen: () => showSlots(),
});

/** 💾 Save slots in Settings: tap one to switch (the game restarts into it). */
function showSlots() {
  const here = activeSlot();
  hud.renderSlots(
    SLOTS.map((n) => ({ n, here: n === here, info: slotSummary(n) })),
    (n) => {
      switchSlot(save, n as Slot); // pauses this slot (no offline income while away)
      window.location.reload();
    },
    (n) => {
      eraseSlot(n as Slot);
      showSlots();
    },
  );
}

async function start() {
  // 1) Load the real bug models (shows the loading bar).
  await loadModels((done, total) => hud.setLoading(done / total));

  // 2) Build both game modes.
  const base = new BaseWorld(hud, sfx, save, progress, queenProgress);
  const run = new GateRun(hud, sfx);
  // base = the ant colony, air = the airport (Act 2), island = Dino Island (Act 3),
  // volcano = Mount Anthill (Act 4), run = a gate run
  // hotel = the Anthill Grand Resort (Act 5)
  let mode: 'base' | 'air' | 'island' | 'volcano' | 'hotel' | 'run' = 'base';
  let airport: AirportWorld | null = null;
  let island: IslandWorld | null = null;
  let volcano: VolcanoWorld | null = null;
  let hotel: HotelWorld | null = null;
  type World = 'base' | 'air' | 'island' | 'volcano' | 'hotel';
  const modeBtn = document.getElementById('modeBtn')!;
  const fade = document.getElementById('fade')!;

  // 3) XP + level-ups
  hud.initStats(progress, queenProgress);
  // 💎 The Obsidian Shrine shows up once you've reached the volcano (or erupted)
  hud.initShrine(progress, () => save.eruptions > 0 || save.shards > 0 || volcanoOpen());
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
    hookAct4();
    return island;
  }
  const islandOpen = () => save.unlocked.includes('a2-island');
  const volcanoOpen = () => save.unlocked.includes('i3-volcano');

  // ACT 4: the Volcano (the Lava Rex is built in code, so nothing new to download).
  async function openVolcano() {
    if (volcano) return volcano;
    await openIsland(); // shares the people + the island's models
    volcano = new VolcanoWorld(hud, sfx, save, progress);
    volcano.resize(app.clientWidth, app.clientHeight);
    volcano.setShadowSize(QUALITY[quality].shadow);
    volcano.player.setFirstPerson(save.view === 'first');
    // 🚁 Heli tour: a gate run over the lava, paid per tourist who makes it
    volcano.onTour = (count) => {
      mode = 'run';
      hud.setLaunch(null);
      hud.setHeat(null);
      run.luck = progress.luck;
      run.cashMult = progress.cashMult * VOLCANO_CFG.tourFare;
      run.start(count, (end) => {
        mode = 'volcano';
        volcano!.enter(false);
        volcano!.receiveTour(end);
        writeSave(save);
      }, 'lava', 'ticket');
    };
    // 🌋 The Big Eruption (prestige)
    volcano.onErupt = async () => {
      const gain = shardsFor(save.cycleEarned);
      const ok = await hud.confirmEruption(gain, save.cycleEarned, save.eruptions);
      if (!ok || !volcano) return;
      volcano.bigBang();
      hud.banner('🌋 KA-BOOOOM!', `+💎 ${gain} Obsidian Shards`, 4000);
      ashEl.classList.add('on');
      sfx.unlocked();
      await new Promise((r) => setTimeout(r, 3200));
      erupt(save, gain);
      writeSave(save);
      try {
        sessionStorage.setItem('anthill-erupted', String(gain)); // open the shrine after the restart
      } catch {
        /* ignore */
      }
      window.location.reload();
    };
    volcano.onAct5 = async () => {
      hud.banner('🏨 The resort is being built!', 'Loading the Anthill Grand Resort…', 4000);
      await openHotel();
      modeBtn.classList.add('pulse');
      hud.banner('The Anthill Grand Resort is open! 🏨', 'Tap 🌍 (top left) to go there', 6000);
    };
    refreshModeBtn();
    return volcano;
  }

  // ACT 5: the Anthill Grand Resort. Opens from the volcano; eruptions don't reset it.
  const hotelOpen = () => save.unlocked.includes('h5-open');
  async function openHotel() {
    if (hotel) return hotel;
    await openIsland(); // shares the people (and the island's Dodo, for when one escapes)
    hotel = new HotelWorld(hud, sfx, save, progress);
    hotel.resize(app.clientWidth, app.clientHeight);
    hotel.setShadowSize(QUALITY[quality].shadow);
    hotel.player.setFirstPerson(save.view === 'first');
    // 🛒 Bellhop Dash: race the luggage up the hallways for tips
    hotel.onDash = (count) => {
      mode = 'run';
      hud.setLaunch(null);
      run.luck = progress.luck;
      run.cashMult = hotel!.priceMult * HOTEL_CFG.bellhopTip; // (shows the tips on the results card)
      run.start(count, (end) => {
        mode = 'hotel';
        hotel!.enter(false);
        hotel!.receiveDash(end);
        writeSave(save);
      }, 'hotel', 'bag');
    };
    refreshModeBtn();
    return hotel;
  }

  // Buying "Big Order: Volcano" on the island opens Act 4.
  function hookAct4() {
    if (!island) return;
    island.onAct4 = async () => {
      hud.banner('🌋 Volcano expedition chartered!', 'Loading Mount Anthill…', 4000);
      await openVolcano();
      modeBtn.classList.add('pulse');
      hud.banner('Mount Anthill is open! 🌋🦖', 'Tap 🌍 (top left) to fly there', 6000);
    };
  }

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
    if (to === 'volcano') await openVolcano();
    if (to === 'hotel') await openHotel();
    await new Promise((r) => setTimeout(r, 380));
    hud.setLaunch(null);
    // Leave the old world (it keeps running in the background)...
    if (from === 'base') base.active = false;
    else if (from === 'air') airport?.leave();
    else if (from === 'island') island?.leave();
    else if (from === 'volcano') volcano?.leave();
    else if (from === 'hotel') hotel?.leave();
    // ...and step into the new one.
    if (to === 'base') base.enter();
    else if (to === 'air') {
      airport!.enter(from === 'base'); // from the colony: zoom out of its planter box
      if (!save.airSeen) {
        save.airSeen = true;
        hud.banner('✈️ Welcome to the airport!', 'Your colony keeps working in the planter box by the window', 4500);
      }
    } else if (to === 'island') {
      island!.enter(true); // fly in over the island
      hud.banner('🏝️ Dino Island', 'Tourists fly in on Anthill Airways. Start with the Juice Bar!', 3500);
    } else if (to === 'hotel') {
      hotel!.enter(true); // swoop down past the tower
      hud.banner('🏨 Anthill Grand Resort', 'Check guests in, get their luggage up, keep the rooms clean ⭐', 3800);
    } else {
      volcano!.enter(true); // swoop down from the crater
      hud.banner('🌋 Mount Anthill', 'Mine 🪨 obsidian, forge 💎 gems… and watch out for the lava!', 3800);
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
    worldMenu.querySelectorAll<HTMLButtonElement>('button[data-world]').forEach((b) => {
      b.classList.toggle('here', b.dataset.world === mode);
      if (b.dataset.world === 'volcano') b.classList.toggle('hidden', !volcanoOpen());
      if (b.dataset.world === 'hotel') b.classList.toggle('hidden', !hotelOpen());
    });
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

  // ⛈️ Storms (airport + island share the sky; the colony is underground)
  const stormEl = document.getElementById('storm')!;
  const ashEl = document.getElementById('ash')!;
  const humanWorld = () => mode === 'air' || mode === 'island';
  weather.onChange = (sky) => {
    if (!humanWorld()) return;
    if (sky === 'warning') hud.banner('⛈️ Storm in 15 s!', 'Flights + safaris will be grounded. Stock up now!', 3500);
    else if (sky === 'storm') hud.banner('⛈️ Tropical storm!', 'Everything waits for it to blow over (~45 s)', 3000);
    else hud.banner('☀️ The storm has passed', 'Flights and safaris are back on', 2200);
  };

  // First-person / third-person view (both worlds; gate runs stay as they are).
  const viewBtn = document.getElementById('viewBtn')!;
  function applyView() {
    const fp = save.view === 'first';
    base.player.setFirstPerson(fp);
    airport?.player.setFirstPerson(fp);
    island?.player.setFirstPerson(fp);
    volcano?.player.setFirstPerson(fp);
    hotel?.player.setFirstPerson(fp);
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
    volcano?.resize(w, h);
    hotel?.resize(w, h);
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
    if (gained > 0) {
      winEarned += gained;
      save.cycleEarned += gained; // counts toward the next eruption's shards
    }
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
    // 💤 Night Shift (shard upgrade): +10% share per level
    const share = Math.min(1, OFFLINE.share + progress.up('night') * 0.1);
    const amount = Math.floor(save.rate * capped * share);
    if (amount < 1) return; // no income measured yet
    welcomeOpen = true;
    const choice = await hud.showWelcome(capped, amount);
    welcomeOpen = false;
    if (choice === 'collect') {
      payOffline(amount);
      return;
    }
    // Bonus run: cash bundles on a tougher course. The finish pays per bundle.
    const back = mode === 'air' ? 'air' : mode === 'island' ? 'island' : mode === 'volcano' ? 'volcano' : mode === 'hotel' ? 'hotel' : 'base';
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
        else if (back === 'volcano') volcano?.enter(false);
        else if (back === 'hotel') hotel?.enter(false);
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
      volcano?.setShadowSize(QUALITY[quality].shadow);
      hotel?.setShadowSize(QUALITY[quality].shadow);
      resize();
      qualityWait = 3;
    }
  }

  // Act 2 already reached in an earlier session: get the airport ready, and
  // go straight back to it if that's where you left off.
  if ((save.world === 'island' && islandOpen()) || (save.world === 'volcano' && volcanoOpen()) || (save.world === 'hotel' && hotelOpen())) {
    await loadHumans((d, t) => hud.setLoading((d / t) * 0.5));
    await loadIsland((d, t) => hud.setLoading(0.5 + (d / t) * 0.5));
    await switchWorld(save.world === 'island' ? 'island' : save.world);
    if (volcanoOpen()) void openVolcano(); // keeps running in the background
    if (hotelOpen()) void openHotel();
  } else if (save.unlocked.includes('expand3')) {
    if (save.world === 'air') {
      await loadHumans((d, t) => hud.setLoading(d / t)); // loading bar again, for the people
      await switchWorld('air');
      if (islandOpen()) void openIsland().then(() => { if (volcanoOpen()) void openVolcano(); if (hotelOpen()) void openHotel(); });
    } else {
      void openAirport().then(() => {
        if (islandOpen()) void openIsland().then(() => { if (volcanoOpen()) void openVolcano(); if (hotelOpen()) void openHotel(); }); // they idle in the background too
        if (save.airSeen) return;
        // Finished Act 1 before the airport existed: point them to it.
        modeBtn.classList.add('pulse');
        hud.banner('The airport is open! ✈️', 'Tap 🧍 (top left) to go human scale', 6000);
      });
    }
  }

  hud.hideLoading();
  // Just erupted (the game restarted): show what the shards can buy
  try {
    const erupted = sessionStorage.getItem('anthill-erupted');
    if (erupted) {
      sessionStorage.removeItem('anthill-erupted');
      window.setTimeout(() => {
        hud.banner('🌋 The island starts fresh!', `+💎 ${erupted} Obsidian Shards: spend them at the Shrine`, 5000);
        hud.openShrine();
      }, 600);
    }
  } catch {
    /* ignore */
  }
  // Welcome back! (time since you last played)
  window.setTimeout(() => offerOffline(awayAtLaunch), 900);

  // 7) Main loop. `?speed=4` in the URL fast-forwards (handy for testing).
  const testSpeed = Math.min(10, Number(new URLSearchParams(location.search).get('speed')) || 1);
  // 🐢 / 🐇 Movement speed (Settings slider, saved on this device): 0.2x - 3x.
  // Only things that walk use it (see core/pace.ts); machines, timers and
  // flying items always run at normal speed.
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
  // The worlds you're NOT looking at keep running (idle game!), but only every
  // other frame, taking turns, with the time they missed (saves battery).
  const still = new THREE.Vector2();
  const bgDt = { base: 0, air: 0, island: 0, volcano: 0, hotel: 0 };
  let bgTurn = 0;
  function background(dt: number) {
    const open = { base: true, air: !!airport, island: !!island, volcano: !!volcano, hotel: !!hotel };
    const others = (['base', 'air', 'island', 'volcano', 'hotel'] as const).filter((w) => w !== mode && open[w]);
    for (const w of others) bgDt[w] += dt;
    if (!others.length || ++bgTurn % 2) return;
    const w = others[(bgTurn >> 1) % others.length];
    const step = Math.min(bgDt[w], 0.15);
    bgDt[w] = 0;
    if (w === 'base') base.update(step, still);
    else if (w === 'air') airport?.update(step, still);
    else if (w === 'island') island?.update(step, still);
    else if (w === 'volcano') volcano?.update(step, still);
    else hotel?.update(step, still);
  }

  /** Split a big time step (?speed= testing) into small ones so nothing tunnels through walls. */
  function steps(dt: number) {
    const n = Math.max(1, Math.ceil(dt / 0.05 - 1e-6));
    return Array.from({ length: n }, () => dt / n);
  }

  let last = performance.now();
  function frame(now: number) {
    const rawMs = now - last;
    const dt = Math.min(0.05, rawMs / 1000) * testSpeed; // cap dt so a lag spike can't teleport things
    last = now;
    watchQuality(rawMs);
    trackIncome(Math.min(1, rawMs / 1000)); // real seconds (income per real second)
    weather.update(dt);
    stormEl.classList.toggle('on', weather.storm && humanWorld());
    ashEl.classList.toggle('on', mode === 'volcano' && !!volcano?.erupting);
    // Rotating the phone: some browsers report the new size a moment late, so
    // check every frame and resize as soon as it changes (no squashed view).
    if (app.clientWidth !== lastW || app.clientHeight !== lastH) resize();
    input.splitLook = save.view === 'first' && mode !== 'run';
    input.update();
    const look = input.takeLook();
    if (mode === 'base') base.player.look(look.dx, look.dy);
    else if (mode === 'air') airport?.player.look(look.dx, look.dy);
    else if (mode === 'island') island?.player.look(look.dx, look.dy);
    else if (mode === 'volcano') volcano?.player.look(look.dx, look.dy);
    else if (mode === 'hotel') hotel?.player.look(look.dx, look.dy);
    if (mode === 'base') {
      for (const step of steps(dt)) base.update(step, input.move);
      background(dt);
      lod.update(base.scene, base.camera, base.player.pos); // hide what the camera can't see
      renderer.render(base.scene, base.camera);
    } else if (mode === 'air' && airport) {
      for (const step of steps(dt)) airport.update(step, input.move);
      background(dt);
      lod.update(airport.scene, airport.camera, airport.focus);
      renderer.render(airport.scene, airport.camera);
    } else if (mode === 'island' && island) {
      for (const step of steps(dt)) island.update(step, input.move);
      background(dt);
      lod.update(island.scene, island.camera, island.focus);
      renderer.render(island.scene, island.camera);
    } else if (mode === 'hotel' && hotel) {
      // (fast game speeds take smaller steps, so nobody walks through walls)
      for (const step of steps(dt)) hotel.update(step, input.move);
      background(dt);
      lod.update(hotel.scene, hotel.camera, hotel.focus);
      renderer.render(hotel.scene, hotel.camera);
    } else if (mode === 'volcano' && volcano) {
      for (const step of steps(dt)) volcano.update(step, input.move);
      background(dt);
      lod.update(volcano.scene, volcano.camera, volcano.focus);
      renderer.render(volcano.scene, volcano.camera);
    } else {
      for (const step of steps(dt)) run.update(step, input.move);
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
    get volcano() { return volcano; },
    get hotel() { return hotel; },
    openHotel,
    openVolcano,
    weather,
    switchWorld,
  };
}

start();

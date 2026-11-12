// ============================================================================
// audio.ts — sound effects + music.
//
// Sounds are mp3 files made with ElevenLabs (scripts/gen-audio.py writes them to
// public/audio/ along with manifest.json, the list of what exists). Any sound
// that hasn't been generated yet falls back to the old tiny synth beep, so the
// game never goes quiet while the files are being made.
//
// iPhone notes:
//   • Audio may only start after a touch, so `unlock()` runs on the first tap.
//   • THE SILENT SWITCH: Safari normally mutes web game audio when the phone is on
//     silent. We tell iOS this is MEDIA PLAYBACK (navigator.audioSession, iOS 17+;
//     older versions: a looping silent <audio> element does the same), so only
//     the volume buttons affect it, like a video or music app.
//
// Everything plays through two volume knobs (Settings): 🎵 Music and 🔊 Effects.
// Each sound is throttled so 30 pickups don't make a wall of noise.
// ============================================================================

/** Sound effect names (= public/audio/<id>.mp3). */
export type SoundId =
  | 'pickup' | 'drop' | 'cash' | 'sale' | 'unlockTick' | 'unlocked' | 'levelUp' | 'upgrade'
  | 'gateGood' | 'gateBad' | 'splash' | 'risky' | 'contract' | 'go' | 'trash' | 'popup' | 'welcome'
  | 'takeoff' | 'heli' | 'horn' | 'dodo' | 'dilo' | 'roar' | 'eruption' | 'lavaBomb' | 'bell' | 'thunder' | 'spider' | 'ptero';
/** Music tracks (= public/audio/music-<id>.mp3): one per world + the gate runs. */
export type MusicId = 'colony' | 'airport' | 'island' | 'volcano' | 'hotel' | 'run';
/** Background ambience beds (= public/audio/amb-<id>.mp3), quietly under the music. */
export type AmbienceId = 'island' | 'volcano';

/** A looping track (music or ambience) fading in/out on its own gain. */
interface Loop {
  key: string;
  el: HTMLAudioElement;
  gain: GainNode;
}

const BASE = `${import.meta.env.BASE_URL}audio/`;
const VOL_KEY = 'anthill-airways-audio';
/** Loaded right after the first tap (the ones you hear in the first minute). */
const PRELOAD: SoundId[] = ['pickup', 'drop', 'cash', 'sale', 'unlockTick', 'unlocked', 'levelUp', 'upgrade', 'popup', 'trash'];

/** A tiny silent WAV, looped on older iPhones to switch audio to "media" mode. */
function silentWav() {
  const n = 4000; // 0.5 s at 8 kHz, 8-bit mono
  const b = new DataView(new ArrayBuffer(44 + n));
  const str = (o: number, s: string) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF'); b.setUint32(4, 36 + n, true); str(8, 'WAVEfmt ');
  b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 8000, true); b.setUint32(28, 8000, true); b.setUint16(32, 1, true); b.setUint16(34, 8, true);
  str(36, 'data'); b.setUint32(40, n, true);
  for (let i = 0; i < n; i++) b.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}

export class Sfx {
  /** Master on/off (Settings "Sound" button). */
  enabled = true;
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private vol = { music: 0.6, sfx: 1 };
  private manifest: Record<string, string> = {};
  private buffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();
  private lastPlayed: Record<string, number> = {};
  private music: Loop | null = null;
  private wantMusic: MusicId | null = null;
  private amb: Loop | null = null;
  private wantAmb: AmbienceId | null = null;

  constructor() {
    try {
      const v = JSON.parse(localStorage.getItem(VOL_KEY) ?? '{}');
      if (typeof v.music === 'number') this.vol.music = v.music;
      if (typeof v.sfx === 'number') this.vol.sfx = v.sfx;
    } catch {
      /* private browsing: defaults */
    }
  }

  // ---- Start-up (first tap) ---------------------------------------------------
  unlock() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    // 🔇 Ignore the silent switch: this is media playback (volume buttons only)
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) {
      try {
        nav.audioSession.type = 'playback';
      } catch {
        /* not allowed: fine */
      }
    } else {
      // Older iPhones: a looping silent <audio> element does the same thing
      const el = document.createElement('audio');
      el.src = silentWav();
      el.loop = true;
      el.setAttribute('playsinline', '');
      el.setAttribute('x-webkit-airplay', 'deny');
      void el.play().catch(() => {});
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain.connect(this.ctx.destination);
    this.musicGain.connect(this.ctx.destination);
    this.applyVolumes();
    // Pause everything while the app is in the background
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      if (document.hidden) {
        void this.ctx.suspend();
        this.music?.el.pause();
        this.amb?.el.pause();
      } else {
        void this.ctx.resume();
        this.applyVolumes(); // (restarts the loops that should be playing)
      }
    });
    // Which sounds exist (made by scripts/gen-audio.py). Never cached: always the live list.
    fetch(`${BASE}manifest.json?t=${Date.now()}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((m: Record<string, string>) => {
        this.manifest = m ?? {};
        PRELOAD.forEach((id) => this.load(id));
        const music = this.wantMusic;
        const amb = this.wantAmb;
        this.wantMusic = this.wantAmb = null;
        this.setMusic(music);
        this.setAmbience(amb);
      })
      .catch(() => {});
  }

  // ---- Volumes (Settings sliders) ----------------------------------------------
  get musicVolume() {
    return this.vol.music;
  }
  get sfxVolume() {
    return this.vol.sfx;
  }
  setVolumes(music: number, sfx: number) {
    this.vol = { music, sfx };
    try {
      localStorage.setItem(VOL_KEY, JSON.stringify(this.vol));
    } catch {
      /* fine */
    }
    this.applyVolumes();
  }
  /** Master switch + sliders -> the two gain knobs. */
  applyVolumes() {
    if (!this.ctx || !this.sfxGain || !this.musicGain) return;
    const t = this.ctx.currentTime;
    this.sfxGain.gain.setTargetAtTime(this.enabled ? this.vol.sfx : 0, t, 0.05);
    this.musicGain.gain.setTargetAtTime(this.enabled ? this.vol.music * 0.55 : 0, t, 0.15);
    if (this.music) {
      if (this.enabled && this.vol.music > 0) void this.music.el.play().catch(() => {});
      else this.music.el.pause();
    }
    if (this.amb) {
      if (this.enabled && this.vol.sfx > 0) void this.amb.el.play().catch(() => {});
      else this.amb.el.pause();
    }
  }

  // ---- Files ----------------------------------------------------------------------
  private load(id: string) {
    if (!this.ctx || this.buffers.has(id) || !this.manifest[id]) return;
    this.buffers.set(id, 'loading');
    fetch(`${BASE}${id}.mp3?v=${this.manifest[id]}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.arrayBuffer();
      })
      .then((data) => this.ctx!.decodeAudioData(data))
      .then((buf) => this.buffers.set(id, buf))
      .catch(() => this.buffers.set(id, 'failed'));
  }

  /**
   * Play a generated sound; if it isn't available (not generated yet, still
   * loading, or failed), play the `fallback` beep instead.
   */
  private play(id: SoundId, fallback?: () => void, opts: { vol?: number; vary?: number } = {}) {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const buf = this.buffers.get(id);
    if (!(buf instanceof AudioBuffer)) {
      this.load(id);
      fallback?.();
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    // A little pitch variety so repeated pickups don't sound robotic
    if (opts.vary) src.playbackRate.value = 1 + (Math.random() * 2 - 1) * opts.vary;
    const g = this.ctx.createGain();
    g.gain.value = opts.vol ?? 1;
    src.connect(g).connect(this.sfxGain);
    src.start();
  }

  /** The old synth beep: one tone, `slideTo` bends the pitch. */
  private tone(freq: number, dur: number, type: OscillatorType = 'sine', vol = 0.12, slideTo?: number, delay = 0) {
    if (!this.enabled || !this.ctx || !this.sfxGain) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.sfxGain);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Returns false if this sound played less than `gapMs` ago. */
  private ready(name: string, gapMs: number) {
    const now = performance.now();
    if (now - (this.lastPlayed[name] ?? 0) < gapMs) return false;
    this.lastPlayed[name] = now;
    return true;
  }

  // ---- Music -----------------------------------------------------------------------
  /**
   * Crossfade one looping layer to `key` (a file id, '' = silence). Music plays
   * through the 🎵 knob, ambience through the 🔊 knob. Missing files = silence.
   */
  private switchLoop(cur: Loop | null, key: string, out: GainNode, audible: boolean): Loop | null {
    if (!this.ctx) return cur;
    if (cur?.key === key) return cur;
    if (cur) {
      // fade the old track out, then stop it
      cur.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
      const old = cur;
      window.setTimeout(() => {
        old.el.pause();
        old.gain.disconnect();
      }, 2000);
    }
    if (!key || !this.manifest[key]) return null;
    const el = new Audio(`${BASE}${key}.mp3?v=${this.manifest[key]}`);
    el.loop = true;
    el.setAttribute('playsinline', '');
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    try {
      this.ctx.createMediaElementSource(el).connect(gain).connect(out);
    } catch {
      return null;
    }
    gain.gain.setTargetAtTime(1, this.ctx.currentTime, 0.6); // fade in
    if (audible) void el.play().catch(() => {});
    return { key, el, gain };
  }

  /** A world's music (null = none). Called every frame; only acts when it changes. */
  setMusic(id: MusicId | null) {
    if (id === this.wantMusic) return;
    this.wantMusic = id;
    if (!this.ctx || !this.musicGain) return;
    this.music = this.switchLoop(this.music, id ? `music-${id}` : '', this.musicGain, this.enabled && this.vol.music > 0);
  }

  /** A world's background ambience (waves, a rumbling volcano...), quietly under the music. */
  setAmbience(id: AmbienceId | null) {
    if (id === this.wantAmb) return;
    this.wantAmb = id;
    if (!this.ctx || !this.sfxGain) return;
    this.amb = this.switchLoop(this.amb, id ? `amb-${id}` : '', this.sfxGain, this.enabled && this.vol.sfx > 0);
  }

  // ---- The sounds ------------------------------------------------------------------
  pickup() {
    if (this.ready('pickup', 45)) this.play('pickup', () => this.tone(520 + Math.random() * 260, 0.06, 'triangle', 0.07), { vol: 0.7, vary: 0.08 });
  }
  drop() {
    if (this.ready('drop', 45)) this.play('drop', () => this.tone(380 + Math.random() * 120, 0.06, 'triangle', 0.06), { vol: 0.7, vary: 0.08 });
  }
  cash() {
    if (this.ready('cash', 50)) this.play('cash', () => this.tone(1250 + Math.random() * 200, 0.08, 'sine', 0.06), { vol: 0.6, vary: 0.1 });
  }
  sale() {
    if (this.ready('sale', 120)) this.play('sale', () => this.tone(880, 0.1, 'square', 0.04, 1320), { vol: 0.6 });
  }
  unlockTick() {
    if (this.ready('unlockTick', 70)) this.play('unlockTick', () => this.tone(660, 0.05, 'triangle', 0.05), { vol: 0.5, vary: 0.12 });
  }
  unlocked() {
    if (this.ready('unlocked', 300)) this.play('unlocked', () => [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.1, undefined, i * 0.08)));
  }
  levelUp() {
    if (this.ready('levelUp', 500)) this.play('levelUp', () => [523, 659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.2, 'triangle', 0.1, undefined, i * 0.09)));
  }
  upgrade() {
    if (this.ready('upgrade', 250)) this.play('upgrade', () => this.tone(440, 0.25, 'triangle', 0.08, 1320));
  }
  gateGood() {
    this.play('gateGood', () => this.tone(500, 0.22, 'square', 0.06, 1100));
  }
  gateBad() {
    this.play('gateBad', () => this.tone(320, 0.3, 'sawtooth', 0.06, 110));
  }
  splash() {
    this.play('splash', () => this.tone(900, 0.2, 'sine', 0.06, 200));
  }
  risky() {
    if (this.ready('risky', 600)) this.play('risky', () => [988, 988].forEach((f, i) => this.tone(f, 0.08, 'square', 0.05, undefined, i * 0.14)), { vol: 0.8 });
  }
  contract() {
    this.play('contract', () => [659, 784, 1046, 1318].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.1, undefined, i * 0.1)));
  }
  go() {
    this.play('go', undefined, { vol: 0.8 });
  }
  trash() {
    if (this.ready('trash', 260)) this.play('trash', () => this.tone(240, 0.08, 'square', 0.04), { vol: 0.6, vary: 0.08 });
  }
  popup() {
    if (this.ready('popup', 150)) this.play('popup', undefined, { vol: 0.6 });
  }
  welcome() {
    this.play('welcome');
  }
  takeoff() {
    if (this.ready('takeoff', 3000)) this.play('takeoff', undefined, { vol: 0.55 });
  }
  heli() {
    if (this.ready('heli', 2500)) this.play('heli', undefined, { vol: 0.55 });
  }
  horn() {
    if (this.ready('horn', 2500)) this.play('horn', undefined, { vol: 0.6 });
  }
  dodo() {
    if (this.ready('dodo', 1500)) this.play('dodo', undefined, { vol: 0.6, vary: 0.1 });
  }
  dilo() {
    if (this.ready('dilo', 2000)) this.play('dilo', undefined, { vol: 0.7 });
  }
  roar() {
    if (this.ready('roar', 2000)) this.play('roar', undefined, { vol: 0.9 });
  }
  eruption() {
    this.play('eruption');
  }
  lavaBomb() {
    if (this.ready('lavaBomb', 400)) this.play('lavaBomb', undefined, { vol: 0.7, vary: 0.1 });
  }
  bell() {
    if (this.ready('bell', 400)) this.play('bell', undefined, { vol: 0.6 });
  }
  thunder() {
    if (this.ready('thunder', 3000)) this.play('thunder', undefined, { vol: 0.8 });
  }
  /** A pterosaur crying far off over Dino Island (now and then). */
  ptero() {
    this.play('ptero', undefined, { vol: 0.45, vary: 0.1 });
  }
  spider() {
    if (this.ready('spider', 1500)) this.play('spider', undefined, { vol: 0.8 });
  }
}

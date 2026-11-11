// ============================================================================
// weather.ts — tropical storms for the human-scale worlds (airport + island).
//
//   clear   -> most of the time
//   warning -> "⛈️ Storm in 15 s!": a heads-up to stock up / launch now
//   storm   -> ~45 s of rain: flights and safaris are grounded, the island's
//              supply drops and fruit trees slow down
//
// One shared weather for both worlds (they're close enough to share the sky).
// The ant colony is unaffected: it's cozy underground.
// ============================================================================
export type Sky = 'clear' | 'warning' | 'storm';

export const STORM = {
  every: [300, 480] as [number, number], // seconds of clear weather between storms
  warning: 15,                           // seconds of warning before it hits
  length: 45,                            // seconds the storm lasts
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Weather {
  sky: Sky = 'clear';
  /** Seconds left in the current phase. */
  left = rand(STORM.every[0], STORM.every[1]);
  /** Called when the sky changes (main.ts shows banners + the rain overlay). */
  onChange: (sky: Sky) => void = () => {};

  get storm() {
    return this.sky === 'storm';
  }

  update(dt: number) {
    this.left -= dt;
    if (this.left > 0) return;
    if (this.sky === 'clear') this.set('warning', STORM.warning);
    else if (this.sky === 'warning') this.set('storm', STORM.length);
    else this.set('clear', rand(STORM.every[0], STORM.every[1]));
  }

  private set(sky: Sky, secs: number) {
    this.sky = sky;
    this.left = secs;
    this.onChange(sky);
  }
}

/** The one sky everyone shares. */
export const weather = new Weather();

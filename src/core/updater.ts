// ============================================================================
// updater.ts — notices when a newer version of the game is live and switches
// to it automatically.
//
// How it works:
//   • Every build bakes its BUILD ID into the code AND writes version.json.
//   • We fetch version.json (never cached) on launch, every 2 minutes, and
//     whenever the app comes back to the foreground.
//   • If its build id differs from ours: a popup says a new version is ready
//     and counts down 10 s. "Update now" (or the countdown) saves the game,
//     tells the service worker to fetch the new files and reloads.
//     "Later" waits: no more popups until the next launch, unless you tap
//     "Check for updates" in Settings.
//   • `canReload()` lets the game say "not right now" (e.g. mid gate run).
// ============================================================================
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
declare const __BUILD_TIME__: string;

export const VERSION = __APP_VERSION__;
export const BUILD_ID = __BUILD_ID__;
export const BUILD_TIME = __BUILD_TIME__;

/** e.g. "v0.7.0 · build 25669b3 · Nov 11, 2026" */
export function versionLabel() {
  const date = new Date(BUILD_TIME).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `v${VERSION} · build ${BUILD_ID} · ${date}`;
}

interface UpdaterOpts {
  canReload: () => boolean;      // false while it would be rude to reload (gate run)
  beforeReload: () => void;      // save the game
  onStatus?: (text: string) => void;
  /** Show the "new version" popup. Resolves true = update now, false = later. */
  confirm: (version: string) => Promise<boolean>;
}

export class Updater {
  private pending: string | null = null; // newer build id we've seen
  private pendingVersion = '';
  private checking = false;
  /** Tapped "Later": no more popups this session (Settings can still update). */
  private snoozed = false;

  constructor(private opts: UpdaterOpts) {
    window.setTimeout(() => this.check(), 4000);
    window.setInterval(() => this.check(), 2 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.check();
    });
    // Try again every few seconds if an update is waiting for a good moment.
    window.setInterval(() => this.pending && this.apply(), 3000);
  }

  /** Ask the server which build is live. Returns true if an update was found. */
  async check(manual = false): Promise<boolean> {
    if (this.checking) return false;
    this.checking = true;
    try {
      if (manual) this.opts.onStatus?.('Checking…');
      const res = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const live = (await res.json()) as { version: string; build: string };
      if (live.build && live.build !== BUILD_ID) {
        this.pending = live.build;
        this.pendingVersion = live.version;
        if (manual) this.snoozed = false; // asked for it: show the popup again
        this.opts.onStatus?.(`New version v${live.version} is ready`);
        this.apply();
        return true;
      }
      if (manual) this.opts.onStatus?.("You're up to date ✅");
      return false;
    } catch {
      if (manual) this.opts.onStatus?.('Offline: can’t check right now');
      return false;
    } finally {
      this.checking = false;
    }
  }

  private applying = false;

  /** Ask first (the popup), then download the new build and reload. */
  private async apply() {
    if (this.applying || this.snoozed || !this.opts.canReload()) return;
    this.applying = true;
    const go = await this.opts.confirm(this.pendingVersion);
    if (!go) {
      // "Later": the new files still install in the background, so the next
      // time the game opens it starts on the new version.
      this.snoozed = true;
      this.applying = false;
      this.opts.onStatus?.(`v${this.pendingVersion} will load next time you open the game`);
      return;
    }
    this.opts.onStatus?.(`Updating to v${this.pendingVersion}…`);
    this.opts.beforeReload();
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        // The new service worker installs (downloads the new files), takes
        // over (autoUpdate = skipWaiting + clientsClaim) and we reload.
        const reloaded = new Promise<void>((resolve) => {
          navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
          window.setTimeout(resolve, 8000); // don't wait forever
        });
        await reg.update();
        await reloaded;
      }
    } catch {
      /* fall through to a plain reload */
    }
    window.location.reload();
  }
}

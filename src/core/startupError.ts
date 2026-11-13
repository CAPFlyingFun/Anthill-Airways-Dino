// ============================================================================
// startupError.ts — a friendly card instead of a frozen loading screen.
//
// If the game can't start (the browser can't make a 3D view, or something
// crashes while loading), the "Waking up the colony…" card turns into an
// explanation with a 🔄 Retry button. It uses plain HTML (no HUD needed),
// so it works even when the failure happens on the game's very first line.
// Also: a watchdog offers Retry if loading takes unusually long.
// ============================================================================
let shown = false;

/** Is the loading card still up (= the game hasn't finished starting)? */
function stillLoading() {
  const el = document.getElementById('loading');
  return !!el && !el.classList.contains('hidden');
}

/** Turn the loading card into an error card. */
export function showStartupError(kind: 'webgl' | 'crash' | 'lost', detail?: unknown) {
  if (shown) return;
  shown = true;
  const card = document.querySelector('#loading .card');
  const overlay = document.getElementById('loading');
  if (!card || !overlay) return;
  overlay.classList.remove('hidden');
  const msg = detail instanceof Error ? detail.message : detail ? String(detail) : '';
  const text = {
    webgl: {
      title: '😵 The 3D view couldn\'t start',
      body: 'Your browser said no to 3D graphics (WebGL) this time. This usually fixes it:',
      tips: ['Tap 🔄 Retry', 'Close other tabs or apps (the phone may be low on memory)', 'Open the game in Safari or Chrome, not inside another app'],
    },
    crash: {
      title: '🐜 Oops, the colony tripped',
      body: 'Something went wrong while loading. Your save is safe.',
      tips: ['Tap 🔄 Retry', 'If it keeps happening, tap "Copy details" and send them to the developer'],
    },
    lost: {
      title: '💤 The 3D view went to sleep',
      body: 'The phone paused the graphics (often after switching apps). Your progress is saved.',
      tips: ['Tap 🔄 Retry to wake it back up'],
    },
  }[kind];
  card.innerHTML = `
    <h2>${text.title}</h2>
    <p>${text.body}</p>
    <ul class="err-tips">${text.tips.map((t) => `<li>${t}</li>`).join('')}</ul>
    <button id="errRetry" class="big-btn err-btn">🔄 Retry</button>
    ${msg ? '<button id="errCopy" class="menu-btn">📋 Copy details</button>' : ''}`;
  document.getElementById('errRetry')!.onclick = () => location.reload();
  const copy = document.getElementById('errCopy');
  if (copy) {
    copy.onclick = () => {
      const info = `Anthill Airways startup error (${kind}): ${msg}\n${navigator.userAgent}`;
      navigator.clipboard?.writeText(info).then(
        () => (copy.textContent = '✅ Copied!'),
        () => (copy.textContent = msg.slice(0, 80)),
      );
    };
  }
}

/** Did this error come from the game's own files (same website)? */
function ours(e: ErrorEvent) {
  if (!e.filename) return e.message !== 'Script error.' && !!e.error; // cross-origin errors arrive blank
  try {
    return new URL(e.filename, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/**
 * Call once, first thing: catches crashes while loading, a lost 3D view, and
 * loading that takes far too long.
 */
export function watchStartup() {
  window.addEventListener('error', (e) => {
    if (!stillLoading()) return;
    // Only OUR crashes count. Some browsers (e.g. Phoenix, in-app browsers, ad
    // blockers, translators) inject their own scripts into every page; when one
    // of those fails, the browser reports a detail-less "Script error." from
    // another origin. That's not the game's problem: keep loading.
    if (!ours(e)) {
      console.warn('Ignored an error from a script that is not the game:', e.message, e.filename);
      return;
    }
    const where = e.filename ? ` (${e.filename.split('/').pop()}:${e.lineno}:${e.colno})` : '';
    showStartupError('crash', `${e.error instanceof Error ? e.error.message : e.message}${where}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (stillLoading()) showStartupError('crash', e.reason);
  });
  // Watchdog: after 60 s still loading -> offer Retry (keeps loading meanwhile)
  window.setTimeout(() => {
    if (!stillLoading() || shown) return;
    const card = document.querySelector('#loading .card');
    if (!card || card.querySelector('#errRetry')) return;
    const p = document.createElement('p');
    p.className = 'err-slow';
    p.innerHTML = 'Taking longer than usual… <button id="errRetry" class="menu-btn">🔄 Retry</button>';
    card.appendChild(p);
    document.getElementById('errRetry')!.onclick = () => location.reload();
  }, 60_000);
}

// The page's first seconds, as a pure rule (no three.js, no real DOM). index.html carries an inline #boot-overlay
// ("Archwright", a CSS bar, "Loading…") that shows while the main module downloads and parses. watchBoot takes it
// away once, the first frame the hook leaves 'loading', and never brings it back (a later level load goes through
// 'loading' too). An uncaught error before then stops the bar and leaves one line in place of "Loading…".
import type { HookState } from './runtime.js';

export const BOOT_FAILED = 'Archwright could not start in this browser.';

/** The overlay as watchBoot touches it: a real HTMLElement in the page, a stub in the tests. */
export interface BootElement {
  remove(): void;
  setAttribute?(name: string, value: string): void;
  textContent?: string | null;
}

export interface BootDoc { getElementById(id: string): BootElement | null }

/** Where uncaught errors arrive ('error', 'unhandledrejection'); window in the page. */
export interface BootErrors {
  addEventListener(type: 'error' | 'unhandledrejection', f: () => void): void;
  removeEventListener(type: 'error' | 'unhandledrejection', f: () => void): void;
}

/** The game has a level on screen: any state but 'loading' (undefined: the hook is not there yet). */
export function bootDone(state: HookState | undefined): boolean {
  return state !== undefined && state !== 'loading';
}

/**
 * Look at `hook.state` every frame (`raf`) until it is done, then remove #boot-overlay once and stop asking for
 * frames. With `errors`, an uncaught error before that marks the overlay failed (data-failed stops the bar) and puts
 * BOOT_FAILED in #boot-text; the watch goes on, so a page that comes up after all still loses the overlay.
 */
export function watchBoot(
  hook: { readonly state?: HookState },
  doc: BootDoc,
  raf: (f: () => void) => unknown,
  errors?: BootErrors,
): void {
  const fail = () => {
    const el = doc.getElementById('boot-overlay');
    if (!el) return;
    el.setAttribute?.('data-failed', '');
    const text = doc.getElementById('boot-text');
    if (text) text.textContent = BOOT_FAILED;
  };
  errors?.addEventListener('error', fail);
  errors?.addEventListener('unhandledrejection', fail);
  const stop = () => {
    errors?.removeEventListener('error', fail);
    errors?.removeEventListener('unhandledrejection', fail);
  };
  const frame = () => {
    const el = doc.getElementById('boot-overlay');
    if (!el) return stop();
    if (bootDone(hook.state)) {
      el.remove();
      return stop();
    }
    raf(frame);
  };
  raf(frame);
}

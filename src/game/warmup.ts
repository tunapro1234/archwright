// Havok warm-up: the physics WASM is fetched once the board has first been shown, when the page is idle, so the
// first stone does not wait for it (and the first load still does not carry it). No idle callbacks (Safari): a
// plain timeout. Either way CollapseSystem still registers physics at the first stone if it has not come by then.

/** Without requestIdleCallback, run this many ms later; with it, at the latest this many ms later. */
export const IDLE_BY_MS = 1500;

export interface IdleHost {
  requestIdleCallback?: (run: () => void, opts?: { timeout: number }) => unknown;
  setTimeout: (run: () => void, ms: number) => unknown;
}

/** Run `run` once when `host` is idle (or IDLE_BY_MS later without idle callbacks). */
export function whenIdle(run: () => void, host: IdleHost = globalThis as unknown as IdleHost): void {
  if (typeof host.requestIdleCallback === 'function') host.requestIdleCallback(() => run(), { timeout: IDLE_BY_MS });
  else host.setTimeout(run, IDLE_BY_MS);
}

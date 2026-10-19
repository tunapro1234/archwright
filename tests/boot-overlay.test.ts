// The boot overlay (src/game/boot-overlay.ts) with a stub document, frame queue and error target: it stays while the
// hook is loading, goes once the hook is ready, never comes back, and shows one line on an uncaught error.
import { describe, expect, it } from 'vitest';
import { BOOT_FAILED, bootDone, watchBoot, type BootErrors } from '../src/game/boot-overlay.js';
import type { HookState } from '../src/game/runtime.js';

function page() {
  const attrs: Record<string, string> = {};
  let removed = 0;
  const text = { remove() {}, textContent: 'Loading…' as string | null };
  let overlay: { remove(): void; setAttribute(k: string, v: string): void } | null = {
    remove() { removed++; overlay = null; },
    setAttribute(k, v) { attrs[k] = v; },
  };
  const doc = { getElementById: (id: string) => (id === 'boot-overlay' ? overlay : id === 'boot-text' && overlay ? text : null) };
  const frames: (() => void)[] = [];
  const raf = (f: () => void) => frames.push(f);
  const run = (n: number) => { for (let i = 0; i < n; i++) frames.shift()?.(); };
  const listeners = new Map<string, Set<() => void>>();
  const errors: BootErrors = {
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
    removeEventListener: (t, f) => { listeners.get(t)?.delete(f); },
  };
  const fire = (t: string) => { for (const f of [...(listeners.get(t) ?? [])]) f(); };
  return { doc, raf, run, frames, errors, fire, attrs, text, removed: () => removed, listening: () => [...listeners.values()].reduce((n, s) => n + s.size, 0) };
}

describe('bootDone', () => {
  it('undefined and loading are not done; every other state is', () => {
    expect(bootDone(undefined)).toBe(false);
    expect(bootDone('loading')).toBe(false);
    for (const s of ['ready', 'building', 'held', 'collapsed'] as HookState[]) expect(bootDone(s)).toBe(true);
  });
});

describe('watchBoot', () => {
  it('stays while loading, goes on ready, and does not come back on a later loading', () => {
    const p = page();
    const hook: { state?: HookState } = {};
    watchBoot(hook, p.doc, p.raf, p.errors);
    p.run(3);
    hook.state = 'loading';
    p.run(5);
    expect(p.removed()).toBe(0);
    hook.state = 'ready';
    p.run(2);
    expect(p.removed()).toBe(1);
    expect(p.frames.length).toBe(0);
    expect(p.listening()).toBe(0);
    hook.state = 'loading';
    p.run(5);
    expect(p.removed()).toBe(1);
  });

  it('an uncaught error before ready stops the bar and shows one line', () => {
    const p = page();
    const hook: { state?: HookState } = { state: 'loading' };
    watchBoot(hook, p.doc, p.raf, p.errors);
    p.run(2);
    p.fire('unhandledrejection');
    expect('data-failed' in p.attrs).toBe(true);
    expect(p.text.textContent).toBe(BOOT_FAILED);
    expect(BOOT_FAILED).not.toMatch(/\n/);
    expect(p.removed()).toBe(0);
  });

  it('an error after the overlay is gone changes nothing', () => {
    const p = page();
    watchBoot({ state: 'ready' }, p.doc, p.raf, p.errors);
    p.run(1);
    p.fire('error');
    expect(p.text.textContent).toBe('Loading…');
  });

  it('with no overlay in the page it stops without throwing', () => {
    const frames: (() => void)[] = [];
    expect(() => {
      watchBoot({ state: 'loading' }, { getElementById: () => null }, f => frames.push(f));
      for (let i = 0; i < 3 && frames.length; i++) frames.shift()!();
    }).not.toThrow();
    expect(frames.length).toBe(0);
  });
});

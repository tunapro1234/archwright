// Which levels the player has solved, and where to pick up. Pure functions over plain data; the
// storage (localStorage in the browser) is passed in, and nothing here ever throws: a missing,
// blocked or corrupt save simply reads as a fresh start, and a failed write returns false.
import { LEVELS } from '../levels/index.js';
import type { Step } from './arch-state.js';

export const STORAGE_KEY = 'archwright.progress.v1';

export interface Progress {
  /**
   * Best result per solved level: fewest stones, when that was first reached (ISO date), and the
   * arrangement that did it (encodeArch; absent in saves from before it was kept).
   */
  solved: Record<string, { stones: number; at: string; arch?: string }>;
  /** The level to open next time. */
  current: string;
}

/** The two calls of the Web Storage API this needs. */
export interface ProgressStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const ids = (): string[] => LEVELS.map(l => l.id);

export function emptyProgress(): Progress {
  return { solved: {}, current: LEVELS[0].id };
}

/** The level after `id` in LEVELS order; null after the last one or for an unknown id. */
export function nextLevel(id: string): string | null {
  const all = ids();
  const i = all.indexOf(id);
  return i >= 0 && i + 1 < all.length ? all[i + 1] : null;
}

/**
 * A win on `level` with `stones` stones: keeps the best (fewest stones) and moves on to the next
 * level. `steps`, the arrangement played, is kept with the best; a tie only fills in a missing one.
 */
export function recordWin(p: Progress, level: string, stones: number, dateISO: string, steps?: Step[]): Progress {
  if (!ids().includes(level)) return { solved: { ...p.solved }, current: p.current };
  const old = p.solved[level];
  const solved = { ...p.solved };
  const arch = steps ? encodeArch(level, steps) : undefined;
  if (!old || stones < old.stones) solved[level] = { stones, at: dateISO, ...(arch ? { arch } : {}) };
  else if (stones === old.stones && arch && !old.arch) solved[level] = { ...old, arch };
  return { solved, current: nextLevel(level) ?? level };
}

/**
 * An arrangement in a few bytes: each step as the stone's index in the level's tray and its side,
 * in placement order, e.g. "0l,4r,1l,3r,2l". Undefined if a stone is not in that level's tray.
 */
export function encodeArch(level: string, steps: Step[]): string | undefined {
  const tray = LEVELS.find(l => l.id === level)?.tray;
  if (!tray || steps.length === 0) return undefined;
  const out: string[] = [];
  for (const s of steps) {
    const i = tray.findIndex(t => t.id === s.stone);
    if (i < 0 || (s.side !== 'left' && s.side !== 'right')) return undefined;
    out.push(`${i}${s.side[0]}`);
  }
  return out.join(',');
}

/** The steps back from encodeArch; null for anything that does not fit the level's tray. */
export function decodeArch(level: string, code: unknown): Step[] | null {
  const tray = LEVELS.find(l => l.id === level)?.tray;
  if (!tray || typeof code !== 'string' || code.length > 400 || !/^\d{1,3}[lr](,\d{1,3}[lr])*$/.test(code)) return null;
  const seen = new Set<number>();
  const steps: Step[] = [];
  for (const part of code.split(',')) {
    const i = Number(part.slice(0, -1));
    if (i >= tray.length || seen.has(i)) return null;
    seen.add(i);
    steps.push({ stone: tray[i].id, side: part.endsWith('l') ? 'left' : 'right' });
  }
  return steps;
}

/** Levels the player may open: every solved one, plus the first one not solved yet. */
export function unlocked(p: Progress): string[] {
  const all = ids();
  const first = all.find(id => !p.solved[id]);
  return all.filter(id => p.solved[id] || id === first);
}

/** The saved progress, cleaned of anything that does not fit the levels this build has. */
export function loadProgress(storage: ProgressStorage | null): Progress {
  let raw: unknown;
  try {
    const text = storage?.getItem(STORAGE_KEY);
    if (!text) return emptyProgress();
    raw = JSON.parse(text);
  } catch {
    return emptyProgress();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyProgress();
  const r = raw as { solved?: unknown; current?: unknown };
  const all = ids();
  const solved: Progress['solved'] = {};
  if (r.solved && typeof r.solved === 'object' && !Array.isArray(r.solved)) {
    for (const [id, v] of Object.entries(r.solved as Record<string, unknown>)) {
      const e = v as { stones?: unknown; at?: unknown } | null;
      if (!all.includes(id) || !e || typeof e !== 'object') continue;
      if (typeof e.stones !== 'number' || !Number.isInteger(e.stones) || e.stones <= 0 || typeof e.at !== 'string') continue;
      const arch = (e as { arch?: unknown }).arch;
      solved[id] = { stones: e.stones, at: e.at, ...(decodeArch(id, arch) ? { arch: arch as string } : {}) };
    }
  }
  const open = unlocked({ solved, current: all[0] });
  const current = typeof r.current === 'string' && open.includes(r.current) ? r.current : open[open.length - 1];
  return { solved, current };
}

export function saveProgress(storage: ProgressStorage | null, p: Progress): boolean {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({ solved: p.solved, current: p.current }));
    return true;
  } catch {
    return false;
  }
}

/** The page's localStorage, or null where it is missing or blocked (reading it can throw). */
export function browserStorage(): ProgressStorage | null {
  try {
    return (globalThis as { localStorage?: ProgressStorage }).localStorage ?? null;
  } catch {
    return null;
  }
}

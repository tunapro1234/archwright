// Which levels the player has solved, and where to pick up. Pure functions over plain data; the
// storage (localStorage in the browser) is passed in, and nothing here ever throws: a missing,
// blocked or corrupt save simply reads as a fresh start, and a failed write returns false.
import { LEVELS } from '../levels/index.js';

export const STORAGE_KEY = 'archwright.progress.v1';

export interface Progress {
  /** Best result per solved level: fewest stones, and when that was first reached (ISO date). */
  solved: Record<string, { stones: number; at: string }>;
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

/** A win on `level` with `stones` stones: keeps the best (fewest stones) and moves on to the next level. */
export function recordWin(p: Progress, level: string, stones: number, dateISO: string): Progress {
  if (!ids().includes(level)) return { solved: { ...p.solved }, current: p.current };
  const old = p.solved[level];
  const solved = { ...p.solved };
  if (!old || stones < old.stones) solved[level] = { stones, at: dateISO };
  return { solved, current: nextLevel(level) ?? level };
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
      solved[id] = { stones: e.stones, at: e.at };
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

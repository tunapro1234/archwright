// Today's Span: one level a day, the same for everyone, and a short card to share how it went.
// Pure functions; the date is the only seed (no Math.random, no clock). The levels come from a pool
// made once by scripts/daily-pool.ts, where each was generated from a fixed seed and checked by the
// solver; day N of the calendar takes pool entry (N - 1) mod pool size. The pool deals semicircle,
// pointed and loaded levels in turn, and any run of days up to the pool's length has no repeat.
// Daily results stay out of the progress save (progress.solved): they live under DAILY_KEY.
import { ringOrder, type GameState, type LevelDef, type Material } from './arch-state.js';
import type { ProgressStorage } from './progress.js';
import { level, LEVELS } from '../levels/index.js';
import { DAILY_POOL } from '../levels/daily-pool.js';

export const DAILY_EPOCH = '2026-10-01';
export const DAILY_KEY = 'archwright.daily.v1';
const DAILY_ID = /^daily-(\d{4}-\d{2}-\d{2})$/;
const DAY_MS = 86400000;

const utcDay = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
};

/** Day number of `dateISO` (YYYY-MM-DD): DAILY_EPOCH is #1. */
export function dailyNumber(dateISO: string): number {
  return utcDay(dateISO) - utcDay(DAILY_EPOCH) + 1;
}

/** The level of the day `dateISO` (YYYY-MM-DD), id `daily-YYYY-MM-DD`. */
export function dailyLevel(dateISO: string): LevelDef {
  const n = DAILY_POOL.length;
  const i = (((dailyNumber(dateISO) - 1) % n) + n) % n;
  return level({ ...DAILY_POOL[i], id: `daily-${dateISO}` });
}

/** The date of a daily level id, or null for any other level. */
export function dailyDate(levelId: string): string | null {
  return DAILY_ID.exec(levelId)?.[1] ?? null;
}

/** Today's date (YYYY-MM-DD) in the player's own time zone. */
export function localDateISO(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const SQUARE: Record<Material, string> = { sandstone: '🟧', tuff: '⬜', basalt: '⬛' };

/**
 * The share card of a struck (or still open) arch: the day's number, one square per stone from the
 * left springing to the right one, the stones used against par, and whether it held. Three lines, no link.
 */
export function shareCard(state: GameState): string {
  const date = dailyDate(state.level);
  const def = date ? dailyLevel(date) : LEVELS.find(l => l.id === state.level);
  const title = date ? `Archwright · Today's Span #${dailyNumber(date)}` : `Archwright · ${state.level}`;
  const squares = ringOrder(state).map(p => SQUARE[p.stone.material]).join('');
  const verdict = state.phase === 'held' ? 'it held' : state.phase === 'collapsed' ? 'it fell' : 'not struck yet';
  const par = def ? ` · par ${def.par}` : '';
  return `${title}\n${squares}\n${state.placed.length} stones${par} · ${verdict}`;
}

/** Whether the day's level has been held on this device (any number of stones). */
export function dailyHeld(storage: ProgressStorage | null, dateISO: string): boolean {
  if (!storage) return false;
  try {
    const raw = JSON.parse(storage.getItem(DAILY_KEY) ?? 'null') as { date?: unknown } | null;
    return !!raw && typeof raw === 'object' && raw.date === dateISO;
  } catch {
    return false;
  }
}

/** Remembers that the day's level held; only the latest day is kept. Never throws. */
export function saveDailyHeld(storage: ProgressStorage | null, dateISO: string, stones: number): boolean {
  if (!storage) return false;
  try {
    storage.setItem(DAILY_KEY, JSON.stringify({ date: dateISO, stones }));
    return true;
  } catch {
    return false;
  }
}

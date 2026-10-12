import { describe, expect, it } from 'vitest';
import {
  chooseSurface, isDesk, LAP_BELOW_EYES, PICK_UNTIL, ROOM_WAIT, type SurfaceCandidate, type SurfaceInput,
} from '../src/scene/surface-chain.js';

const head = { x: 0.3, y: 1.15, z: 0.2 };
const top = (o: Partial<SurfaceCandidate> = {}): SurfaceCandidate =>
  ({ x: 0.3, y: 0.72, z: -0.25, width: 1.0, depth: 0.6, horizontal: true, source: 'plane', ...o });
const input = (o: Partial<SurfaceInput> = {}): SurfaceInput =>
  ({ inXR: true, passthrough: true, head, fwd: { x: 0, z: -1 }, candidates: [], hitTest: true, elapsed: 4, ...o });

describe('chooseSurface', () => {
  it('takes a narrow but long top either way round', () => {
    expect(isDesk(head, top({ width: 0.22, depth: 0.5 }))).toBe(true);
    expect(isDesk(head, top({ width: 0.5, depth: 0.18 }))).toBe(false);
  });

  it('measures the desk band from the eyes, not from the floor (local reference space)', () => {
    const low = { x: 0, y: 0.0, z: 0 };
    expect(chooseSurface(input({ head: low, candidates: [top({ x: 0, z: -0.4, y: -0.45 })] })).kind).toBe('plane');
    expect(chooseSurface(input({ head: low, candidates: [top({ x: 0, z: -0.4, y: 0.72 })], hitTest: false })).kind).toBe('lap');
  });

  it('a mesh desk out of reach does not beat a plane desk in reach', () => {
    const c = chooseSurface(input({ candidates: [top(), top({ source: 'mesh', z: -1.2 })] }));
    expect(c.kind).toBe('plane');
  });

  it('forced mesh or plane waits until such a desk shows up, never falls back', () => {
    expect(chooseSurface(input({ force: 'mesh', candidates: [top()], elapsed: 30 }))).toEqual({ kind: 'mesh', position: null, waiting: true });
    expect(chooseSurface(input({ force: 'plane', candidates: [top()] })).kind).toBe('plane');
  });

  it('forced lap and pick still need XR: outside it the page desk wins', () => {
    expect(chooseSurface(input({ inXR: false, force: 'lap' })).kind).toBe('desk');
  });

  it('the pick window closes at PICK_UNTIL, and the room wait at ROOM_WAIT', () => {
    expect(chooseSurface(input({ elapsed: ROOM_WAIT - 0.01 })).waiting).toBe(true);
    expect(chooseSurface(input({ elapsed: PICK_UNTIL - 0.01 })).kind).toBe('pick');
    const lap = chooseSurface(input({ elapsed: PICK_UNTIL }));
    expect(lap.kind).toBe('lap');
    expect(lap.position!.y).toBeCloseTo(head.y - LAP_BELOW_EYES);
  });

  it('a pick that came in late still counts while the window is open', () => {
    const c = chooseSurface(input({ elapsed: 9, picked: { x: 0.2, y: 0.75, z: -0.3 } }));
    expect(c).toEqual({ kind: 'pick', position: { x: 0.2, y: 0.75, z: -0.3 }, waiting: false });
  });

  it('returns fresh position objects (callers may keep them)', () => {
    const picked = { x: 0.2, y: 0.75, z: -0.3 };
    const c = chooseSurface(input({ picked }));
    expect(c.position).not.toBe(picked);
  });
});

// The device report's frame rates are the session's own (src/systems/xr-entry.ts DeviceReportSystem, startSession,
// endSession): its XR frames' times, the first one's (the way in) left out, none of the page's 2D frames before it and
// none of the last session's; __archwright.xr.frames counts the session's XR frames. DeviceReportSystem runs on a
// stand-in for the world and the renderer.
import { describe, expect, it } from 'vitest';
import { DeviceReportSystem, endSession, startSession } from '../src/systems/xr-entry';

function world(frameStats: unknown = { n: 600, p50: 30, p5: 20 }) {
  const hook = {
    perf: { fps: 72, frameMs: 1, drawCalls: 20, triangles: 5000, bodies: 0 }, level: 'w1-1', state: 'ready', build: 'abc1234',
    xr: { mode: 'immersive-vr', features: ['local-floor'], inputs: ['generic-hand'], room: null, head: null, frames: 0 },
    surface: 'atelier', detected: { planes: [], meshes: [] },
  };
  const xr = { isPresenting: true, getSession: () => ({ environmentBlendMode: 'opaque', visibilityState: 'visible' }) };
  const sys = Object.create(DeviceReportSystem.prototype) as DeviceReportSystem;
  // globals.frameStats holds the page's own 2D frames: the report must not take them.
  Object.assign(sys, { world: { globals: { arch: { hook }, frameStats } }, renderer: { xr } });
  return { hook, xr, frame: (dt: number) => sys.update(dt, 0) };
}

const line = (body: string, key: string) => (body.match(new RegExp(`^${key}: (.*)$`, 'm')) ?? [])[1];

describe('the device report counts the session\'s own frames', () => {
  it('72 Hz in the session: p50 = p5 = 72, frames n = the frames after the first; xr.frames counts them all', () => {
    const { hook, frame } = world();
    startSession();
    frame(2.5); // the first XR frame: its time spans the way into the session
    for (let i = 0; i < 99; i++) frame(1 / 72);
    expect(hook.xr.frames).toBe(100);
    const body = endSession()!;
    expect(line(body, 'frames n')).toBe('99');
    expect(line(body, 'fps p50')).toBe('72.0');
    expect(line(body, 'fps p5')).toBe('72.0');
    expect(Number(line(body, 'frames n'))).toBeLessThanOrEqual(hook.xr.frames);
  });

  it('a new session forgets the last one\'s frames', () => {
    const { hook, frame } = world();
    startSession();
    for (let i = 0; i < 300; i++) frame(1 / 30);
    endSession();
    startSession();
    for (let i = 0; i < 11; i++) frame(1 / 90);
    expect(hook.xr.frames).toBe(11);
    const body = endSession()!;
    expect(line(body, 'frames n')).toBe('10');
    expect(line(body, 'fps p50')).toBe('90.0');
  });

  it('a session with one XR frame reports frames n 0; one with none has no report', () => {
    const { frame } = world();
    startSession();
    frame(1 / 72);
    expect(line(endSession()!, 'frames n')).toBe('0');
    startSession();
    expect(endSession()).toBeNull();
  });

  it('frames outside a session are not counted', () => {
    const { hook, xr, frame } = world();
    startSession();
    xr.isPresenting = false;
    for (let i = 0; i < 5; i++) frame(1 / 60);
    expect(hook.xr.frames).toBe(0);
    expect(endSession()).toBeNull();
  });
});

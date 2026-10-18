// ?emulator=1&room=<room>&seat=table (src/emulator/head.ts): the room file's tables in the world frame, and a seat at the
// nearest one, SEAT_BACK out from the middle of its long edge on the near side, facing its centre.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEAD_Z, roomTables, SEAT_BACK, seatAtTable, type Table } from '../src/emulator/head.js';

const ROOMS = ['office_small', 'office_large', 'living_room', 'meeting_room', 'music_room'];
const room = (name: string) => JSON.parse(readFileSync(new URL(`../public/emulator/rooms/${name}.json`, import.meta.url), 'utf8'));

/** Where the seat is in the table's own frame (u along width, v along depth), and how far its view is off the centre (deg). */
function seen(t: Table, s: { x: number; z: number; yaw: number }) {
  const c = Math.cos(t.yaw), sn = Math.sin(t.yaw), dx = s.x - t.cx, dz = s.z - t.cz;
  const fwd = { x: -Math.sin((s.yaw * Math.PI) / 180), z: -Math.cos((s.yaw * Math.PI) / 180) };
  const off = Math.acos(Math.min(1, (fwd.x * -dx + fwd.z * -dz) / Math.hypot(dx, dz))) * 180 / Math.PI;
  return { u: c * dx - sn * dz, v: sn * dx + c * dz, off };
}

describe('seatAtTable', () => {
  it('no table: null', () => expect(seatAtTable([], { x: 0, z: 0 })).toBeNull());

  for (const deg of [0, 30, -45, 90]) {
    it(`a 1.2 × 0.6 m table turned ${deg}°: out from the long edge on the near side, facing the centre`, () => {
      const t: Table = { cx: 0.4, cz: -1.2, y: 0.75, width: 1.2, depth: 0.6, yaw: (deg * Math.PI) / 180 };
      const s = seatAtTable([t], { x: 0, z: 0 })!;
      const r = seen(t, s);
      expect(Math.abs(r.u)).toBeLessThan(1e-9);
      expect(Math.abs(r.v)).toBeCloseTo(0.3 + SEAT_BACK, 9);
      expect(r.off).toBeLessThan(1e-6);
      // The near side: closer to `from` than the far edge's seat would be.
      const far = { x: 2 * t.cx - s.x, z: 2 * t.cz - s.z };
      expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(Math.hypot(far.x, far.z) + 1e-9);
    });
  }

  it('a table deeper than wide: the long edges run along its depth', () => {
    const t: Table = { cx: 0, cz: -1, y: 0.75, width: 0.6, depth: 1.4, yaw: 0 };
    const s = seatAtTable([t], { x: -2, z: -1 })!;
    expect(s.x).toBeCloseTo(-0.3 - SEAT_BACK, 9);
    expect(s.z).toBeCloseTo(-1, 9);
    expect(s.yaw).toBeCloseTo(-90, 9); // facing +x: turned right
  });

  it('the nearest table to `from` wins', () => {
    const a: Table = { cx: 0, cz: -2, y: 0.75, width: 1, depth: 0.5, yaw: 0 };
    const b: Table = { cx: 1, cz: 0.5, y: 0.75, width: 1, depth: 0.5, yaw: 0 };
    expect(seatAtTable([a, b], { x: 0.8, z: 0 })!.x).toBeCloseTo(1, 9);
    expect(seatAtTable([a, b], { x: 0, z: -1.5 })!.x).toBeCloseTo(0, 9);
  });
});

describe('roomTables', () => {
  it('nothing usable: no tables', () => {
    expect(roomTables(null)).toEqual([]);
    expect(roomTables({ spatialEntities: [{ semanticLabel_META: 'TABLE' }, { semanticLabel_META: 'FLOOR' }] })).toEqual([]);
  });

  for (const name of ROOMS) {
    it(`${name}: each table, as a plane and as a box, comes out the same rectangle, level with its top`, () => {
      const json = room(name);
      const labelled = json.spatialEntities.filter((e: { semanticLabel_META?: string }) => e.semanticLabel_META === 'TABLE').length;
      const tables = roomTables(json);
      expect(tables.length).toBe(labelled);
      expect(tables.length).toBeGreaterThan(0);
      for (const t of tables) {
        expect(t.width).toBeGreaterThanOrEqual(t.depth);
        const twin = tables.filter(o => o !== t && Math.hypot(o.cx - t.cx, o.cz - t.cz) < 0.01);
        expect(twin.length).toBe(1); // the other description of the same table
        expect(twin[0].width).toBeCloseTo(t.width, 2);
        expect(twin[0].depth).toBeCloseTo(t.depth, 2);
        expect(Math.abs(twin[0].y - t.y)).toBeLessThan(0.02);
      }
      // A seat exists, at the table nearest where the headset would start.
      expect(seatAtTable(tables, { x: 0, z: HEAD_Z })).not.toBeNull();
    });
  }

  it('office_small: its desk is 1.60 × 0.75 m, its top 0.75 m up, square to the room within 1°', () => {
    const [t] = roomTables(room('office_small'));
    expect(t.width).toBeCloseTo(1.6, 2);
    expect(t.depth).toBeCloseTo(0.75, 2);
    expect(t.y).toBeCloseTo(0.75, 2);
    const yaw = ((t.yaw * 180) / Math.PI + 360) % 180;
    expect(Math.min(yaw, 180 - yaw)).toBeLessThan(1);
  });
});

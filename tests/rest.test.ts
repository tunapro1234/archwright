import { describe, expect, it } from 'vitest';
import { ON_BOARD_MARGIN, ON_TOP_BELOW, overBoard, overDesk, restPlace, type DeskTop } from '../src/game/rest.js';
import { BOARD } from '../src/scene/layout.js';

const desk: DeskTop = { cx: 0, cz: -0.5, y: 0.75, width: 1.2, depth: 0.6, yaw: Math.PI / 6 };
/** Desk frame (u along its width, v along its depth) to world, as three.js rotationY(yaw). */
const onTop = (u: number, v: number, y = desk.y + 0.01) => {
  const c = Math.cos(desk.yaw), s = Math.sin(desk.yaw);
  return { x: desk.cx + u * c + v * s, y, z: desk.cz - u * s + v * c };
};

describe('where a fallen stone rests', () => {
  it('over the board: inside its edges plus the margin, down to just under its top', () => {
    expect(overBoard({ x: 0, y: 0.02, z: 0.1 })).toBe(true);
    expect(overBoard({ x: BOARD.width / 2 + ON_BOARD_MARGIN - 1e-6, y: 0, z: BOARD.zMax + ON_BOARD_MARGIN - 1e-6 })).toBe(true);
    expect(overBoard({ x: BOARD.width / 2 + ON_BOARD_MARGIN + 1e-3, y: 0, z: 0 })).toBe(false);
    expect(overBoard({ x: 0, y: 0, z: BOARD.zMin - ON_BOARD_MARGIN - 1e-3 })).toBe(false);
    expect(overBoard({ x: 0, y: -ON_TOP_BELOW - 1e-3, z: 0 })).toBe(false);
  });

  it('on a turned desk: inside its own rectangle, not inside the world box round it', () => {
    expect(overDesk(desk, onTop(0.55, 0.25))).toBe(true);
    expect(overDesk(desk, onTop(0.65, 0))).toBe(false);
    expect(overDesk(desk, onTop(0, 0.35))).toBe(false);
    // A corner of the world box round the turned desk is not desk.
    const hx = (1.2 * Math.cos(desk.yaw) + 0.6 * Math.sin(desk.yaw)) / 2, hz = (1.2 * Math.sin(desk.yaw) + 0.6 * Math.cos(desk.yaw)) / 2;
    expect(overDesk(desk, { x: desk.cx + hx - 0.01, y: desk.y, z: desk.cz + hz - 0.01 })).toBe(false);
    expect(overDesk(desk, onTop(0, 0, desk.y - ON_TOP_BELOW - 1e-3))).toBe(false);
  });

  it('the board first, then the desk, else below; no desk, nothing on it', () => {
    const far = { x: 5, y: 0, z: 5 };
    expect(restPlace({ x: 0, y: 0.01, z: 0 }, onTop(0, 0), desk)).toBe('onBoard');
    expect(restPlace(far, onTop(0.4, 0.1), desk)).toBe('onDesk');
    expect(restPlace(far, { x: 0, y: 0.05, z: -0.5 }, desk)).toBe('below');
    expect(restPlace(far, onTop(0.4, 0.1), null)).toBe('below');
  });
});

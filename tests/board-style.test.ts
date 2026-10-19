// How the board is drawn where it stands (src/scene/board-style.ts): a stone frame and a felt under the tray on a
// detected desk in passthrough with the whole board on it, the solid board everywhere else; the frame and the felt
// (src/scene/models.ts) and the runtime that switches between them (ArchRuntime.placeBoard, setBoardStyle, the
// palette's repaint), on its prototype with the meshes it uses.
import { describe, expect, it } from 'vitest';
import { Box3, Color, Float32BufferAttribute, Mesh, Object3D } from '@iwsdk/core';
import { boardStyle, footprintInsideDesk, parseBoardParam, type BoardStyleInput } from '../src/scene/board-style.js';
import { BOARD, TRAY, trayPoses, stoneOutline } from '../src/scene/layout.js';
import { BOARD_FRAME, boardFrame, boardMesh, boardOutline, flatMaterial, recolorBoardOutline, trayFelt } from '../src/scene/models.js';
import { COLORS, HIGH_CONTRAST, PALETTE, onRepaint, usePalette } from '../src/scene/palette.js';
import { ArchRuntime } from '../src/game/runtime.js';
import { LEVELS } from '../src/levels/index.js';
import { dailyLevel } from '../src/game/daily.js';
import type { DeskTop } from '../src/game/rest.js';

// A 1.2 × 0.6 m desk; the board (0.46 × [-0.08, 0.30] in the site frame) on it, its centre on the desk's.
const desk: DeskTop = { cx: 0, cz: -0.55, y: 0.75, width: 1.2, depth: 0.6, yaw: 0 };
const site = { x: 0, z: -0.66, yaw: 0 };
const base: BoardStyleInput = { kind: 'mesh', passthrough: true, desk, site, highContrast: false, override: null };

describe('boardStyle', () => {
  it.each<[string, Partial<BoardStyleInput>, 'solid' | 'frame']>([
    ['desk (the page)', { kind: 'desk', passthrough: false, desk: null }, 'solid'],
    ['atelier', { kind: 'atelier', passthrough: false }, 'solid'],
    ['lap tray', { kind: 'lap', desk: null }, 'solid'],
    ['picked spot in passthrough', { kind: 'pick', desk: null }, 'solid'],
    ['mesh desk in passthrough', {}, 'frame'],
    ['plane desk in passthrough', { kind: 'plane' }, 'frame'],
    ['mesh desk, opaque VR', { passthrough: false }, 'solid'],
    ['mesh desk, high contrast', { highContrast: true }, 'solid'],
    ['mesh desk, ?board=solid', { override: 'solid' }, 'solid'],
    ['mesh desk, the board overhangs it', { site: { x: 0.5, z: -0.66, yaw: 0 } }, 'solid'],
  ])('%s → %s', (_, o, style) => {
    expect(boardStyle({ ...base, ...o })).toBe(style);
  });

  it('a mesh or plane kind with no desk is solid', () => {
    expect(boardStyle({ ...base, desk: null })).toBe('solid');
    expect(boardStyle({ ...base, kind: 'plane', desk: null })).toBe('solid');
  });

  it('?board=solid is the only override', () => {
    expect(parseBoardParam('solid')).toBe('solid');
    for (const v of [null, '', 'frame', 'SOLID', 'x']) expect(parseBoardParam(v)).toBeNull();
  });
});

describe('footprintInsideDesk', () => {
  it('yaw 0: in up to the margin from each edge, out past it', () => {
    expect(footprintInsideDesk(site, desk)).toBe(true);
    // Right: 0.35 + 0.23 = 0.58 ≤ 0.59; 0.37 + 0.23 = 0.60 > 0.59.
    expect(footprintInsideDesk({ ...site, x: 0.35 }, desk)).toBe(true);
    expect(footprintInsideDesk({ ...site, x: 0.37 }, desk)).toBe(false);
    expect(footprintInsideDesk({ ...site, x: -0.37 }, desk)).toBe(false);
    // Near edge (towards the player, +z): -0.25 - 0.01 = -0.26 against the board's zMax 0.30.
    expect(footprintInsideDesk({ ...site, z: -0.56 }, desk)).toBe(true);
    expect(footprintInsideDesk({ ...site, z: -0.55 }, desk)).toBe(false);
    // Far edge: -0.85 + 0.01 = -0.84 against zMin -0.08.
    expect(footprintInsideDesk({ ...site, z: -0.76 }, desk)).toBe(true);
    expect(footprintInsideDesk({ ...site, z: -0.77 }, desk)).toBe(false);
    // The margin itself.
    expect(footprintInsideDesk({ ...site, x: 0.36 }, desk, 0)).toBe(true);
    expect(footprintInsideDesk({ ...site, x: 0.36 }, desk, 0.02)).toBe(false);
  });

  it('90°: the board lies across, its 0.46 m along z', () => {
    const at = { x: 0, z: -0.55, yaw: Math.PI / 2 };
    expect(footprintInsideDesk(at, desk)).toBe(true);
    expect(footprintInsideDesk(at, { ...desk, depth: 0.47 })).toBe(false);
    expect(footprintInsideDesk(at, { ...desk, depth: 0.48 })).toBe(true);
  });

  it('45°: a turned board needs its diagonal', () => {
    const at = { x: 0, z: -0.11, yaw: Math.PI / 4 };
    const square = (s: number): DeskTop => ({ cx: 0, cz: -0.11, y: 0.75, width: s, depth: s, yaw: 0 });
    expect(footprintInsideDesk(at, square(0.5))).toBe(false);
    expect(footprintInsideDesk(at, square(1))).toBe(true);
  });

  it('a desk turned as the board: a tight desk fits only when the yaws agree', () => {
    for (const yaw of [Math.PI / 6, Math.PI / 4, -Math.PI / 3, Math.PI]) {
      const at = { x: 0.2, z: -0.4, yaw };
      // The board's centre in the world (three.js rotationY: local (0, mid) → (mid sin, mid cos)).
      const mid = (BOARD.zMin + BOARD.zMax) / 2;
      const tight: DeskTop = { cx: at.x + mid * Math.sin(yaw), cz: at.z + mid * Math.cos(yaw), y: 0.75, width: 0.485, depth: 0.405, yaw };
      expect(footprintInsideDesk(at, tight), `yaw ${yaw}`).toBe(true);
      expect(footprintInsideDesk(at, { ...tight, yaw: yaw + 0.2 }), `yaw ${yaw} + 0.2`).toBe(false);
      // The same desk the other way round (width and depth swapped, turned a quarter) is the same rectangle.
      expect(footprintInsideDesk(at, { ...tight, width: tight.depth, depth: tight.width, yaw: yaw + Math.PI / 2 })).toBe(true);
    }
  });
});

describe('the frame and the felt', () => {
  const box = (m: Mesh) => new Box3().setFromObject(m);

  it('both palettes have frame and felt', () => {
    for (const p of [PALETTE, HIGH_CONTRAST]) for (const k of ['frame', 'felt'] as const) expect(typeof p[k]).toBe('number');
  });

  it('the frame is the board\'s edge, BOARD_FRAME.band wide, its top level with the board\'s', () => {
    const f = box(boardFrame(flatMaterial('frame'))), b = box(boardMesh(flatMaterial('board')));
    expect(f.max.y).toBeCloseTo(0, 6);
    expect(b.max.y).toBeCloseTo(0, 6);
    for (const k of ['x', 'z'] as const) {
      expect(f.min[k]).toBeCloseTo(b.min[k], 6);
      expect(f.max[k]).toBeCloseTo(b.max[k], 6);
    }
    expect(BOARD_FRAME.band).toBe(0.008);
  });

  it('the felt lies inside the frame (no shared top to fight over), at most 2 mm thick, under every tray stone', () => {
    const felt = box(trayFelt(flatMaterial('felt')));
    const { band } = BOARD_FRAME;
    expect(felt.max.y).toBeCloseTo(0, 6);
    expect(felt.max.y - felt.min.y).toBeLessThanOrEqual(0.002);
    const eps = 1e-6; // the geometry is Float32
    expect(felt.min.x).toBeGreaterThanOrEqual(-BOARD.width / 2 + band - eps);
    expect(felt.max.x).toBeLessThanOrEqual(BOARD.width / 2 - band + eps);
    expect(felt.max.z).toBeLessThanOrEqual(BOARD.zMax - band + eps);
    expect(felt.min.z).toBeLessThan(TRAY.z);
    // Each tray stone, lying, covers z in [pose.z - maxY, pose.z - minY] (src/scene/layout.ts trayPoses): its middle
    // is over the felt, on every level and a month of daily ones, but for a third row that reaches past the board's
    // own near edge (the layout's, the same on the solid board).
    const days = Array.from({ length: 30 }, (_, i) => dailyLevel(`2026-10-${String(i + 1).padStart(2, '0')}`));
    for (const def of [...LEVELS, ...days]) {
      const geo = { span: def.span, rise: def.rise, units: def.stones, depth: def.depth };
      trayPoses(def).forEach((p, i) => {
        const ys = stoneOutline(geo, def.tray[i]).map(v => v.y);
        const mid = p.z - (Math.max(...ys) + Math.min(...ys)) / 2;
        expect(mid, `${def.id} ${def.tray[i].id}`).toBeGreaterThan(felt.min.z);
        if (mid < BOARD.zMax) expect(mid, `${def.id} ${def.tray[i].id}`).toBeLessThan(felt.max.z + BOARD_FRAME.band);
        expect(Math.abs(p.x)).toBeLessThan(felt.max.x);
      });
    }
  });
});

describe('the frame and the felt are one mesh', () => {
  const colours = (m: Mesh) => {
    const a = m.geometry.getAttribute('color') as Float32BufferAttribute, seen = new Set<number>();
    for (let i = 0; i < a.count; i++) seen.add(new Color(a.getX(i), a.getY(i), a.getZ(i)).getHex());
    return seen;
  };

  it('one geometry, no groups (one draw call; in XR one per eye, as the solid board), the frame\'s and the felt\'s extent', () => {
    const o = boardOutline();
    expect(o.geometry.groups).toHaveLength(0);
    expect(Array.isArray(o.material)).toBe(false);
    const b = new Box3().setFromObject(o), f = new Box3().setFromObject(boardFrame(flatMaterial('frame')));
    for (const k of ['x', 'y', 'z'] as const) {
      expect(b.min[k]).toBeCloseTo(f.min[k], 6);
      expect(b.max[k]).toBeCloseTo(f.max[k], 6);
    }
  });

  it('coloured frame and felt from the palette, and only recolorBoardOutline changes them', () => {
    const o = boardOutline();
    expect(colours(o)).toEqual(new Set([COLORS.frame, COLORS.felt]));
    usePalette(HIGH_CONTRAST);
    expect(colours(o)).toEqual(new Set([PALETTE.frame, PALETTE.felt])); // only the runtime's repaint recolours it
    recolorBoardOutline(o);
    expect(colours(o)).toEqual(new Set([HIGH_CONTRAST.frame, HIGH_CONTRAST.felt]));
    usePalette(PALETTE);
  });
});

describe('ArchRuntime draws the style SurfaceSystem works out', () => {
  function runtime() {
    const arch = Object.create(ArchRuntime.prototype) as ArchRuntime;
    const board = boardMesh(flatMaterial('board')), outline = boardOutline();
    outline.visible = false;
    const hook = { board: { kind: 'mesh', style: 'solid' } };
    Object.assign(arch, { board, outline, hook, stones: [], boardLook: 'solid', boardWhere: null, site: new Object3D() });
    // The palette change reaches it as in the constructor (onRepaint).
    onRepaint(() => (arch as unknown as { repaint(): void }).repaint());
    return { arch, board, outline, hook };
  }
  const where = ({ highContrast: _, ...w }: BoardStyleInput) => w;

  it('frame: the board hidden, the frame and felt shown, the hook says so', () => {
    const { arch, board, outline, hook } = runtime();
    arch.placeBoard(where(base));
    expect(arch.boardLook).toBe('frame');
    expect(hook.board.style).toBe('frame');
    expect([board.visible, outline.visible]).toEqual([false, true]);
    arch.placeBoard(where({ ...base, kind: 'lap', desk: null }));
    expect(hook.board.style).toBe('solid');
    expect([board.visible, outline.visible]).toEqual([true, false]);
  });

  it('high contrast turns it solid, and off again back to the frame', () => {
    const { arch, board, outline, hook } = runtime();
    arch.placeBoard(where(base));
    usePalette(HIGH_CONTRAST);
    expect(hook.board.style).toBe('solid');
    expect([board.visible, outline.visible]).toEqual([true, false]);
    const a = outline.geometry.getAttribute('color') as Float32BufferAttribute;
    expect(new Color(a.getX(0), a.getY(0), a.getZ(0)).getHex()).toBe(HIGH_CONTRAST.frame); // repainted
    // Placed again while high contrast is on: still solid.
    arch.placeBoard(where(base));
    expect(hook.board.style).toBe('solid');
    usePalette(PALETTE);
    expect(hook.board.style).toBe('frame');
    expect([board.visible, outline.visible]).toEqual([false, true]);
  });

  it('?board=solid stays solid through a palette change', () => {
    const { arch, hook } = runtime();
    arch.placeBoard(where({ ...base, override: 'solid' }));
    usePalette(HIGH_CONTRAST);
    usePalette(PALETTE);
    expect(hook.board.style).toBe('solid');
  });
});

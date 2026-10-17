// pickTarget (src/systems/grab-snap.ts): the stone a pinch takes, and the one marked before it does.
import { describe, expect, it } from 'vitest';
import { GRAB_RADIUS, PICK_TIE, pickTarget } from '../src/systems/grab-snap.js';

const stone = (id: string, x: number, y = 0.76, z = 0.15) => ({ id, x, y, z });
const at = (x: number, y = 0.76, z = 0.15) => ({ x, y, z });

describe('pickTarget', () => {
  // Two tray stones 1.2 cm apart, centre to centre: the point between them goes to the nearer one.
  const pair = [stone('a', 0), stone('b', 0.012)];

  it('takes the nearest centre between two stones 1.2 cm apart', () => {
    expect(pickTarget(at(0.004), pair)).toBe('a');
    expect(pickTarget(at(0.0085), pair)).toBe('b');
    expect(pickTarget(at(0.012, 0.79), pair)).toBe('b');
  });

  it('takes nothing out of reach, and nothing from an empty tray', () => {
    expect(pickTarget(at(0, 0.76 + GRAB_RADIUS + 0.001), pair)).toBeNull();
    expect(pickTarget(at(0.012 + GRAB_RADIUS), pair)).toBeNull();
    expect(pickTarget(at(0), [])).toBeNull();
    expect(pickTarget(at(0.02), pair, 0.005)).toBeNull();
    expect(pickTarget(at(0.014), pair, 0.005)).toBe('b');
  });

  it('a tie (within half a millimetre) goes to the stone listed first, either way round', () => {
    expect(pickTarget(at(0.006), pair)).toBe('a');
    expect(pickTarget(at(0.0062), pair)).toBe('a');
    expect(pickTarget(at(0.006), [...pair].reverse())).toBe('b');
    expect(pickTarget(at(0.0058), [...pair].reverse())).toBe('b');
    // Just past the tie: the nearer one again.
    expect(pickTarget(at(0.006 + PICK_TIE / 2 + 0.0001), pair)).toBe('b');
  });

  it('the first of the near ones, not the first that is merely in reach', () => {
    const three = [stone('far', -0.02), stone('mid', 0.0099), stone('near', 0.0096)];
    // 'far' (2 cm) comes first but is not near; 'mid' (9.9 mm) ties with 'near' (9.6 mm) and is listed before it.
    expect(pickTarget(at(0), three)).toBe('mid');
  });
});

import { describe, expect, it } from 'vitest';
import { truckShape, type GameMapFrame } from './gameMapGl';

const SIZE = 1024;
const TRUCK = [18, 174, 255];

function frame(): GameMapFrame {
  return { w: SIZE, h: SIZE, data: new Uint8Array(SIZE * SIZE * 4) };
}

/** Paints a block of the truck's blue, `x`, `y` from the map's middle. */
function blue(f: GameMapFrame, x: number, y: number, w: number, h: number) {
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const at = ((SIZE / 2 + y + j) * SIZE + SIZE / 2 + x + i) * 4;
      f.data.set([...TRUCK, 255], at);
    }
  }
}

describe('the game truck in the middle of its map', () => {
  it('is an ellipse round its arrow, wide and low as the arrow is', () => {
    const f = frame();
    blue(f, -17, -7, 34, 14);
    const s = truckShape(f, false)!;
    expect(s.rx).toBeGreaterThan(20);
    expect(s.rx).toBeLessThan(30);
    expect(s.ry).toBeGreaterThan(8);
    expect(s.ry).toBeLessThan(12);
  });

  it('leaves a waypoint pin of the same blue beside it alone', () => {
    const f = frame();
    blue(f, -17, -7, 34, 14);
    // The pin, 30 to 50 texels ahead: it used to swell the hole round the truck to cover it.
    blue(f, 8, 30, 20, 20);
    const s = truckShape(f, false)!;
    expect(s.ry).toBeLessThan(12);
    expect(s.rx).toBeLessThan(30);
  });

  it('does not grow past the arrow’s reach when the pin stands on the truck', () => {
    const f = frame();
    blue(f, -17, -7, 34, 14);
    blue(f, -10, 6, 20, 60);
    const s = truckShape(f, false)!;
    expect(s.ry).toBeLessThan(0.032 * SIZE + 4);
    expect(s.rx).toBeLessThan(0.032 * SIZE + 4);
  });

  it('is nothing without the arrow', () => {
    const f = frame();
    blue(f, 30, 30, 20, 20);
    expect(truckShape(f, false)).toBeNull();
  });
});

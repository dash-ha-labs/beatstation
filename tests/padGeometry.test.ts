import { describe, expect, it } from 'vitest';
import { padGeometry } from '../src/screens/workspace/BeatEditor';

describe('padGeometry', () => {
  it('calculates width based on available space and minSize', () => {
    // avail: 800, n: 16, minSize: 32
    // gaps = 15 * 4 + 3 * (10 - 4) = 60 + 18 = 78
    // avail - 78 = 722, 722 / 16 = 45.125
    // (M2 x kids-reskin integration: pad height cap is 44 since the reskin's 48 px rows)
    expect(padGeometry(800, 16, 32)).toEqual({ w: 45, h: 44 });
  });

  it('clamps width to minSize', () => {
    // avail: 400, n: 16, minSize: 40
    // avail - 78 = 322, 322 / 16 = 20.125
    expect(padGeometry(400, 16, 40)).toEqual({ w: 40, h: 40 });
  });

  it('limits height to the reskin row cap (PAD_MAX_H)', () => {
    // 1000 - 78 = 922 / 16 = 57
    expect(padGeometry(1000, 16, 22)).toEqual({ w: 57, h: 44 });
  });
});

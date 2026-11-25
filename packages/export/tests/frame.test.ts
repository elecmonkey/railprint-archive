import { expect, test } from 'rstack/test';
import { fitFrame } from '../src/index.ts';

test('fitFrame fits every point inside the padding', () => {
  const points: [number, number][] = [
    [94.7, 40.1],
    [109.5, 18.3],
    [121.5, 31.2],
    [116.4, 40.2],
  ];
  const frame = fitFrame(points, 1000, 40);
  for (const p of points) {
    const [x, y] = frame.projection(p)!;
    expect(x).toBeGreaterThanOrEqual(40 - 0.5);
    expect(x).toBeLessThanOrEqual(1000 - 40 + 0.5);
    expect(y).toBeGreaterThanOrEqual(40 - 0.5);
    expect(y).toBeLessThanOrEqual(frame.height - 40 + 0.5);
  }
  // The network is taller than wide here, so the height grows past the width.
  expect(frame.height).toBeGreaterThan(1000);
  expect(frame.view.pixelsPerDegree).toBeGreaterThan(0);
});

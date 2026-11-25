import { expect, test } from 'rstack/test';
import { viewBox } from '../src/terrain.ts';
import {
  TILE_LEVELS,
  tileBounds,
  tileCount,
  tileLevelFor,
  tilesInBox,
  tileSpan,
} from '../src/tiles.ts';

test('every level tiles the globe exactly', () => {
  for (let level = 0; level < TILE_LEVELS.length; level++) {
    const [columns, rows] = tileCount(level);
    expect(columns * tileSpan(level)).toBeCloseTo(360, 9);
    expect(rows * tileSpan(level)).toBeCloseTo(180, 9);
  }
  expect(tileCount(0)).toEqual([6, 3]);
  expect(tileBounds(4, 0, 0)).toEqual([-180, 86.25, -176.25, 90]);
});

test('picks the coarsest level fine enough for the screen', () => {
  // 30 px per degree at 2× is 1/60° per device pixel: 1′ cells.
  expect(TILE_LEVELS[tileLevelFor(1 / 60)]).toBe(60);
  expect(tileLevelFor(1)).toBe(0);
  expect(tileLevelFor(1e-6)).toBe(TILE_LEVELS.length - 1);
});

test('finds the tiles of a box, across the antimeridian too', () => {
  expect(tilesInBox(0, [100, 10, 130, 50])).toEqual([
    [4, 0],
    [5, 0],
    [4, 1],
    [5, 1],
  ]);
  expect(tilesInBox(0, [170, 0, -170, 10]).map(([x]) => x)).toEqual([5, 0]);
});

test('the view box covers what the globe shows', () => {
  const box = viewBox({ center: [116, 40], pixelsPerDegree: 400 }, 800, 600);
  expect(box[0]).toBeLessThan(116);
  expect(box[2]).toBeGreaterThan(116);
  expect(box[3] - box[1]).toBeLessThan(5);
  // Zoomed out, the whole hemisphere.
  expect(viewBox({ center: [0, 80], pixelsPerDegree: 2 }, 800, 600)).toEqual([
    -180, -10, 180, 90,
  ]);
});

test('the tile vertex projection matches d3', async () => {
  const { createProjection } = await import('../src/projection.ts');
  const { projectPoint } = await import('../src/terrain.ts');
  const { geoDistance } = await import('d3-geo');
  for (const view of [
    { center: [112.5, 31] as [number, number], pixelsPerDegree: 37 },
    { center: [-70, -40] as [number, number], pixelsPerDegree: 800 },
  ]) {
    const d3 = createProjection(view, 1200, 800);
    for (const p of [
      [110, 30],
      [140, 60],
      [100.5, 3],
      [-60, -45],
      [175, -10],
    ] as [number, number][]) {
      const ours = projectPoint(view, 1200, 800, p);
      expect(ours.facing).toBe(geoDistance(p, view.center) < Math.PI / 2);
      if (!ours.facing) continue;
      const [x, y] = d3(p)!;
      expect(ours.x).toBeCloseTo(x, 6);
      expect(ours.y).toBeCloseTo(y, 6);
    }
  }
});

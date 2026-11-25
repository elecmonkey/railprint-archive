import { expect, test } from 'rstack/test';
import { rasterizeCoverage, type Grid } from '../src/raster.ts';
import { hillshade, MAX_ELEVATION_M, packTerrain } from '../src/terrain.ts';

const grid: Grid = {
  width: 4,
  height: 4,
  west: 0,
  south: 0,
  east: 4,
  north: 4,
};

test('rasterizes exact coverage with even-odd holes', () => {
  const outer: [number, number][] = [
    [0.5, 0.5],
    [3.5, 0.5],
    [3.5, 3.5],
    [0.5, 3.5],
  ];
  const hole: [number, number][] = [
    [1, 1],
    [3, 1],
    [3, 3],
    [1, 3],
  ];
  const cover = rasterizeCoverage([outer, hole], grid);
  // Corner cells are a quarter covered; inner cells are the hole.
  expect(cover[0]).toBeCloseTo(0.25, 6);
  expect(cover[1]).toBeCloseTo(0.5, 6);
  expect(cover[5]).toBeCloseTo(0, 6);
  expect(cover.reduce((a, b) => a + b, 0)).toBeCloseTo(9 - 4, 6);
});

test('flat ground shades to cos(zenith)', () => {
  const flat = hillshade(new Float32Array(16).fill(500), grid, 1);
  for (const v of flat) expect(v).toBeCloseTo(Math.cos(Math.PI / 4), 6);
});

test('slopes facing the north-west light are brighter', () => {
  // Rising towards the south-east, so the slope faces the north-west light.
  const facing = new Float32Array(16).map(
    (_, i) => ((i % 4) + Math.floor(i / 4)) * 40_000,
  );
  const away = facing.map((v) => -v);
  expect(hillshade(facing, grid, 1)[5]!).toBeGreaterThan(
    hillshade(away, grid, 1)[5]! + 0.1,
  );
});

test('packs shade, elevation and land into RGB', () => {
  const rgb = packTerrain(
    Float32Array.of(1, 0),
    Float32Array.of(MAX_ELEVATION_M / 4, -100),
    Float32Array.of(1, 0),
  );
  expect(Array.from(rgb)).toEqual([255, 128, 255, 0, 0, 0]);
});

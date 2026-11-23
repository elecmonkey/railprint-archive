import { expect, test } from 'rstack/test';
import { rasterizeCoverage, type Grid } from '../src/raster.ts';
import { readShapefile } from '../src/shapefile.ts';
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

test('reads a polyline shapefile with DBF attributes', () => {
  // One record: a two-point polyline, plus a DBF with a NUL-padded name.
  const shp = Buffer.alloc(100 + 8 + 44 + 4 + 32);
  shp.writeInt32LE(3, 32);
  shp.writeInt32BE((44 + 4 + 32) / 2, 104);
  const c = 108;
  shp.writeInt32LE(3, c);
  shp.writeInt32LE(1, c + 36);
  shp.writeInt32LE(2, c + 40);
  shp.writeInt32LE(0, c + 44);
  [116.4, 39.9, 121.5, 31.2].forEach((v, i) =>
    shp.writeDoubleLE(v, c + 48 + i * 8),
  );

  const dbf = Buffer.alloc(32 + 32 + 1 + 1 + 8);
  dbf.writeUInt32LE(1, 4);
  dbf.writeUInt16LE(65, 8);
  dbf.writeUInt16LE(9, 10);
  dbf.write('name', 32, 'latin1');
  dbf.write('C', 43, 'latin1');
  dbf[48] = 8;
  dbf[64] = 0x0d;
  dbf.write(' Huai\0\0\0', 66, 'utf8');

  const file = readShapefile(shp, dbf);
  expect(file.type).toBe('polyline');
  expect(file.records[0]).toEqual({
    parts: [
      [
        [116.4, 39.9],
        [121.5, 31.2],
      ],
    ],
    properties: { name: 'Huai' },
  });
});

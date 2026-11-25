import { expect, test } from 'rstack/test';
import { readShapefile } from '../src/shapefile.ts';

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

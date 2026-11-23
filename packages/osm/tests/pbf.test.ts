import { fileURLToPath } from 'node:url';
import { expect, test } from 'rstack/test';
import { readPbf, type OsmRelation, type OsmWay } from '../src/pbf.ts';
import { ProtoReader } from '../src/protobuf.ts';

const fixture = fileURLToPath(
  new URL('./fixtures/mini.osm.pbf', import.meta.url),
);

test('decodes varints beyond 32 bits and zigzag values', () => {
  // 13_000_000_000 as varint, then zigzag(-3) = 5, then zigzag(150) = 300.
  const bytes = Uint8Array.from([
    0x80, 0x84, 0xf1, 0xb6, 0x30, 0x05, 0xac, 0x02,
  ]);
  const r = new ProtoReader(bytes);
  expect(r.varint()).toBe(13_000_000_000);
  expect(r.svarint()).toBe(-3);
  expect(r.svarint()).toBe(150);
  expect(r.done).toBe(true);
});

test('rejects truncated varints', () => {
  expect(() => new ProtoReader(Uint8Array.from([0x80])).varint()).toThrow(
    /Truncated/,
  );
});

test('reads nodes, ways and relations from a PBF file', async () => {
  const nodes: { id: number; lon: number; lat: number; name?: string }[] = [];
  const ways: OsmWay[] = [];
  const relations: OsmRelation[] = [];
  const summary = await readPbf(fixture, {
    node: (id, lon, lat, tags) =>
      nodes.push({ id, lon, lat, ...(tags?.name ? { name: tags.name } : {}) }),
    way: (w) => ways.push(w),
    relation: (r) => relations.push(r),
  });
  expect(summary).toMatchObject({ nodes: 7, ways: 3, relations: 2 });
  expect(nodes[0]).toEqual({ id: 1, lon: 100, lat: 30, name: '甲' });
  expect(nodes[2]).toMatchObject({ id: 3, lon: 100.02, name: '乙线路所' });
  expect(nodes[1]?.name).toBeUndefined();
  expect(ways[2]).toEqual({
    id: 12,
    tags: { railway: 'rail', service: 'siding' },
    nodes: [2, 6, 4],
  });
  expect(relations[0]?.members).toEqual([
    { type: 'way', ref: 10, role: '' },
    { type: 'way', ref: 11, role: '' },
  ]);
  expect(relations[0]?.tags.name).toBe('甲丙高速线');
});

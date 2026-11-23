import { fileURLToPath } from 'node:url';
import type { Catalog } from '@railprint/catalog';
import type { MappingFile, PathsFile } from '@railprint/matching';
import { loadRailNetwork, type RailNetwork } from '@railprint/railnet';
import { beforeAll, expect, test } from 'rstack/test';
import { buildRelease, ReleaseError } from '../src/build.ts';
import { featureCollection, lineFeature, releaseMeta } from '../src/write.ts';

const fixture = fileURLToPath(
  new URL('../../osm/tests/fixtures/mini.osm.pbf', import.meta.url),
);
let net: RailNetwork;

beforeAll(async () => {
  net = await loadRailNetwork(fixture);
});

const catalog: Catalog = {
  version: 1,
  lines: [
    {
      id: 'hs',
      name: '甲丙高铁',
      from: '甲',
      to: '丙',
      group: { scope: '跨省线路', class: '客运专线' },
    },
    {
      id: 'link',
      name: '乙丁联络线',
      from: '<乙>',
      to: '<丁>',
      group: { scope: '省内线路', province: '某省' },
    },
  ],
};

const mapping: MappingFile = {
  version: 1,
  lines: {
    hs: {
      from: { osm: 'node/1' },
      to: { osm: 'node/5' },
      relations: [{ id: 100, name: '甲丙高速线' }],
      confirmed: '2026-01-01',
    },
    // Ends at an unnamed track node; its relation lists no stations.
    link: {
      from: { osm: 'node/3' },
      to: { osm: 'node/4', name: '无名' },
      relations: [],
      confirmed: '2026-01-01',
    },
  },
};

const paths: PathsFile = {
  version: 1,
  lines: {
    hs: [
      [10, 1, 3],
      [11, 3, 5],
    ],
    link: [[11, 3, 4]],
  },
};

test('builds lines from confirmed paths', () => {
  const release = buildRelease(net, catalog, mapping, paths);
  const hs = release.lines[0]!;
  expect(hs).toMatchObject({
    id: 'hs',
    lineClass: 'high-speed',
    from: '甲',
    to: '丙',
  });
  expect(hs.coordinates).toEqual([
    [100, 30],
    [100.01, 30],
    [100.02, 30],
    [100.03, 30],
    [100.04, 30],
  ]);
  expect(hs.lengthKm).toBeCloseTo(3.9, 1);
  expect(release.lines[1]).toMatchObject({
    lineClass: 'link',
    from: '乙',
    to: '丁',
  });
});

test('collects stations from relation members, path nodes and endpoints', () => {
  const { stations } = buildRelease(net, catalog, mapping, paths);
  const byRef = Object.fromEntries(stations.map((s) => [s.osm, s]));
  expect(byRef['node/1']).toMatchObject({
    name: '甲',
    kind: 'station',
    endpoint: true,
    lines: ['hs'],
  });
  // 乙线路所 lies on both paths; the link line starts there with the catalog name.
  expect(byRef['node/3']).toMatchObject({
    name: '乙',
    osmName: '乙线路所',
    kind: 'junction',
    endpoint: true,
    lines: ['hs', 'link'],
  });
  expect(byRef['node/4']).toMatchObject({
    name: '丁',
    kind: 'junction',
    endpoint: true,
    lines: ['link'],
  });
  expect(byRef['node/5']).toMatchObject({
    name: '丙',
    endpoint: true,
    lines: ['hs'],
  });
  // The subway station named 丙 is not a railway place.
  expect(stations.map((s) => s.osm)).toEqual([
    'node/1',
    'node/3',
    'node/4',
    'node/5',
  ]);
});

test('refuses unconfirmed or broken lines', () => {
  const unconfirmed = {
    ...mapping,
    lines: {
      ...mapping.lines,
      link: { ...mapping.lines.link!, confirmed: undefined },
    },
  } as MappingFile;
  expect(() => buildRelease(net, catalog, unconfirmed, paths)).toThrow(
    ReleaseError,
  );
  const broken: PathsFile = {
    version: 1,
    lines: { ...paths.lines, hs: [[10, 1, 5]] },
  };
  expect(() => buildRelease(net, catalog, mapping, broken)).toThrow(
    /broken at way 10/,
  );
});

test('writes one feature per text line', () => {
  const release = buildRelease(net, catalog, mapping, paths);
  const text = featureCollection(release.lines.map(lineFeature));
  expect(text.split('\n')).toHaveLength(5);
  const parsed = JSON.parse(text) as {
    features: { geometry: { type: string } }[];
  };
  expect(parsed.features[0]?.geometry.type).toBe('LineString');
  expect(
    releaseMeta(release, { source: 's', sha256: 'x' }).counts,
  ).toMatchObject({ lines: 2, stations: 4, endpoints: 4 });
});

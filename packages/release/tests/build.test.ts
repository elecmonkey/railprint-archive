import { fileURLToPath } from 'node:url';
import type { Catalog, PathsFile } from '@railprint/catalog';
import { loadRailNetwork, type RailNetwork } from '@railprint/railnet';
import { beforeAll, expect, test } from 'rstack/test';
import { buildRelease, projectOnSegment, ReleaseError } from '../src/build.ts';
import { featureCollection, lineFeature, releaseMeta } from '../src/write.ts';

const fixture = fileURLToPath(
  new URL('../../osm/tests/fixtures/mini.osm.pbf', import.meta.url),
);
let net: RailNetwork;

beforeAll(async () => {
  net = await loadRailNetwork(fixture);
});

const catalog: Catalog = {
  version: 2,
  lines: [
    {
      id: 'hs',
      name: '甲丙高铁',
      from: '甲',
      to: '丙',
      category: 'emu',
      osm: {
        from: 'node/1',
        to: 'node/5',
        relations: [{ id: 100, name: '甲丙高速线' }],
        confirmed: '2026-01-01',
      },
    },
    // Ends at an unnamed track node; its relations list no stations.
    {
      id: 'link',
      name: '乙丁联络线',
      from: '<乙>',
      to: '<丁>',
      category: 'link',
      osm: {
        from: 'node/3',
        to: 'node/4',
        relations: [],
        confirmed: '2026-01-01',
      },
    },
  ],
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
  const release = buildRelease(net, catalog, paths);
  const hs = release.lines[0]!;
  expect(hs).toMatchObject({
    id: 'hs',
    category: 'emu',
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
    category: 'link',
    from: '<乙>',
    to: '<丁>',
  });
});

test('collects stations from relation members, path nodes and endpoints', () => {
  const { stations } = buildRelease(net, catalog, paths);
  const byRef = Object.fromEntries(stations.map((s) => [s.osm, s]));
  expect(byRef['node/1']).toMatchObject({
    name: '甲',
    kind: 'station',
    endpoint: true,
    lines: ['hs'],
  });
  // 乙线路所 lies on both paths; the link line starts there as <乙>.
  expect(byRef['node/3']).toMatchObject({
    name: '<乙>',
    kind: 'junction',
    endpoint: true,
    lines: ['hs', 'link'],
  });
  // <丁> has no OSM name of its own.
  expect(byRef['node/4']).toMatchObject({
    name: '<丁>',
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

test('merges endpoints that pin one station through different objects', () => {
  const spur: Catalog = {
    ...catalog,
    lines: [
      ...catalog.lines,
      // Starts at 甲 but pins the track node beside it.
      {
        id: 'spur',
        name: '甲乙支线',
        from: '甲',
        to: '<乙>',
        category: 'conventional',
        osm: {
          from: 'node/2',
          to: 'node/3',
          relations: [],
          confirmed: '2026-01-01',
        },
      },
    ],
  };
  const { stations } = buildRelease(net, spur, {
    ...paths,
    lines: { ...paths.lines, spur: [[10, 2, 3]] },
  });
  expect(stations.filter((s) => s.name === '甲')).toEqual([
    expect.objectContaining({ osm: 'node/1', lines: ['hs', 'spur'] }),
  ]);
});

test('refuses unconfirmed or broken lines', () => {
  const unconfirmed: Catalog = {
    version: 2,
    lines: catalog.lines.map((l) =>
      l.id === 'link' ? { ...l, osm: { from: 'node/3', to: 'node/4' } } : l,
    ),
  };
  expect(() => buildRelease(net, unconfirmed, paths)).toThrow(ReleaseError);
  const broken: PathsFile = {
    version: 1,
    lines: { ...paths.lines, hs: [[10, 1, 5]] },
  };
  expect(() => buildRelease(net, catalog, broken)).toThrow(/broken at way 10/);
});

test('writes one feature per text line', () => {
  const release = buildRelease(net, catalog, paths);
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

test('projects a station onto the inside of a track edge', () => {
  const hit = projectOnSegment([100.005, 30.001], [100, 30], [100.01, 30])!;
  expect(hit.point[0]).toBeCloseTo(100.005, 6);
  expect(hit.point[1]).toBeCloseTo(30, 6);
  expect(hit.distance).toBeCloseTo(111, 0);
  // Beyond either end of the edge there is nothing to extend to.
  expect(
    projectOnSegment([100.02, 30], [100, 30], [100.01, 30]),
  ).toBeUndefined();
});

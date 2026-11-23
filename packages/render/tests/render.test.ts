import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { light } from '@railprint/style';
import { expect, test } from 'rstack/test';
import { draw, type DrawContext } from '../src/draw.ts';
import { levelFor, prepareData, LEVEL_TOLERANCES } from '../src/prepare.ts';
import { createProjection, fitView } from '../src/projection.ts';
import { simplify } from '../src/simplify.ts';
import type { LinesCollection, StationsCollection } from '../src/types.ts';

test('simplify keeps endpoints and drops points within tolerance', () => {
  const line: [number, number][] = [
    [0, 0],
    [1, 0.001],
    [2, -0.001],
    [3, 1],
    [4, 0],
  ];
  expect(simplify(line, 0.01)).toEqual([
    [0, 0],
    [2, -0.001],
    [3, 1],
    [4, 0],
  ]);
  expect(simplify(line, 0)).toEqual(line);
  expect(simplify(line, 10)).toEqual([
    [0, 0],
    [4, 0],
  ]);
});

test('levelFor picks finer geometry as the map zooms in', () => {
  expect(levelFor(5)).toBe(0);
  expect(levelFor(500)).toBe(3);
  expect(levelFor(200)).toBe(2);
  expect(levelFor(1e6)).toBe(LEVEL_TOLERANCES.length - 1);
});

test('projections put the view centre in the middle of the viewport', () => {
  for (const kind of ['globe', 'conic'] as const) {
    const view = {
      ...fitView(kind, 800, 600),
      center: [116.4, 39.9] as [number, number],
    };
    const [x, y] = createProjection(view, 800, 600)(view.center)!;
    expect(x).toBeCloseTo(400, 6);
    expect(y).toBeCloseTo(300, 6);
  }
});

const lines: LinesCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        id: 'a',
        name: 'A',
        from: '甲',
        to: '乙',
        lengthKm: 100,
        highSpeedShare: 1,
        relations: [],
        category: 'emu',
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [104, 34],
          [106, 34],
        ],
      },
    },
  ],
};
const stations: StationsCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        osm: 'node/1',
        name: '甲',
        kind: 'station',
        endpoint: true,
        lines: ['a'],
      },
      geometry: { type: 'Point', coordinates: [104, 34] },
    },
  ],
};

/** Records the drawing calls the renderer makes. */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy(
    { measureText: (t: string) => ({ width: t.length * 12 }) } as Record<
      string,
      unknown
    >,
    {
      get: (target, key: string) =>
        key in target
          ? target[key]
          : (...args: unknown[]) => calls.push(`${key}(${args.length})`),
      set: (target, key: string, value) => {
        calls.push(`${key}=${String(value)}`);
        target[key] = value;
        return true;
      },
    },
  );
  return { ctx: ctx as unknown as DrawContext, calls };
}

test('draws lines in their category colour, then stations and labels', () => {
  const { ctx, calls } = recorder();
  const data = prepareData(lines, stations);
  const stats = draw({
    context: ctx,
    width: 800,
    height: 600,
    view: { kind: 'conic', center: [105, 34], pixelsPerDegree: 120 },
    data,
    theme: light,
  });
  expect(stats).toMatchObject({ stations: 1, labels: 1 });
  expect(calls).toContain(`strokeStyle=${light.lines.emu.color}`);
  expect(calls.filter((c) => c.startsWith('fillText'))).toHaveLength(1);
});

test('hides stations on the far side of the globe', () => {
  const { ctx } = recorder();
  const stats = draw({
    context: ctx,
    width: 800,
    height: 600,
    view: { kind: 'globe', center: [-75, -34], pixelsPerDegree: 50 },
    data: prepareData(lines, stations),
    theme: light,
  });
  expect(stats.stations).toBe(0);
});

test('prepares the real release without errors', () => {
  const root = fileURLToPath(
    new URL('../../../data/release/', import.meta.url),
  );
  const data = prepareData(
    JSON.parse(readFileSync(`${root}lines.geojson`, 'utf8')) as LinesCollection,
    JSON.parse(
      readFileSync(`${root}stations.geojson`, 'utf8'),
    ) as StationsCollection,
  );
  expect(data.lines.length).toBeGreaterThan(100);
  const coarse = data.lines.reduce((n, l) => n + l.levels[0]!.length, 0);
  const full = data.lines.reduce((n, l) => n + l.levels.at(-1)!.length, 0);
  expect(coarse).toBeLessThan(full / 10);
});

test('fitView fits the bounds into the padded viewport', () => {
  const view = fitView('conic', 1000, 500, [100, 20, 120, 40], 50);
  expect(view.center).toEqual([110, 30]);
  // Height is the limit: 400 px for 20 degrees of latitude.
  expect(view.pixelsPerDegree).toBeCloseTo(20, 6);
});

test.each(['globe', 'conic'] as const)(
  'terrain inverse projection matches d3 (%s)',
  async (kind) => {
    const { invertPoint } = await import('../src/terrain.ts');
    const view = {
      kind,
      center: [112.5, 31] as [number, number],
      pixelsPerDegree: 37,
    };
    const projection = createProjection(view, 1200, 800);
    for (const [sx, sy] of [
      [600, 400],
      [10, 20],
      [1190, 790],
      [300, 700],
    ] as const) {
      const ours = invertPoint(view, 1200, 800, sx, sy)!;
      const d3 = projection.invert!([sx, sy])!;
      expect(ours[0]).toBeCloseTo(d3[0], 6);
      expect(ours[1]).toBeCloseTo(d3[1], 6);
    }
  },
);

test('terrain inverse projection is undefined off the globe', async () => {
  const { invertPoint } = await import('../src/terrain.ts');
  const view = {
    kind: 'globe' as const,
    center: [0, 0] as [number, number],
    pixelsPerDegree: 1,
  };
  expect(invertPoint(view, 1000, 1000, 5, 5)).toBeUndefined();
});

test('endpoint names appear before symbols, all endpoints alike', () => {
  const station = (lines: string[]) => ({
    properties: {
      osm: 'node/1',
      name: 'x',
      kind: 'station' as const,
      endpoint: true,
      lines,
    },
    coordinates: [104, 34] as [number, number],
  });
  const data = prepareData(lines, { type: 'FeatureCollection', features: [] });
  data.stations.push(station(['a', 'b', 'c']), {
    ...station(['a']),
    coordinates: [106, 34],
  });
  const at = (pixelsPerDegree: number) => {
    const { ctx, calls } = recorder();
    const stats = draw({
      context: ctx,
      width: 800,
      height: 600,
      view: { kind: 'conic', center: [105, 34], pixelsPerDegree },
      data,
      theme: light,
    });
    return { ...stats, arcs: calls.filter((c) => c.startsWith('arc')).length };
  };
  expect(at(20)).toMatchObject({ labels: 0, arcs: 0 });
  // Names on their own at overview scale, for every endpoint.
  expect(at(40)).toMatchObject({ labels: 2, arcs: 0 });
  expect(at(100)).toMatchObject({ labels: 2, arcs: 2 });
});

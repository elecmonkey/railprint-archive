import { fileURLToPath } from 'node:url';
import { beforeAll, expect, test } from 'rstack/test';
import {
  loadRailNetwork,
  nodeIndexOf,
  WayFlag,
  wayIndexOf,
  type RailNetwork,
} from '../src/network.ts';
import { Router } from '../src/route.ts';
import { TrackNodeIndex } from '../src/spatial.ts';

const fixture = fileURLToPath(
  new URL('../../osm/tests/fixtures/mini.osm.pbf', import.meta.url),
);
let net: RailNetwork;

beforeAll(async () => {
  net = await loadRailNetwork(fixture);
});

test('builds the track graph from rail ways only', () => {
  expect(Array.from(net.wayIds)).toEqual([10, 11, 12]);
  expect(net.adjNode.length).toBe(2 * 6); // 2 + 2 + 2 edges, both directions
  expect(net.wayFlags[wayIndexOf(net, 10)]! & WayFlag.HighSpeed).toBeTruthy();
  expect(net.wayFlags[wayIndexOf(net, 12)]! & WayFlag.Service).toBeTruthy();
  expect(net.wayFlags[wayIndexOf(net, 11)]! & WayFlag.Main).toBeTruthy();
});

test('collects places, skipping urban transit stations', () => {
  const names = net.places.map((p) => p.names[0]);
  expect(names).toEqual(['甲', '乙线路所', '丙']);
  const bing = net.places.find((p) => p.names[0] === '丙')!;
  expect(bing.oldNames).toEqual(['丁']);
  expect(bing.trackNode).toBe(nodeIndexOf(net, 5));
});

test('maps relation members to track way indices', () => {
  const r = net.relations.find((x) => x.id === 100)!;
  expect(Array.from(r.ways)).toEqual([
    wayIndexOf(net, 10),
    wayIndexOf(net, 11),
  ]);
  expect(Array.from(r.places).map((i) => net.places[i]!.names[0])).toEqual([
    '甲',
    '丙',
  ]);
});

test('routes along the cheapest ways', () => {
  const router = new Router(net);
  const start = { node: nodeIndexOf(net, 1), cost: 0, tag: 0 };
  const end = { node: nodeIndexOf(net, 5), cost: 0, tag: 0 };
  const plain = router.route([start], [end], {
    wayFactor: Float32Array.from([1, 1, 1]),
  })!;
  expect(plain.nodes.map((n) => net.nodeIds[n])).toEqual([1, 2, 3, 4, 5]);
  expect(plain.lengthM).toBeGreaterThan(3800);
  expect(plain.lengthM).toBeLessThan(3900);

  // Make way 11 expensive: the route takes the siding 2 → 6 → 4 instead.
  const detour = router.route([start], [end], {
    wayFactor: Float32Array.from([1, 10, 1]),
  })!;
  expect(detour.nodes.map((n) => net.nodeIds[n])).toEqual([1, 2, 6, 4, 5]);
  expect(detour.ways.map((w) => net.wayIds[w])).toEqual([10, 12, 12, 11]);
});

test('returns undefined when targets are unreachable', () => {
  const router = new Router(net);
  const start = { node: nodeIndexOf(net, 1), cost: 0, tag: 0 };
  const end = { node: nodeIndexOf(net, 5), cost: 0, tag: 0 };
  expect(
    router.route([start], [end], {
      wayFactor: Float32Array.from([Infinity, 1, 1]),
    }),
  ).toBeUndefined();
});

test('finds track nodes near a point', () => {
  const index = new TrackNodeIndex(net);
  const near = index.within(100.0201, 30, 100);
  expect(near.map((n) => net.nodeIds[n.node])).toEqual([3]);
});

test('walks along a single way', async () => {
  const { walkWay } = await import('../src/walk.ts');
  const w11 = wayIndexOf(net, 11);
  const n = (id: number) => nodeIndexOf(net, id);
  expect(walkWay(net, w11, n(3), n(5))?.map((i) => net.nodeIds[i])).toEqual([
    3, 4, 5,
  ]);
  expect(walkWay(net, w11, n(5), n(4))?.map((i) => net.nodeIds[i])).toEqual([
    5, 4,
  ]);
  expect(walkWay(net, w11, n(1), n(5))).toBeUndefined();
});

test('finds track nodes within a track distance', async () => {
  const { reachable } = await import('../src/reach.ts');
  const n = (id: number) => nodeIndexOf(net, id);
  const near = reachable(net, [{ node: n(3), cost: 0 }], 1000);
  expect([...near.keys()].map((i) => net.nodeIds[i]).sort()).toEqual([2, 3, 4]);
  expect(reachable(net, [{ node: n(3), cost: 2000 }], 1000).size).toBe(0);
});

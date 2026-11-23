import {
  readPbf,
  type OsmRelation,
  type PbfHeader,
  type Tags,
} from '@railprint/osm';
import { haversine } from './geo.ts';
import { binarySearch, Growable } from './growable.ts';

/** `railway=*` values whose ways form the routable track graph (`ferry` is a train ferry). */
export const TRACK_RAILWAY = new Set(['rail', 'narrow_gauge', 'ferry']);

/** `railway=*` values of named places a line can start or end at. */
export const PLACE_RAILWAY = new Set([
  'station',
  'halt',
  'junction',
  'service_station',
  'yard',
  'crossover',
]);

/** Station subtypes that belong to urban transit, not the national network. */
const URBAN_STATION = new Set([
  'subway',
  'light_rail',
  'monorail',
  'tram',
  'funicular',
]);

/** Bit flags describing a track way. */
export const WayFlag = {
  /** service=yard|siding|spur|crossover */
  Service: 1,
  /** highspeed=yes */
  HighSpeed: 2,
  /** usage=main */
  Main: 4,
  /** usage=branch */
  Branch: 8,
  /** usage=industrial|military|test|tourism */
  Minor: 16,
  /** railway=ferry */
  Ferry: 32,
} as const;

const SERVICE_VALUES = new Set(['yard', 'siding', 'spur', 'crossover']);
const MINOR_USAGE = new Set(['industrial', 'military', 'test', 'tourism']);

/** A named railway place: station, halt, junction (线路所), yard … */
export interface RailPlace {
  osm: { type: 'node' | 'way'; id: number };
  /** The `railway=*` value. */
  railway: string;
  /** `name` first, then other current name variants, without duplicates. */
  names: string[];
  /** Former names (`old_name`). */
  oldNames: string[];
  lon: number;
  lat: number;
  /** Node index when the place is a node lying on the track graph. */
  trackNode?: number;
}

export interface RailRelation {
  id: number;
  route: 'railway' | 'train';
  tags: Tags;
  /** Indices of member track ways. */
  ways: Int32Array;
}

export interface RailNetwork {
  header: PbfHeader;
  /** All nodes of the extract, ascending by OSM id. */
  nodeIds: Float64Array;
  lon: Float64Array;
  lat: Float64Array;
  /** CSR adjacency over node indices: neighbours of n are adjOffset[n]..adjOffset[n+1]. */
  adjOffset: Int32Array;
  adjNode: Int32Array;
  adjWay: Int32Array;
  /** Edge length in metres. */
  adjLength: Float32Array;
  /** Track ways, ascending by OSM id. */
  wayIds: Float64Array;
  wayFlags: Uint8Array;
  wayNames: (string | undefined)[];
  places: RailPlace[];
  relations: RailRelation[];
}

const NAME_KEYS = [
  'name',
  'name:zh',
  'name:zh-Hans',
  'name:zh-CN',
  'official_name',
];

function namesOf(tags: Tags): string[] {
  const names: string[] = [];
  for (const key of NAME_KEYS) {
    const value = tags[key]?.trim();
    if (value) names.push(value);
  }
  for (const alt of (tags.alt_name ?? '').split(';')) {
    const value = alt.trim();
    if (value) names.push(value);
  }
  return [...new Set(names)];
}

function oldNamesOf(tags: Tags): string[] {
  return [
    ...new Set(
      (tags.old_name ?? '')
        .split(';')
        .map((n) => n.trim())
        .filter(Boolean),
    ),
  ];
}

function isPlace(tags: Tags): boolean {
  const railway = tags.railway;
  if (!railway || !PLACE_RAILWAY.has(railway)) return false;
  if (tags.station && URBAN_STATION.has(tags.station)) return false;
  if (tags.subway === 'yes' && tags.train !== 'yes') return false;
  return namesOf(tags).length > 0;
}

function wayFlags(tags: Tags): number {
  let flags = 0;
  if (tags.railway === 'ferry') flags |= WayFlag.Ferry;
  if (tags.service && SERVICE_VALUES.has(tags.service))
    flags |= WayFlag.Service;
  if (tags.highspeed === 'yes') flags |= WayFlag.HighSpeed;
  if (tags.usage === 'main') flags |= WayFlag.Main;
  else if (tags.usage === 'branch') flags |= WayFlag.Branch;
  else if (tags.usage && MINOR_USAGE.has(tags.usage)) flags |= WayFlag.Minor;
  return flags;
}

/**
 * Load the railway extract into memory. Requires a PBF sorted by type then id
 * (osmium output is), so every way's nodes are known when the way arrives.
 */
export async function loadRailNetwork(path: string): Promise<RailNetwork> {
  const nodeIds = new Growable(Float64Array, 1 << 22);
  const lon = new Growable(Float64Array, 1 << 22);
  const lat = new Growable(Float64Array, 1 << 22);
  const placeNodes: { id: number; tags: Tags }[] = [];
  const placeWays: { id: number; tags: Tags; nodes: number[] }[] = [];
  const wayIds = new Growable(Float64Array, 1 << 19);
  const flags = new Growable(Uint8Array, 1 << 19);
  const wayNames: (string | undefined)[] = [];
  const edgeFrom = new Growable(Int32Array, 1 << 23);
  const edgeTo = new Growable(Int32Array, 1 << 23);
  const edgeWay = new Growable(Int32Array, 1 << 23);
  const rawRelations: OsmRelation[] = [];
  let finishedNodes: { ids: Float64Array; count: number } | undefined;
  let lastNodeId = -Infinity;
  let lastWayId = -Infinity;

  const nodeIndex = (id: number) => {
    finishedNodes ??= { ids: nodeIds.finish(), count: nodeIds.length };
    return binarySearch(finishedNodes.ids, id, finishedNodes.count);
  };

  const summary = await readPbf(path, {
    node(id, x, y, tags) {
      if (id <= lastNodeId || finishedNodes) {
        throw new Error('Railway extract is not sorted by type then id');
      }
      lastNodeId = id;
      nodeIds.push(id);
      lon.push(x);
      lat.push(y);
      if (tags && isPlace(tags)) placeNodes.push({ id, tags });
    },
    way(way) {
      if (way.id <= lastWayId)
        throw new Error('Railway extract ways are not sorted by id');
      lastWayId = way.id;
      const railway = way.tags.railway;
      if (railway && TRACK_RAILWAY.has(railway)) {
        const index = wayIds.length;
        wayIds.push(way.id);
        flags.push(wayFlags(way.tags));
        wayNames.push(way.tags.name);
        let previous = -1;
        for (const ref of way.nodes) {
          const n = nodeIndex(ref);
          if (n < 0)
            throw new Error(`Way ${way.id} references missing node ${ref}`);
          if (previous >= 0 && previous !== n) {
            edgeFrom.push(previous);
            edgeTo.push(n);
            edgeWay.push(index);
          }
          previous = n;
        }
      } else if (isPlace(way.tags)) {
        placeWays.push({ id: way.id, tags: way.tags, nodes: way.nodes });
      }
    },
    relation(relation) {
      const route = relation.tags.route;
      if (route === 'railway' || route === 'train') rawRelations.push(relation);
    },
  });

  const ids = finishedNodes?.ids ?? nodeIds.finish();
  const lons = lon.finish();
  const lats = lat.finish();
  const nodeCount = ids.length;
  const ways = wayIds.finish();

  // Build CSR adjacency with both directions of every edge.
  const from = edgeFrom.finish();
  const to = edgeTo.finish();
  const via = edgeWay.finish();
  const degree = new Int32Array(nodeCount + 1);
  for (let e = 0; e < from.length; e++) {
    degree[from[e]! + 1]!++;
    degree[to[e]! + 1]!++;
  }
  for (let n = 0; n < nodeCount; n++) degree[n + 1]! += degree[n]!;
  const adjOffset = degree;
  const fill = adjOffset.slice(0, nodeCount);
  const adjNode = new Int32Array(from.length * 2);
  const adjWay = new Int32Array(from.length * 2);
  const adjLength = new Float32Array(from.length * 2);
  for (let e = 0; e < from.length; e++) {
    const a = from[e]!;
    const b = to[e]!;
    const length = haversine(lons[a]!, lats[a]!, lons[b]!, lats[b]!);
    for (const [u, v] of [
      [a, b],
      [b, a],
    ] as const) {
      const slot = fill[u]!++;
      adjNode[slot] = v;
      adjWay[slot] = via[e]!;
      adjLength[slot] = length;
    }
  }

  const places: RailPlace[] = [];
  for (const { id, tags } of placeNodes) {
    const n = binarySearch(ids, id, nodeCount);
    const onTrack = adjOffset[n + 1]! > adjOffset[n]!;
    places.push({
      osm: { type: 'node', id },
      railway: tags.railway!,
      names: namesOf(tags),
      oldNames: oldNamesOf(tags),
      lon: lons[n]!,
      lat: lats[n]!,
      ...(onTrack ? { trackNode: n } : {}),
    });
  }
  for (const { id, tags, nodes } of placeWays) {
    let sumLon = 0;
    let sumLat = 0;
    let count = 0;
    for (const ref of nodes) {
      const n = binarySearch(ids, ref, nodeCount);
      if (n < 0) continue;
      sumLon += lons[n]!;
      sumLat += lats[n]!;
      count++;
    }
    if (!count) continue;
    places.push({
      osm: { type: 'way', id },
      railway: tags.railway!,
      names: namesOf(tags),
      oldNames: oldNamesOf(tags),
      lon: sumLon / count,
      lat: sumLat / count,
    });
  }

  const relations: RailRelation[] = rawRelations.map((relation) => {
    const members: number[] = [];
    for (const member of relation.members) {
      if (member.type !== 'way') continue;
      const w = binarySearch(ways, member.ref);
      if (w >= 0) members.push(w);
    }
    return {
      id: relation.id,
      route: relation.tags.route as 'railway' | 'train',
      tags: relation.tags,
      ways: Int32Array.from(members),
    };
  });

  return {
    header: summary.header,
    nodeIds: ids,
    lon: lons,
    lat: lats,
    adjOffset,
    adjNode,
    adjWay,
    adjLength,
    wayIds: ways,
    wayFlags: flags.finish(),
    wayNames,
    places,
    relations,
  };
}

export function nodeIndexOf(network: RailNetwork, id: number): number {
  return binarySearch(network.nodeIds, id);
}

export function wayIndexOf(network: RailNetwork, id: number): number {
  return binarySearch(network.wayIds, id);
}

export const degreeOf = (network: RailNetwork, node: number) =>
  network.adjOffset[node + 1]! - network.adjOffset[node]!;

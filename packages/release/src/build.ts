import {
  parseEndpoint,
  parseRef,
  type Catalog,
  type LineCategory,
  type PathsFile,
} from '@railprint/catalog';
import { placeKey } from '@railprint/matching';
import {
  haversine,
  nodeIndexOf,
  reachable,
  TrackNodeIndex,
  walkWay,
  WayFlag,
  wayIndexOf,
  type RailNetwork,
  type RailPlace,
} from '@railprint/railnet';

/** Place kinds shown on the map; yards and depots are not included. */
export type StationKind = 'station' | 'junction' | 'non-passenger';

export interface ReleaseLine {
  id: string;
  name: string;
  aliases?: string[];
  category: LineCategory;
  /** Endpoint names as written in the catalog, without markers. */
  from: string;
  to: string;
  lengthKm: number;
  relations: { id: number; name: string }[];
  /** [lon, lat] from `from` to `to`. */
  coordinates: [number, number][];
}

export interface ReleaseStation {
  /** OSM object, e.g. `node/123`. */
  osm: string;
  name: string;
  /**
   * OSM name when it differs from `name`. Endpoints use the catalog name, a
   * junction's in full: `<横山>` is shown as 横山线路所.
   */
  osmName?: string;
  kind: StationKind;
  /** True when some line starts or ends here. */
  endpoint: boolean;
  /** Ids of the lines passing through or ending here, in catalog order. */
  lines: string[];
  coordinates: [number, number];
}

export interface Release {
  lines: ReleaseLine[];
  stations: ReleaseStation[];
}

/**
 * The full name of a junction written `<横山>` in the catalog: the OSM name
 * when it is that name with a 所 suffix (横山线路所, 茂陵东辅助所), otherwise
 * the name with 线路所 added.
 */
export function junctionName(name: string, osmName?: string): string {
  if (name.endsWith('所')) return name;
  if (osmName?.startsWith(name) && osmName.endsWith('所')) return osmName;
  return `${name}线路所`;
}

/** A relation's member station belongs to a line within this distance of its path. */
export const MEMBER_RADIUS_M = 2000;
/** Track distance searched from a place node lying on the track. */
export const ON_TRACK_REACH_M = 200;
/** Straight-line radius for finding the track near an off-track place. */
export const OFF_TRACK_SEARCH_M = 1000;
/** Track distance searched from the track nodes nearest an off-track place. */
export const OFF_TRACK_REACH_M = 1000;
/** Track nodes this much farther than the nearest one also count as nearest. */
const START_SLACK_M = 25;
/** Names of objects mis-tagged as railway stations. */
const NOT_A_STATION = /汽车站$/;
/** Same-name places closer than this are one station. */
const SAME_STATION_M = 2000;

const PLACE_KIND: Record<string, StationKind | undefined> = {
  station: 'station',
  halt: 'station',
  junction: 'junction',
  service_station: 'junction',
  crossover: 'junction',
};

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReleaseError';
  }
}

/**
 * The point on segment a→b closest to p, as [lon, lat] and its distance in
 * metres, or undefined when that point is an end of the segment. Uses a local
 * flat projection, fine for the few hundred metres of a station.
 */
export function projectOnSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): { point: [number, number]; distance: number } | undefined {
  const k = Math.cos((p[1] * Math.PI) / 180);
  const ax = (a[0] - p[0]) * k;
  const ay = a[1] - p[1];
  const dx = (b[0] - a[0]) * k;
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (!len2) return undefined;
  const t = -(ax * dx + ay * dy) / len2;
  if (t <= 0 || t >= 1) return undefined;
  const point: [number, number] = [a[0] + t * (b[0] - a[0]), a[1] + t * dy];
  return { point, distance: haversine(p[0], p[1], point[0], point[1]) };
}

/**
 * Where a line drawn to an off-track station should end. Paths end at a
 * track node, but in a station crossed by one long edge the nearest node can
 * lie hundreds of metres away, and two lines ending there stop short on
 * either side. When an edge leaving the end node passes closer to the station,
 * the line continues along it to the point nearest the station.
 */
function stationEnd(
  network: RailNetwork,
  end: number,
  previous: number,
  place: RailPlace,
): [number, number] | undefined {
  const { lon, lat } = network;
  const p: [number, number] = [place.lon, place.lat];
  let best = haversine(place.lon, place.lat, lon[end]!, lat[end]!);
  let point: [number, number] | undefined;
  for (let s = network.adjOffset[end]!; s < network.adjOffset[end + 1]!; s++) {
    const next = network.adjNode[s]!;
    if (next === previous) continue;
    const hit = projectOnSegment(
      p,
      [lon[end]!, lat[end]!],
      [lon[next]!, lat[next]!],
    );
    if (hit && hit.distance < best) {
      best = hit.distance;
      point = hit.point;
    }
  }
  return point;
}

/** Node indices of a stored path; throws when it no longer resolves. */
function walkPath(
  network: RailNetwork,
  id: string,
  segments: PathsFile['lines'][string],
): number[] {
  const nodes: number[] = [];
  for (const [wayId, fromId, toId] of segments) {
    const way = wayIndexOf(network, wayId);
    const a = nodeIndexOf(network, fromId);
    const b = nodeIndexOf(network, toId);
    const walked =
      way >= 0 && a >= 0 && b >= 0 ? walkWay(network, way, a, b) : undefined;
    if (!walked || (nodes.length && nodes.at(-1) !== a)) {
      throw new ReleaseError(
        `${id}: confirmed path is broken at way ${wayId}; run \`pnpm match\``,
      );
    }
    nodes.push(...(nodes.length ? walked.slice(1) : walked));
  }
  return nodes;
}

/**
 * Build the release from the confirmed catalog. Every catalog line must be
 * confirmed with a stored path; the output is deterministic for a given
 * extract, catalog and paths.
 */
export function buildRelease(
  network: RailNetwork,
  catalog: Catalog,
  paths: PathsFile,
): Release {
  const unconfirmed = catalog.lines.filter(
    (l) => !l.osm?.confirmed || !paths.lines[l.id]?.length,
  );
  if (unconfirmed.length) {
    throw new ReleaseError(
      `${unconfirmed.length} line(s) not confirmed, e.g. ${unconfirmed[0]!.id}; run \`pnpm match\``,
    );
  }

  const { lon, lat } = network;
  const placeByRef = new Map(
    network.places.map((p) => [`${p.osm.type}/${p.osm.id}`, p]),
  );
  const lines: ReleaseLine[] = [];
  /** Lines through each path node. */
  const nodeLines = new Map<number, Set<number>>();

  /** A path's coordinates, reaching its off-track end stations. */
  const drawn = (nodes: number[], from: string, to: string) => {
    const coordinates: [number, number][] = nodes.map((n) => [
      lon[n]!,
      lat[n]!,
    ]);
    const start = placeByRef.get(from);
    const end = placeByRef.get(to);
    if (start && start.trackNode === undefined) {
      const point = stationEnd(network, nodes[0]!, nodes[1]!, start);
      if (point) coordinates.unshift(point);
    }
    if (end && end.trackNode === undefined) {
      const point = stationEnd(network, nodes.at(-1)!, nodes.at(-2)!, end);
      if (point) coordinates.push(point);
    }
    return coordinates.map(([x, y]): [number, number] => [
      round6(x),
      round6(y),
    ]);
  };

  catalog.lines.forEach((line, index) => {
    const osm = line.osm!;
    const nodes = walkPath(network, line.id, paths.lines[line.id]!);
    let lengthM = 0;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      lengthM += haversine(lon[a]!, lat[a]!, lon[b]!, lat[b]!);
    }
    for (const n of nodes) {
      let set = nodeLines.get(n);
      if (!set) nodeLines.set(n, (set = new Set()));
      set.add(index);
    }
    lines.push({
      id: line.id,
      name: line.name,
      ...(line.aliases?.length ? { aliases: line.aliases } : {}),
      category: line.category,
      from: parseEndpoint(line.from).name,
      to: parseEndpoint(line.to).name,
      lengthKm: Math.round(lengthM / 100) / 10,
      relations: osm.relations ?? [],
      coordinates: drawn(nodes, osm.from!, osm.to!),
    });
  });

  // Stations along the lines. OSM route relations list their stations as
  // members, which is the most reliable signal: geometry alone cannot tell a
  // hub whose platforms serve a line from a station the line merely passes.
  //   1. members of the line's relations within MEMBER_RADIUS_M of its path;
  //   2. place nodes lying on the path itself;
  //   3. only for lines whose relations list no stations: places reaching the
  //      path along the track (see reachesLines).
  const trackIndex = new TrackNodeIndex(network);
  const mainTrack = (way: number) => !(network.wayFlags[way]! & WayFlag.Minor);
  const relationById = new Map(network.relations.map((r) => [r.id, r]));
  const found = new Map<string, { place: RailPlace; lines: Set<number> }>();
  const add = (place: RailPlace, line: number) => {
    if (!PLACE_KIND[place.railway] || NOT_A_STATION.test(place.names[0] ?? ''))
      return;
    const ref = `${place.osm.type}/${place.osm.id}`;
    const entry = found.get(ref) ?? { place, lines: new Set<number>() };
    entry.lines.add(line);
    found.set(ref, entry);
  };
  /** Lines whose path passes within `radius` of a point. */
  const linesNear = (lon: number, lat: number, radius: number) => {
    const near = new Set<number>();
    for (const { node } of trackIndex.within(lon, lat, radius)) {
      for (const l of nodeLines.get(node) ?? []) near.add(l);
    }
    return near;
  };

  const withoutMembers = new Set<number>();
  catalog.lines.forEach((line, index) => {
    const members = (line.osm!.relations ?? []).flatMap((pin) => [
      ...(relationById.get(pin.id)?.places ?? []),
    ]);
    if (!members.length) withoutMembers.add(index);
    for (const p of members) {
      const place = network.places[p]!;
      if (linesNear(place.lon, place.lat, MEMBER_RADIUS_M).has(index))
        add(place, index);
    }
  });

  for (const place of network.places) {
    if (place.trackNode !== undefined) {
      for (const l of nodeLines.get(place.trackNode) ?? []) add(place, l);
    }
    if (!withoutMembers.size) continue;
    for (const l of reachesLines(place))
      if (withoutMembers.has(l)) add(place, l);
  }

  /** Lines reached from a place along main track within the reach limits. */
  function reachesLines(place: RailPlace): Set<number> {
    let starts: { node: number; cost: number }[];
    let reach: number;
    if (place.trackNode !== undefined) {
      starts = [{ node: place.trackNode, cost: 0 }];
      reach = ON_TRACK_REACH_M;
    } else {
      const near = trackIndex.within(place.lon, place.lat, OFF_TRACK_SEARCH_M);
      if (!near.length) return new Set();
      const limit = near[0]!.distance + START_SLACK_M;
      starts = near
        .filter((n) => n.distance <= limit)
        .map((n) => ({ node: n.node, cost: 0 }));
      reach = OFF_TRACK_REACH_M;
    }
    const served = new Set<number>();
    for (const node of reachable(network, starts, reach, mainTrack).keys()) {
      for (const l of nodeLines.get(node) ?? []) served.add(l);
    }
    return served;
  }

  // Endpoints come from the catalog's osm block and may be unnamed track nodes.
  const endpoints = new Map<
    string,
    { name: string; kind: StationKind; lines: Set<number> }
  >();
  catalog.lines.forEach((line, index) => {
    for (const [pin, text] of [
      [line.osm!.from, line.from],
      [line.osm!.to, line.to],
    ] as const) {
      if (!pin)
        throw new ReleaseError(
          `${line.id}: confirmed line lacks an OSM endpoint`,
        );
      const endpoint = parseEndpoint(text);
      const kind: StationKind = endpoint.kind;
      const current = endpoints.get(pin) ?? {
        name: endpoint.name,
        kind,
        lines: new Set(),
      };
      current.lines.add(index);
      endpoints.set(pin, current);
    }
  });

  const stations: ReleaseStation[] = [];
  const consumed = new Set<string>();
  const pinned: { station: ReleaseStation; rank: number }[] = [];
  for (const [ref, ep] of endpoints) {
    const hit = found.get(ref);
    const place = hit?.place ?? placeByRef.get(ref);
    const lines = new Set([...ep.lines, ...(hit?.lines ?? [])]);
    let coordinates: [number, number];
    let osmName: string | undefined;
    if (place) {
      coordinates = [round6(place.lon), round6(place.lat)];
      osmName = place.names[0];
    } else {
      const { type, id } = parseRef(ref);
      const n = type === 'node' ? nodeIndexOf(network, id) : -1;
      if (n < 0)
        throw new ReleaseError(
          `Endpoint ${ref} is not in the extract; run \`pnpm match\``,
        );
      coordinates = [round6(lon[n]!), round6(lat[n]!)];
    }
    consumed.add(ref);
    const name =
      ep.kind === 'junction' ? junctionName(ep.name, osmName) : ep.name;
    pinned.push({
      station: {
        osm: ref,
        name,
        ...(osmName && osmName !== name ? { osmName } : {}),
        kind: ep.kind,
        endpoint: true,
        lines: [...lines].map((i) => catalog.lines[i]!.id),
        coordinates,
      },
      // A bare track node only stands in for a station OSM lacks.
      rank: place ? rank(place) : 3,
    });
  }

  // Lines may pin the same station through different OSM objects, such as
  // its node and its area; keep the better one.
  pinned.sort((a, b) => a.rank - b.rank);
  for (const { station } of pinned) {
    const twin = stations.find(
      (s) =>
        s.kind === station.kind &&
        placeKey(s.name) === placeKey(station.name) &&
        haversine(
          s.coordinates[0],
          s.coordinates[1],
          station.coordinates[0],
          station.coordinates[1],
        ) < SAME_STATION_M,
    );
    if (twin) mergeLines(twin, station.lines);
    else stations.push(station);
  }
  for (const s of stations) mergeLines(s, []);

  /** Adds lines to a station, keeping them in catalog order. */
  function mergeLines(station: ReleaseStation, more: string[]) {
    const merged = new Set([...station.lines, ...more]);
    station.lines = catalog.lines
      .map((l) => l.id)
      .filter((id) => merged.has(id));
  }

  // Remaining places, merging OSM duplicates (a station tagged both as a
  // node and as an area) that share a name and lie close together.
  const rest = [...found]
    .filter(([ref]) => !consumed.has(ref))
    .sort(([, a], [, b]) => rank(a.place) - rank(b.place));
  const kept: ReleaseStation[] = [];
  for (const [ref, { place, lines: served }] of rest) {
    const name = place.names[0]!;
    const key = placeKey(name);
    const twin = [...stations, ...kept].find(
      (s) =>
        placeKey(s.osmName ?? s.name) === key &&
        haversine(s.coordinates[0], s.coordinates[1], place.lon, place.lat) <
          SAME_STATION_M,
    );
    if (twin) {
      mergeLines(
        twin,
        [...served].map((i) => catalog.lines[i]!.id),
      );
      continue;
    }
    kept.push({
      osm: ref,
      name,
      kind: PLACE_KIND[place.railway]!,
      endpoint: false,
      lines: [...served].sort((a, b) => a - b).map((i) => catalog.lines[i]!.id),
      coordinates: [round6(place.lon), round6(place.lat)],
    });
  }
  stations.push(...kept);
  stations.sort((a, b) => compareRef(a.osm, b.osm));
  return { lines, stations };
}

/** Prefer on-track nodes, then other nodes, then areas, when merging twins. */
function rank(place: RailPlace): number {
  if (place.trackNode !== undefined) return 0;
  return place.osm.type === 'node' ? 1 : 2;
}

function compareRef(a: string, b: string): number {
  const ra = parseRef(a);
  const rb = parseRef(b);
  return ra.type === rb.type ? ra.id - rb.id : ra.type < rb.type ? -1 : 1;
}

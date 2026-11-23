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
  /** Share of the path on highspeed=yes track. */
  highSpeedShare: number;
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

/** Node indices of a stored path; throws when it no longer resolves. */
function walkPath(
  network: RailNetwork,
  id: string,
  segments: PathsFile['lines'][string],
): { nodes: number[]; ways: number[] } {
  const nodes: number[] = [];
  const ways: number[] = [];
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
    for (let i = 1; i < walked.length; i++) ways.push(way);
    nodes.push(...(nodes.length ? walked.slice(1) : walked));
  }
  return { nodes, ways };
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
  const lines: ReleaseLine[] = [];
  /** Lines through each path node. */
  const nodeLines = new Map<number, Set<number>>();

  catalog.lines.forEach((line, index) => {
    const osm = line.osm!;
    const { nodes, ways } = walkPath(network, line.id, paths.lines[line.id]!);
    let lengthM = 0;
    let highSpeedM = 0;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      const edge = haversine(lon[a]!, lat[a]!, lon[b]!, lat[b]!);
      lengthM += edge;
      if (network.wayFlags[ways[i - 1]!]! & WayFlag.HighSpeed)
        highSpeedM += edge;
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
      highSpeedShare: lengthM
        ? Math.round((highSpeedM / lengthM) * 1000) / 1000
        : 0,
      relations: osm.relations ?? [],
      coordinates: nodes.map((n) => [round6(lon[n]!), round6(lat[n]!)]),
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

  const placeByRef = new Map(
    network.places.map((p) => [`${p.osm.type}/${p.osm.id}`, p]),
  );
  const stations: ReleaseStation[] = [];
  const consumed = new Set<string>();
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
    stations.push({
      osm: ref,
      name,
      ...(osmName && osmName !== name ? { osmName } : {}),
      kind: ep.kind,
      endpoint: true,
      lines: [...lines].sort((a, b) => a - b).map((i) => catalog.lines[i]!.id),
      coordinates,
    });
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
      const merged = new Set([
        ...twin.lines,
        ...[...served].map((i) => catalog.lines[i]!.id),
      ]);
      twin.lines = catalog.lines
        .map((l) => l.id)
        .filter((id) => merged.has(id));
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

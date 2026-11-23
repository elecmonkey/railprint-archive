import {
  parseEndpoint,
  parseRef,
  type CatalogLine,
  type LineOsm,
  type OsmRef,
  type StoredSegment,
} from '@railprint/catalog';
import {
  haversine,
  nodeIndexOf,
  Router,
  TrackNodeIndex,
  WayFlag,
  type Anchor,
  type RailNetwork,
  type RailPlace,
  type RailRelation,
  walkWay,
  wayIndexOf,
} from '@railprint/railnet';
import { lineKey, lineKeyString } from './names.ts';
import { PlaceIndex, type PlaceMatch } from './places.ts';

/** `confirmed`: the line's OSM correspondence is confirmed and still resolves. */
export type MatchStatus = 'confirmed' | 'ok' | 'review' | 'failed';

export type IssueCode =
  | 'endpoint-missing'
  | 'endpoint-kind'
  | 'endpoint-renamed'
  | 'endpoint-ambiguous'
  | 'pin-missing'
  | 'path-broken'
  | 'no-relation'
  | 'no-route'
  | 'low-coverage'
  | 'detour'
  | 'long-link';

export interface Issue {
  code: IssueCode;
  message: string;
}

export interface PlaceRef {
  type: 'node' | 'way';
  id: number;
  railway: string;
  name: string;
  lon: number;
  lat: number;
}

export interface EndpointResult {
  text: string;
  /** The place the chosen route starts or ends at. */
  place?: PlaceRef;
  candidates: number;
  /** True when the endpoint is fixed in the catalog's `osm` block. */
  pinned: boolean;
}

export interface RelationRef {
  id: number;
  name: string;
}

export interface RelationShare extends RelationRef {
  km: number;
}

/** Consecutive path edges on one way, as OSM ids. */
export interface PathSegment {
  way: number;
  from: number;
  to: number;
}

export interface LineMatch {
  id: string;
  status: MatchStatus;
  issues: Issue[];
  from: EndpointResult;
  to: EndpointResult;
  /** Relations the path was steered along (pinned, or named like the line). */
  relations: RelationRef[];
  path?: {
    lengthKm: number;
    straightKm: number;
    /** Path length divided by straight-line distance. */
    detour: number;
    /** Share of the path on `relations`; undefined when there are none. */
    coverage?: number;
    /** Infrastructure relations the path runs on, longest first. */
    onRelations: RelationShare[];
    /** Share of the path on service tracks (yards, sidings, spurs). */
    serviceShare: number;
    /** Share of the path on highspeed=yes track. */
    highSpeedShare: number;
    segments: PathSegment[];
  };
}

export interface MatchThresholds {
  /** Minimum share of the path on the matched relations. */
  coverage: number;
  /** Maximum path length / straight-line distance. */
  detour: number;
  /** Same-name candidates farther apart than this count as ambiguous. */
  ambiguousKm: number;
  /** A link line (联络线 / 疏解线) longer than this is suspicious. */
  linkKm: number;
}

export const DEFAULT_THRESHOLDS: MatchThresholds = {
  coverage: 0.9,
  detour: 1.8,
  ambiguousKm: 20,
  linkKm: 50,
};

/** Edge cost multipliers; all ≥ 1. */
const FACTOR = {
  onRelation: 1,
  offRelation: 3,
  noRelationKnown: 1.5,
  service: 4,
  wrongSpeedClass: 2,
  minorUsage: 2,
} as const;

/** Anchor radius around a place that is not itself on the track graph. */
const PLACE_RADIUS_M = 1500;
/** Extra anchors around a place node that lies on the track graph. */
const ON_TRACK_RADIUS_M = 300;
const MAX_ANCHORS = 200;
/**
 * Cost per metre between a place and a nearby track node. Higher than any
 * track factor, so routes follow the track as close to the place as possible
 * instead of stopping at the first node inside the radius.
 */
const ANCHOR_FACTOR = 3 * FACTOR.offRelation * FACTOR.service;

const relationName = (r: RailRelation) =>
  r.tags.name ?? r.tags['name:zh'] ?? `relation ${r.id}`;

const RELATION_NAME_KEYS = [
  'name',
  'name:zh',
  'name:zh-Hans',
  'official_name',
  'alt_name',
];

const round = (n: number, digits = 1) =>
  Math.round(n * 10 ** digits) / 10 ** digits;

/** Endpoint candidates plus what the report should say about them. */
interface Resolved {
  candidates: RailPlace[];
  pinned: boolean;
}

/** Matching context built once per network and reused for every line. */
export class Matcher {
  private readonly network: RailNetwork;
  private readonly router: Router;
  private readonly nodes: TrackNodeIndex;
  private readonly places: PlaceIndex;
  private readonly thresholds: MatchThresholds;
  private readonly placeByRef = new Map<string, RailPlace>();
  private readonly relationById = new Map<number, RailRelation>();
  /** Infrastructure relations by normalized line key. */
  private readonly relationsByKey = new Map<string, RailRelation[]>();
  /** Infrastructure relations each track way belongs to. */
  private readonly wayRelations = new Map<number, RailRelation[]>();
  private readonly factor: Float32Array;

  constructor(
    network: RailNetwork,
    thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.network = network;
    this.thresholds = thresholds;
    this.router = new Router(network);
    this.nodes = new TrackNodeIndex(network);
    this.places = new PlaceIndex(network);
    this.factor = new Float32Array(network.wayIds.length);
    for (const place of network.places) {
      this.placeByRef.set(`${place.osm.type}/${place.osm.id}`, place);
    }
    for (const relation of network.relations) {
      if (relation.route !== 'railway') continue;
      this.relationById.set(relation.id, relation);
      const keys = new Set<string>();
      for (const k of RELATION_NAME_KEYS) {
        for (const name of (relation.tags[k] ?? '').split(';')) {
          if (name.trim()) keys.add(lineKeyString(lineKey(name)));
        }
      }
      for (const key of keys) {
        let list = this.relationsByKey.get(key);
        if (!list) this.relationsByKey.set(key, (list = []));
        list.push(relation);
      }
      for (const way of relation.ways) {
        let list = this.wayRelations.get(way);
        if (!list) this.wayRelations.set(way, (list = []));
        if (!list.includes(relation)) list.push(relation);
      }
    }
  }

  /** Infrastructure relations named like the line or one of its aliases. */
  relationsFor(line: CatalogLine): RailRelation[] {
    const found = new Map<number, RailRelation>();
    for (const name of [line.name, ...(line.aliases ?? [])]) {
      for (const r of this.relationsByKey.get(lineKeyString(lineKey(name))) ??
        []) {
        found.set(r.id, r);
      }
    }
    return [...found.values()];
  }

  /**
   * A pinned endpoint: a known place, or any track node (for junctions that
   * OSM does not name, such as where a link line meets a main line).
   */
  private resolvePin(pin: OsmRef, text: string): RailPlace | undefined {
    const place = this.placeByRef.get(pin);
    if (place) return place;
    const { type, id } = parseRef(pin);
    if (type !== 'node') return undefined;
    const n = nodeIndexOf(this.network, id);
    if (n < 0 || this.network.adjOffset[n + 1] === this.network.adjOffset[n])
      return undefined;
    return {
      osm: { type: 'node', id },
      railway: 'track',
      names: [parseEndpoint(text).name],
      oldNames: [],
      lon: this.network.lon[n]!,
      lat: this.network.lat[n]!,
      trackNode: n,
    };
  }

  private resolveEndpoint(
    text: string,
    pin: OsmRef | undefined,
    label: string,
    issues: Issue[],
  ): Resolved {
    if (pin) {
      const place = this.resolvePin(pin, text);
      if (!place) {
        issues.push({
          code: 'pin-missing',
          message: `${label}固定的 ${pin} 在当前 OSM 中不存在或不在轨道上`,
        });
        return { candidates: [], pinned: true };
      }
      return { candidates: [place], pinned: true };
    }
    const match = this.places.resolve(text);
    this.endpointIssues(match, label, issues);
    return { candidates: match.candidates, pinned: false };
  }

  private anchors(places: RailPlace[]): Anchor[] {
    const anchors: Anchor[] = [];
    places.forEach((place, tag) => {
      if (place.trackNode !== undefined) {
        anchors.push({ node: place.trackNode, cost: 0, tag });
      }
      const radius =
        place.trackNode !== undefined ? ON_TRACK_RADIUS_M : PLACE_RADIUS_M;
      for (const { node, distance } of this.nodes
        .within(place.lon, place.lat, radius)
        .slice(0, MAX_ANCHORS)) {
        anchors.push({ node, cost: distance * ANCHOR_FACTOR, tag });
      }
    });
    return anchors;
  }

  private setFactors(relations: RailRelation[], speed: SpeedPreference): void {
    const { wayFlags } = this.network;
    const onRelation = new Set<number>();
    for (const r of relations) for (const w of r.ways) onRelation.add(w);
    const base = relations.length ? FACTOR.offRelation : FACTOR.noRelationKnown;
    const wantHighSpeed = speed === 'high-speed';
    for (let w = 0; w < this.factor.length; w++) {
      if (onRelation.has(w)) {
        this.factor[w] = FACTOR.onRelation;
        continue;
      }
      const flags = wayFlags[w]!;
      let f = base;
      if (flags & WayFlag.Service) f *= FACTOR.service;
      if (flags & WayFlag.Minor) f *= FACTOR.minorUsage;
      if (
        speed !== 'any' &&
        !(flags & WayFlag.Ferry) &&
        Boolean(flags & WayFlag.HighSpeed) !== wantHighSpeed
      ) {
        f *= FACTOR.wrongSpeedClass;
      }
      this.factor[w] = f;
    }
  }

  private endpointIssues(
    match: PlaceMatch,
    label: string,
    issues: Issue[],
  ): void {
    const { endpoint, candidates } = match;
    if (!candidates.length) {
      issues.push({
        code: 'endpoint-missing',
        message: `${label}「${endpoint.name}」在 OSM 中找不到`,
      });
      return;
    }
    if (match.byOldName) {
      const now = [...new Set(candidates.map((p) => p.names[0]))].join('/');
      issues.push({
        code: 'endpoint-renamed',
        message: `${label}「${endpoint.name}」按旧名匹配，OSM 现名「${now}」`,
      });
    }
    if (match.kindMismatch) {
      const kinds = [...new Set(candidates.map((p) => p.railway))].join('/');
      issues.push({
        code: 'endpoint-kind',
        message: `${label}「${endpoint.name}」目录记为 ${endpoint.kind}，OSM 中只有 ${kinds}`,
      });
    }
    let farthest = 0;
    for (const a of candidates) {
      for (const b of candidates) {
        farthest = Math.max(farthest, haversine(a.lon, a.lat, b.lon, b.lat));
      }
    }
    if (farthest > this.thresholds.ambiguousKm * 1000) {
      issues.push({
        code: 'endpoint-ambiguous',
        message: `${label}「${endpoint.name}」有 ${candidates.length} 个同名对象，最远相距 ${(farthest / 1000).toFixed(0)} km`,
      });
    }
  }

  private pinnedRelations(osm: LineOsm, issues: Issue[]): RailRelation[] {
    const found: RailRelation[] = [];
    for (const pin of osm.relations ?? []) {
      const relation = this.relationById.get(pin.id);
      if (relation) found.push(relation);
      else {
        issues.push({
          code: 'pin-missing',
          message: `固定的 relation ${pin.id}（${pin.name}）在当前 OSM 中不存在`,
        });
      }
    }
    return found;
  }

  /** Node and way indices of a stored path, if it is still intact. */
  private walkStored(
    stored: readonly StoredSegment[],
  ): { nodes: number[]; ways: number[] } | undefined {
    const nodes: number[] = [];
    const ways: number[] = [];
    for (const [wayId, fromId, toId] of stored) {
      const way = wayIndexOf(this.network, wayId);
      const a = nodeIndexOf(this.network, fromId);
      const b = nodeIndexOf(this.network, toId);
      if (way < 0 || a < 0 || b < 0) return undefined;
      if (nodes.length && nodes.at(-1) !== a) return undefined;
      const walked = walkWay(this.network, way, a, b);
      if (!walked) return undefined;
      if (!nodes.length) nodes.push(walked[0]!);
      for (const n of walked.slice(1)) {
        nodes.push(n);
        ways.push(way);
      }
    }
    return nodes.length > 1 ? { nodes, ways } : undefined;
  }

  /**
   * Match one line. `osm` defaults to the line's own OSM block; with a
   * confirmed block and the stored path, the path is reused as long as it is
   * intact; otherwise a route is searched.
   */
  match(
    line: CatalogLine,
    osm: LineOsm = line.osm ?? {},
    stored?: readonly StoredSegment[],
  ): LineMatch {
    const issues: Issue[] = [];
    const confirmed = Boolean(osm.confirmed);
    const fromResolved = this.resolveEndpoint(
      line.from,
      osm.from,
      '起点',
      issues,
    );
    const toResolved = this.resolveEndpoint(line.to, osm.to, '终点', issues);

    const relations = osm.relations
      ? this.pinnedRelations(osm, issues)
      : this.relationsFor(line);
    if (!osm.relations && !relations.length) {
      issues.push({
        code: 'no-relation',
        message: `OSM 中没有与「${line.name}」同名的线路 relation`,
      });
    }

    const from: EndpointResult = {
      text: line.from,
      candidates: fromResolved.candidates.length,
      pinned: fromResolved.pinned,
    };
    const to: EndpointResult = {
      text: line.to,
      candidates: toResolved.candidates.length,
      pinned: toResolved.pinned,
    };
    const relationRefs = relations.map((r) => ({
      id: r.id,
      name: relationName(r),
    }));
    const result = (
      status: MatchStatus,
      path?: LineMatch['path'],
    ): LineMatch => ({
      id: line.id,
      status,
      issues,
      from,
      to,
      relations: relationRefs,
      ...(path ? { path } : {}),
    });

    if (!fromResolved.candidates.length || !toResolved.candidates.length) {
      return result('failed');
    }

    let route: { nodes: number[]; ways: number[] } | undefined;
    let fromPlace: RailPlace;
    let toPlace: RailPlace;
    if (confirmed && stored?.length) {
      route = this.walkStored(stored);
      if (!route) {
        issues.push({
          code: 'path-broken',
          message: '固定路径在当前 OSM 中已断开，以下为重新求得的路径',
        });
      }
    }
    if (route) {
      fromPlace = fromResolved.candidates[0]!;
      toPlace = toResolved.candidates[0]!;
    } else {
      this.setFactors(relations, speedPreference(line));
      const found = this.router.route(
        this.anchors(fromResolved.candidates),
        this.anchors(toResolved.candidates),
        { wayFactor: this.factor },
      );
      if (!found) {
        issues.push({ code: 'no-route', message: '两端之间没有连通的轨道' });
        return result('failed');
      }
      route = found;
      fromPlace = fromResolved.candidates[found.from.tag]!;
      toPlace = toResolved.candidates[found.to.tag]!;
    }
    from.place = placeRef(fromPlace);
    to.place = placeRef(toPlace);

    const { lon, lat, nodeIds, wayIds, wayFlags } = this.network;
    const steered = new Set(relations.map((r) => r.id));
    const shares = new Map<number, RelationShare>();
    let onSteered = 0;
    let onService = 0;
    let onHighSpeed = 0;
    let lengthM = 0;
    const segments: PathSegment[] = [];
    for (let i = 0; i < route.ways.length; i++) {
      const way = route.ways[i]!;
      const a = route.nodes[i]!;
      const b = route.nodes[i + 1]!;
      const edge = haversine(lon[a]!, lat[a]!, lon[b]!, lat[b]!);
      lengthM += edge;
      if (wayFlags[way]! & WayFlag.Service) onService += edge;
      if (wayFlags[way]! & WayFlag.HighSpeed) onHighSpeed += edge;
      const rels = this.wayRelations.get(way) ?? [];
      if (rels.some((r) => steered.has(r.id))) onSteered += edge;
      for (const r of rels) {
        const share = shares.get(r.id) ?? {
          id: r.id,
          name: relationName(r),
          km: 0,
        };
        share.km += edge / 1000;
        shares.set(r.id, share);
      }
      const last = segments.at(-1);
      if (last && last.way === wayIds[way]) last.to = nodeIds[b]!;
      else
        segments.push({
          way: wayIds[way]!,
          from: nodeIds[a]!,
          to: nodeIds[b]!,
        });
    }

    const straightM = haversine(
      fromPlace.lon,
      fromPlace.lat,
      toPlace.lon,
      toPlace.lat,
    );
    const detour = straightM > 0 ? lengthM / straightM : 1;
    const coverage =
      relations.length && lengthM > 0 ? onSteered / lengthM : undefined;

    // A confirmed line was reviewed by the author; only report what broke.
    if (!confirmed) {
      if (coverage !== undefined && coverage < this.thresholds.coverage) {
        issues.push({
          code: 'low-coverage',
          message: `路径只有 ${(coverage * 100).toFixed(0)}% 在同名 relation 上`,
        });
      }
      if (line.category === 'link' && lengthM > this.thresholds.linkKm * 1000) {
        issues.push({
          code: 'long-link',
          message: `联络线路径长 ${(lengthM / 1000).toFixed(0)} km，端点可能匹配错了`,
        });
      }
      if (detour > this.thresholds.detour) {
        issues.push({
          code: 'detour',
          message: `路径长度是直线距离的 ${detour.toFixed(1)} 倍`,
        });
      }
    }

    const status: MatchStatus = issues.length
      ? 'review'
      : confirmed
        ? 'confirmed'
        : 'ok';
    return result(status, {
      lengthKm: round(lengthM / 1000),
      straightKm: round(straightM / 1000),
      detour: round(detour, 2),
      ...(coverage !== undefined ? { coverage: round(coverage, 3) } : {}),
      onRelations: [...shares.values()]
        .sort((a, b) => b.km - a.km)
        .map((s) => ({ ...s, km: round(s.km) })),
      serviceShare: round(lengthM ? onService / lengthM : 0, 3),
      highSpeedShare: round(lengthM ? onHighSpeed / lengthM : 0, 3),
      segments,
    });
  }
}

function placeRef(place: RailPlace): PlaceRef {
  return {
    type: place.osm.type,
    id: place.osm.id,
    railway: place.railway,
    name: place.names[0] ?? '',
    lon: place.lon,
    lat: place.lat,
  };
}

/** Which kind of track a line should prefer when routing. */
export type SpeedPreference = 'high-speed' | 'conventional' | 'any';

/** The line's category decides: 动车 lines prefer high-speed track. */
export function speedPreference(line: CatalogLine): SpeedPreference {
  if (line.category === 'emu') return 'high-speed';
  if (line.category === 'conventional') return 'conventional';
  return 'any';
}

/** Share of a path a relation must cover to be pinned when confirming. */
export const PIN_RELATION_SHARE = 0.05;

/**
 * OSM block that fixes a successful match: its endpoints, the relations
 * carrying at least `PIN_RELATION_SHARE` of the path, and the date. The path
 * itself goes to paths.json.
 */
export function confirmMatch(match: LineMatch, date: string): LineOsm {
  if (!match.path || !match.from.place || !match.to.place) {
    throw new Error(`${match.id}: cannot confirm a line without a path`);
  }
  const ref = (p: PlaceRef): OsmRef => `${p.type}/${p.id}`;
  const minKm = match.path.lengthKm * PIN_RELATION_SHARE;
  return {
    from: ref(match.from.place),
    to: ref(match.to.place),
    relations: match.path.onRelations
      .filter((r) => r.km >= minKm)
      .map((r) => ({ id: r.id, name: r.name })),
    confirmed: date,
  };
}

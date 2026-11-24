import { geoDistance } from 'd3-geo';
import { createProjection, type View } from './projection.ts';
import type { RenderData, RenderLine, RenderStation } from './types.ts';

const DEG = Math.PI / 180;
const EARTH_KM = 6371.0088;
/** Size of a cell in the segment index, in degrees. */
const CELL = 0.25;
/** Lines this close to the nearest hit (in pixels) count as the same place. */
const SAME_PLACE = 2;

/** Distance in km between two nearby points. */
function km(a: [number, number], b: [number, number]): number {
  const kx = Math.cos(((a[1] + b[1]) / 2) * DEG);
  return Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]) * DEG * EARTH_KM;
}

function geometry(line: RenderLine): [number, number][] {
  return line.levels.at(-1)!;
}

/** Distance from the start of the line to each vertex, in km. */
const cumulative = new WeakMap<RenderLine, Float64Array>();
function along(line: RenderLine): Float64Array {
  let result = cumulative.get(line);
  if (!result) {
    const points = geometry(line);
    result = new Float64Array(points.length);
    for (let i = 1; i < points.length; i++)
      result[i] = result[i - 1]! + km(points[i - 1]!, points[i]!);
    cumulative.set(line, result);
  }
  return result;
}

/** A station on a line, with its distance from the line's start. */
export interface LineStop {
  station: RenderStation;
  km: number;
}

const stopsCache = new WeakMap<RenderLine, LineStop[]>();

/** Stations of `line` in order along it. */
export function lineStops(data: RenderData, line: RenderLine): LineStop[] {
  const cached = stopsCache.get(line);
  if (cached) return cached;
  const id = line.properties.id;
  const points = geometry(line);
  const distances = along(line);
  const stops: LineStop[] = [];
  for (const station of data.stations) {
    if (!station.properties.lines.includes(id)) continue;
    const [lon, lat] = station.coordinates;
    const kx = Math.cos(lat * DEG);
    let best = Infinity;
    let at = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const dx = (bx - ax) * kx;
      const dy = by - ay;
      const length2 = dx * dx + dy * dy;
      const t =
        length2 > 0
          ? Math.max(
              0,
              Math.min(1, ((lon - ax) * kx * dx + (lat - ay) * dy) / length2),
            )
          : 0;
      const d = Math.hypot((ax + t * (bx - ax) - lon) * kx, ay + t * dy - lat);
      if (d < best) {
        best = d;
        at = distances[i - 1]! + t * (distances[i]! - distances[i - 1]!);
      }
    }
    stops.push({ station, km: at });
  }
  stops.sort((a, b) => a.km - b.km);
  stopsCache.set(line, stops);
  return stops;
}

/** The two stops either side of `km` along a line, if any. */
export function sectionAt(
  stops: LineStop[],
  km: number,
): [LineStop, LineStop] | undefined {
  for (let i = 1; i < stops.length; i++) {
    if (km <= stops[i]!.km) return [stops[i - 1]!, stops[i]!];
  }
  return undefined;
}

export interface LineHit {
  line: RenderLine;
  /** Distance from the pointer in CSS pixels. */
  distance: number;
  /** Position of the nearest point along the line, in km from its start. */
  km: number;
}

export interface Hit {
  station?: RenderStation;
  /**
   * Lines near the pointer, nearest first. Where lines overlap on screen, the
   * one drawn on top comes first, as that is the one the reader sees.
   */
  lines: LineHit[];
}

export interface PickOptions {
  /** Radius around the pointer in CSS pixels. */
  tolerance: number;
  /** Stations that are drawn and can be hit; none when omitted. */
  stations?: (station: RenderStation) => boolean;
  /** Drawing order of a line; higher is on top. */
  z?: (line: RenderLine) => number;
}

/**
 * Finds what lies under a point on the map. Segments are indexed once by
 * geographic cell; each pick only projects the few near the pointer.
 */
export class Picker {
  private readonly cells = new Map<number, number[]>();
  private readonly data: RenderData;

  constructor(data: RenderData) {
    this.data = data;
    data.lines.forEach((line, lineIndex) => {
      const points = geometry(line);
      for (let i = 1; i < points.length; i++) {
        const [ax, ay] = points[i - 1]!;
        const [bx, by] = points[i]!;
        const x0 = Math.floor(Math.min(ax, bx) / CELL);
        const x1 = Math.floor(Math.max(ax, bx) / CELL);
        const y0 = Math.floor(Math.min(ay, by) / CELL);
        const y1 = Math.floor(Math.max(ay, by) / CELL);
        for (let x = x0; x <= x1; x++)
          for (let y = y0; y <= y1; y++) {
            const key = cellKey(x, y);
            let list = this.cells.get(key);
            if (!list) this.cells.set(key, (list = []));
            list.push(lineIndex, i);
          }
      }
    });
  }

  pick(
    view: View,
    width: number,
    height: number,
    point: [number, number],
    { tolerance, stations, z = () => 0 }: PickOptions,
  ): Hit {
    const projection = createProjection(view, width, height);
    const visible = (c: [number, number]) =>
      geoDistance(c, view.center) < Math.PI / 2 - 0.01;
    const hit: Hit = { lines: [] };

    if (stations) {
      let best = tolerance + 2;
      for (const s of this.data.stations) {
        if (!stations(s) || !visible(s.coordinates)) continue;
        const p = projection(s.coordinates);
        if (!p) continue;
        const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
        if (d < best) {
          best = d;
          hit.station = s;
        }
      }
    }

    const centre = projection.invert?.(point);
    if (!centre || !Number.isFinite(centre[0]) || !visible(centre)) return hit;
    // Search radius in degrees: how far `tolerance` pixels reach on the
    // ground around the pointer, which grows towards the globe's edge.
    let radius = 0;
    for (const [dx, dy] of [
      [tolerance, 0],
      [-tolerance, 0],
      [0, tolerance],
      [0, -tolerance],
    ] as const) {
      const q = projection.invert?.([point[0] + dx, point[1] + dy]);
      radius = Math.max(
        radius,
        q && Number.isFinite(q[0])
          ? geoDistance(centre, q) / DEG
          : (4 * tolerance) / view.pixelsPerDegree,
      );
    }
    const kx = Math.max(0.05, Math.cos(centre[1] * DEG));
    const x0 = Math.floor((centre[0] - radius / kx) / CELL);
    const x1 = Math.floor((centre[0] + radius / kx) / CELL);
    const y0 = Math.floor((centre[1] - radius) / CELL);
    const y1 = Math.floor((centre[1] + radius) / CELL);

    const nearest = new Map<number, { distance: number; km: number }>();
    const seen = new Set<number>();
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const list = this.cells.get(cellKey(x, y));
        if (!list) continue;
        for (let k = 0; k < list.length; k += 2) {
          const lineIndex = list[k]!;
          const i = list[k + 1]!;
          const id = lineIndex * 1_000_000 + i;
          if (seen.has(id)) continue;
          seen.add(id);
          const line = this.data.lines[lineIndex]!;
          const points = geometry(line);
          const a = points[i - 1]!;
          const b = points[i]!;
          if (!visible(a) || !visible(b)) continue;
          const pa = projection(a);
          const pb = projection(b);
          if (!pa || !pb) continue;
          const [distance, t] = toSegment(point, pa, pb);
          if (distance > tolerance) continue;
          const previous = nearest.get(lineIndex);
          if (!previous || distance < previous.distance) {
            const distances = along(line);
            nearest.set(lineIndex, {
              distance,
              km: distances[i - 1]! + t * (distances[i]! - distances[i - 1]!),
            });
          }
        }
      }

    const lines = [...nearest].map(([index, { distance, km }]) => ({
      line: this.data.lines[index]!,
      distance,
      km,
    }));
    const closest = Math.min(...lines.map((l) => l.distance));
    const here = (l: LineHit) => l.distance <= closest + SAME_PLACE;
    lines.sort(
      (a, b) =>
        Number(here(b)) - Number(here(a)) ||
        (here(a) ? z(b.line) - z(a.line) : 0) ||
        a.distance - b.distance,
    );
    hit.lines = lines;
    return hit;
  }
}

function cellKey(x: number, y: number): number {
  return (x + 2000) * 4000 + (y + 2000);
}

/** Distance from p to segment ab, and the position t (0–1) along it. */
function toSegment(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): [number, number] {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length2 = dx * dx + dy * dy;
  const t =
    length2 > 0
      ? Math.max(
          0,
          Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2),
        )
      : 0;
  return [Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]), t];
}

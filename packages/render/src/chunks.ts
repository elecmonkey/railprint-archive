import { geoDistance } from 'd3-geo';
import type { View } from './projection.ts';

const DEG = Math.PI / 180;

/** Points per chunk; neighbouring chunks share their end point. */
const CHUNK_SIZE = 64;

/**
 * A short run of a line with a circle on the sphere around it, so drawing
 * can skip the parts that are off screen without projecting them.
 */
export interface Chunk {
  points: [number, number][];
  center: [number, number];
  /** `center` as a unit vector, for cheap angle tests. */
  vector: Vector;
  /** Angular radius of the circle, in radians. */
  radius: number;
}

export function chunk(points: [number, number][]): Chunk[] {
  const chunks: Chunk[] = [];
  for (let start = 0; start < points.length - 1; start += CHUNK_SIZE - 1) {
    const part = points.slice(start, start + CHUNK_SIZE);
    let [west, south, east, north] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [lon, lat] of part) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
    const center: [number, number] = [(west + east) / 2, (south + north) / 2];
    let radius = 0;
    for (const p of part) radius = Math.max(radius, geoDistance(center, p));
    chunks.push({ points: part, center, vector: unitVector(center), radius });
  }
  return chunks;
}

/** Room around the viewport for line widths and labels, in CSS pixels. */
const MARGIN = 16;

/**
 * Angular radius around the view centre that covers the whole viewport, or
 * the visible hemisphere when the globe's edge is on screen.
 */
export function viewRadius(view: View, width: number, height: number): number {
  const globe = view.pixelsPerDegree / DEG;
  const corner = Math.hypot(width / 2, height / 2) + MARGIN;
  return corner >= globe ? Math.PI / 2 : Math.asin(corner / globe);
}

/** A point on the sphere as a unit vector. */
export type Vector = [number, number, number];

export function unitVector([lon, lat]: [number, number]): Vector {
  const cosLat = Math.cos(lat * DEG);
  return [
    cosLat * Math.cos(lon * DEG),
    cosLat * Math.sin(lon * DEG),
    Math.sin(lat * DEG),
  ];
}

/** Cosine of the angle between two unit vectors. */
export const cosAngle = (a: Vector, b: Vector) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Whether the chunk comes within `radius` of the unit vector `center`. */
export function chunkVisible(
  c: Chunk,
  center: Vector,
  radius: number,
): boolean {
  const reach = radius + c.radius;
  return reach >= Math.PI || cosAngle(c.vector, center) > Math.cos(reach);
}

import { haversine } from './geo.ts';
import type { RailNetwork } from './network.ts';

const CELL_DEGREES = 0.01;

/** Grid index over the nodes that lie on the track graph. */
export class TrackNodeIndex {
  private readonly cells = new Map<number, number[]>();
  private readonly network: RailNetwork;

  constructor(network: RailNetwork) {
    this.network = network;
    const { adjOffset, lon, lat } = network;
    for (let n = 0; n < lon.length; n++) {
      if (adjOffset[n + 1] === adjOffset[n]) continue;
      const key = cellKey(cell(lon[n]!), cell(lat[n]!));
      let bucket = this.cells.get(key);
      if (!bucket) this.cells.set(key, (bucket = []));
      bucket.push(n);
    }
  }

  /** Track nodes within `radiusM` of a point, nearest first. */
  within(
    lon: number,
    lat: number,
    radiusM: number,
  ): { node: number; distance: number }[] {
    const dLat = radiusM / 111_320;
    const dLon = dLat / Math.max(0.1, Math.cos((lat * Math.PI) / 180));
    const out: { node: number; distance: number }[] = [];
    for (let cx = cell(lon - dLon); cx <= cell(lon + dLon); cx++) {
      for (let cy = cell(lat - dLat); cy <= cell(lat + dLat); cy++) {
        for (const n of this.cells.get(cellKey(cx, cy)) ?? []) {
          const distance = haversine(
            lon,
            lat,
            this.network.lon[n]!,
            this.network.lat[n]!,
          );
          if (distance <= radiusM) out.push({ node: n, distance });
        }
      }
    }
    return out.sort((a, b) => a.distance - b.distance);
  }
}

const cell = (degrees: number) => Math.floor(degrees / CELL_DEGREES);
// Longitudes and latitudes stay well inside ±36000 cells.
const cellKey = (cx: number, cy: number) =>
  (cx + 40_000) * 100_000 + (cy + 40_000);

import type { Ring } from '@railprint/basemap';

/** An equirectangular grid: `width` × `height` cells over [west, south, east, north]. */
export interface Grid {
  width: number;
  height: number;
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Vertical samples per cell; horizontal coverage is computed exactly. */
const SUBROWS = 4;

/**
 * Fraction of each cell covered by `rings` under the even-odd rule, row 0 at
 * the north edge. Scanline fill with exact horizontal span coverage.
 */
export function rasterizeCoverage(
  rings: readonly Ring[],
  grid: Grid,
): Float32Array {
  const { width, height, west, south, east, north } = grid;
  const sx = width / (east - west);
  const sy = height / (north - south);
  // Edges in grid units, y growing southwards.
  const edges: { x0: number; y0: number; x1: number; y1: number }[] = [];
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const y0 = (north - a[1]) * sy;
      const y1 = (north - b[1]) * sy;
      if (y0 === y1) continue;
      const [top, bottom] = y0 < y1 ? [a, b] : [b, a];
      edges.push({
        x0: (top[0] - west) * sx,
        y0: (north - top[1]) * sy,
        x1: (bottom[0] - west) * sx,
        y1: (north - bottom[1]) * sy,
      });
    }
  }
  edges.sort((p, q) => p.y0 - q.y0);

  const out = new Float32Array(width * height);
  let next = 0;
  let active: typeof edges = [];
  const xs: number[] = [];
  for (let row = 0; row < height; row++) {
    for (let s = 0; s < SUBROWS; s++) {
      const y = row + (s + 0.5) / SUBROWS;
      while (next < edges.length && edges[next]!.y0 <= y)
        active.push(edges[next++]!);
      active = active.filter((e) => e.y1 > y);
      xs.length = 0;
      for (const e of active) {
        if (e.y0 > y) continue;
        xs.push(e.x0 + ((y - e.y0) / (e.y1 - e.y0)) * (e.x1 - e.x0));
      }
      xs.sort((a, b) => a - b);
      const base = row * width;
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const from = Math.max(0, xs[i]!);
        const to = Math.min(width, xs[i + 1]!);
        if (to <= from) continue;
        const c0 = Math.floor(from);
        const c1 = Math.min(width - 1, Math.floor(to));
        if (c0 === c1) {
          out[base + c0]! += (to - from) / SUBROWS;
          continue;
        }
        out[base + c0]! += (c0 + 1 - from) / SUBROWS;
        for (let c = c0 + 1; c < c1; c++) out[base + c]! += 1 / SUBROWS;
        if (c1 < width) out[base + c1]! += (to - c1) / SUBROWS;
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i]!);
  return out;
}

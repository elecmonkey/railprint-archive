import h5wasm from 'h5wasm/node';
import type { Grid } from './raster.ts';

/**
 * ETOPO 2022 grids (60″ or 30″): cell-centred, rows south to north, columns
 * from 180°W. The resolution is read from the file.
 */
const ETOPO_FILL = -99999;

/**
 * Mean elevation (metres) of each grid cell, row 0 at the north edge. Grid
 * cells must be whole multiples of the ETOPO cell and aligned to it.
 */
export async function readElevation(
  etopoFile: string,
  grid: Grid,
): Promise<Float32Array> {
  await h5wasm.ready;
  const file = new h5wasm.File(etopoFile, 'r');
  try {
    const z = file.get('z') as InstanceType<typeof h5wasm.Dataset>;
    const cellsPerDegree = z.shape![1]! / 360;
    const block = ((grid.east - grid.west) / grid.width) * cellsPerDegree;
    if (Math.abs(block - Math.round(block)) > 1e-9 || Math.round(block) < 1) {
      throw new Error(
        `Grid cell must be a whole number of ETOPO cells (got ${block})`,
      );
    }
    const b = Math.round(block);
    const col0 = Math.round((grid.west + 180) * cellsPerDegree);
    const rowNorth = Math.round((grid.north + 90) * cellsPerDegree);
    const out = new Float32Array(grid.width * grid.height);
    const bandRows = Math.max(1, Math.floor(2048 / b));
    for (let y0 = 0; y0 < grid.height; y0 += bandRows) {
      const y1 = Math.min(grid.height, y0 + bandRows);
      // Source rows for output rows y0..y1 (north to south) are descending.
      const srcTop = rowNorth - y1 * b;
      const srcBottom = rowNorth - y0 * b;
      const width = grid.width * b;
      const band = z.slice([
        [srcTop, srcBottom],
        [col0, col0 + width],
      ]) as Float32Array;
      for (let y = y0; y < y1; y++) {
        for (let x = 0; x < grid.width; x++) {
          let sum = 0;
          let n = 0;
          for (let dy = 0; dy < b; dy++) {
            // Output row y spans source rows rowNorth-(y+1)b .. rowNorth-yb.
            const srcRow = rowNorth - (y + 1) * b + dy - srcTop;
            const base = srcRow * width + x * b;
            for (let dx = 0; dx < b; dx++) {
              const v = band[base + dx]!;
              if (v > ETOPO_FILL) {
                sum += v;
                n++;
              }
            }
          }
          out[y * grid.width + x] = n ? sum / n : 0;
        }
      }
    }
    return out;
  } finally {
    file.close();
  }
}

const METRES_PER_DEGREE = 111_320;

/**
 * Hillshade (Horn's method, GDAL conventions) in 0–1; flat ground gives
 * cos(zenith). `exaggeration` scales heights, which coarse grids need.
 */
export function hillshade(
  elevation: Float32Array,
  grid: Grid,
  exaggeration: number,
  azimuthDeg = 315,
  altitudeDeg = 45,
): Float32Array {
  const { width, height } = grid;
  const cell = (grid.east - grid.west) / width;
  const zenith = ((90 - altitudeDeg) * Math.PI) / 180;
  const azimuth = (((360 - azimuthDeg + 90) % 360) * Math.PI) / 180;
  const cosZ = Math.cos(zenith);
  const sinZ = Math.sin(zenith);
  const out = new Float32Array(width * height);
  const at = (x: number, y: number) =>
    elevation[
      Math.min(height - 1, Math.max(0, y)) * width +
        Math.min(width - 1, Math.max(0, x))
    ]!;
  for (let y = 0; y < height; y++) {
    const lat = grid.north - (y + 0.5) * cell;
    const ns = cell * METRES_PER_DEGREE;
    const ew = ns * Math.max(0.05, Math.cos((lat * Math.PI) / 180));
    for (let x = 0; x < width; x++) {
      const a = at(x - 1, y - 1);
      const b = at(x, y - 1);
      const c = at(x + 1, y - 1);
      const d = at(x - 1, y);
      const f = at(x + 1, y);
      const g = at(x - 1, y + 1);
      const h = at(x, y + 1);
      const i = at(x + 1, y + 1);
      const dzdx = (c + 2 * f + i - (a + 2 * d + g)) / (8 * ew);
      const dzdy = (g + 2 * h + i - (a + 2 * b + c)) / (8 * ns);
      const slope = Math.atan(exaggeration * Math.hypot(dzdx, dzdy));
      const aspect = Math.atan2(dzdy, -dzdx);
      const shade =
        cosZ * Math.cos(slope) +
        sinZ * Math.sin(slope) * Math.cos(azimuth - aspect);
      out[y * width + x] = Math.max(0, Math.min(1, shade));
    }
  }
  return out;
}

/** Elevation that maps to the top of the green channel. */
export const MAX_ELEVATION_M = 7000;

/**
 * Pack terrain into RGB: R hillshade (0–255), G sqrt(elevation / 7000 m) on
 * land, B land fraction (0 water, 255 land; partial along coasts).
 */
export function packTerrain(
  shade: Float32Array,
  elevation: Float32Array,
  land: Float32Array,
): Uint8Array {
  const rgb = new Uint8Array(shade.length * 3);
  for (let i = 0; i < shade.length; i++) {
    rgb[i * 3] = Math.round(shade[i]! * 255);
    const e = Math.max(0, Math.min(MAX_ELEVATION_M, elevation[i]!));
    rgb[i * 3 + 1] = Math.round(Math.sqrt(e / MAX_ELEVATION_M) * 255);
    rgb[i * 3 + 2] = Math.round(land[i]! * 255);
  }
  return rgb;
}

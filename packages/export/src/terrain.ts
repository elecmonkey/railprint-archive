import type { GeoProjection } from 'd3-geo';
import type { TerrainGrid } from '@railprint/render';
import type { Theme } from '@railprint/style';

/** A decoded terrain texture: RGB(A) bytes in rows from the north. */
export interface TerrainRaster {
  grid: TerrainGrid;
  data: Uint8Array;
  channels: number;
}

/** Hillshade of flat ground, as the texture encodes it (see packages/basemap). */
const FLAT_SHADE = Math.cos(Math.PI / 4);
/** Regional textures fade in over this many degrees inside their edges. */
const FADE_DEG = 0.5;

function rgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`Expected #rrggbb, got ${color}`);
  return [
    parseInt(m[1]!, 16) / 255,
    parseInt(m[2]!, 16) / 255,
    parseInt(m[3]!, 16) / 255,
  ];
}

/** Bilinear sample of the three channels at [lon, lat], each 0–1. */
function sample(
  t: TerrainRaster,
  lon: number,
  lat: number,
  out: Float64Array,
): void {
  const { width, height, west, east, south, north } = t.grid;
  const x = Math.min(
    width - 1,
    Math.max(0, ((lon - west) / (east - west)) * width - 0.5),
  );
  const y = Math.min(
    height - 1,
    Math.max(0, ((north - lat) / (north - south)) * height - 0.5),
  );
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const c = t.channels;
  for (let ch = 0; ch < 3; ch++) {
    const a = t.data[(y0 * width + x0) * c + ch]!;
    const b = t.data[(y0 * width + x1) * c + ch]!;
    const d = t.data[(y1 * width + x0) * c + ch]!;
    const e = t.data[(y1 * width + x1) * c + ch]!;
    out[ch] =
      ((a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy) / 255;
  }
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The terrain layer as RGBA pixels, already blended over the background at
 * the theme's terrain opacity: the CPU twin of the web app's terrain shader
 * (packages/render/src/terrain.ts) for a flat projection.
 */
export function paintTerrain(
  projection: GeoProjection,
  width: number,
  height: number,
  ratio: number,
  global: TerrainRaster,
  regional: TerrainRaster[],
  theme: Theme,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const sea = rgb(theme.sea);
  const low = rgb(theme.terrain.landLow);
  const high = rgb(theme.terrain.landHigh);
  const background = rgb(theme.background);
  const { shade, seaShade, opacity } = theme.terrain;
  const t = new Float64Array(3);
  const r = new Float64Array(3);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const lonlat = projection.invert!([
        (px + 0.5) / ratio,
        (py + 0.5) / ratio,
      ]);
      const i = (py * width + px) * 4;
      let color = background;
      if (lonlat) {
        const [lon, lat] = lonlat;
        sample(global, lon, lat, t);
        for (const tex of regional) {
          const g = tex.grid;
          const edge = Math.min(
            lon - g.west,
            g.east - lon,
            lat - g.south,
            g.north - lat,
          );
          const w = Math.min(1, Math.max(0, edge / FADE_DEG));
          if (w <= 0) continue;
          sample(tex, lon, lat, r);
          for (let ch = 0; ch < 3; ch++) t[ch] = t[ch]! * (1 - w) + r[ch]! * w;
        }
        const relief = t[0]! / FLAT_SHADE;
        const elevation = t[1]! * t[1]!;
        const land = t[2]!;
        const ramp = smoothstep(0, 0.7, elevation);
        const groundShade = 1 + (relief - 1) * shade;
        const seaFactor = 1 + (relief - 1) * seaShade;
        const terrain: [number, number, number] = [0, 0, 0];
        for (let ch = 0; ch < 3; ch++) {
          const ground =
            (low[ch]! + (high[ch]! - low[ch]!) * ramp) * groundShade;
          const water = sea[ch]! * seaFactor;
          terrain[ch] = water + (ground - water) * land;
        }
        color = terrain.map(
          (v, ch) => background[ch]! * (1 - opacity) + v * opacity,
        ) as [number, number, number];
      }
      pixels[i] = Math.round(color[0] * 255);
      pixels[i + 1] = Math.round(color[1] * 255);
      pixels[i + 2] = Math.round(color[2] * 255);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

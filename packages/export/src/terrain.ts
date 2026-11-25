import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { GeoProjection } from 'd3-geo';
import {
  TILE_LEVELS,
  TILE_SIZE,
  tileKey,
  tilesInBox,
  type TileIndex,
} from '@railprint/render';
import type { Theme } from '@railprint/style';
import sharp from 'sharp';

/** Hillshade of flat ground, as the tiles encode it; also the open sea's. */
const FLAT_SHADE = Math.cos(Math.PI / 4);

/** Texel values of open sea, where no tile exists. */
const SEA = [Math.round(FLAT_SHADE * 255), 0, 0];

/** The terrain tiles of one level, decoded, sampled by longitude and latitude. */
export class TileSampler {
  private readonly tiles = new Map<
    string,
    { data: Buffer; channels: number }
  >();
  private readonly level: number;
  private readonly cell: number;

  private constructor(level: number) {
    this.level = level;
    this.cell = TILE_LEVELS[level]! / 3600;
  }

  /** Loads the tiles of `level` that overlap `box` from `dir` (packages/tiles/dist). */
  static async load(
    dir: string,
    level: number,
    box: [number, number, number, number],
  ): Promise<TileSampler> {
    const index = JSON.parse(
      await readFile(join(dir, 'tiles.json'), 'utf8'),
    ) as TileIndex;
    const present = new Set(index.levels[level]!.tiles);
    const sampler = new TileSampler(level);
    await Promise.all(
      tilesInBox(level, box)
        .filter(([x, y]) => present.has(`${x},${y}`))
        .map(async ([x, y]) => {
          const key = tileKey(level, x, y);
          const { data, info } = await sharp(join(dir, `${key}.webp`))
            .raw()
            .toBuffer({ resolveWithObject: true });
          sampler.tiles.set(key, { data, channels: info.channels });
        }),
    );
    return sampler;
  }

  private texel(ix: number, iy: number, ch: number): number {
    const tile = this.tiles.get(
      tileKey(
        this.level,
        Math.floor(ix / TILE_SIZE),
        Math.floor(iy / TILE_SIZE),
      ),
    );
    if (!tile) return SEA[ch]!;
    const px =
      ((iy % TILE_SIZE) * TILE_SIZE + (ix % TILE_SIZE)) * tile.channels;
    return tile.data[px + ch]!;
  }

  /** Bilinear sample of the three channels at [lon, lat], each 0–1. */
  sample(lon: number, lat: number, out: Float64Array): void {
    const gx = Math.max(0, (lon + 180) / this.cell - 0.5);
    const gy = Math.max(0, (90 - lat) / this.cell - 0.5);
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const fx = gx - x0;
    const fy = gy - y0;
    for (let ch = 0; ch < 3; ch++) {
      const a = this.texel(x0, y0, ch);
      const b = this.texel(x0 + 1, y0, ch);
      const c = this.texel(x0, y0 + 1, ch);
      const d = this.texel(x0 + 1, y0 + 1, ch);
      out[ch] =
        ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) /
        255;
    }
  }
}

function rgb(color: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color);
  if (!m) throw new Error(`Expected #rrggbb, got ${color}`);
  return [
    parseInt(m[1]!, 16) / 255,
    parseInt(m[2]!, 16) / 255,
    parseInt(m[3]!, 16) / 255,
  ];
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
  tiles: TileSampler,
  theme: Theme,
): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(width * height * 4);
  const sea = rgb(theme.sea);
  const low = rgb(theme.terrain.landLow);
  const high = rgb(theme.terrain.landHigh);
  const background = rgb(theme.background);
  const { shade, opacity } = theme.terrain;
  const t = new Float64Array(3);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const lonlat = projection.invert!([
        (px + 0.5) / ratio,
        (py + 0.5) / ratio,
      ]);
      const i = (py * width + px) * 4;
      let color = background;
      if (lonlat) {
        tiles.sample(lonlat[0], lonlat[1], t);
        const relief = t[0]! / FLAT_SHADE;
        const elevation = t[1]! * t[1]!;
        const land = t[2]!;
        const ramp = smoothstep(0, 0.7, elevation);
        const groundShade = 1 + (relief - 1) * shade;
        color = [0, 1, 2].map((ch) => {
          const ground =
            (low[ch]! + (high[ch]! - low[ch]!) * ramp) * groundShade;
          const terrain = sea[ch]! + (ground - sea[ch]!) * land;
          return background[ch]! * (1 - opacity) + terrain * opacity;
        }) as [number, number, number];
      }
      pixels[i] = Math.round(color[0] * 255);
      pixels[i + 1] = Math.round(color[1] * 255);
      pixels[i + 2] = Math.round(color[2] * 255);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

/** [west, south, east, north] the image shows, from its edges. */
export function frameBox(
  projection: GeoProjection,
  width: number,
  height: number,
): [number, number, number, number] {
  const box: [number, number, number, number] = [180, 90, -180, -90];
  const steps = 32;
  for (let i = 0; i <= steps; i++)
    for (const [x, y] of [
      [(width * i) / steps, 0],
      [(width * i) / steps, height],
      [0, (height * i) / steps],
      [width, (height * i) / steps],
    ] as const) {
      const p = projection.invert!([x, y]);
      if (!p) continue;
      box[0] = Math.min(box[0], p[0]);
      box[1] = Math.min(box[1], p[1]);
      box[2] = Math.max(box[2], p[0]);
      box[3] = Math.max(box[3], p[1]);
    }
  return box;
}

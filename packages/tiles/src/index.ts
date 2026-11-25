import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readShapefile, unzip, type Ring } from '@railprint/basemap';
import type { DataLayout } from '@railprint/layout';
import {
  TILE_LEVELS,
  TILE_SIZE,
  tileBounds,
  tileCount,
  type TileIndex,
} from '@railprint/render';
import {
  loadManifest,
  readLock,
  sourceStatus,
  type SourceDefinition,
} from '@railprint/sources';
import sharp from 'sharp';
import { rasterizeCoverage, type Grid } from './raster.ts';
import { hillshade, packTerrain, readElevation } from './terrain.ts';

export const SOURCES = {
  land: 'ne-10m-land',
  lakes: 'ne-10m-lakes',
  coarse: 'etopo-2022-60s',
  fine: 'etopo-2022-30s',
} as const;

/** Hillshade height exaggeration at 30″; coarser cells need more. */
const EXAGGERATION_30S = 3;

/** Shade of flat ground: sea pixels get it, so the sea draws as one colour. */
const FLAT_SHADE = Math.cos(Math.PI / 4);

async function sourcePath(layout: DataLayout, id: string): Promise<string> {
  const manifest = await loadManifest(layout.sourcesManifest);
  const source = manifest.sources.find((s) => s.id === id) as SourceDefinition;
  const status = await sourceStatus(
    source,
    layout.sources,
    await readLock(layout.sourcesLock),
  );
  if (status.state !== 'ok')
    throw new Error(
      `${id} is ${status.state}; run \`pnpm sources fetch ${id}\``,
    );
  return join(layout.sources, source.path);
}

interface Shapes {
  rings: Ring[];
  /** [west, south, east, north] of each ring. */
  boxes: [number, number, number, number][];
}

async function loadRings(zip: string, dir: string, base: string) {
  await unzip(zip, dir, [`${base}.shp`, `${base}.dbf`]);
  const shapes = readShapefile(
    await readFile(join(dir, `${base}.shp`)),
    await readFile(join(dir, `${base}.dbf`)),
  );
  const rings = shapes.records.flatMap((r) => r.parts);
  const boxes = rings.map((ring) => {
    const box: [number, number, number, number] = [180, 90, -180, -90];
    for (const [lon, lat] of ring) {
      box[0] = Math.min(box[0], lon);
      box[1] = Math.min(box[1], lat);
      box[2] = Math.max(box[2], lon);
      box[3] = Math.max(box[3], lat);
    }
    return box;
  });
  return { rings, boxes } satisfies Shapes;
}

/** Rings whose box meets [west, south, east, north]. */
function ringsIn(shapes: Shapes, [w, s, e, n]: number[]): Ring[] {
  return shapes.rings.filter((_, i) => {
    const b = shapes.boxes[i]!;
    return b[0] < e! && b[2] > w! && b[1] < n! && b[3] > s!;
  });
}

/**
 * One tile as packed RGB (see basemap's packTerrain), or undefined when it
 * holds no land. Elevation is read with a one-cell margin, where the globe
 * allows, so hillshade matches across tile edges.
 */
async function renderTile(
  etopo: string,
  land: Shapes,
  lakes: Shapes,
  level: number,
  x: number,
  y: number,
): Promise<Uint8Array | undefined> {
  const [west, south, east, north] = tileBounds(level, x, y);
  const grid: Grid = {
    width: TILE_SIZE,
    height: TILE_SIZE,
    west,
    south,
    east,
    north,
  };
  const landRings = ringsIn(land, [west, south, east, north]);
  if (!landRings.length) return undefined;
  const cover = rasterizeCoverage(landRings, grid);
  const lakeRings = ringsIn(lakes, [west, south, east, north]);
  if (lakeRings.length) {
    const lake = rasterizeCoverage(lakeRings, grid);
    for (let i = 0; i < cover.length; i++)
      cover[i] = Math.max(0, cover[i]! - lake[i]!);
  }
  if (!cover.some((v) => v > 0)) return undefined;

  const cell = TILE_LEVELS[level]! / 3600;
  const outer: Grid = {
    west: Math.max(-180, west - cell),
    south: Math.max(-90, south - cell),
    east: Math.min(180, east + cell),
    north: Math.min(90, north + cell),
    width: 0,
    height: 0,
  };
  outer.width = Math.round((outer.east - outer.west) / cell);
  outer.height = Math.round((outer.north - outer.south) / cell);
  const elevationOuter = await readElevation(etopo, outer);
  const exaggeration =
    EXAGGERATION_30S * Math.sqrt(TILE_LEVELS[level]! / TILE_LEVELS.at(-1)!);
  const shadeOuter = hillshade(elevationOuter, outer, exaggeration);
  const ox = Math.round((west - outer.west) / cell);
  const oy = Math.round((outer.north - north) / cell);
  const shade = new Float32Array(TILE_SIZE * TILE_SIZE);
  const elevation = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let row = 0; row < TILE_SIZE; row++)
    for (let col = 0; col < TILE_SIZE; col++) {
      const i = row * TILE_SIZE + col;
      const o = (row + oy) * outer.width + col + ox;
      const sea = cover[i] === 0;
      shade[i] = sea ? FLAT_SHADE : shadeOuter[o]!;
      elevation[i] = sea ? 0 : elevationOuter[o]!;
    }
  return packTerrain(shade, elevation, cover);
}

export interface TilesOptions {
  /** Directory the tiles and tiles.json are written to. */
  out: string;
  /** Levels to build, default all. */
  levels?: number[];
  log: (line: string) => void;
}

/** Builds every tile with land, and tiles.json listing them. */
export async function buildTiles(
  layout: DataLayout,
  options: TilesOptions,
): Promise<TileIndex> {
  const cache = join(layout.cache, 'basemap');
  const land = await loadRings(
    await sourcePath(layout, SOURCES.land),
    join(cache, 'land'),
    'ne_10m_land',
  );
  const lakes = await loadRings(
    await sourcePath(layout, SOURCES.lakes),
    join(cache, 'lakes'),
    'ne_10m_lakes',
  );
  const levels = options.levels ?? TILE_LEVELS.map((_, i) => i);
  const indexFile = join(options.out, 'tiles.json');
  // Per-tile hashes, to merge a partial build; not part of the site.
  const hashesFile = join(layout.cache, 'tiles-hashes.json');
  // Building some levels keeps the others of an earlier build.
  const readJson = <T>(file: string) =>
    options.levels
      ? readFile(file, 'utf8')
          .then((text) => JSON.parse(text) as T)
          .catch(() => undefined)
      : Promise.resolve(undefined);
  const previous = await readJson<TileIndex>(indexFile);
  /** sha256 of each tile's pixels, by `level/x/y`. */
  const hashes: Record<string, string> = Object.fromEntries(
    Object.entries(
      (await readJson<Record<string, string>>(hashesFile)) ?? {},
    ).filter(([key]) => !levels.includes(Number(key.split('/')[0]))),
  );
  const index: TileIndex = {
    hash: '',
    tileSize: TILE_SIZE,
    levels: TILE_LEVELS.map((cellArcsec, level) => ({
      cellArcsec,
      tiles: levels.includes(level)
        ? []
        : (previous?.levels[level]?.tiles ?? []),
    })),
  };
  // Encoding runs in libvips threads while the next tiles are computed.
  const limit = availableParallelism();
  const pending = new Set<Promise<void>>();
  for (const level of levels) {
    const started = Date.now();
    const etopo = await sourcePath(
      layout,
      TILE_LEVELS[level] === 30 ? SOURCES.fine : SOURCES.coarse,
    );
    const [columns, rows] = tileCount(level);
    let bytes = 0;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < columns; x++) {
        const rgb = await renderTile(etopo, land, lakes, level, x, y);
        if (!rgb) continue;
        index.levels[level]!.tiles.push(`${x},${y}`);
        hashes[`${level}/${x}/${y}`] = createHash('sha256')
          .update(rgb)
          .digest('hex');
        const file = join(options.out, String(level), String(x), `${y}.webp`);
        const job = (async () => {
          // Lossless: the channels are data, not colours.
          const webp = await sharp(Buffer.from(rgb), {
            raw: { width: TILE_SIZE, height: TILE_SIZE, channels: 3 },
          })
            .webp({ lossless: true, effort: 6 })
            .toBuffer();
          await mkdir(dirname(file), { recursive: true });
          await writeFile(file, webp);
          bytes += webp.length;
        })();
        pending.add(job);
        void job.finally(() => pending.delete(job));
        if (pending.size >= limit) await Promise.race(pending);
      }
    await Promise.all(pending);
    options.log(
      `level ${level} (${TILE_LEVELS[level]}″): ${index.levels[level]!.tiles.length} tiles, ${(bytes / 1048576).toFixed(0)} MiB, ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  }
  // The hash covers the pixels, not the encoded files, so builds on other
  // machines that compute the same terrain agree on it.
  const all = createHash('sha256').update(`${TILE_SIZE}\n`);
  for (const key of Object.keys(hashes).sort())
    all.update(`${key} ${hashes[key]}\n`);
  index.hash = all.digest('hex');
  await mkdir(options.out, { recursive: true });
  await mkdir(dirname(hashesFile), { recursive: true });
  await writeFile(hashesFile, `${JSON.stringify(hashes)}\n`);
  await writeFile(`${indexFile}.tmp`, `${JSON.stringify(index)}\n`);
  await rename(`${indexFile}.tmp`, indexFile);
  // Headers for the tiles site: cross-origin reads, long caching of tiles.
  await copyFile(
    fileURLToPath(new URL('../edgeone.json', import.meta.url)),
    join(options.out, 'edgeone.json'),
  );
  return index;
}

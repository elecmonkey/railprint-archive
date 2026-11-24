import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DataLayout } from '@railprint/layout';
import {
  loadManifest,
  readLock,
  sourceStatus,
  type SourceDefinition,
} from '@railprint/sources';
import sharp from 'sharp';
import { rasterizeCoverage, type Grid } from './raster.ts';
import { readShapefile, type Ring } from './shapefile.ts';
import {
  hillshade,
  MAX_ELEVATION_M,
  packTerrain,
  readElevation,
} from './terrain.ts';
import { featureCollection, toLines } from './vector.ts';
import { unzip } from './zip.ts';

/**
 * Where the basemap is written: inside this package, committed with it. The
 * basemap depends only on Natural Earth and ETOPO, which rarely change, so it
 * is built once and reused rather than rebuilt with the railway data.
 */
export const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

export interface TerrainSpec {
  name: string;
  /** ETOPO source the texture is built from. */
  elevation: keyof typeof ELEVATION;
  grid: Grid;
  /** Height exaggeration for the hillshade; coarser grids need more. */
  exaggeration: number;
}

const ELEVATION = {
  '60s': 'etopo-2022-60s',
  '30s': 'etopo-2022-30s',
} as const;

/**
 * A global texture small enough for any WebGL device, and sharper ones for
 * East Asia at ETOPO's full 30″ resolution: China, Korea and Japan, split in
 * two so each stays well within common texture limits. They overlap by one
 * degree, which the renderer fades across.
 */
export const TERRAIN: TerrainSpec[] = [
  {
    name: 'global',
    elevation: '60s',
    grid: {
      width: 3600,
      height: 1800,
      west: -180,
      south: -90,
      east: 180,
      north: 90,
    },
    exaggeration: 10,
  },
  {
    name: 'east-asia-west',
    elevation: '30s',
    grid: {
      width: 4500,
      height: 4560,
      west: 73,
      south: 17,
      east: 110.5,
      north: 55,
    },
    exaggeration: 3,
  },
  {
    name: 'east-asia-east',
    elevation: '30s',
    grid: {
      width: 4500,
      height: 4560,
      west: 109.5,
      south: 17,
      east: 147,
      north: 55,
    },
    exaggeration: 3,
  },
];

const SOURCES = {
  land: 'ne-10m-land',
  lakes: 'ne-10m-lakes',
  rivers: 'ne-10m-rivers-lake-centerlines',
  ...Object.fromEntries(
    Object.entries(ELEVATION).map(([k, id]) => [`etopo${k}`, id]),
  ),
} as Record<string, string>;

export interface TerrainIndex {
  encoding: {
    r: string;
    g: string;
    b: string;
    flatShade: number;
    maxElevationM: number;
  };
  textures: { name: string; file: string; grid: Grid }[];
}

async function sourcePaths(
  layout: DataLayout,
): Promise<Record<string, string>> {
  const manifest = await loadManifest(layout.sourcesManifest);
  const lock = await readLock(layout.sourcesLock);
  const out: Record<string, string> = {};
  for (const [key, id] of Object.entries(SOURCES)) {
    const source = manifest.sources.find(
      (s) => s.id === id,
    ) as SourceDefinition;
    const status = await sourceStatus(source, layout.sources, lock);
    if (status.state !== 'ok')
      throw new Error(
        `${id} is ${status.state}; run \`pnpm sources fetch ${id}\``,
      );
    out[key] = join(layout.sources, source.path);
  }
  return out;
}

async function loadShapes(zip: string, dir: string, base: string) {
  await unzip(zip, dir, [`${base}.shp`, `${base}.dbf`]);
  return readShapefile(
    await readFile(join(dir, `${base}.shp`)),
    await readFile(join(dir, `${base}.dbf`)),
  );
}

async function atomicWrite(file: string, data: string | Uint8Array) {
  await writeFile(`${file}.tmp`, data);
  await rename(`${file}.tmp`, file);
}

export async function buildBasemap(
  layout: DataLayout,
  log: (line: string) => void,
): Promise<void> {
  const paths = await sourcePaths(layout);
  const cache = join(layout.cache, 'basemap');
  const out = ASSETS_DIR;
  await mkdir(out, { recursive: true });

  const land = await loadShapes(
    paths.land!,
    join(cache, 'land'),
    'ne_10m_land',
  );
  const lakes = await loadShapes(
    paths.lakes!,
    join(cache, 'lakes'),
    'ne_10m_lakes',
  );
  const rivers = await loadShapes(
    paths.rivers!,
    join(cache, 'rivers'),
    'ne_10m_rivers_lake_centerlines',
  );
  const landRings: Ring[] = land.records.flatMap((r) => r.parts);
  const lakeRings: Ring[] = lakes.records.flatMap((r) => r.parts);
  log(
    `land ${land.records.length} records, lakes ${lakes.records.length}, rivers ${rivers.records.length}`,
  );

  const index: TerrainIndex = {
    encoding: {
      r: 'hillshade, 0–255',
      g: `sqrt(elevation / ${MAX_ELEVATION_M} m) on land, 0–255`,
      b: 'land fraction (lakes are water), 0–255',
      flatShade: Math.round(Math.cos(Math.PI / 4) * 255),
      maxElevationM: MAX_ELEVATION_M,
    },
    textures: [],
  };
  for (const spec of TERRAIN) {
    const started = Date.now();
    const elevation = await readElevation(
      paths[`etopo${spec.elevation}`]!,
      spec.grid,
    );
    const shade = hillshade(elevation, spec.grid, spec.exaggeration);
    const landCover = rasterizeCoverage(landRings, spec.grid);
    const lakeCover = rasterizeCoverage(lakeRings, spec.grid);
    for (let i = 0; i < landCover.length; i++)
      landCover[i] = Math.max(0, landCover[i]! - lakeCover[i]!);
    const file = `terrain-${spec.name}.webp`;
    // Lossless: the channels are data, not colours.
    const webp = await sharp(
      Buffer.from(packTerrain(shade, elevation, landCover)),
      {
        raw: { width: spec.grid.width, height: spec.grid.height, channels: 3 },
      },
    )
      .webp({ lossless: true, effort: 6 })
      .toBuffer();
    await atomicWrite(join(out, file), webp);
    index.textures.push({ name: spec.name, file, grid: spec.grid });
    log(
      `${file}: ${spec.grid.width}×${spec.grid.height}, ${(webp.length / 1048576).toFixed(1)} MiB, ${((Date.now() - started) / 1000).toFixed(0)} s`,
    );
  }
  await atomicWrite(
    join(out, 'terrain.json'),
    `${JSON.stringify(index, null, 2)}\n`,
  );

  const riverFeatures = toLines(rivers, (p) => p.featurecla === 'River');
  const lakeFeatures = toLines(lakes, () => true);
  await atomicWrite(
    join(out, 'rivers.geojson'),
    featureCollection(riverFeatures),
  );
  await atomicWrite(
    join(out, 'lakes.geojson'),
    featureCollection(lakeFeatures),
  );
  log(`rivers ${riverFeatures.length}, lakes ${lakeFeatures.length}`);
}

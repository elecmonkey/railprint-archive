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
import { readShapefile } from './shapefile.ts';
import { featureCollection, toLines } from './vector.ts';
import { unzip } from './zip.ts';

/**
 * Where rivers and lakes are written: inside this package, committed with
 * it. They depend only on Natural Earth, which rarely changes, so they are
 * built once and reused rather than rebuilt with the railway data. Terrain
 * comes from packages/tiles.
 */
export const ASSETS_DIR = fileURLToPath(new URL('../assets/', import.meta.url));

const SOURCES: Record<string, string> = {
  lakes: 'ne-10m-lakes',
  rivers: 'ne-10m-rivers-lake-centerlines',
};

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
  log(`lakes ${lakes.records.length}, rivers ${rivers.records.length}`);

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

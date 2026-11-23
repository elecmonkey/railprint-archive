import { join } from 'node:path';
import type { DataLayout } from '@railprint/layout';
import { readLock } from '@railprint/sources';
import { readExtractMeta } from './extract.ts';

/** The railway extract is built from this source. */
export const RAIL_EXTRACT = {
  sourceId: 'osm-china',
  file: 'osm/china-rail.osm.pbf',
} as const;

export const railExtractPath = (layout: DataLayout) =>
  join(layout.cache, RAIL_EXTRACT.file);

/**
 * Return the extract path, failing when it is missing or was built from a
 * different snapshot than the one in the sources lock.
 */
export async function requireFreshRailExtract(
  layout: DataLayout,
): Promise<string> {
  const path = railExtractPath(layout);
  const lock = await readLock(layout.sourcesLock);
  const entry = lock.entries[RAIL_EXTRACT.sourceId];
  if (!entry)
    throw new Error(
      `${RAIL_EXTRACT.sourceId} is not downloaded; run \`pnpm sources fetch\``,
    );
  const meta = await readExtractMeta(path);
  if (!meta) throw new Error('Railway extract missing; run `pnpm osm extract`');
  if (meta.source.sha256 !== entry.sha256) {
    throw new Error(
      'Railway extract is from an older snapshot; run `pnpm osm extract`',
    );
  }
  return path;
}

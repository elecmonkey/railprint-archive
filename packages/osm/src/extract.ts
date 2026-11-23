import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { osmiumVersion, tagsFilter } from './osmium.ts';
import { readPbf, type PbfHeader } from './pbf.ts';

/**
 * Objects kept in the railway extract: all railway-tagged objects (tracks,
 * stations, junctions), railway infrastructure and train route relations, and
 * stop areas (which group station objects under one name). Referenced nodes
 * and members are kept by osmium automatically.
 */
export const RAIL_FILTER = [
  'nwr/railway',
  'r/route=railway,train',
  'r/public_transport=stop_area',
] as const;

/** Sidecar written next to an extract, recording exactly what produced it. */
export interface ExtractMeta {
  source: { id: string; sha256: string };
  filter: string[];
  osmium: string;
  header: PbfHeader;
  counts: { nodes: number; ways: number; relations: number };
  createdAt: string;
}

export const metaPath = (extract: string) => `${extract}.meta.json`;

export async function extractRail(
  input: string,
  output: string,
  source: ExtractMeta['source'],
): Promise<ExtractMeta> {
  const osmium = await osmiumVersion();
  await mkdir(dirname(output), { recursive: true });
  const temporary = `${output}.tmp.osm.pbf`;
  await tagsFilter(input, RAIL_FILTER, temporary);
  const summary = await readPbf(temporary);
  await rename(temporary, output);
  const meta: ExtractMeta = {
    source,
    filter: [...RAIL_FILTER],
    osmium,
    header: summary.header,
    counts: {
      nodes: summary.nodes,
      ways: summary.ways,
      relations: summary.relations,
    },
    createdAt: new Date().toISOString(),
  };
  await writeFile(metaPath(output), `${JSON.stringify(meta, null, 2)}\n`);
  return meta;
}

export async function readExtractMeta(
  extract: string,
): Promise<ExtractMeta | undefined> {
  try {
    return JSON.parse(await readFile(metaPath(extract), 'utf8')) as ExtractMeta;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

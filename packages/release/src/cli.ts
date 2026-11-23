#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { loadCatalog } from '@railprint/catalog';
import { dataLayout } from '@railprint/layout';
import { loadMapping, loadPaths } from '@railprint/matching';
import { readExtractMeta, requireFreshRailExtract } from '@railprint/osm';
import { loadRailNetwork } from '@railprint/railnet';
import { buildRelease, ReleaseError } from './build.ts';
import { releaseMeta, writeRelease } from './write.ts';

const USAGE = `Usage: railprint-release

Build data/release/ (lines.geojson, stations.geojson, meta.json) from the
confirmed mappings. Every catalog line must be confirmed.
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: { help: { type: 'boolean', short: 'h', default: false } },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const layout = dataLayout();
  const catalog = await loadCatalog(layout.catalog);
  const ids = new Set(catalog.lines.map((l) => l.id));
  const mapping = await loadMapping(layout.mapping, ids);
  const paths = await loadPaths(layout.mapping, ids);
  const extract = await requireFreshRailExtract(layout);
  const meta = (await readExtractMeta(extract))!;
  try {
    const release = buildRelease(
      await loadRailNetwork(extract),
      catalog,
      mapping,
      paths,
    );
    const info = releaseMeta(release, {
      source: meta.source.id,
      sha256: meta.source.sha256,
      ...(meta.header.replicationTimestamp
        ? { timestamp: meta.header.replicationTimestamp }
        : {}),
      ...(meta.header.replicationSequenceNumber !== undefined
        ? { sequence: meta.header.replicationSequenceNumber }
        : {}),
    });
    await writeRelease(layout.release, release, info);
    const { lines, stations, endpoints, lengthKm } = info.counts;
    console.log(
      `${lines} lines (${lengthKm} km), ${stations} stations (${endpoints} endpoints) → ${layout.release}`,
    );
    return 0;
  } catch (error) {
    if (error instanceof ReleaseError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();

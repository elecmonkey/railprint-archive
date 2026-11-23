#!/usr/bin/env node
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { dataLayout } from '@railprint/layout';
import {
  loadManifest,
  readLock,
  selectSources,
  sourceStatus,
  withFileLock,
} from '@railprint/sources';
import { extractRail } from './extract.ts';
import { RAIL_EXTRACT, railExtractPath } from './paths.ts';
import { osmiumVersion } from './osmium.ts';
import { readPbf } from './pbf.ts';
import { updateOsmSource } from './update.ts';

const USAGE = `Usage: railprint-osm <command>

Commands:
  update [id]   Apply replication changes to an OSM source (default osm-china)
  extract       Build data/cache/osm/china-rail.osm.pbf from the China extract
  info <file>   Print the header and element counts of a PBF file
`;

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { help: { type: 'boolean', short: 'h', default: false } },
  });
  const [command, ...args] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }
  const layout = dataLayout();

  if (command === 'extract') {
    const manifest = await loadManifest(layout.sourcesManifest);
    const [source] = selectSources(manifest, [RAIL_EXTRACT.sourceId]);
    const lock = await readLock(layout.sourcesLock);
    const status = await sourceStatus(source!, layout.sources, lock);
    if (status.state !== 'ok') {
      console.error(
        `${source!.id} is ${status.state}; run \`pnpm sources fetch ${source!.id}\``,
      );
      return 1;
    }
    const started = Date.now();
    const output = railExtractPath(layout);
    const meta = await extractRail(join(layout.sources, source!.path), output, {
      id: source!.id,
      sha256: status.entry.sha256,
    });
    console.log(
      `${output}: ${meta.counts.nodes} nodes, ${meta.counts.ways} ways, ${meta.counts.relations} relations ` +
        `(OSM ${meta.header.replicationTimestamp ?? 'unknown'}, ${((Date.now() - started) / 1000).toFixed(0)} s)`,
    );
    return 0;
  }

  if (command === 'update') {
    const id = args[0] ?? RAIL_EXTRACT.sourceId;
    const manifest = await loadManifest(layout.sourcesManifest);
    const [source] = selectSources(manifest, [id]);
    const destination = join(layout.sources, source!.path);
    return withFileLock(`${destination}.lock`, async () => {
      const lock = await readLock(layout.sourcesLock);
      const status = await sourceStatus(source!, layout.sources, lock);
      if (status.state !== 'ok') {
        console.error(
          `${id} is ${status.state}; run \`pnpm sources fetch ${id}\``,
        );
        return 1;
      }
      const log = (line: string) => console.log(line);
      await osmiumVersion();
      const result = await updateOsmSource(source!, status.entry, {
        sourcesDir: layout.sources,
        lockFile: layout.sourcesLock,
        log,
      });
      if (result.state === 'up-to-date')
        console.log(`${id}: up to date (sequence ${result.sequence})`);
      return 0;
    });
  }

  if (command === 'info') {
    const [file] = args;
    if (!file) {
      console.error(USAGE);
      return 1;
    }
    console.log(JSON.stringify(await readPbf(file), null, 2));
    return 0;
  }

  console.error(`Unknown command "${command}"\n\n${USAGE}`);
  return 1;
}

process.exitCode = await main();

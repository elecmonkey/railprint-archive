#!/usr/bin/env node
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { dataLayout } from '@railprint/layout';
import { describeError, downloadSource } from './download.ts';
import { LockedError, withFileLock } from './file-lock.ts';
import { readLock, recordLockEntry } from './lock.ts';
import { loadManifest, selectSources } from './manifest.ts';
import { sourceStatus } from './status.ts';

const USAGE = `Usage: railprint-sources <command> [source-id...] [options]

Commands:
  status            Show every declared source and whether it is present
  fetch [ids...]    Download missing sources (all non-optional ones by default)
  verify [ids...]   Re-hash downloaded files and compare with the lock

Set NODE_USE_ENV_PROXY=1 to download through HTTP(S)_PROXY.

Options:
  --force           fetch: download again even if the file matches the lock
  -h, --help        Show this help
`;

const log = (line: string) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`);

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      force: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  const [command, ...ids] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return command || values.help ? 0 : 1;
  }

  const layout = dataLayout();
  const manifest = await loadManifest(layout.sourcesManifest);
  const lock = await readLock(layout.sourcesLock);

  switch (command) {
    case 'status': {
      const selected = ids.length
        ? selectSources(manifest, ids)
        : manifest.sources;
      for (const source of selected) {
        const status = await sourceStatus(source, layout.sources, lock);
        const flag = source.optional ? ' (optional)' : '';
        const detail =
          status.state === 'mismatch'
            ? ` — ${status.reason}`
            : status.state === 'ok'
              ? ` — ${(status.entry.bytes / 1048576).toFixed(1)} MiB, fetched ${status.entry.fetchedAt}`
              : '';
        console.log(`${status.state.padEnd(8)} ${source.id}${flag}${detail}`);
      }
      return 0;
    }

    case 'verify': {
      let failures = 0;
      const selected = ids.length
        ? selectSources(manifest, ids)
        : manifest.sources;
      for (const source of selected) {
        const status = await sourceStatus(source, layout.sources, lock, true);
        if (status.state === 'missing') continue;
        if (status.state !== 'ok') failures++;
        console.log(
          `${status.state.padEnd(8)} ${source.id}${status.state === 'mismatch' ? ` — ${status.reason}` : ''}`,
        );
      }
      return failures ? 1 : 0;
    }

    case 'fetch': {
      let failures = 0;
      for (const source of selectSources(manifest, ids)) {
        const destination = join(layout.sources, source.path);
        try {
          // One process per file; other processes skip it and move on.
          await withFileLock(`${destination}.lock`, async () => {
            // Re-read: another process may have finished this file meanwhile.
            const current = await readLock(layout.sourcesLock);
            const status = await sourceStatus(source, layout.sources, current);
            if (status.state === 'ok' && !values.force) {
              log(`${source.id}: up to date`);
              return;
            }
            const entry = await downloadSource(source, destination, { log });
            await recordLockEntry(layout.sourcesLock, entry);
          });
        } catch (error) {
          if (error instanceof LockedError) {
            log(
              `${source.id}: being downloaded by process ${error.holder}, skipped`,
            );
            continue;
          }
          failures++;
          log(`${source.id}: FAILED — ${describeError(error)}`);
        }
      }
      return failures ? 1 : 0;
    }

    default:
      console.error(`Unknown command "${command}"\n\n${USAGE}`);
      return 1;
  }
}

process.exitCode = await main();

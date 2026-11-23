import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  downloadSource,
  fetchText,
  recordLockEntry,
  sha256File,
  type LockEntry,
  type SourceDefinition,
} from '@railprint/sources';
import { applyChanges } from './osmium.ts';
import { readPbfHeader } from './pbf.ts';

/** Contents of an OSM replication `state.txt`. */
export interface ReplicationState {
  sequence: number;
  timestamp: string;
}

/** Parse `state.txt` (Java properties; `:` is escaped as `\:`). */
export function parseState(text: string): ReplicationState {
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    if (line.startsWith('#')) continue;
    const at = line.indexOf('=');
    if (at > 0)
      values.set(
        line.slice(0, at).trim(),
        line
          .slice(at + 1)
          .trim()
          .replace(/\\(.)/g, '$1'),
      );
  }
  const sequence = Number(values.get('sequenceNumber'));
  const timestamp = values.get('timestamp');
  if (!Number.isInteger(sequence) || !timestamp)
    throw new Error('Invalid replication state.txt');
  return { sequence, timestamp };
}

/** `4979` → `000/004/979`, the replication directory layout. */
export function sequencePath(sequence: number): string {
  const digits = String(sequence).padStart(9, '0');
  return `${digits.slice(0, 3)}/${digits.slice(3, 6)}/${digits.slice(6)}`;
}

export interface UpdateOptions {
  /** `data/sources/`. */
  sourcesDir: string;
  lockFile: string;
  log?: (line: string) => void;
  /** Replication base URL; defaults to the one in the PBF header. */
  baseUrl?: string;
}

export type UpdateResult =
  | { state: 'up-to-date'; sequence: number }
  | { state: 'updated'; from: number; to: number; entry: LockEntry };

/**
 * Bring a downloaded OSM extract up to date by applying the provider's
 * replication change files with `osmium apply-changes`. The replication
 * position is read from the PBF header and written back into the new file's
 * header, so updates can be repeated.
 */
export async function updateOsmSource(
  source: SourceDefinition,
  entry: LockEntry,
  options: UpdateOptions,
): Promise<UpdateResult> {
  const log = options.log ?? (() => {});
  const file = join(options.sourcesDir, source.path);
  const header = await readPbfHeader(file);
  const current = header.replicationSequenceNumber;
  const baseUrl = (options.baseUrl ?? header.replicationBaseUrl)?.replace(
    /\/$/,
    '',
  );
  if (current === undefined || !baseUrl) {
    throw new Error(
      `${source.id}: PBF header has no replication sequence or base URL`,
    );
  }

  const latest = parseState(await fetchText(`${baseUrl}/state.txt`));
  if (latest.sequence <= current)
    return { state: 'up-to-date', sequence: current };
  log(
    `${source.id}: sequence ${current} → ${latest.sequence} (${latest.timestamp})`,
  );

  const changesDir = join(options.sourcesDir, 'osm', 'changes', source.id);
  await mkdir(changesDir, { recursive: true });
  const changes: string[] = [];
  for (let sequence = current + 1; sequence <= latest.sequence; sequence++) {
    const relative = join('osm', 'changes', source.id, `${sequence}.osc.gz`);
    const target = join(options.sourcesDir, relative);
    const exists = await stat(target).then(
      () => true,
      () => false,
    );
    if (!exists) {
      const change: SourceDefinition = {
        id: `${source.id}-change-${sequence}`,
        title: `${source.title}, change ${sequence}`,
        provider: source.provider,
        url: `${baseUrl}/${sequencePath(sequence)}.osc.gz`,
        path: relative,
        license: source.license,
      };
      await downloadSource(change, target, { log });
    }
    changes.push(target);
  }

  const updated = `${file}.updating.osm.pbf`;
  log(`${source.id}: applying ${changes.length} change file(s)`);
  await applyChanges(file, changes, updated, {
    osmosis_replication_sequence_number: String(latest.sequence),
    osmosis_replication_timestamp: latest.timestamp,
    osmosis_replication_base_url: baseUrl,
    timestamp: latest.timestamp,
  });
  const check = await readPbfHeader(updated);
  if (check.replicationSequenceNumber !== latest.sequence) {
    await rm(updated, { force: true });
    throw new Error(
      `${source.id}: updated file header does not carry sequence ${latest.sequence}`,
    );
  }

  const bytes = (await stat(updated)).size;
  const sha256 = await sha256File(updated);
  await rename(updated, file);
  for (const change of changes) await rm(change, { force: true });

  // The first update keeps the original download as the base record.
  const base = entry.osmUpdate?.base ?? {
    ...(entry.resolvedUrl ? { resolvedUrl: entry.resolvedUrl } : {}),
    bytes: entry.bytes,
    sha256: entry.sha256,
    ...(entry.upstreamChecksum
      ? { upstreamChecksum: entry.upstreamChecksum }
      : {}),
    sequence: current,
  };
  const { upstreamChecksum: _baseChecksum, ...rest } = entry;
  const next: LockEntry = {
    ...rest,
    bytes,
    sha256,
    osmUpdate: {
      base,
      sequence: latest.sequence,
      timestamp: latest.timestamp,
      updatedAt: new Date().toISOString(),
    },
  };
  await recordLockEntry(options.lockFile, next);
  log(`${source.id}: updated to sequence ${latest.sequence}`);
  return { state: 'updated', from: current, to: latest.sequence, entry: next };
}

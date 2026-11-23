import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sha256File } from './download.ts';
import type { LockEntry, SourcesLock } from './lock.ts';
import type { SourceDefinition } from './manifest.ts';

export type SourceStatus =
  /** File present and matches the lock (size only, or size+hash when deep). */
  | { state: 'ok'; entry: LockEntry }
  /** Not downloaded on this machine. */
  | { state: 'missing'; entry?: LockEntry }
  /** File present but not recorded in the lock. */
  | { state: 'unlocked'; bytes: number }
  /** Lock records a different URL than the manifest declares now. */
  | { state: 'stale'; entry: LockEntry }
  /** File differs from what the lock recorded. */
  | { state: 'mismatch'; entry: LockEntry; reason: string };

/**
 * Compare one declared source with the lock and the local file. A shallow
 * check compares sizes; `deep` re-hashes the file.
 */
export async function sourceStatus(
  source: SourceDefinition,
  sourcesDir: string,
  lock: SourcesLock,
  deep = false,
): Promise<SourceStatus> {
  const entry = lock.entries[source.id];
  let bytes: number;
  try {
    bytes = (await stat(join(sourcesDir, source.path))).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return entry ? { state: 'missing', entry } : { state: 'missing' };
    }
    throw error;
  }
  if (!entry) return { state: 'unlocked', bytes };
  if (entry.url !== source.url || entry.path !== source.path) {
    return { state: 'stale', entry };
  }
  if (entry.bytes !== bytes) {
    return {
      state: 'mismatch',
      entry,
      reason: `size ${bytes} ≠ locked ${entry.bytes}`,
    };
  }
  if (deep) {
    const sha256 = await sha256File(join(sourcesDir, source.path));
    if (sha256 !== entry.sha256) {
      return { state: 'mismatch', entry, reason: 'sha256 differs from lock' };
    }
  }
  return { state: 'ok', entry };
}

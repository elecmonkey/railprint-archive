import { readFile, rename, writeFile } from 'node:fs/promises';
import { withFileLock } from './file-lock.ts';

/** Record of one completed, verified download. */
export interface LockEntry {
  id: string;
  /** URL declared in the manifest at download time. */
  url: string;
  /** URL after redirects, when different from `url`. */
  resolvedUrl?: string;
  /** Path relative to `data/sources/`. */
  path: string;
  bytes: number;
  sha256: string;
  /** Upstream checksum that was checked against the file, if any. */
  upstreamChecksum?: { algorithm: 'md5' | 'sha256'; value: string };
  etag?: string;
  lastModified?: string;
  /** ISO time the download finished. */
  fetchedAt: string;
  /**
   * Set when OSM change files were applied to the download. `bytes` and
   * `sha256` then describe the updated file; `base` the original download.
   */
  osmUpdate?: OsmUpdate;
}

export interface OsmUpdate {
  base: {
    resolvedUrl?: string;
    bytes: number;
    sha256: string;
    upstreamChecksum?: { algorithm: 'md5' | 'sha256'; value: string };
    sequence: number;
  };
  /** Replication sequence number the file is now up to date with. */
  sequence: number;
  /** OSM data timestamp of that sequence. */
  timestamp: string;
  updatedAt: string;
}

export interface SourcesLock {
  version: 1;
  entries: Record<string, LockEntry>;
}

export function emptyLock(): SourcesLock {
  return { version: 1, entries: {} };
}

export async function readLock(file: string): Promise<SourcesLock> {
  let text: string;
  try {
    text = await readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyLock();
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<SourcesLock>;
  if (parsed.version !== 1 || typeof parsed.entries !== 'object') {
    throw new Error(`${file}: unsupported lock format`);
  }
  return { version: 1, entries: parsed.entries ?? {} };
}

/** Serialize with ids sorted so the committed file diffs cleanly. */
export function serializeLock(lock: SourcesLock): string {
  const entries: Record<string, LockEntry> = {};
  for (const id of Object.keys(lock.entries).sort()) {
    const entry = lock.entries[id];
    if (entry) entries[id] = entry;
  }
  return `${JSON.stringify({ version: 1, entries }, null, 2)}\n`;
}

/** Write atomically so an interrupted run never leaves a truncated lock. */
export async function writeLock(
  file: string,
  lock: SourcesLock,
): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, serializeLock(lock));
  await rename(temporary, file);
}

/**
 * Add or replace one entry, re-reading the lock from disk under an exclusive
 * lock so concurrent `fetch` processes keep each other's entries.
 */
export async function recordLockEntry(
  file: string,
  entry: LockEntry,
): Promise<SourcesLock> {
  return withFileLock(
    `${file}.lock`,
    async () => {
      const lock = await readLock(file);
      lock.entries[entry.id] = entry;
      await writeLock(file, lock);
      return lock;
    },
    { waitMs: 10_000 },
  );
}

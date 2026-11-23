import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** File whose presence marks the repository root. */
const ROOT_MARKER = 'pnpm-workspace.yaml';

/**
 * Walk up from `start` until a directory containing the workspace marker is
 * found. Every CLI resolves paths against this root, so commands behave the
 * same no matter which package directory they are launched from.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, ROOT_MARKER))) return current;
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(
        `Cannot find the railprint repository root (${ROOT_MARKER}) above ${start}`,
      );
    }
    current = parent;
  }
}

/**
 * Absolute paths of every data location. Committed and ignored locations are
 * documented in data/README.md; keep the two in sync.
 */
export interface DataLayout {
  /** Repository root. */
  root: string;
  /** `data/` */
  data: string;
  /** Raw downloads, never edited (ignored by git). */
  sources: string;
  /** Rebuildable intermediates derived from sources (ignored by git). */
  cache: string;
  /** Line catalog and confirmed paths (committed). */
  catalog: string;
  /** Final geometry consumed by the web app and exporters (committed). */
  release: string;
  /** Declared external sources (committed). */
  sourcesManifest: string;
  /** What was actually downloaded, with checksums (committed, generated). */
  sourcesLock: string;
}

export function dataLayout(root: string = findRepoRoot()): DataLayout {
  const data = join(root, 'data');
  return {
    root,
    data,
    sources: join(data, 'sources'),
    cache: join(data, 'cache'),
    catalog: join(data, 'catalog'),
    release: join(data, 'release'),
    sourcesManifest: join(data, 'sources.json'),
    sourcesLock: join(data, 'sources.lock.json'),
  };
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Confirmed track paths, in data/catalog/paths.json: for each confirmed line
 * the ordered `[wayId, fromNodeId, toNodeId]` segments. Written by
 * `pnpm match confirm`, one line of text per catalog line so diffs stay
 * readable.
 */
export type StoredSegment = [way: number, from: number, to: number];

export interface PathsFile {
  version: 1;
  lines: Record<string, StoredSegment[]>;
}

export const PATHS_FILE = 'paths.json';

export async function loadPaths(
  catalogDir: string,
  lineIds: ReadonlySet<string>,
): Promise<PathsFile> {
  let text: string;
  try {
    text = await readFile(join(catalogDir, PATHS_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, lines: {} };
    throw error;
  }
  const json = JSON.parse(text) as Partial<PathsFile>;
  if (json.version !== 1 || typeof json.lines !== 'object' || !json.lines) {
    throw new Error('paths: expected { "version": 1, "lines": { … } }');
  }
  const problems: string[] = [];
  for (const [id, segments] of Object.entries(json.lines)) {
    if (!lineIds.has(id))
      problems.push(`paths["${id}"]: no catalog line with this id`);
    const valid =
      Array.isArray(segments) &&
      segments.every(
        (s) =>
          Array.isArray(s) &&
          s.length === 3 &&
          s.every((n) => Number.isInteger(n)),
      );
    if (!valid) problems.push(`paths["${id}"] must be [[way, from, to], …]`);
  }
  if (problems.length)
    throw new Error(`Invalid paths:\n  ${problems.join('\n  ')}`);
  return { version: 1, lines: json.lines };
}

export function serializePaths(
  paths: PathsFile,
  order: readonly string[],
): string {
  const rows = order
    .filter((id) => paths.lines[id])
    .map(
      (id) => `    ${JSON.stringify(id)}: ${JSON.stringify(paths.lines[id])}`,
    );
  return `{\n  "version": 1,\n  "lines": {\n${rows.join(',\n')}\n  }\n}\n`;
}

/** Write paths in catalog order. */
export async function savePaths(
  catalogDir: string,
  paths: PathsFile,
  order: readonly string[],
): Promise<void> {
  await mkdir(catalogDir, { recursive: true });
  const file = join(catalogDir, PATHS_FILE);
  await writeFile(`${file}.tmp`, serializePaths(paths, order));
  await rename(`${file}.tmp`, file);
}

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Decisions that tie a catalog line to OSM, kept in data/mapping/lines.json.
 * Name-based matching proposes; a mapping entry fixes the result so later OSM
 * updates cannot silently change which objects a line uses.
 */

/** An OSM object written as `node/123` or `way/456`. */
export type OsmRef = `${'node' | 'way'}/${number}`;

export interface EndpointPin {
  osm: OsmRef;
  /** OSM name at confirmation time, for readability only. */
  name?: string;
}

export interface RelationPin {
  id: number;
  /** OSM name at confirmation time, for readability only. */
  name: string;
}

export interface LineMapping {
  from?: EndpointPin;
  to?: EndpointPin;
  /** Infrastructure relations the path should follow. */
  relations?: RelationPin[];
  /** Date (YYYY-MM-DD) the whole mapping was confirmed by the author. */
  confirmed?: string;
  notes?: string[];
}

export interface MappingFile {
  version: 1;
  lines: Record<string, LineMapping>;
}

export const MAPPING_FILE = 'lines.json';

const REF = /^(node|way)\/(\d+)$/;

export function parseRef(ref: string): { type: 'node' | 'way'; id: number } {
  const match = REF.exec(ref);
  if (!match)
    throw new Error(
      `Invalid OSM reference "${ref}" (expected node/<id> or way/<id>)`,
    );
  return { type: match[1] as 'node' | 'way', id: Number(match[2]) };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function parsePin(
  raw: unknown,
  where: string,
  problems: string[],
): EndpointPin | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw) || typeof raw.osm !== 'string' || !REF.test(raw.osm)) {
    problems.push(`${where} must be { "osm": "node/<id>" | "way/<id>" }`);
    return undefined;
  }
  return {
    osm: raw.osm as OsmRef,
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
  };
}

/** Validate untrusted JSON; `lineIds` are the catalog ids entries may use. */
export function parseMapping(
  json: unknown,
  lineIds: ReadonlySet<string>,
): MappingFile {
  const problems: string[] = [];
  if (!isRecord(json) || json.version !== 1 || !isRecord(json.lines)) {
    throw new Error('mapping: expected { "version": 1, "lines": { … } }');
  }
  const lines: Record<string, LineMapping> = {};
  for (const [id, raw] of Object.entries(json.lines)) {
    const where = `mapping["${id}"]`;
    if (!lineIds.has(id))
      problems.push(`${where}: no catalog line with this id`);
    if (!isRecord(raw)) {
      problems.push(`${where} must be an object`);
      continue;
    }
    const from = parsePin(raw.from, `${where}.from`, problems);
    const to = parsePin(raw.to, `${where}.to`, problems);
    let relations: RelationPin[] | undefined;
    if (raw.relations !== undefined) {
      if (
        !Array.isArray(raw.relations) ||
        !raw.relations.every(
          (r) =>
            isRecord(r) && Number.isInteger(r.id) && typeof r.name === 'string',
        )
      ) {
        problems.push(
          `${where}.relations must be [{ "id": number, "name": string }]`,
        );
      } else relations = raw.relations as RelationPin[];
    }
    if (
      raw.confirmed !== undefined &&
      (typeof raw.confirmed !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(raw.confirmed))
    ) {
      problems.push(`${where}.confirmed must be YYYY-MM-DD`);
    }
    if (
      raw.notes !== undefined &&
      (!Array.isArray(raw.notes) ||
        !raw.notes.every((n) => typeof n === 'string'))
    ) {
      problems.push(`${where}.notes must be an array of strings`);
    }
    lines[id] = {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(relations ? { relations } : {}),
      ...(typeof raw.confirmed === 'string'
        ? { confirmed: raw.confirmed }
        : {}),
      ...(Array.isArray(raw.notes) ? { notes: raw.notes as string[] } : {}),
    };
  }
  if (problems.length)
    throw new Error(`Invalid mapping:\n  ${problems.join('\n  ')}`);
  return { version: 1, lines };
}

export async function loadMapping(
  dir: string,
  lineIds: ReadonlySet<string>,
): Promise<MappingFile> {
  let text: string;
  try {
    text = await readFile(join(dir, MAPPING_FILE), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { version: 1, lines: {} };
    throw error;
  }
  return parseMapping(JSON.parse(text), lineIds);
}

/** Write entries in catalog order so the file reads like the catalog. */
export async function saveMapping(
  dir: string,
  mapping: MappingFile,
  order: readonly string[],
): Promise<void> {
  const lines: Record<string, LineMapping> = {};
  for (const id of order) {
    const entry = mapping.lines[id];
    if (entry) lines[id] = entry;
  }
  await mkdir(dir, { recursive: true });
  const file = join(dir, MAPPING_FILE);
  await writeFile(
    `${file}.tmp`,
    `${JSON.stringify({ version: 1, lines }, null, 2)}\n`,
  );
  await rename(`${file}.tmp`, file);
}

/**
 * Confirmed track paths, kept in data/mapping/paths.json: for each line the
 * ordered `[wayId, fromNodeId, toNodeId]` segments it was confirmed with.
 * Written one line per catalog line so diffs stay readable.
 */
export type StoredSegment = [way: number, from: number, to: number];

export interface PathsFile {
  version: 1;
  lines: Record<string, StoredSegment[]>;
}

export const PATHS_FILE = 'paths.json';

export async function loadPaths(
  dir: string,
  lineIds: ReadonlySet<string>,
): Promise<PathsFile> {
  let text: string;
  try {
    text = await readFile(join(dir, PATHS_FILE), 'utf8');
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

export async function savePaths(
  dir: string,
  paths: PathsFile,
  order: readonly string[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, PATHS_FILE);
  await writeFile(`${file}.tmp`, serializePaths(paths, order));
  await rename(`${file}.tmp`, file);
}

import { lineId, parseEndpoint } from './endpoint.ts';
import {
  LINE_CATEGORIES,
  type Catalog,
  type CatalogLine,
  type LineCategory,
  type LineOsm,
  type OsmRef,
  type RelationRef,
} from './types.ts';

export class CatalogError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid catalog:\n  ${problems.join('\n  ')}`);
    this.name = 'CatalogError';
    this.problems = problems;
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isNonEmpty = (v: unknown): v is string =>
  typeof v === 'string' && v.trim() !== '';

const LINE_KEYS = new Set([
  'id',
  'name',
  'from',
  'to',
  'category',
  'osm',
  'notes',
]);
const OSM_KEYS = new Set([
  'from',
  'to',
  'relations',
  'fixedRelations',
  'confirmed',
]);
const REF = /^(node|way)\/(\d+)$/;

export function parseRef(ref: string): { type: 'node' | 'way'; id: number } {
  const match = REF.exec(ref);
  if (!match)
    throw new Error(
      `Invalid OSM reference "${ref}" (expected node/<id> or way/<id>)`,
    );
  return { type: match[1] as 'node' | 'way', id: Number(match[2]) };
}

function checkStringList(
  raw: unknown,
  where: string,
  problems: string[],
): string[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || !raw.every(isNonEmpty)) {
    problems.push(`${where} must be an array of non-empty strings`);
    return undefined;
  }
  return raw;
}

function checkOsm(
  raw: unknown,
  where: string,
  problems: string[],
): LineOsm | undefined {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) {
    problems.push(`${where} must be an object`);
    return undefined;
  }
  for (const key of Object.keys(raw)) {
    if (!OSM_KEYS.has(key)) problems.push(`${where} has unknown key "${key}"`);
  }
  const osm: LineOsm = {};
  for (const key of ['from', 'to'] as const) {
    const value = raw[key];
    if (value === undefined) continue;
    if (typeof value !== 'string' || !REF.test(value)) {
      problems.push(`${where}.${key} must be "node/<id>" or "way/<id>"`);
    } else osm[key] = value as OsmRef;
  }
  if (raw.relations !== undefined) {
    const ok =
      Array.isArray(raw.relations) &&
      raw.relations.every(
        (r) =>
          isRecord(r) && Number.isInteger(r.id) && typeof r.name === 'string',
      );
    if (ok) osm.relations = raw.relations as RelationRef[];
    else
      problems.push(
        `${where}.relations must be [{ "id": number, "name": string }]`,
      );
  }
  if (raw.fixedRelations !== undefined) {
    if (raw.fixedRelations === true) osm.fixedRelations = true;
    else problems.push(`${where}.fixedRelations must be true or absent`);
  }
  if (raw.confirmed !== undefined) {
    if (
      typeof raw.confirmed === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw.confirmed)
    ) {
      osm.confirmed = raw.confirmed;
    } else problems.push(`${where}.confirmed must be YYYY-MM-DD`);
  }
  if (osm.confirmed && (!osm.from || !osm.to)) {
    problems.push(`${where}: a confirmed line needs both endpoints`);
  }
  return osm;
}

/**
 * Validate untrusted JSON as a catalog. All problems are collected and
 * reported together so a hand edit can be fixed in one pass.
 */
export function parseCatalog(json: unknown): Catalog {
  const problems: string[] = [];
  if (!isRecord(json)) throw new CatalogError(['root must be an object']);
  if (json.version !== 2) problems.push('version must be 2');
  if (!Array.isArray(json.lines))
    throw new CatalogError([...problems, 'lines must be an array']);

  const ids = new Map<string, number>();
  const sections = new Map<string, number>();
  const lines: CatalogLine[] = [];

  json.lines.forEach((raw: unknown, index) => {
    const where = `lines[${index}]`;
    if (!isRecord(raw)) {
      problems.push(`${where} must be an object`);
      return;
    }
    for (const key of Object.keys(raw)) {
      if (!LINE_KEYS.has(key))
        problems.push(`${where} has unknown key "${key}"`);
    }
    const label = isNonEmpty(raw.id) ? `${where} (${raw.id})` : where;
    for (const key of ['id', 'name', 'from', 'to'] as const) {
      if (!isNonEmpty(raw[key]))
        problems.push(`${label}.${key} must be a non-empty string`);
    }
    if (
      !isNonEmpty(raw.id) ||
      !isNonEmpty(raw.name) ||
      !isNonEmpty(raw.from) ||
      !isNonEmpty(raw.to)
    ) {
      return;
    }

    const previous = ids.get(raw.id);
    if (previous !== undefined)
      problems.push(`${label} duplicates the id of lines[${previous}]`);
    else ids.set(raw.id, index);

    for (const key of ['from', 'to'] as const) {
      try {
        parseEndpoint(raw[key] as string);
      } catch (error) {
        problems.push(`${label}.${key}: ${(error as Error).message}`);
      }
    }
    if (raw.from === raw.to)
      problems.push(`${label} starts and ends at the same endpoint`);
    else {
      try {
        const id = lineId(raw.name, raw.from, raw.to);
        if (raw.id !== id) problems.push(`${label}.id must be "${id}"`);
      } catch {
        // Already reported as an invalid endpoint.
      }
    }

    // The same line between the same endpoints twice is almost certainly a
    // duplicate entry; direction does not matter.
    const section = `${raw.name}|${[raw.from, raw.to].sort().join('|')}`;
    const twin = sections.get(section);
    if (twin !== undefined)
      problems.push(`${label} repeats the section of lines[${twin}]`);
    else sections.set(section, index);

    if (!LINE_CATEGORIES.includes(raw.category as LineCategory)) {
      problems.push(
        `${label}.category must be one of ${LINE_CATEGORIES.join(', ')}`,
      );
      return;
    }
    const notes = checkStringList(raw.notes, `${label}.notes`, problems);
    const osm = checkOsm(raw.osm, `${label}.osm`, problems);

    lines.push({
      id: raw.id,
      name: raw.name,
      from: raw.from,
      to: raw.to,
      category: raw.category as LineCategory,
      ...(osm && Object.keys(osm).length ? { osm } : {}),
      ...(notes?.length ? { notes } : {}),
    });
  });

  if (problems.length) throw new CatalogError(problems);
  return { version: 2, lines };
}

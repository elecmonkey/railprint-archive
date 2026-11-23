import { parseEndpoint } from './endpoint.ts';
import {
  INTER_PROVINCE_CLASSES,
  LINE_CATEGORIES,
  type LineCategoryName,
  type Catalog,
  type InterProvinceClass,
  type CatalogLine,
  type LineGroup,
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
  'aliases',
  'from',
  'to',
  'group',
  'category',
  'notes',
]);

function checkGroup(
  raw: unknown,
  where: string,
  problems: string[],
): LineGroup | undefined {
  if (!isRecord(raw)) {
    problems.push(`${where}.group must be an object`);
    return undefined;
  }
  if (raw.scope === '跨省线路') {
    if (!INTER_PROVINCE_CLASSES.includes(raw.class as never)) {
      problems.push(
        `${where}.group.class must be one of ${INTER_PROVINCE_CLASSES.join(', ')}`,
      );
      return undefined;
    }
    return { scope: '跨省线路', class: raw.class as InterProvinceClass };
  }
  if (raw.scope === '省内线路') {
    if (!isNonEmpty(raw.province)) {
      problems.push(`${where}.group.province must be a non-empty string`);
      return undefined;
    }
    return { scope: '省内线路', province: raw.province };
  }
  problems.push(`${where}.group.scope must be 跨省线路 or 省内线路`);
  return undefined;
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

/**
 * Validate untrusted JSON as a catalog. All problems are collected and
 * reported together so a hand edit can be fixed in one pass.
 */
export function parseCatalog(json: unknown): Catalog {
  const problems: string[] = [];
  if (!isRecord(json)) throw new CatalogError(['root must be an object']);
  if (json.version !== 1) problems.push('version must be 1');
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
    ids.set(raw.id, index);

    for (const key of ['from', 'to'] as const) {
      try {
        parseEndpoint(raw[key] as string);
      } catch (error) {
        problems.push(`${label}.${key}: ${(error as Error).message}`);
      }
    }
    if (raw.from === raw.to)
      problems.push(`${label} starts and ends at the same endpoint`);

    // The same line between the same endpoints twice is almost certainly a
    // duplicate entry; direction does not matter.
    const section = `${raw.name}|${[raw.from, raw.to].sort().join('|')}`;
    const twin = sections.get(section);
    if (twin !== undefined)
      problems.push(`${label} repeats the section of lines[${twin}]`);
    if (twin === undefined) sections.set(section, index);

    const group = checkGroup(raw.group, label, problems);
    const aliases = checkStringList(raw.aliases, `${label}.aliases`, problems);
    const notes = checkStringList(raw.notes, `${label}.notes`, problems);
    let category: LineCategoryName | undefined;
    if (raw.category !== undefined) {
      if (LINE_CATEGORIES.includes(raw.category as LineCategoryName)) {
        category = raw.category as LineCategoryName;
      } else {
        problems.push(
          `${label}.category must be one of ${LINE_CATEGORIES.join(', ')}`,
        );
      }
    }
    if (aliases?.includes(raw.name))
      problems.push(`${label}.aliases repeats the name`);
    if (!group) return;

    lines.push({
      id: raw.id,
      name: raw.name,
      ...(aliases?.length ? { aliases } : {}),
      from: raw.from,
      to: raw.to,
      group,
      ...(category ? { category } : {}),
      ...(notes?.length ? { notes } : {}),
    });
  });

  if (problems.length) throw new CatalogError(problems);
  return { version: 1, lines };
}

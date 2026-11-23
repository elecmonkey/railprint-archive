import { readFile } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';

/**
 * Upstream-published checksum file (`<hex>  <filename>`) used to verify a
 * download. Either a fixed `url`, or a `suffix` appended to the URL the
 * download resolved to after redirects; the latter keeps the checksum tied to
 * the concrete snapshot behind a moving alias such as `*-latest`.
 */
export type UpstreamChecksum =
  | { algorithm: 'md5' | 'sha256'; url: string }
  | { algorithm: 'md5' | 'sha256'; suffix: string };

export interface SourceLicense {
  /** SPDX identifier where one exists, otherwise a short descriptive id. */
  id: string;
  /** Attribution text required or requested by the provider. */
  attribution: string;
  url: string;
}

/** One external file the pipeline depends on. */
export interface SourceDefinition {
  /** Stable kebab-case identifier used on the command line and in the lock. */
  id: string;
  title: string;
  provider: string;
  url: string;
  /** Destination relative to `data/sources/`. */
  path: string;
  license: SourceLicense;
  checksum?: UpstreamChecksum;
  /**
   * Optional sources are skipped by `fetch` unless named explicitly, e.g.
   * large higher-resolution variants that are only needed later.
   */
  optional?: boolean;
  notes?: string;
}

export interface SourceManifest {
  version: 1;
  sources: SourceDefinition[];
}

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function fail(where: string, message: string): never {
  throw new Error(`sources.json: ${where}: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(where, `"${key}" must be a non-empty string`);
  }
  return value;
}

function requireHttpUrl(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = requireString(record, key, where);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail(where, `"${key}" is not a valid URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    fail(where, `"${key}" must be http(s)`);
  }
  return value;
}

/** Validate untrusted JSON and return a typed manifest. */
export function parseManifest(json: unknown): SourceManifest {
  if (!isRecord(json)) fail('root', 'must be an object');
  if (json.version !== 1) fail('root', 'unsupported "version" (expected 1)');
  if (!Array.isArray(json.sources)) fail('root', '"sources" must be an array');

  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const sources = json.sources.map((raw: unknown, index): SourceDefinition => {
    const where = `sources[${index}]`;
    if (!isRecord(raw)) fail(where, 'must be an object');
    const id = requireString(raw, 'id', where);
    if (!ID_PATTERN.test(id)) fail(where, `id "${id}" must be kebab-case`);
    if (seenIds.has(id)) fail(where, `duplicate id "${id}"`);
    seenIds.add(id);

    const path = requireString(raw, 'path', where);
    const normalized = normalize(path);
    if (isAbsolute(path) || normalized.startsWith('..')) {
      fail(where, `path "${path}" must stay inside data/sources/`);
    }
    if (seenPaths.has(normalized)) fail(where, `duplicate path "${path}"`);
    seenPaths.add(normalized);

    if (!isRecord(raw.license)) fail(where, '"license" must be an object');
    const license: SourceLicense = {
      id: requireString(raw.license, 'id', `${where}.license`),
      attribution: requireString(
        raw.license,
        'attribution',
        `${where}.license`,
      ),
      url: requireHttpUrl(raw.license, 'url', `${where}.license`),
    };

    let checksum: UpstreamChecksum | undefined;
    if (raw.checksum !== undefined) {
      if (!isRecord(raw.checksum)) fail(where, '"checksum" must be an object');
      const algorithm = raw.checksum.algorithm;
      if (algorithm !== 'md5' && algorithm !== 'sha256') {
        fail(`${where}.checksum`, '"algorithm" must be md5 or sha256');
      }
      const hasUrl = raw.checksum.url !== undefined;
      const hasSuffix = raw.checksum.suffix !== undefined;
      if (hasUrl === hasSuffix) {
        fail(`${where}.checksum`, 'needs exactly one of "url" or "suffix"');
      }
      checksum = hasUrl
        ? {
            algorithm,
            url: requireHttpUrl(raw.checksum, 'url', `${where}.checksum`),
          }
        : {
            algorithm,
            suffix: requireString(raw.checksum, 'suffix', `${where}.checksum`),
          };
    }

    if (raw.optional !== undefined && typeof raw.optional !== 'boolean') {
      fail(where, '"optional" must be a boolean');
    }
    if (raw.notes !== undefined && typeof raw.notes !== 'string') {
      fail(where, '"notes" must be a string');
    }

    return {
      id,
      title: requireString(raw, 'title', where),
      provider: requireString(raw, 'provider', where),
      url: requireHttpUrl(raw, 'url', where),
      path: normalized,
      license,
      ...(checksum ? { checksum } : {}),
      ...(raw.optional === true ? { optional: true } : {}),
      ...(typeof raw.notes === 'string' ? { notes: raw.notes } : {}),
    };
  });

  return { version: 1, sources };
}

export async function loadManifest(file: string): Promise<SourceManifest> {
  return parseManifest(JSON.parse(await readFile(file, 'utf8')));
}

/**
 * Resolve the sources a command should act on. Explicit ids may name optional
 * sources; with no ids, every non-optional source is selected.
 */
export function selectSources(
  manifest: SourceManifest,
  ids: readonly string[],
): SourceDefinition[] {
  if (ids.length === 0) return manifest.sources.filter((s) => !s.optional);
  const byId = new Map(manifest.sources.map((s) => [s.id, s]));
  return ids.map((id) => {
    const source = byId.get(id);
    if (!source) throw new Error(`Unknown source id "${id}"`);
    return source;
  });
}

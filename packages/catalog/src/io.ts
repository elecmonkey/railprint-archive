import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Catalog } from './types.ts';
import { parseCatalog } from './validate.ts';

/** File name of the catalog inside data/catalog/. */
export const CATALOG_FILE = 'lines.json';

export const catalogPath = (catalogDir: string) =>
  join(catalogDir, CATALOG_FILE);

export async function loadCatalog(catalogDir: string): Promise<Catalog> {
  const file = catalogPath(catalogDir);
  let json: unknown;
  try {
    json = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read ${file}: ${(error as Error).message}`, {
      cause: error,
    });
  }
  return parseCatalog(json);
}

/**
 * Write the catalog, preserving line order (the order is the author's and is
 * meaningful when reading the file). Validates before writing.
 */
export async function saveCatalog(
  catalogDir: string,
  catalog: Catalog,
): Promise<void> {
  parseCatalog(catalog);
  const file = catalogPath(catalogDir);
  await writeFile(`${file}.tmp`, `${JSON.stringify(catalog, null, 2)}\n`);
  await rename(`${file}.tmp`, file);
}

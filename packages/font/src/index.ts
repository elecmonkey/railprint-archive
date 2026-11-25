import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DataLayout } from '@railprint/layout';
import {
  loadManifest,
  readLock,
  sourceStatus,
  type SourceDefinition,
} from '@railprint/sources';
import subsetFont from 'subset-font';

const SOURCES = { font: 'noto-sans-sc', license: 'noto-sans-sc-license' };

/** Weights the web app uses (400–650), as a variable range. */
const WEIGHTS = { min: 400, max: 700 };

/** Copyright, licence description and licence URL, as the OFL asks. */
const NAME_IDS = [0, 13, 14];

export interface FontFiles {
  /** The cut-down font, in data/cache/font/. */
  font: string;
  /** Its licence text, to ship next to it. */
  license: string;
}

async function sourcePath(layout: DataLayout, id: string): Promise<string> {
  const manifest = await loadManifest(layout.sourcesManifest);
  const source = manifest.sources.find((s) => s.id === id) as SourceDefinition;
  const status = await sourceStatus(
    source,
    layout.sources,
    await readLock(layout.sourcesLock),
  );
  if (status.state !== 'ok')
    throw new Error(
      `${id} is ${status.state}; run \`pnpm sources fetch ${id}\``,
    );
  return join(layout.sources, source.path);
}

/**
 * Cuts Noto Sans SC down to the characters in data/release/characters.txt
 * and writes it, with its licence, to data/cache/font/.
 */
export async function buildFont(layout: DataLayout): Promise<FontFiles> {
  const characters = (
    await readFile(join(layout.release, 'characters.txt'), 'utf8')
  ).trim();
  const font = await subsetFont(
    await readFile(await sourcePath(layout, SOURCES.font)),
    characters,
    {
      targetFormat: 'woff2',
      variationAxes: { wght: WEIGHTS },
      preserveNameIds: NAME_IDS,
    },
  );
  const dir = join(layout.cache, 'font');
  await mkdir(dir, { recursive: true });
  const files: FontFiles = {
    font: join(dir, 'railprint-sc.woff2'),
    license: join(dir, 'OFL.txt'),
  };
  await writeFile(files.font, font);
  await copyFile(await sourcePath(layout, SOURCES.license), files.license);
  return files;
}

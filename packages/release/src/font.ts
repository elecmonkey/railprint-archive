import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import type { DataLayout } from '@railprint/layout';
import {
  loadManifest,
  readLock,
  sourceStatus,
  type SourceDefinition,
} from '@railprint/sources';
import subsetFont from 'subset-font';

/**
 * The site's Chinese font: Noto Sans SC cut down to the characters the
 * release and the web app show, written to data/release/font/ next to its
 * licence.
 */
export const FONT_DIR = 'font';
export const FONT_FILES = {
  font: 'railprint-sc.woff2',
  characters: 'characters.txt',
  license: 'OFL.txt',
} as const;

const SOURCES = { font: 'noto-sans-sc', license: 'noto-sans-sc-license' };

/** Weights the web app uses (400–650), as a variable range. */
const WEIGHTS = { min: 400, max: 700 };

/** CJK characters and punctuation; everything else is drawn in Geist. */
const CJK_RANGES: [number, number][] = [
  [0x3000, 0x303f], // punctuation
  [0x3400, 0x9fff], // ideographs
  [0xff00, 0xffef], // full-width forms
];
const isCJK = (c: string) => {
  const n = c.codePointAt(0)!;
  return CJK_RANGES.some(([a, b]) => n >= a && n <= b);
};

/** Text of the release that the site shows. */
export interface ShownText {
  lines: {
    name: string;
    from: string;
    to: string;
    relations: { name: string }[];
  }[];
  stations: { name: string }[];
}

/** Places in the repository whose source holds interface text. */
const UI_DIRS = ['apps/web/src', 'packages/style/src'];

async function* sourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(path);
    else if (/\.(tsx?|css)$/.test(entry.name)) yield path;
  }
}

/**
 * Every CJK character the site can show, sorted: from the release and from
 * the web app's source.
 */
export async function shownCharacters(
  root: string,
  release: ShownText,
): Promise<string> {
  const texts: string[] = [];
  for (const l of release.lines)
    texts.push(l.name, l.from, l.to, ...l.relations.map((r) => r.name));
  for (const s of release.stations) texts.push(s.name);
  for (const dir of UI_DIRS)
    for await (const file of sourceFiles(join(root, dir)))
      texts.push(await readFile(file, 'utf8'));
  const set = new Set<string>();
  for (const text of texts) for (const c of text) if (isCJK(c)) set.add(c);
  return [...set].sort().join('');
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

/** Writes the cut-down font, its character list and licence; returns the font size in bytes. */
export async function writeFont(
  layout: DataLayout,
  release: ShownText,
): Promise<{ characters: number; bytes: number }> {
  const characters = await shownCharacters(layout.root, release);
  const font = await subsetFont(
    await readFile(await sourcePath(layout, SOURCES.font)),
    characters,
    { targetFormat: 'woff2', variationAxes: { wght: WEIGHTS } },
  );
  const dir = join(layout.release, FONT_DIR);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, FONT_FILES.font), font);
  await writeFile(join(dir, FONT_FILES.characters), `${characters}\n`);
  await copyFile(
    await sourcePath(layout, SOURCES.license),
    join(dir, FONT_FILES.license),
  );
  return { characters: characters.length, bytes: font.length };
}

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataLayout } from '@railprint/layout';
import { expect, test } from 'rstack/test';
import { FONT_DIR, FONT_FILES, shownCharacters } from '../src/font.ts';

test('the committed font covers every character the site shows', async () => {
  const layout = dataLayout(
    fileURLToPath(new URL('../../..', import.meta.url)),
  );
  const read = (file: string) =>
    readFileSync(`${layout.release}/${file}`, 'utf8');
  const properties = (file: string) =>
    (
      JSON.parse(read(file)) as { features: { properties: never }[] }
    ).features.map((f) => f.properties);
  const shown = await shownCharacters(layout.root, {
    lines: properties('lines.geojson'),
    stations: properties('stations.geojson'),
  });
  const covered = new Set(read(`${FONT_DIR}/${FONT_FILES.characters}`).trim());
  const missing = [...shown].filter((c) => !covered.has(c));
  // Run `pnpm release` after adding Chinese text to the web app.
  expect(missing.join('')).toBe('');
});

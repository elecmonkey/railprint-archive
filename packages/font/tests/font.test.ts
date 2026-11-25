import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dataLayout } from '@railprint/layout';
import { expect, test } from 'rstack/test';
import { buildFont } from '../src/index.ts';

const layout = dataLayout(fileURLToPath(new URL('../../..', import.meta.url)));
let fetched = true;
try {
  readFileSync(`${layout.sources}/fonts/NotoSansSC[wght].ttf`);
} catch {
  fetched = false;
}

// Needs `pnpm sources fetch noto-sans-sc noto-sans-sc-license`.
test.skipIf(!fetched)('cuts the font down to a small woff2', async () => {
  const files = await buildFont(layout);
  const font = readFileSync(files.font);
  expect(font.subarray(0, 4).toString('latin1')).toBe('wOF2');
  expect(font.length).toBeLessThan(1024 * 1024);
  expect(readFileSync(files.license, 'utf8')).toMatch(/Open Font License/);
});

#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { dataLayout } from '@railprint/layout';
import { buildTiles } from './index.ts';

const USAGE = `Usage: railprint-tiles [--out <dir>] [--levels 0,1,...]

Build the global terrain tiles and tiles.json (default packages/tiles/dist/),
and record their hash in packages/tiles/version.json for the web app.
Needs: pnpm sources fetch etopo-2022-60s etopo-2022-30s ne-10m-land ne-10m-lakes
`;

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    levels: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (values.help) {
  console.log(USAGE);
} else {
  const layout = dataLayout();
  const started = Date.now();
  const index = await buildTiles(layout, {
    out: values.out
      ? resolve(values.out)
      : fileURLToPath(new URL('../dist/', import.meta.url)),
    ...(values.levels ? { levels: values.levels.split(',').map(Number) } : {}),
    log: (line) => console.log(line),
  });
  await writeFile(
    new URL('../version.json', import.meta.url),
    `${JSON.stringify({ hash: index.hash }, null, 2)}\n`,
  );
  console.log(`hash ${index.hash}`);
  console.log(`tiles built in ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

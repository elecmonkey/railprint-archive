#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { dataLayout } from '@railprint/layout';
import { themes } from '@railprint/style';
import { renderExport, type ImageFormat } from './index.ts';

const USAGE = `Usage: railprint-export [options]

Render every line of data/release/ on a flat map (Lambert conformal conic)
with terrain, rivers and lakes, as an image fitted to the network.

  --width <px>     Width in CSS pixels; styles are sized as on screen (3000)
  --scale <n>      Device pixels per CSS pixel (3)
  --theme <name>   light or dark (light)
  --out <file>     Output file; .webp, .jpg or .png sets the format
                   (data/cache/export/railprint-<theme>.webp)
`;

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      width: { type: 'string', default: '3000' },
      scale: { type: 'string', default: '3' },
      theme: { type: 'string', default: 'light' },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  const width = Number(values.width);
  const scale = Number(values.scale);
  const theme = themes[values.theme as keyof typeof themes];
  if (!(width > 0) || !(scale > 0) || !theme) {
    console.error(USAGE);
    return 1;
  }
  const layout = dataLayout();
  const out = values.out
    ? resolve(values.out)
    : join(layout.cache, 'export', `railprint-${theme.name}.webp`);
  const ext = extname(out).slice(1).toLowerCase();
  const format = (ext === 'jpeg' ? 'jpg' : ext) as ImageFormat;
  if (!['webp', 'jpg', 'png'].includes(format)) {
    console.error(`Unknown image type ".${ext}"; use .webp, .jpg or .png`);
    return 1;
  }
  const started = Date.now();
  const result = await renderExport({
    layout,
    theme,
    width,
    scale,
    padding: 48,
    format,
  });
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, result.image);
  console.log(
    `${result.width}×${result.height} px in ${((Date.now() - started) / 1000).toFixed(0)} s → ${out}`,
  );
  return 0;
}

process.exitCode = await main();

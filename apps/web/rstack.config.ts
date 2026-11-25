// Configuration guide: https://rstack.rs/config
import { copyFile, readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { define } from 'rstack';
import type { RsbuildPlugin } from 'rstack/app';

/** Where the terrain tiles live once deployed (packages/tiles). */
const TILES_URL = process.env.TILES_URL ?? 'https://tiles.rail.elecmonkey.com/';

define.app(async ({ command }) => {
  const { pluginReact } = await import('@rsbuild/plugin-react');
  const { buildFont } = await import('@railprint/font');
  const { dataLayout } = await import('@railprint/layout');
  const layout = dataLayout();
  const tilesDir = join(layout.root, 'packages', 'tiles');
  // The tiles this build expects; the page warns when the served ones differ.
  const { hash } = JSON.parse(
    await readFile(join(tilesDir, 'version.json'), 'utf8'),
  ) as { hash: string };
  const dev = command === 'dev';
  const tilesDist = join(tilesDir, 'dist');
  if (dev)
    await readFile(join(tilesDist, 'tiles.json')).catch(() => {
      throw new Error(
        'No local terrain tiles in packages/tiles/dist; run `pnpm tiles`',
      );
    });
  let license = '';
  const fontPlugin: RsbuildPlugin = {
    // The Chinese font is cut down from Noto Sans SC before each build
    // (see packages/font); its licence ships next to the site.
    name: 'railprint-font',
    setup(api) {
      const build = async () => {
        license = (await buildFont(layout)).license;
      };
      api.onBeforeStartDevServer(build);
      api.onBeforeBuild(build);
      api.onAfterBuild(() =>
        copyFile(license, join(api.context.distPath, 'OFL-noto-sans-sc.txt')),
      );
    },
  };
  return {
    plugins: [pluginReact(), fontPlugin],
    html: { title: "Elecmonkey's Railprint", favicon: './src/favicon.svg' },
    source: {
      define: {
        'import.meta.env.TILES_URL': JSON.stringify(
          dev ? '/tiles/' : TILES_URL,
        ),
        'import.meta.env.TILES_HASH': JSON.stringify(hash),
      },
      // The railway release and the basemap are imported as assets, so their
      // file names carry a content hash.
      assetsInclude: /\.geojson$/,
    },
    server: {
      // The local tiles, in place of the tiles site.
      setup: ({ action, server }) => {
        if (action !== 'dev') return;
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0] ?? '';
          if (!url.startsWith('/tiles/')) return next();
          const file = join(tilesDist, normalize(url.slice('/tiles/'.length)));
          if (!file.startsWith(`${tilesDist}/`)) return next();
          readFile(file).then(
            (data) => {
              res.setHeader(
                'Content-Type',
                extname(file) === '.json' ? 'application/json' : 'image/webp',
              );
              res.end(data);
            },
            () => {
              res.statusCode = 404;
              res.end();
            },
          );
        });
      },
    },
    output: {
      filename: {
        // Hosts compress .json but serve unknown .geojson as raw bytes.
        assets: (pathData) =>
          /\.geojson(\?|$)/.test(pathData.filename ?? '')
            ? '[name].[contenthash:10].json'
            : '[name].[contenthash:10][ext]',
      },
    },
  };
});

define.test({
  setupFiles: ['./tests/rstest.setup.ts'],
});

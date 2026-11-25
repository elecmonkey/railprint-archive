// Configuration guide: https://rstack.rs/config
import { copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { define } from 'rstack';
import type { RsbuildPlugin } from 'rstack/app';

define.app(async () => {
  const { pluginReact } = await import('@rsbuild/plugin-react');
  const { buildFont } = await import('@railprint/font');
  const { dataLayout } = await import('@railprint/layout');
  let license = '';
  const fontPlugin: RsbuildPlugin = {
    // The Chinese font is cut down from Noto Sans SC before each build
    // (see packages/font); its licence ships next to the site.
    name: 'railprint-font',
    setup(api) {
      const build = async () => {
        license = (await buildFont(dataLayout())).license;
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
    // The railway release and the basemap are imported as assets, so their
    // file names carry a content hash.
    source: { assetsInclude: /\.geojson$/ },
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

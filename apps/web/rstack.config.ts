// Configuration guide: https://rstack.rs/config
import { define } from 'rstack';

define.app(async () => {
  const { pluginReact } = await import('@rsbuild/plugin-react');
  return {
    plugins: [pluginReact()],
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

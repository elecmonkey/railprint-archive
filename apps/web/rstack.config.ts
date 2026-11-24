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
  };
});

define.test({
  setupFiles: ['./tests/rstest.setup.ts'],
});

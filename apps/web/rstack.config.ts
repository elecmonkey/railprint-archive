// Configuration guide: https://rstack.rs/config
import { define } from 'rstack';

define.app(async () => {
  const { pluginReact } = await import('@rsbuild/plugin-react');
  return {
    plugins: [pluginReact()],
    html: { title: "Elecmonkey's Railprint", favicon: './src/favicon.svg' },
    server: {
      // Serve the railway release and the basemap assets at the site root,
      // and copy both into the build output.
      publicDir: [
        { name: '../../data/release', copyOnBuild: true, watch: true },
        { name: '../../packages/basemap/assets', copyOnBuild: true },
      ],
    },
  };
});

define.test({
  setupFiles: ['./tests/rstest.setup.ts'],
});

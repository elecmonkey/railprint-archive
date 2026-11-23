// Configuration guide: ./node_modules/rstack/docs/llms.txt
import { define } from 'rstack';

define.lint(({ js, ts, reactPlugin, reactHooksPlugin, rstestPlugin }) => [
  js.configs.recommended,
  ts.configs.recommendedTypeChecked,
  reactPlugin.configs.recommended,
  reactHooksPlugin.configs.recommended,
  {
    files: ['**/*.{test,spec}.?(c|m)[jt]s?(x)'],
    ...rstestPlugin.configs.recommended,
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
]);

define.fmt({
  singleQuote: true,
  // Generated with one line per catalog line; keep that layout.
  ignorePatterns: [
    'data/mapping/paths.json',
    'data/sources.lock.json',
    'data/release/**',
    'packages/basemap/assets/**',
  ],
});

define.staged({
  '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}': ['rs lint --fix', 'rs fmt'],
  '*.{json,jsonc,md,mdx,css,html,yml,yaml}': 'rs fmt',
});

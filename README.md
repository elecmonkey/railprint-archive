# railprint

A railway network map built from real OpenStreetMap geometry, shown on the web and exportable as large prints.

The line list is hand-maintained in `data/catalog/`; geometry comes from OSM; the background is physical geography only (land and sea, terrain, rivers and lakes), with no political boundaries.

## Layout

| Path              | Contents                            |
| ----------------- | ----------------------------------- |
| `apps/web`        | Web viewer (placeholder for now)    |
| `packages/layout` | Canonical repository and data paths |

## Requirements

Node.js 24 or newer (TypeScript runs directly through Node's type stripping) and pnpm.

```sh
pnpm install
```

## Commands

Run from the repository root:

| Command      | Purpose                           |
| ------------ | --------------------------------- |
| `pnpm test`  | Run all package tests             |
| `pnpm check` | Lint, type check and format check |
| `pnpm dev`   | Start the web app                 |

## Package conventions

- Internal packages export TypeScript sources directly (`"exports": { ".": "./src/index.ts" }`); there is no build step for them. Relative imports use the `.ts` extension and only erasable TypeScript syntax (`erasableSyntaxOnly`), so Node can run them as is.
- Node-side packages extend `tsconfig.node.json`; browser code extends `tsconfig.base.json`.
- Each package has its own `rstack.config.ts` with `define.test()`; tests live in `tests/` and import from `rstack/test`.
- CLIs resolve every path from the repository root (found through `pnpm-workspace.yaml`), so they work from any working directory.

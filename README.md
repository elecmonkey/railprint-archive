# railprint

A railway network map built from real OpenStreetMap geometry, shown on the web and exportable as large prints.

The line list is hand-maintained in `data/catalog/`; geometry comes from OSM; the background is physical geography only (land and sea, terrain, rivers and lakes), with no political boundaries.

## Layout

| Path                | Contents                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| `apps/web`          | Web map viewer (React, CSS Modules)                                                 |
| `packages/layout`   | Canonical repository and data paths                                                 |
| `packages/sources`  | External data sources: download, resume, checksum, lock file                        |
| `packages/catalog`  | Line catalog types, validation and CLI                                              |
| `packages/osm`      | OSM PBF reader, osmium-based extracts and incremental updates                       |
| `packages/railnet`  | Railway network model: track graph, places, relations, shortest paths               |
| `packages/matching` | Catalog line ↔ OSM matching, confirmed mappings and the review report               |
| `packages/release`  | Final line and station GeoJSON in `data/release/`                                   |
| `packages/style`    | Design tokens: line, station and background styles, light and dark                  |
| `packages/render`   | Canvas renderer for the release data, shared by the web app and export              |
| `packages/basemap`  | Terrain, rivers and lakes in `packages/basemap/assets/` (committed; rarely rebuilt) |
| `data/`             | Committed data and ignored downloads, see [data/README.md](data/README.md)          |

## Requirements

Node.js 24 or newer (TypeScript runs directly through Node's type stripping), pnpm, and osmium-tool (`brew install osmium-tool`).

```sh
pnpm install
```

## Commands

Run from the repository root:

| Command                                  | Purpose                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm sources status`                    | Which external sources are present locally                               |
| `pnpm sources fetch [id...]`             | Download missing sources and update the lock                             |
| `pnpm sources verify [id...]`            | Re-hash downloaded files against the lock                                |
| `pnpm catalog check`                     | Validate the line catalog and print a summary                            |
| `pnpm catalog notes`                     | List catalog lines with open questions                                   |
| `pnpm osm update [id]`                   | Apply OSM change files to a downloaded extract                           |
| `pnpm osm extract`                       | Build the railway extract in `data/cache/osm/`                           |
| `pnpm match [line-id...]`                | Match catalog lines to OSM, write `data/cache/matching/report.{json,md}` |
| `pnpm match confirm <line-id...\|--all>` | Fix the current result of lines in `data/mapping/`                       |
| `pnpm match audit`                       | Re-route confirmed lines under the current rules and list differences    |
| `pnpm release`                           | Build `data/release/` from the confirmed mappings                        |
| `pnpm basemap`                           | Rebuild the basemap assets (see packages/basemap/README.md)              |
| `pnpm test`                              | Run all package tests                                                    |
| `pnpm check`                             | Lint, type check and format check                                        |
| `pnpm dev`                               | Start the web app at http://localhost:3000, serving `data/release/`      |

## Package conventions

- Internal packages export TypeScript sources directly (`"exports": { ".": "./src/index.ts" }`); there is no build step for them. Relative imports use the `.ts` extension and only erasable TypeScript syntax (`erasableSyntaxOnly`), so Node can run them as is.
- Node-side packages extend `tsconfig.node.json`; browser code extends `tsconfig.base.json`.
- Each package has its own `rstack.config.ts` with `define.test()`; tests live in `tests/` and import from `rstack/test`.
- CLIs resolve every path from the repository root (found through `pnpm-workspace.yaml`), so they work from any working directory.

## Licences

Map data © OpenStreetMap contributors (ODbL 1.0). Other sources and their terms are listed in `data/sources.json`.

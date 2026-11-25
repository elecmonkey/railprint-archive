# AGENTS.md

## Layout

| Path                | Contents                                                                            |
| ------------------- | ----------------------------------------------------------------------------------- |
| `apps/web`          | Web map viewer (React, CSS Modules)                                                 |
| `packages/layout`   | Canonical repository and data paths                                                 |
| `packages/sources`  | External data sources: download, resume, checksum, lock file                        |
| `packages/catalog`  | Line catalog types, validation and CLI                                              |
| `packages/osm`      | OSM PBF reader, osmium-based extracts and incremental updates                       |
| `packages/railnet`  | Railway network model: track graph, places, relations, shortest paths               |
| `packages/matching` | Catalog line ↔ OSM matching, confirmation, audit and the review report              |
| `packages/release`  | Final line and station GeoJSON in `data/release/`                                   |
| `packages/style`    | Design tokens: line, station and background styles, light and dark                  |
| `packages/render`   | Canvas renderer for the release data, shared by the web app and export              |
| `packages/export`   | Flat image of the whole network with terrain, rivers and lakes                      |
| `packages/basemap`  | Terrain, rivers and lakes in `packages/basemap/assets/` (committed; rarely rebuilt) |
| `data/`             | Committed data and ignored downloads, see [data/README.md](data/README.md)          |

## Requirements

Node.js 24 or newer (TypeScript runs directly through Node's type stripping), pnpm, and osmium-tool (`brew install osmium-tool`).

```sh
pnpm install
```

## Commands

Run from the repository root:

| Command                                       | Purpose                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm sources status`                         | Which external sources are present locally                               |
| `pnpm sources fetch [id...]`                  | Download missing sources and update the lock                             |
| `pnpm sources verify [id...]`                 | Re-hash downloaded files against the lock                                |
| `pnpm catalog check`                          | Validate the line catalog and print a summary                            |
| `pnpm catalog notes`                          | List catalog lines with open questions                                   |
| `pnpm osm update [id]`                        | Apply OSM change files to a downloaded extract                           |
| `pnpm osm extract`                            | Build the railway extract in `data/cache/osm/`                           |
| `pnpm match [line-id...]`                     | Match catalog lines to OSM, write `data/cache/matching/report.{json,md}` |
| `pnpm match confirm <line-id...\|--all>`      | Record the current result of lines in `data/catalog/`                    |
| `pnpm match audit`                            | Re-route confirmed lines under the current rules and list differences    |
| `pnpm match overlaps [line-id...]`            | List track lines share with other lines, so it counts twice              |
| `pnpm release`                                | Build `data/release/` from the confirmed catalog                         |
| `pnpm basemap`                                | Rebuild the basemap assets (see packages/basemap/README.md)              |
| `pnpm export [--width --scale --theme --out]` | Render the network as an image in `data/cache/export/`                   |

## JavaScript toolchain

The JavaScript toolchain is [Rstack](https://rstack.rs), run as `pnpm exec rs`.

| Command      | Purpose                                    |
| ------------ | ------------------------------------------ |
| `pnpm dev`   | Start the web app at http://localhost:3000 |
| `pnpm build` | Build the web app into `apps/web/dist/`    |
| `pnpm test`  | Run all package tests                      |
| `pnpm check` | Lint, type check and format check          |

## Package conventions

- Internal packages export TypeScript sources directly (`"exports": { ".": "./src/index.ts" }`); there is no build step for them. Relative imports use the `.ts` extension and only erasable TypeScript syntax (`erasableSyntaxOnly`), so Node can run them as is.
- Node-side packages extend `tsconfig.node.json`; browser code extends `tsconfig.base.json`.
- Each package has its own `rstack.config.ts` with `define.test()`; tests live in `tests/` and import from `rstack/test`.
- CLIs resolve every path from the repository root (found through `pnpm-workspace.yaml`), so they work from any working directory.

## Updating data and the lock

Requires osmium-tool (`brew install osmium-tool`).

Sources are declared in `data/sources.json`, downloaded to `data/sources/` (ignored) and recorded in `data/sources.lock.json` (committed).

```sh
pnpm sources status
pnpm sources fetch [id...] [--force]
pnpm sources verify [id...]
```

- Only `pnpm sources fetch` and `pnpm osm update` write the lock; never edit it by hand.
- Run `verify` after `fetch` or `update`.
- Commit the lock together with data derived from those sources.
- Add a source: add it to `sources.json`, fetch, verify, commit both files.
- Refresh a source: `fetch <id> --force`, verify, rebuild derived data, commit.
- Proxy: run with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`; no proxy code.
- Update an OSM extract incrementally: `pnpm osm update [id]` (default `osm-china`), then `pnpm osm extract` and `pnpm match`. A full `fetch --force` resets it to a fresh download.
- `pnpm match` must end with every line `confirmed`. Lines that turn `review` or `failed` after an update need the author's decision before `pnpm match confirm <id>`; never confirm them on your own.
- After changing matching rules or updating OSM, run `pnpm match audit`: it re-routes confirmed lines and lists those that would change. Show the list to the author; do not re-confirm on your own.
- After `pnpm match confirm`, run `pnpm release` and commit `data/catalog/` and `data/release/` together.

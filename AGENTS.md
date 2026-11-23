# AGENTS.md

This project uses Rstack CLI as its JS toolchain:

- Read the docs linked from `node_modules/rstack/docs/llms.txt` when needed
- Online docs: https://rstack.rs/llms.txt
- Run `rs -h` for CLI help

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
- Update an OSM extract incrementally: `pnpm osm update [id]` (default `osm-china`), then `pnpm osm extract`. A full `fetch --force` resets it to a fresh download.

# AGENTS.md

This project uses Rstack CLI as its JS toolchain:

- Read the docs linked from `node_modules/rstack/docs/llms.txt` when needed
- Online docs: https://rstack.rs/llms.txt
- Run `rs -h` for CLI help

## Updating data and the lock

Sources are declared in `data/sources.json`, downloaded to `data/sources/` (ignored) and recorded in `data/sources.lock.json` (committed).

```sh
pnpm sources status
pnpm sources fetch [id...] [--force]
pnpm sources verify [id...]
```

- Only `pnpm sources fetch` writes the lock; never edit it by hand.
- Run `verify` after `fetch`.
- Commit the lock together with data derived from those sources.
- Add a source: add it to `sources.json`, fetch, verify, commit both files.
- Refresh a source: `fetch <id> --force`, verify, rebuild derived data, commit.
- Proxy: run with `NODE_USE_ENV_PROXY=1` and `HTTPS_PROXY`; no proxy code.

# Data

Everything the map is built from. Human decisions and small reproducible records are committed; large downloads and anything that can be regenerated are ignored.

```
data/
├── sources.json        committed  declared external sources
├── sources.lock.json   committed  what was actually downloaded (generated)
├── catalog/            committed  the line catalog (planned)
├── mapping/            committed  catalog line → OSM correspondence (planned)
├── release/            committed  final geometry for web and export (planned)
├── sources/            ignored    raw downloads, never edited
└── cache/              ignored    rebuildable intermediates
```

## External sources

`sources.json` declares every external file: URL, destination under `sources/`, licence and attribution, and optionally an upstream checksum. Sources marked `"optional": true` are only fetched when named explicitly.

```sh
pnpm sources status            # what is present
pnpm sources fetch             # all non-optional sources
pnpm sources fetch osm-japan   # a single (optional) source
pnpm sources verify            # re-hash local files against the lock
```

`fetch` writes `sources.lock.json` after every completed file. A lock entry records the declared URL, the concrete URL after redirects (for example the dated snapshot behind Geofabrik's `*-latest`), size, sha256, the verified upstream checksum, ETag / Last-Modified and the download time. Commit the lock together with any data derived from those files.

### Downloads and resume

- Interrupted transfers keep `<file>.part` plus `<file>.part.json`. Running `fetch` again resumes with `Range` / `If-Range`, against the same concrete snapshot. If the server no longer has it, the download restarts from zero.
- A file only appears at its final path after its size and upstream checksum have been verified.
- Transfers with no data for 60 s are aborted and retried with backoff.
- Several `fetch` processes can run at once, e.g. a slow source in one terminal and the rest in another. Each file is downloaded by one process only (others skip it), and lock entries are merged instead of overwritten.

  ```sh
  pnpm sources fetch osm-china   # terminal 1
  pnpm sources fetch             # terminal 2: skips osm-china while it runs
  ```

### Proxy

Downloads use Node's built-in fetch. To go through a proxy, set `HTTPS_PROXY` / `HTTP_PROXY` (and `NO_PROXY`) and `NODE_USE_ENV_PROXY=1`:

```sh
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:10802 pnpm sources fetch
```

`ALL_PROXY` is not read by Node.

### Updating a source

- Any source: `pnpm sources fetch <id> --force` downloads it again and replaces the lock entry.

Rebuild everything derived from an updated source and commit the lock with it.

## Licences

OSM-derived data (`release/`, and anything else built from OSM) is © OpenStreetMap contributors under ODbL 1.0 and must carry that attribution. Natural Earth and ETOPO are public domain; attribution texts are in `sources.json`.

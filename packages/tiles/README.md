# @railprint/tiles

Global terrain tiles for the web app and exports, built from ETOPO 2022 and Natural Earth land and lakes. They are not committed and not built with the site: they are uploaded by hand to their own site, `https://tiles.rail.elecmonkey.com/`.

```sh
pnpm tiles    # = pnpm --filter @railprint/tiles build
```

The build fetches its sources (`etopo-2022-60s`, `etopo-2022-30s`, `ne-10m-land`, `ne-10m-lakes`), writes the tiles to `dist/` and their hash to `version.json`. Commit `version.json`; upload the contents of `dist/` to the tiles site. The tiles only change with their sources or the encoding.

## Tiles

| Level | Cell | Tile span | Source    |
| ----- | ---- | --------- | --------- |
| 0     | 8′   | 60°       | ETOPO 60″ |
| 1     | 4′   | 30°       | ETOPO 60″ |
| 2     | 2′   | 15°       | ETOPO 60″ |
| 3     | 1′   | 7.5°      | ETOPO 60″ |
| 4     | 30″  | 3.75°     | ETOPO 30″ |

- 450×450 lossless WebP at `dist/<level>/<x>/<y>.webp`, counted from 180°W and the north pole; every level divides the globe and the ETOPO grid exactly. The tile scheme is in `packages/render/src/tiles.ts`.
- Channels are data: R hillshade, G sqrt(elevation / 7000 m) on land, B land fraction (lakes are water).
- Only tiles with land exist; open sea is drawn as one colour. Sea pixels in coastal tiles carry flat shade and no elevation.
- `dist/edgeone.json` (copied from `edgeone.json`) sets the tiles site's headers: `Access-Control-Allow-Origin: https://rail.elecmonkey.com` everywhere, a year's immutable cache for tiles (their URLs carry the hash), `no-cache` for `tiles.json`.
- `dist/tiles.json` lists the tiles of each level and `hash`, a sha256 over every tile's pixels (not the encoded files, so builds that compute the same terrain agree).

## Web app

The web build reads `version.json` and the page compares that hash with the served `tiles.json`, noting on the map when they differ or the tiles cannot be loaded. `pnpm dev` serves `dist/` at `/tiles/` and refuses to start without it. The deployed site loads tiles from `https://tiles.rail.elecmonkey.com/` (set `TILES_URL` at build time to change it), so the tiles site must send `Access-Control-Allow-Origin` for the site's origin.

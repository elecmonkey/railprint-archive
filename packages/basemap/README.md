# @railprint/basemap

Builds the physical-geography basemap in `assets/`: terrain textures, rivers and lake outlines. The web app imports these files, so the build gives each a name with a content hash; a texture added to `terrain.json` also needs an import in `apps/web/src/data/useBasemap.ts`.

**You normally do not run this.** `assets/` is committed. It depends only on Natural Earth and ETOPO, which rarely change, not on the railway data. Rebuild only when those sources, the texture specs or the encoding change:

```sh
pnpm sources fetch ne-10m-land ne-10m-lakes ne-10m-rivers-lake-centerlines etopo-2022-60s etopo-2022-30s
pnpm basemap
```

Then commit `assets/` together with the code change.

## Outputs

| File                          | Contents                                          |
| ----------------------------- | ------------------------------------------------- |
| `terrain-global.webp`         | 3600×1800, 6′ cells, whole world                  |
| `terrain-east-asia-west.webp` | 4500×4560, 30″ cells, 73–110.5°E, 17–55°N         |
| `terrain-east-asia-east.webp` | 4500×4560, 30″ cells, 109.5–147°E, 17–55°N        |
| `terrain.json`                | Grid of each texture and the channel encoding     |
| `rivers.geojson`              | Natural Earth 1:10m rivers with scale rank        |
| `lakes.geojson`               | Natural Earth 1:10m lake outlines with scale rank |

The global texture comes from ETOPO 60″. The two East Asia textures come from ETOPO 30″ at full resolution and together cover China, Korea and Japan; they overlap by one degree so the renderer can fade between them. Devices whose texture limit is below 4560 px use the global texture only.

Terrain textures are lossless WebP whose channels are data, not colours: R hillshade, G sqrt(elevation / 7000 m) on land, B land fraction (lakes count as water). `@railprint/render` turns them into colours per theme.

Natural Earth and ETOPO 2022 are public domain; attribution texts are in `data/sources.json`.

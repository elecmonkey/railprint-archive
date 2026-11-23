# @railprint/basemap

Builds the physical-geography basemap in `assets/`: terrain textures, rivers and lake outlines. The web app serves `assets/` at the site root.

**You normally do not run this.** `assets/` is committed. It depends only on Natural Earth and ETOPO, which rarely change, not on the railway data. Rebuild only when those sources, the texture specs or the encoding change:

```sh
pnpm sources fetch ne-10m-land ne-10m-lakes ne-10m-rivers-lake-centerlines etopo-2022-60s
pnpm basemap
```

Then commit `assets/` together with the code change.

## Outputs

| File                     | Contents                                          |
| ------------------------ | ------------------------------------------------- |
| `terrain-global.webp`    | 3600×1800, 6′ cells, whole world                  |
| `terrain-east-asia.webp` | 4500×2400, 1′ cells, 70–145°E, 15–55°N            |
| `terrain.json`           | Grid of each texture and the channel encoding     |
| `rivers.geojson`         | Natural Earth 1:10m rivers with scale rank        |
| `lakes.geojson`          | Natural Earth 1:10m lake outlines with scale rank |

Terrain textures are lossless WebP whose channels are data, not colours: R hillshade, G sqrt(elevation / 7000 m) on land, B land fraction (lakes count as water). `@railprint/render` turns them into colours per theme.

Natural Earth and ETOPO 2022 are public domain; attribution texts are in `data/sources.json`.

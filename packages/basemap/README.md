# @railprint/basemap

Builds the rivers and lake outlines in `assets/` from Natural Earth 1:10m. The web app imports these files, so the build gives each a name with a content hash. Terrain comes from `packages/tiles`.

**You normally do not run this.** `assets/` is committed and depends only on Natural Earth, which rarely changes:

```sh
pnpm sources fetch ne-10m-lakes ne-10m-rivers-lake-centerlines
pnpm basemap
```

Then commit `assets/` together with the code change.

| File             | Contents                                          |
| ---------------- | ------------------------------------------------- |
| `rivers.geojson` | Natural Earth 1:10m rivers with scale rank        |
| `lakes.geojson`  | Natural Earth 1:10m lake outlines with scale rank |

Natural Earth is public domain; attribution texts are in `data/sources.json`.

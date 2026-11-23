# Line catalog

`lines.json` lists every railway section the map draws, divided the way the author divides the network. It is the source of truth: add, split, merge or correct lines here, then run `pnpm catalog check`.

The catalog says _what_ to draw; how each line corresponds to OSM relations, nodes and ways lives in `data/mapping/`. One catalog line may cover several OSM relations or part of one.

## Line fields

```jsonc
{
  "id": "西延高铁/延安-西安东", // stable key, see below
  "name": "西延高铁", // display name
  "aliases": ["西延高速线"], // optional: other names for the same section
  "from": "延安", // endpoint, see notation
  "to": "西安东",
  "group": { "scope": "省内线路", "province": "陕西省" },
  "category": "trunk", // optional: map category, overriding the automatic one
  "notes": ["…"], // optional: remarks and open questions
}
```

`group` is one of:

- `{ "scope": "跨省线路", "class": "客运专线" | "普速三横五纵" | "动分客货共线" | "其它线路" }`
- `{ "scope": "省内线路", "province": "<省级行政区>" }`

### Map category

Lines are drawn in three categories: `emu` (red, lines with 动车), `trunk` (black, conventional lines) and `other` (grey, 联络线). The automatic rule: 客运专线, 动分客货共线 and provincial high-speed or intercity lines are `emu`; 联络线 and 疏解线 are `other`; every other line is `trunk`. Set `category` on a line to override it, e.g. `other` for a minor branch.

### Endpoint notation

| Written  | Meaning                           |
| -------- | --------------------------------- |
| `西安东` | passenger station                 |
| `<耿镇>` | junction / 线路所                 |
| `[吕河]` | station without passenger service |

### IDs

`id` is `<name>/<from>-<to>` without endpoint markers, set when the line is created. Mapping files refer to lines by id, so **never change an id** once it exists, even if the name or endpoints are corrected later. A new line gets a new id.

## Rules checked by `pnpm catalog check`

- ids are unique; no two lines repeat the same name and endpoints
- endpoints parse in the notation above, and differ from each other
- `group` uses a known scope and class
- no unknown fields

## History

The initial 195 lines were imported on 2026-11-23 from the author's earlier hand-drawn draft. While importing, names that differ only in 高速线 / 高铁 / 客专 / 城际 suffixes for the same section were merged into one line with aliases. Lines whose endpoint markers disagreed in the draft carry a note.

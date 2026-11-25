---
name: record-trip
description: Update the line catalog after the author rides a train. Use when the author describes a trip (where they went, the main and link lines it used) and wants the map updated, or asks what a planned trip would add.
---

# Recording a trip

The catalog in `data/catalog/` lists the sections the author has ridden, divided the way the author divides the network. A trip becomes new or changed catalog lines. The author decides every line; propose, never settle on your own. Reply in the author's language.

## 1. Work out the route

- Write the trip as a chain of sections: `line: from → to`, including the link lines (联络线) and junctions (线路所) where the train changes lines.
- Compare it with `data/catalog/lines.json`: which sections are already there, which extend or join an existing line, which are new.
- Fill gaps from OSM, not by guessing: route relations, junctions near the change of line, the track between them. `data/cache/osm/china-rail.osm.pbf` loads with `loadRailNetwork` from `@railprint/railnet`; put such scripts in the scratchpad, never in the repository.
- Where OSM allows several routes (parallel lines, which link was used), ask the author.
- Propose the changes as a list (add, extend, merge, remove) and wait for agreement.

## 2. Divide it into lines

- Name each line after the railway it is, as OSM names it: 高铁 / 客专 / 高速线 variants are the same line. A connector is a link line named after its OSM 联络线 relation. Never invent a name for a section.
- Endpoints are stations, written by name, or junctions (线路所), written `<name>` without 线路所. Never invent names for unnamed track nodes; a short overlap at a station throat is fine.
- Category: `emu` for 动车 lines, `conventional` for 普速, `link` for 联络线.
- Never let one line contain another. When the trip covers more of a line already in the catalog, replace the pieces it covers with one line over the whole ridden extent: `杭深线/杭州东-宁波` replaces `杭深线/杭州东-绍兴北`, and several 杭深线 pieces become `杭深线/杭州东-深圳北`.
- Short shared track is normal and stays: a link line leaving a station along a main line for a kilometre or two (`厦门北联络线` runs 1.25 km on 杭深线 before it turns off), or lines meeting at a station throat. Do not move endpoints to unnamed points to remove it.

## 3. Edit and match

1. Edit `lines.json` (see `data/catalog/README.md` for the format). Pin endpoints already known: copy `osm.from` / `osm.to` from lines ending at the same place. Remove the `paths.json` entries of lines that are changed or removed. Run `pnpm catalog check`.
2. `pnpm match <id...>`, then read `data/cache/matching/report.md`: endpoints, length, detour, coverage, relations.
3. `pnpm match overlaps <id...>` lists track shared with other lines. Short overlaps at stations and junctions are expected; a long one, or one as long as the shorter line, means a line contains another and must be merged.
4. A wrong route: pin the endpoints, or force relations with `osm.relations` and `osm.fixedRelations: true`, and match again.
5. Show the author each line (id, length, relations, overlaps) and the change in totals: lines and km before and after.

For a planned trip, do the same without touching the catalog: match in a scratch script and build the release in memory (`Matcher`, `confirmMatch`, `buildRelease`, `releaseMeta`). To show it on the map, write that release to `data/release/` for `pnpm dev` and restore it with `git checkout data/release` afterwards.

## 4. Confirm and release

Only after the author confirms the result:

1. `pnpm match confirm <id...>`
2. `pnpm exec rs fmt data/catalog/lines.json` (confirming rewrites the layout of `notes`)
3. `pnpm release`, then `pnpm catalog check`: every line confirmed.
4. Commit `data/catalog/` and `data/release/` together (`data: …`). Push only when asked.

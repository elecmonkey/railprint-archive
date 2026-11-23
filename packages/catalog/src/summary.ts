import { parseEndpoint } from './endpoint.ts';
import type { Catalog, LineCategory } from './types.ts';

export interface CatalogSummary {
  lines: number;
  byCategory: Record<LineCategory, number>;
  endpointKinds: Record<string, number>;
  confirmed: number;
  withNotes: number;
}

export function summarizeCatalog(catalog: Catalog): CatalogSummary {
  const byCategory: Record<LineCategory, number> = {
    emu: 0,
    conventional: 0,
    link: 0,
  };
  const endpointKinds: Record<string, number> = {};
  for (const line of catalog.lines) {
    byCategory[line.category]++;
    for (const end of [line.from, line.to]) {
      const { kind } = parseEndpoint(end);
      endpointKinds[kind] = (endpointKinds[kind] ?? 0) + 1;
    }
  }
  return {
    lines: catalog.lines.length,
    byCategory,
    endpointKinds,
    confirmed: catalog.lines.filter((l) => l.osm?.confirmed).length,
    withNotes: catalog.lines.filter((l) => l.notes?.length).length,
  };
}

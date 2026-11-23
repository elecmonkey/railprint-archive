import { parseEndpoint } from './endpoint.ts';
import type { Catalog } from './types.ts';

export interface CatalogSummary {
  lines: number;
  byGroup: { label: string; lines: number }[];
  endpointKinds: Record<string, number>;
  withNotes: number;
}

export function groupLabel(group: Catalog['lines'][number]['group']): string {
  return group.scope === '跨省线路'
    ? `跨省线路/${group.class}`
    : `省内线路/${group.province}`;
}

export function summarizeCatalog(catalog: Catalog): CatalogSummary {
  const groups = new Map<string, number>();
  const endpointKinds: Record<string, number> = {};
  for (const line of catalog.lines) {
    const label = groupLabel(line.group);
    groups.set(label, (groups.get(label) ?? 0) + 1);
    for (const end of [line.from, line.to]) {
      const { kind } = parseEndpoint(end);
      endpointKinds[kind] = (endpointKinds[kind] ?? 0) + 1;
    }
  }
  return {
    lines: catalog.lines.length,
    byGroup: [...groups].map(([label, lines]) => ({ label, lines })),
    endpointKinds,
    withNotes: catalog.lines.filter((l) => l.notes?.length).length,
  };
}

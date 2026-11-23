import { simplify } from '@railprint/render';
import type { Ring, Shapefile } from './shapefile.ts';

export interface VectorFeature {
  type: 'Feature';
  properties: { name?: string; rank: number };
  geometry: { type: 'MultiLineString'; coordinates: Ring[] };
}

/** Degrees; finer than the terrain grid, coarse enough for a small file. */
export const VECTOR_TOLERANCE = 0.004;

const round5 = (n: number) => Math.round(n * 1e5) / 1e5;

/**
 * Lines (rivers) or polygon outlines (lakes) as MultiLineStrings with a
 * Natural Earth scale rank, simplified and rounded.
 */
export function toLines(
  shapefile: Shapefile,
  keep: (properties: Record<string, string | number>) => boolean,
): VectorFeature[] {
  const features: VectorFeature[] = [];
  for (const record of shapefile.records) {
    if (!keep(record.properties)) continue;
    const parts = record.parts
      .map((part) =>
        simplify(part, VECTOR_TOLERANCE).map(
          ([x, y]) => [round5(x), round5(y)] as [number, number],
        ),
      )
      .filter((part) => part.length >= 2);
    if (!parts.length) continue;
    const name = String(
      record.properties.name_zh || record.properties.name || '',
    ).trim();
    features.push({
      type: 'Feature',
      properties: {
        ...(name ? { name } : {}),
        rank: Number(record.properties.scalerank ?? 0),
      },
      geometry: { type: 'MultiLineString', coordinates: parts },
    });
  }
  return features.sort((a, b) => a.properties.rank - b.properties.rank);
}

/** GeoJSON with one feature per line of text. */
export function featureCollection(features: object[]): string {
  return `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

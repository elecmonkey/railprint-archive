import { light } from '@railprint/style';
import type { Bounds } from './projection.ts';
import { simplify } from './simplify.ts';
import type {
  LinesCollection,
  RenderData,
  StationsCollection,
} from './types.ts';

/**
 * Simplification tolerances in degrees, coarsest first. The renderer picks
 * the level whose tolerance stays below about half a pixel (see `levelFor`).
 */
export const LEVEL_TOLERANCES = [0.02, 0.005, 0.0012, 0.0003, 0] as const;

export function prepareData(
  lines: LinesCollection,
  stations: StationsCollection,
): RenderData {
  const prepared = lines.features.map((feature) => ({
    properties: feature.properties,
    category: feature.properties.category,
    levels: LEVEL_TOLERANCES.map((t) =>
      simplify(feature.geometry.coordinates, t),
    ),
  }));
  // Draw order is a property of the category, identical in every theme.
  prepared.sort(
    (a, b) => light.lines[a.category].z - light.lines[b.category].z,
  );
  return {
    lines: prepared,
    stations: stations.features.map((f) => ({
      properties: f.properties,
      coordinates: f.geometry.coordinates,
    })),
  };
}

/** Index into `LEVEL_TOLERANCES` for a given number of pixels per degree. */
export function levelFor(pixelsPerDegree: number): number {
  const maxTolerance = 0.5 / pixelsPerDegree;
  const index = LEVEL_TOLERANCES.findIndex((t) => t <= maxTolerance);
  return index < 0 ? LEVEL_TOLERANCES.length - 1 : index;
}

/** Extent of all line geometry. */
export function dataBounds(data: RenderData): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const line of data.lines) {
    for (const [lon, lat] of line.levels[0]!) {
      bounds[0] = Math.min(bounds[0], lon);
      bounds[1] = Math.min(bounds[1], lat);
      bounds[2] = Math.max(bounds[2], lon);
      bounds[3] = Math.max(bounds[3], lat);
    }
  }
  return bounds;
}

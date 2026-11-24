import { chunk, type Chunk } from './chunks.ts';
import { simplify } from './simplify.ts';

/** Feature in data/release/basemap/{rivers,lakes}.geojson. */
export interface BasemapFeature {
  type: 'Feature';
  properties: { name?: string; rank: number };
  geometry: { type: 'MultiLineString'; coordinates: [number, number][][] };
}

export interface BasemapCollection {
  type: 'FeatureCollection';
  features: BasemapFeature[];
}

export interface BasemapLine {
  /** Natural Earth scale rank: lower is more important. */
  rank: number;
  /** [coarse, full] geometry, every part cut into chunks. */
  levels: [Chunk[], Chunk[]];
}

export interface BasemapData {
  rivers: BasemapLine[];
  lakes: BasemapLine[];
}

const COARSE_TOLERANCE = 0.02;

function prepare(collection: BasemapCollection): BasemapLine[] {
  return collection.features.map((f) => ({
    rank: f.properties.rank,
    levels: [
      f.geometry.coordinates.flatMap((part) =>
        chunk(simplify(part, COARSE_TOLERANCE)),
      ),
      f.geometry.coordinates.flatMap(chunk),
    ],
  }));
}

export function prepareBasemap(
  rivers: BasemapCollection,
  lakes: BasemapCollection,
): BasemapData {
  return { rivers: prepare(rivers), lakes: prepare(lakes) };
}

/** Highest scale rank shown at a zoom (pixels per degree). */
export function maxRank(pixelsPerDegree: number): number {
  if (pixelsPerDegree < 8) return 3;
  if (pixelsPerDegree < 20) return 6;
  if (pixelsPerDegree < 60) return 8;
  return 12;
}

import type { CategorizableLine, LineCategory } from '@railprint/style';

/** Properties of a feature in data/release/lines.geojson. */
export interface ReleaseLineProperties extends CategorizableLine {
  id: string;
  name: string;
  aliases?: string[];
  from: string;
  to: string;
  lengthKm: number;
  highSpeedShare: number;
  relations: { id: number; name: string }[];
}

/** Properties of a feature in data/release/stations.geojson. */
export interface ReleaseStationProperties {
  osm: string;
  name: string;
  osmName?: string;
  kind: 'station' | 'junction' | 'non-passenger';
  endpoint: boolean;
  lines: string[];
}

export interface FeatureCollection<G, P> {
  type: 'FeatureCollection';
  features: { type: 'Feature'; properties: P; geometry: G }[];
}

export type LinesCollection = FeatureCollection<
  { type: 'LineString'; coordinates: [number, number][] },
  ReleaseLineProperties
>;
export type StationsCollection = FeatureCollection<
  { type: 'Point'; coordinates: [number, number] },
  ReleaseStationProperties
>;

/** A line ready for drawing, with geometry at several levels of detail. */
export interface RenderLine {
  properties: ReleaseLineProperties;
  category: LineCategory;
  /** One coordinate list per `LEVEL_TOLERANCES` entry, coarsest first. */
  levels: [number, number][][];
}

export interface RenderStation {
  properties: ReleaseStationProperties;
  coordinates: [number, number];
}

export interface RenderData {
  lines: RenderLine[];
  stations: RenderStation[];
}

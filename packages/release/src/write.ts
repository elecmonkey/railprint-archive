import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Release, ReleaseLine, ReleaseStation } from './build.ts';

export const RELEASE_FILES = {
  lines: 'lines.geojson',
  stations: 'stations.geojson',
  meta: 'meta.json',
} as const;

export interface ReleaseMeta {
  osm: {
    source: string;
    sha256: string;
    timestamp?: string;
    sequence?: number;
  };
  attribution: string;
  license: string;
  counts: {
    lines: number;
    stations: number;
    endpoints: number;
    lengthKm: number;
  };
}

/** GeoJSON FeatureCollection with one feature per line of text. */
export function featureCollection(features: object[]): string {
  return `{"type":"FeatureCollection","features":[\n${features.map((f) => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

export function lineFeature(line: ReleaseLine): object {
  const { coordinates, ...properties } = line;
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'LineString', coordinates },
  };
}

export function stationFeature(station: ReleaseStation): object {
  const { coordinates, ...properties } = station;
  return {
    type: 'Feature',
    properties,
    geometry: { type: 'Point', coordinates },
  };
}

export function releaseMeta(
  release: Release,
  osm: ReleaseMeta['osm'],
): ReleaseMeta {
  const lengthKm = release.lines.reduce((sum, l) => sum + l.lengthKm, 0);
  return {
    osm,
    attribution: '© OpenStreetMap contributors',
    license: 'ODbL-1.0',
    counts: {
      lines: release.lines.length,
      stations: release.stations.length,
      endpoints: release.stations.filter((s) => s.endpoint).length,
      lengthKm: Math.round(lengthKm),
    },
  };
}

async function atomicWrite(file: string, text: string): Promise<void> {
  await writeFile(`${file}.tmp`, text);
  await rename(`${file}.tmp`, file);
}

export async function writeRelease(
  dir: string,
  release: Release,
  meta: ReleaseMeta,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  await atomicWrite(
    join(dir, RELEASE_FILES.lines),
    featureCollection(release.lines.map(lineFeature)),
  );
  await atomicWrite(
    join(dir, RELEASE_FILES.stations),
    featureCollection(release.stations.map(stationFeature)),
  );
  await atomicWrite(
    join(dir, RELEASE_FILES.meta),
    `${JSON.stringify(meta, null, 2)}\n`,
  );
}

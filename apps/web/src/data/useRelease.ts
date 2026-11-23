import { useEffect, useState } from 'react';
import {
  prepareData,
  type LinesCollection,
  type RenderData,
  type StationsCollection,
} from '@railprint/render';

export interface ReleaseMeta {
  osm: { timestamp?: string };
  attribution: string;
  counts: { lines: number; stations: number; lengthKm: number };
}

export type ReleaseState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RenderData; meta: ReleaseMeta };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/** Load data/release/ served at the site root and prepare it for drawing. */
export function useRelease(): ReleaseState {
  const [state, setState] = useState<ReleaseState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    Promise.all([
      getJson<LinesCollection>('lines.geojson', signal),
      getJson<StationsCollection>('stations.geojson', signal),
      getJson<ReleaseMeta>('meta.json', signal),
    ])
      .then(([lines, stations, meta]) =>
        setState({ status: 'ready', data: prepareData(lines, stations), meta }),
      )
      .catch((error: unknown) => {
        if (!signal.aborted)
          setState({ status: 'error', message: String(error) });
      });
    return () => controller.abort();
  }, []);
  return state;
}

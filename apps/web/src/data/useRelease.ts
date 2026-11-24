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
  /** Size of each data file in bytes; older releases lack it. */
  bytes?: { lines: number; stations: number };
}

export type ReleaseState =
  /** `progress` is 0–1, or undefined while the total is unknown. */
  | { status: 'loading'; progress?: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: RenderData; meta: ReleaseMeta };

async function getJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Fetch JSON, calling `onBytes` with each chunk's size as it arrives. The
 * sizes are of the file as stored: Content-Length would be the compressed
 * size when the server compresses, so the caller supplies the total.
 */
async function streamJson<T>(
  url: string,
  signal: AbortSignal,
  onBytes: (bytes: number) => void,
): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  if (!response.body) {
    const text = await response.text();
    onBytes(new TextEncoder().encode(text).length);
    return JSON.parse(text) as T;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onBytes(value.byteLength);
  }
  text += decoder.decode();
  return JSON.parse(text) as T;
}

/** Load data/release/ served at the site root and prepare it for drawing. */
export function useRelease(): ReleaseState {
  const [state, setState] = useState<ReleaseState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      // The small meta file first: it says how much there is to load.
      const meta = await getJson<ReleaseMeta>('meta.json', signal);
      const total = meta.bytes
        ? meta.bytes.lines + meta.bytes.stations
        : undefined;
      let loaded = 0;
      let shown = -1;
      const onBytes = (bytes: number) => {
        if (!total) return;
        loaded += bytes;
        // Whole percents are enough; skip renders in between.
        const percent = Math.min(100, Math.floor((loaded / total) * 100));
        if (percent === shown || signal.aborted) return;
        shown = percent;
        setState({ status: 'loading', progress: percent / 100 });
      };
      if (total) setState({ status: 'loading', progress: 0 });
      const [lines, stations] = await Promise.all([
        streamJson<LinesCollection>('lines.geojson', signal, onBytes),
        streamJson<StationsCollection>('stations.geojson', signal, onBytes),
      ]);
      if (!signal.aborted)
        setState({ status: 'ready', data: prepareData(lines, stations), meta });
    })().catch((error: unknown) => {
      if (!signal.aborted)
        setState({ status: 'error', message: String(error) });
    });
    return () => controller.abort();
  }, []);
  return state;
}

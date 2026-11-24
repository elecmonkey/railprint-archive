import type { Hit } from '@railprint/render';

/**
 * What the reader has selected: a line, a station, or a station seen from a
 * line (both set, the station on that line). Ids are release ids and `osm`.
 */
export interface Selection {
  line?: string;
  station?: string;
}

/** Selection after a click that hit `hit`. */
export function selectFromHit(current: Selection, hit: Hit): Selection {
  if (hit.station) {
    const { osm, lines } = hit.station.properties;
    return current.line && lines.includes(current.line)
      ? { line: current.line, station: osm }
      : { station: osm };
  }
  const top = hit.lines[0];
  return top ? { line: top.line.properties.id } : {};
}

export function readHash(hash: string): Selection {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const selection: Selection = {};
  const line = params.get('line');
  const station = params.get('station');
  if (line) selection.line = line;
  if (station) selection.station = station;
  return selection;
}

export function writeHash(selection: Selection): string {
  const params = new URLSearchParams();
  if (selection.line) params.set('line', selection.line);
  if (selection.station) params.set('station', selection.station);
  const text = params.toString();
  return text ? `#${text}` : '';
}

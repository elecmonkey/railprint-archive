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
  if (hit.here > 0) {
    const ids = hit.lines.slice(0, hit.here).map((l) => l.line.properties.id);
    // Clicking shared track again moves on to the next line there.
    const at = current.line ? ids.indexOf(current.line) : -1;
    return { line: ids[(at + 1) % ids.length]! };
  }
  return {};
}

/** Lines sharing the clicked place, when there is more than one. */
export function sharedAt(hit: Hit): string[] {
  return hit.here > 1
    ? hit.lines.slice(0, hit.here).map((l) => l.line.properties.id)
    : [];
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

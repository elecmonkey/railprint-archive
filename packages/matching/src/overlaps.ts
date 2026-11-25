import type { StoredSegment } from '@railprint/catalog';
import {
  haversine,
  nodeIndexOf,
  walkWay,
  wayIndexOf,
  type RailNetwork,
} from '@railprint/railnet';

/** Overlaps shorter than this are ignored. */
const MIN_METRES = 50;

/** Track that two lines both run over, so its length counts twice. */
export interface Overlap {
  line: string;
  other: string;
  km: number;
}

/** Each track edge a path runs over, keyed by its two node indices, with its length in metres. */
function edges(
  network: RailNetwork,
  segments: StoredSegment[],
): Map<string, number> {
  const result = new Map<string, number>();
  for (const [way, from, to] of segments) {
    const nodes = walkWay(
      network,
      wayIndexOf(network, way),
      nodeIndexOf(network, from),
      nodeIndexOf(network, to),
    );
    if (!nodes) continue;
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1]!;
      const b = nodes[i]!;
      result.set(
        a < b ? `${a}:${b}` : `${b}:${a}`,
        haversine(
          network.lon[a]!,
          network.lat[a]!,
          network.lon[b]!,
          network.lat[b]!,
        ),
      );
    }
  }
  return result;
}

/**
 * Track shared between `lines` and every other path, longest first. Each
 * pair is reported once.
 */
export function overlaps(
  network: RailNetwork,
  paths: Record<string, StoredSegment[]>,
  lines: string[] = Object.keys(paths),
): Overlap[] {
  const byLine = new Map(
    Object.entries(paths).map(([id, segments]) => [
      id,
      edges(network, segments),
    ]),
  );
  const seen = new Set<string>();
  const result: Overlap[] = [];
  for (const line of lines) {
    const mine = byLine.get(line);
    if (!mine) continue;
    for (const [other, theirs] of byLine) {
      if (other === line) continue;
      const pair = line < other ? `${line}\n${other}` : `${other}\n${line}`;
      if (seen.has(pair)) continue;
      seen.add(pair);
      let metres = 0;
      for (const [key, length] of mine) if (theirs.has(key)) metres += length;
      // Shorter shared bits are station throats where lines meet.
      if (metres >= MIN_METRES)
        result.push({ line, other, km: Math.round(metres / 100) / 10 });
    }
  }
  return result.sort((a, b) => b.km - a.km);
}

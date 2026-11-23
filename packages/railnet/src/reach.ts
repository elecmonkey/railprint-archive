import type { Anchor } from './route.ts';
import type { RailNetwork } from './network.ts';

/**
 * Track nodes reachable from `starts` within `maxM` metres along the track
 * (plus each start's own cost), with their distances. A bounded Dijkstra
 * over all track ways.
 */
export function reachable(
  network: RailNetwork,
  starts: readonly Pick<Anchor, 'node' | 'cost'>[],
  maxM: number,
  /** Ways that may be traversed; all when omitted. */
  allowWay?: (way: number) => boolean,
): Map<number, number> {
  const { adjOffset, adjNode, adjLength, adjWay } = network;
  const dist = new Map<number, number>();
  const queue: [number, number][] = [];
  for (const { node, cost } of starts) {
    if (cost <= maxM && cost < (dist.get(node) ?? Infinity)) {
      dist.set(node, cost);
      queue.push([cost, node]);
    }
  }
  // The explored area is small, so a sorted array works as the queue.
  while (queue.length) {
    queue.sort((a, b) => b[0] - a[0]);
    const [cost, node] = queue.pop()!;
    if (cost > dist.get(node)!) continue;
    for (let slot = adjOffset[node]!; slot < adjOffset[node + 1]!; slot++) {
      if (allowWay && !allowWay(adjWay[slot]!)) continue;
      const next = adjNode[slot]!;
      const nextCost = cost + adjLength[slot]!;
      if (nextCost <= maxM && nextCost < (dist.get(next) ?? Infinity)) {
        dist.set(next, nextCost);
        queue.push([nextCost, next]);
      }
    }
  }
  return dist;
}

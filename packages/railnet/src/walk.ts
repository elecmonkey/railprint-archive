import type { RailNetwork } from './network.ts';

/**
 * Node indices from `from` to `to` along a single track way, or undefined
 * when the way does not connect them. Used to check that a stored path is
 * still valid in a newer OSM snapshot.
 */
export function walkWay(
  network: RailNetwork,
  way: number,
  from: number,
  to: number,
): number[] | undefined {
  if (from === to) return [from];
  const { adjOffset, adjNode, adjWay } = network;
  // Depth-first over edges of this way only; ways are short, and loops or
  // self-touching ways are handled by the visited set.
  const previous = new Map<number, number>([[from, -1]]);
  const stack = [from];
  while (stack.length) {
    const node = stack.pop()!;
    for (let slot = adjOffset[node]!; slot < adjOffset[node + 1]!; slot++) {
      if (adjWay[slot] !== way) continue;
      const next = adjNode[slot]!;
      if (previous.has(next)) continue;
      previous.set(next, node);
      if (next === to) {
        const nodes = [to];
        for (let n = node; n >= 0; n = previous.get(n)!) nodes.push(n);
        return nodes.reverse();
      }
      stack.push(next);
    }
  }
  return undefined;
}

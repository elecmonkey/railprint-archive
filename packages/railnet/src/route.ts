import type { RailNetwork } from './network.ts';

/** A graph node to start from or end at, with the cost of reaching it. */
export interface Anchor {
  node: number;
  cost: number;
  /** Caller-defined tag, e.g. which candidate place the anchor belongs to. */
  tag: number;
}

export interface RouteOptions {
  /**
   * Cost multiplier per track way index (edge cost = length × factor).
   * Infinity excludes a way. Factors must be ≥ 1 for `maxCost` to be safe.
   */
  wayFactor: Float32Array;
  /** Stop searching beyond this cost. */
  maxCost?: number;
  /** Cost of turning back by more than 90° at a node; see Router. */
  turnPenalty?: number;
}

export interface Route {
  /** Node indices from start to end. */
  nodes: number[];
  /** Track way index of each edge (`nodes.length - 1` entries). */
  ways: number[];
  lengthM: number;
  cost: number;
  from: Anchor;
  to: Anchor;
}

/** Binary min-heap of (cost, node) pairs. */
class Heap {
  private costs: number[] = [];
  private nodes: number[] = [];

  get size() {
    return this.costs.length;
  }

  push(cost: number, node: number) {
    const c = this.costs;
    const n = this.nodes;
    let i = c.length;
    c.push(cost);
    n.push(node);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (c[parent]! <= cost) break;
      c[i] = c[parent]!;
      n[i] = n[parent]!;
      i = parent;
    }
    c[i] = cost;
    n[i] = node;
  }

  pop(): [number, number] {
    const c = this.costs;
    const n = this.nodes;
    const top: [number, number] = [c[0]!, n[0]!];
    const lastCost = c.pop()!;
    const lastNode = n.pop()!;
    if (c.length) {
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        if (left >= c.length) break;
        const right = left + 1;
        const child = right < c.length && c[right]! < c[left]! ? right : left;
        if (c[child]! >= lastCost) break;
        c[i] = c[child]!;
        n[i] = n[child]!;
        i = child;
      }
      c[i] = lastCost;
      n[i] = lastNode;
    }
    return top;
  }
}

/** Cost added for turning back by more than 90° at a node (≈ 30 km of track). */
export const DEFAULT_TURN_PENALTY = 30_000;

/**
 * Reusable multi-source, multi-target Dijkstra over directed edges, so a
 * route knows which way it entered each node. Turning back at a node (more
 * than 90°, e.g. running past a junction and reversing onto the other leg of
 * a triangle) costs `turnPenalty`: trains do not do that except at real
 * switchbacks, which stay possible when there is no other way. Scratch
 * arrays are sized to the network once and reset lazily.
 */
export class Router {
  private readonly network: RailNetwork;
  /** Node each directed edge (adjacency slot) starts from. */
  private readonly slotFrom: Int32Array;
  private readonly dist: Float64Array;
  private readonly prevSlot: Int32Array;
  private readonly origin: Int32Array;
  private touched: number[] = [];

  constructor(network: RailNetwork) {
    this.network = network;
    const slots = network.adjNode.length;
    this.slotFrom = new Int32Array(slots);
    for (let n = 0; n + 1 < network.adjOffset.length; n++) {
      for (let s = network.adjOffset[n]!; s < network.adjOffset[n + 1]!; s++)
        this.slotFrom[s] = n;
    }
    this.dist = new Float64Array(slots).fill(Infinity);
    this.prevSlot = new Int32Array(slots).fill(-1);
    this.origin = new Int32Array(slots).fill(-1);
  }

  private reset() {
    for (const s of this.touched) {
      this.dist[s] = Infinity;
      this.prevSlot[s] = -1;
      this.origin[s] = -1;
    }
    this.touched = [];
  }

  /** True when going a→b→c turns back by more than 90°. */
  private turnsBack(a: number, b: number, c: number): boolean {
    if (a === c) return true;
    const { lon, lat } = this.network;
    const k = Math.cos((lat[b]! * Math.PI) / 180);
    const dot =
      (lon[b]! - lon[a]!) * k * (lon[c]! - lon[b]!) * k +
      (lat[b]! - lat[a]!) * (lat[c]! - lat[b]!);
    return dot < 0;
  }

  /** Cheapest route from any source anchor to any target anchor. */
  route(
    sources: readonly Anchor[],
    targets: readonly Anchor[],
    options: RouteOptions,
  ): Route | undefined {
    this.reset();
    const { adjOffset, adjNode, adjWay, adjLength } = this.network;
    const { wayFactor } = options;
    const maxCost = options.maxCost ?? Infinity;
    const turnPenalty = options.turnPenalty ?? DEFAULT_TURN_PENALTY;
    if (!targets.length || !sources.length) return undefined;
    const targetCost = new Map<number, number>();
    const targetAnchor = new Map<number, number>();
    targets.forEach((t, i) => {
      if (t.cost < (targetCost.get(t.node) ?? Infinity)) {
        targetCost.set(t.node, t.cost);
        targetAnchor.set(t.node, i);
      }
    });

    let best = Infinity;
    let bestSlot = -1;
    // A source that is itself a target gives a route without edges.
    let bestEmpty: { source: number; node: number } | undefined;
    const heap = new Heap();
    sources.forEach((s, i) => {
      const extra = targetCost.get(s.node);
      if (extra !== undefined && s.cost + extra < best) {
        best = s.cost + extra;
        bestEmpty = { source: i, node: s.node };
      }
      for (
        let slot = adjOffset[s.node]!;
        slot < adjOffset[s.node + 1]!;
        slot++
      ) {
        const factor = wayFactor[adjWay[slot]!]!;
        if (factor === Infinity) continue;
        const cost = s.cost + adjLength[slot]! * factor;
        if (cost < this.dist[slot]!) {
          if (this.dist[slot] === Infinity) this.touched.push(slot);
          this.dist[slot] = cost;
          this.origin[slot] = i;
          heap.push(cost, slot);
        }
      }
    });

    while (heap.size) {
      const [cost, slot] = heap.pop();
      if (cost > this.dist[slot]!) continue;
      if (cost >= best || cost > maxCost) break;
      const from = this.slotFrom[slot]!;
      const node = adjNode[slot]!;
      const extra = targetCost.get(node);
      if (extra !== undefined && cost + extra < best) {
        best = cost + extra;
        bestSlot = slot;
        bestEmpty = undefined;
      }
      for (let next = adjOffset[node]!; next < adjOffset[node + 1]!; next++) {
        const factor = wayFactor[adjWay[next]!]!;
        if (factor === Infinity) continue;
        let nextCost = cost + adjLength[next]! * factor;
        if (this.turnsBack(from, node, adjNode[next]!)) nextCost += turnPenalty;
        if (nextCost < this.dist[next]!) {
          if (this.dist[next] === Infinity) this.touched.push(next);
          this.dist[next] = nextCost;
          this.prevSlot[next] = slot;
          this.origin[next] = this.origin[slot]!;
          heap.push(nextCost, next);
        }
      }
    }

    if (bestEmpty) {
      return {
        nodes: [bestEmpty.node],
        ways: [],
        lengthM: 0,
        cost: best,
        from: sources[bestEmpty.source]!,
        to: targets[targetAnchor.get(bestEmpty.node)!]!,
      };
    }
    if (bestSlot < 0) return undefined;

    const nodes: number[] = [];
    const ways: number[] = [];
    let lengthM = 0;
    for (let slot = bestSlot; slot >= 0; slot = this.prevSlot[slot]!) {
      nodes.push(adjNode[slot]!);
      ways.push(adjWay[slot]!);
      lengthM += adjLength[slot]!;
      if (this.prevSlot[slot]! < 0) nodes.push(this.slotFrom[slot]!);
    }
    nodes.reverse();
    ways.reverse();
    return {
      nodes,
      ways,
      lengthM,
      cost: best,
      from: sources[this.origin[bestSlot]!]!,
      to: targets[targetAnchor.get(adjNode[bestSlot]!)!]!,
    };
  }
}

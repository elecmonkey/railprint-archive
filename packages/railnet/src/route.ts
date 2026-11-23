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

/**
 * Reusable multi-source, multi-target Dijkstra. Scratch arrays are sized to
 * the network once and reset lazily, so repeated queries stay cheap.
 */
export class Router {
  private readonly network: RailNetwork;
  private readonly dist: Float64Array;
  private readonly prev: Int32Array;
  private readonly prevSlot: Int32Array;
  private readonly origin: Int32Array;
  private touched: number[] = [];

  constructor(network: RailNetwork) {
    this.network = network;
    const n = network.nodeIds.length;
    this.dist = new Float64Array(n).fill(Infinity);
    this.prev = new Int32Array(n).fill(-1);
    this.prevSlot = new Int32Array(n).fill(-1);
    this.origin = new Int32Array(n).fill(-1);
  }

  private reset() {
    for (const n of this.touched) {
      this.dist[n] = Infinity;
      this.prev[n] = -1;
      this.prevSlot[n] = -1;
      this.origin[n] = -1;
    }
    this.touched = [];
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
    const targetCost = new Map<number, number>();
    const targetAnchor = new Map<number, number>();
    targets.forEach((t, i) => {
      if (t.cost < (targetCost.get(t.node) ?? Infinity)) {
        targetCost.set(t.node, t.cost);
        targetAnchor.set(t.node, i);
      }
    });
    if (!targets.length || !sources.length) return undefined;

    const heap = new Heap();
    sources.forEach((s, i) => {
      if (s.cost < this.dist[s.node]!) {
        if (this.dist[s.node] === Infinity) this.touched.push(s.node);
        this.dist[s.node] = s.cost;
        this.origin[s.node] = i;
        heap.push(s.cost, s.node);
      }
    });

    let best = Infinity;
    let bestNode = -1;
    while (heap.size) {
      const [cost, node] = heap.pop();
      if (cost > this.dist[node]!) continue;
      if (cost >= best || cost > maxCost) break;
      const extra = targetCost.get(node);
      if (extra !== undefined && cost + extra < best) {
        best = cost + extra;
        bestNode = node;
      }
      for (let slot = adjOffset[node]!; slot < adjOffset[node + 1]!; slot++) {
        const factor = wayFactor[adjWay[slot]!]!;
        if (factor === Infinity) continue;
        const next = adjNode[slot]!;
        const nextCost = cost + adjLength[slot]! * factor;
        if (nextCost < this.dist[next]!) {
          if (this.dist[next] === Infinity) this.touched.push(next);
          this.dist[next] = nextCost;
          this.prev[next] = node;
          this.prevSlot[next] = slot;
          this.origin[next] = this.origin[node]!;
          heap.push(nextCost, next);
        }
      }
    }
    if (bestNode < 0) return undefined;

    const nodes: number[] = [];
    const ways: number[] = [];
    let lengthM = 0;
    for (let n = bestNode; n >= 0; n = this.prev[n]!) {
      nodes.push(n);
      const slot = this.prevSlot[n]!;
      if (slot >= 0) {
        ways.push(adjWay[slot]!);
        lengthM += adjLength[slot]!;
      }
    }
    nodes.reverse();
    ways.reverse();
    return {
      nodes,
      ways,
      lengthM,
      cost: best,
      from: sources[this.origin[bestNode]!]!,
      to: targets[targetAnchor.get(bestNode)!]!,
    };
  }
}

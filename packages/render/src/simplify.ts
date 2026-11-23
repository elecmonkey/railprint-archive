/**
 * Douglas–Peucker simplification in degrees, with longitude scaled by the
 * cosine of the line's mean latitude so the tolerance is roughly isotropic.
 * Endpoints are always kept.
 */
export function simplify(
  points: readonly [number, number][],
  tolerance: number,
): [number, number][] {
  if (tolerance <= 0 || points.length <= 2) return points.slice();
  const meanLat = points.reduce((s, p) => s + p[1], 0) / points.length;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const t2 = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = points[first]!;
    const [bx, by] = points[last]!;
    const dx = (bx - ax) * kx;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD2 = t2;
    for (let i = first + 1; i < last; i++) {
      const px = (points[i]![0] - ax) * kx;
      const py = points[i]![1] - ay;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        d2 = ex * ex + ey * ey;
      }
      if (d2 > worstD2) {
        worstD2 = d2;
        worst = i;
      }
    }
    if (worst > 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

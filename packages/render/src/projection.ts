import { geoOrthographic, type GeoProjection } from 'd3-geo';

/** What the globe shows: the point at the centre, and the zoom. */
export interface View {
  /** [lon, lat] at the centre of the viewport. */
  center: [number, number];
  /** Pixels per degree at the centre. */
  pixelsPerDegree: number;
}

const DEG = Math.PI / 180;

/** Orthographic globe centred on `view.center`. */
export function createProjection(
  view: View,
  width: number,
  height: number,
): GeoProjection {
  return geoOrthographic()
    .rotate([-view.center[0], -view.center[1]])
    .scale(view.pixelsPerDegree / DEG)
    .translate([width / 2, height / 2])
    .clipAngle(90)
    .precision(0.5);
}

/** [west, south, east, north] in degrees. */
export type Bounds = [number, number, number, number];

/** Network extent used before data is known. */
export const DEFAULT_BOUNDS: Bounds = [87, 18, 123, 46];

/**
 * View that fits `bounds` into the viewport with `padding` CSS pixels on
 * every side.
 */
export function fitView(
  width: number,
  height: number,
  bounds: Bounds = DEFAULT_BOUNDS,
  padding = 48,
): View {
  const [west, south, east, north] = bounds;
  const midLat = (south + north) / 2;
  const lonSpan = Math.max(0.01, (east - west) * Math.cos(midLat * DEG));
  const latSpan = Math.max(0.01, north - south);
  const pixelsPerDegree = clampZoom(
    Math.min((width - 2 * padding) / lonSpan, (height - 2 * padding) / latSpan),
  );
  return { center: [(west + east) / 2, midLat], pixelsPerDegree };
}

export const MIN_PIXELS_PER_DEGREE = 2;
export const MAX_PIXELS_PER_DEGREE = 4000;

export function clampZoom(pixelsPerDegree: number): number {
  return Math.min(
    MAX_PIXELS_PER_DEGREE,
    Math.max(MIN_PIXELS_PER_DEGREE, pixelsPerDegree),
  );
}

/** Room to leave on each side of the viewport, in CSS pixels. */
export interface Padding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * View that fits `points` into the viewport inside `padding`, measured on
 * the globe as drawn: far from the centre the orthographic projection
 * shortens distances, so a box in degrees would misjudge the extent.
 */
export function fitPoints(
  width: number,
  height: number,
  points: readonly [number, number][],
  padding: Padding,
): View {
  if (!points.length) return fitView(width, height);
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    south = Math.min(south, lat);
    east = Math.max(east, lon);
    north = Math.max(north, lat);
  }
  // At one pixel per degree, positions scale linearly with the zoom.
  let center: [number, number] = [(west + east) / 2, (south + north) / 2];
  let box = [0, 0, 0, 0];
  for (let i = 0; i < 5; i++) {
    const projection = createProjection({ center, pixelsPerDegree: 1 }, 0, 0);
    box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const point of points) {
      const p = projection(point);
      if (!p) continue;
      box = [
        Math.min(box[0]!, p[0]),
        Math.min(box[1]!, p[1]),
        Math.max(box[2]!, p[0]),
        Math.max(box[3]!, p[1]),
      ];
    }
    const mid = projection.invert?.([
      (box[0]! + box[2]!) / 2,
      (box[1]! + box[3]!) / 2,
    ]);
    if (!mid) break;
    center = [mid[0], mid[1]];
  }
  const [x0, y0, x1, y1] = box as [number, number, number, number];
  const room = (x: number, y: number) =>
    Math.min(
      (width - padding.left - padding.right) / Math.max(1e-6, x),
      (height - padding.top - padding.bottom) / Math.max(1e-6, y),
    );
  let view: View = {
    center,
    pixelsPerDegree: clampZoom(room(x1 - x0, y1 - y0)),
  };
  // Moving the centre turns the globe and changes the extent's shape a
  // little, so settle position and zoom together on screen.
  const targetX = (padding.left + width - padding.right) / 2;
  const targetY = (padding.top + height - padding.bottom) / 2;
  for (let i = 0; i < 8; i++) {
    const projection = createProjection(view, width, height);
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const point of points) {
      const p = projection(point);
      if (!p) continue;
      left = Math.min(left, p[0]);
      top = Math.min(top, p[1]);
      right = Math.max(right, p[0]);
      bottom = Math.max(bottom, p[1]);
    }
    const scale = room(right - left, bottom - top);
    const dx = (left + right) / 2 - targetX;
    const dy = (top + bottom) / 2 - targetY;
    if (Math.abs(scale - 1) < 1e-4 && Math.hypot(dx, dy) < 0.05) break;
    const moved = projection.invert?.([width / 2 + dx, height / 2 + dy]);
    view = {
      center: moved ? [moved[0], moved[1]] : view.center,
      pixelsPerDegree: clampZoom(view.pixelsPerDegree * scale),
    };
  }
  return view;
}

import { geoConicConformal, geoOrthographic, type GeoProjection } from 'd3-geo';

export type ProjectionKind = 'globe' | 'conic';

/** What the map shows: projection, the point at the centre, and the zoom. */
export interface View {
  kind: ProjectionKind;
  /** [lon, lat] at the centre of the viewport. */
  center: [number, number];
  /** Pixels per degree at the centre. */
  pixelsPerDegree: number;
}

/**
 * Lambert conformal conic for flat maps of China and its neighbours; the
 * standard parallels of 25°N and 47°N are the usual choice for China.
 */
export const CONIC = { parallels: [25, 47] as [number, number], meridian: 105 };

const DEG = Math.PI / 180;

export function createProjection(
  view: View,
  width: number,
  height: number,
): GeoProjection {
  const scale = view.pixelsPerDegree / DEG;
  if (view.kind === 'globe') {
    return geoOrthographic()
      .rotate([-view.center[0], -view.center[1]])
      .scale(scale)
      .translate([width / 2, height / 2])
      .clipAngle(90)
      .precision(0.5);
  }
  const projection = geoConicConformal()
    .parallels(CONIC.parallels)
    .rotate([-CONIC.meridian, 0])
    .scale(scale)
    .translate([0, 0])
    .precision(0.5);
  const [x, y] = projection(view.center)!;
  return projection.translate([width / 2 - x, height / 2 - y]);
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
  kind: ProjectionKind,
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
  return { kind, center: [(west + east) / 2, midLat], pixelsPerDegree };
}

export const MIN_PIXELS_PER_DEGREE = 2;
export const MAX_PIXELS_PER_DEGREE = 4000;

export function clampZoom(pixelsPerDegree: number): number {
  return Math.min(
    MAX_PIXELS_PER_DEGREE,
    Math.max(MIN_PIXELS_PER_DEGREE, pixelsPerDegree),
  );
}

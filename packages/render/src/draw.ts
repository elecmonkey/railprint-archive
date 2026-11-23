import { geoDistance, geoPath } from 'd3-geo';
import type { LineCategory, Theme } from '@railprint/style';
import { maxRank, type BasemapData } from './basemap.ts';
import { levelFor } from './prepare.ts';
import { createProjection, type View } from './projection.ts';
import type { RenderData, RenderStation } from './types.ts';

/**
 * The subset of CanvasRenderingContext2D the renderer uses, so it also runs
 * against server-side canvas implementations for image export.
 */
export type DrawContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'closePath'
  | 'fill'
  | 'stroke'
  | 'fillRect'
  | 'fillText'
  | 'strokeText'
  | 'measureText'
  | 'save'
  | 'restore'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'globalAlpha'
  | 'lineJoin'
  | 'lineCap'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
>;

export interface DrawOptions {
  context: DrawContext;
  /** Size in CSS pixels; the caller applies any device pixel ratio transform. */
  width: number;
  height: number;
  view: View;
  data: RenderData;
  theme: Theme;
  /**
   * Which stations to draw: only line endpoints (default), or every station
   * along the lines.
   */
  stations?: 'endpoints' | 'all';
  /** Rivers and lake outlines drawn under the railway. */
  basemap?: BasemapData;
  /** Opacity of rivers and lakes, matching the terrain layer (0–1, default 1). */
  basemapOpacity?: number;
  /**
   * A terrain layer is drawn underneath: leave the background transparent
   * and only outline the globe.
   */
  terrain?: boolean;
}

export interface DrawStats {
  level: number;
  stations: number;
  labels: number;
}

/**
 * Role of a station on the map. Endpoints are graded by how many catalog
 * lines meet there: a hub (3+), a terminus (1) or a join (2, usually just
 * where the author split a line into sections). Junctions (线路所) and
 * intermediate stations come last.
 */
export type StationRole =
  'hub' | 'terminus' | 'join' | 'junction' | 'intermediate';

export function stationRole(s: RenderStation): StationRole {
  if (s.properties.kind === 'junction') return 'junction';
  if (!s.properties.endpoint) return 'intermediate';
  const n = s.properties.lines.length;
  return n >= 3 ? 'hub' : n === 1 ? 'terminus' : 'join';
}

/** Pixels per degree at which each role's symbol and label appear. */
export const ROLE_ZOOM: Record<StationRole, { symbol: number; label: number }> =
  {
    hub: { symbol: 50, label: 60 },
    terminus: { symbol: 80, label: 100 },
    join: { symbol: 130, label: 150 },
    junction: { symbol: 180, label: Infinity },
    intermediate: { symbol: 160, label: 220 },
  };

const ROLE_ORDER: StationRole[] = [
  'hub',
  'terminus',
  'join',
  'intermediate',
  'junction',
];

/** Symbol radius in CSS pixels at full size. */
const ROLE_RADIUS: Record<StationRole, number> = {
  hub: 3.2,
  terminus: 2.2,
  join: 2.4,
  junction: 2.4,
  intermediate: 1.8,
};

/** Line widths grow gently with zoom around this reference. */
const REFERENCE_PIXELS_PER_DEGREE = 20;

const LABEL_SIZE = 12;

export function widthScale(pixelsPerDegree: number): number {
  const scale = (pixelsPerDegree / REFERENCE_PIXELS_PER_DEGREE) ** 0.35;
  return Math.min(2.4, Math.max(0.6, scale));
}

export function draw({
  context: ctx,
  width,
  height,
  view,
  data,
  theme,
  basemap,
  terrain,
  stations = 'endpoints',
  basemapOpacity = 1,
}: DrawOptions): DrawStats {
  const projection = createProjection(view, width, height);
  const path = geoPath(projection, ctx as unknown as CanvasRenderingContext2D);
  const ppd = view.pixelsPerDegree;
  const level = levelFor(ppd);
  const scale = widthScale(ppd);

  ctx.save();
  if (!terrain) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
  }
  if (view.kind === 'globe') {
    ctx.beginPath();
    path({ type: 'Sphere' });
    if (!terrain) {
      ctx.fillStyle = theme.sea;
      ctx.fill();
    }
    ctx.strokeStyle = theme.sphere;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (!terrain) {
    ctx.fillStyle = theme.sea;
    ctx.fillRect(0, 0, width, height);
  }

  // Rivers and lake outlines, most important first so they stay on top.
  if (basemap && basemapOpacity > 0) {
    ctx.globalAlpha = basemapOpacity;
    const rank = maxRank(ppd);
    const detail = ppd < 60 ? 0 : 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = theme.water.lakeOutline;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const lake of basemap.lakes) {
      if (lake.rank > rank) break;
      path({ type: 'MultiLineString', coordinates: lake.levels[detail]! });
    }
    ctx.stroke();
    ctx.strokeStyle = theme.water.river;
    for (const [low, high, factor] of [
      [5, rank, 1],
      [0, 4, 1.6],
    ] as const) {
      ctx.lineWidth = theme.water.riverWidth * factor * Math.min(1.6, scale);
      ctx.beginPath();
      for (const river of basemap.rivers) {
        if (river.rank > high) break;
        if (river.rank < low) continue;
        path({ type: 'MultiLineString', coordinates: river.levels[detail]! });
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Lines: one path per category, drawn bottom to top.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let i = 0;
  while (i < data.lines.length) {
    const category: LineCategory = data.lines[i]!.category;
    ctx.beginPath();
    for (; i < data.lines.length && data.lines[i]!.category === category; i++) {
      path({ type: 'LineString', coordinates: data.lines[i]!.levels[level]! });
    }
    const style = theme.lines[category];
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width * scale;
    ctx.stroke();
  }

  // Stations. Endpoints are graded by role and appear as the map zooms in,
  // so the overview shows the network itself rather than a field of dots.
  const visible = (s: RenderStation) =>
    view.kind !== 'globe' ||
    geoDistance(s.coordinates, view.center) < Math.PI / 2 - 0.01;
  const placed: {
    x: number;
    y: number;
    s: RenderStation;
    role: StationRole;
  }[] = [];
  for (const s of data.stations) {
    const role = stationRole(s);
    if (role === 'intermediate' && stations !== 'all') continue;
    if (ppd < ROLE_ZOOM[role].symbol || !visible(s)) continue;
    const p = projection(s.coordinates);
    if (
      !p ||
      p[0] < -20 ||
      p[1] < -20 ||
      p[0] > width + 20 ||
      p[1] > height + 20
    )
      continue;
    placed.push({ x: p[0], y: p[1], s, role });
  }
  // Important roles first: they draw on top and win label space.
  placed.sort(
    (a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role),
  );

  const symbolScale = Math.min(1.3, Math.max(0.6, Math.sqrt(ppd / 120)));
  const { fill, stroke } = theme.station;
  for (const { x, y, role } of [...placed].reverse()) {
    const r = ROLE_RADIUS[role] * symbolScale;
    ctx.beginPath();
    if (role === 'junction') {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    // Termini are solid dots; everything else is a ring.
    ctx.fillStyle = role === 'terminus' ? stroke : fill;
    ctx.fill();
    ctx.lineWidth = role === 'hub' ? 1.3 : 1;
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }

  // Labels with greedy collision avoidance; junctions are not labelled.
  const size = LABEL_SIZE;
  ctx.font = `500 ${size}px ${theme.font}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const boxes: [number, number, number, number][] = [];
  let labels = 0;
  for (const { x, y, s, role } of placed) {
    if (role === 'junction' || ppd < ROLE_ZOOM[role].label) continue;
    const text = s.properties.name;
    const w = ctx.measureText(text).width;
    const box: [number, number, number, number] = [
      x + 5,
      y - size / 2 - 1,
      x + 7 + w,
      y + size / 2 + 1,
    ];
    if (
      boxes.some(
        (b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3],
      )
    )
      continue;
    boxes.push(box);
    ctx.strokeStyle = theme.halo;
    ctx.lineWidth = 3;
    ctx.strokeText(text, x + 6, y);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, x + 6, y);
    labels++;
  }

  ctx.restore();
  return { level, stations: placed.length, labels };
}

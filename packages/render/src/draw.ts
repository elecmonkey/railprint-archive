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

/** Zoom thresholds in pixels per degree. */
export const ZOOM = {
  /** Endpoint names appear, written on the station before symbols show. */
  endpointLabels: 30,
  /** Endpoint symbols appear; names move beside them. */
  endpointSymbols: 90,
  /** Intermediate stations (when drawn at all). */
  stations: 160,
  stationLabels: 220,
} as const;

/** Symbol radius in CSS pixels at full size. */
const RADIUS = { endpoint: 2.8, intermediate: 1.8 } as const;

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

  // Stations. All line endpoints are treated alike: names appear first,
  // written on the station; symbols follow when zoomed in and the names move
  // beside them. Junctions (线路所) get a symbol but no name.
  const visible = (s: RenderStation) =>
    view.kind !== 'globe' ||
    geoDistance(s.coordinates, view.center) < Math.PI / 2 - 0.01;
  const placed: {
    x: number;
    y: number;
    s: RenderStation;
    symbol: boolean;
    label: boolean;
  }[] = [];
  for (const s of data.stations) {
    const endpoint = s.properties.endpoint;
    if (!endpoint && stations !== 'all') continue;
    const symbol = ppd >= (endpoint ? ZOOM.endpointSymbols : ZOOM.stations);
    const label =
      s.properties.kind !== 'junction' &&
      ppd >= (endpoint ? ZOOM.endpointLabels : ZOOM.stationLabels);
    if ((!symbol && !label) || !visible(s)) continue;
    const p = projection(s.coordinates);
    if (
      !p ||
      p[0] < -20 ||
      p[1] < -20 ||
      p[0] > width + 20 ||
      p[1] > height + 20
    )
      continue;
    placed.push({ x: p[0], y: p[1], s, symbol, label });
  }
  // When names collide, stations where more lines meet keep theirs.
  placed.sort(
    (a, b) => b.s.properties.lines.length - a.s.properties.lines.length,
  );

  const symbolScale = Math.min(1.3, Math.max(0.6, Math.sqrt(ppd / 120)));
  ctx.lineWidth = 1.2;
  for (const { x, y, s, symbol } of placed) {
    if (!symbol) continue;
    const r =
      (s.properties.endpoint ? RADIUS.endpoint : RADIUS.intermediate) *
      symbolScale;
    ctx.beginPath();
    if (s.properties.kind === 'junction') {
      ctx.moveTo(x - r, y);
      ctx.lineTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = theme.station.fill;
    ctx.fill();
    ctx.strokeStyle = theme.station.stroke;
    ctx.stroke();
  }

  // Labels with greedy collision avoidance.
  const size = LABEL_SIZE;
  ctx.font = `500 ${size}px ${theme.font}`;
  ctx.textBaseline = 'middle';
  const boxes: [number, number, number, number][] = [];
  let labels = 0;
  for (const { x, y, s, symbol, label } of placed) {
    if (!label) continue;
    const text = s.properties.name;
    const w = ctx.measureText(text).width;
    // Beside the symbol, or centred on the station when there is none.
    const left = symbol ? x + 6 : x - w / 2;
    const box: [number, number, number, number] = [
      left - 1,
      y - size / 2 - 1,
      left + w + 1,
      y + size / 2 + 1,
    ];
    if (
      boxes.some(
        (b) => b[0] < box[2] && box[0] < b[2] && b[1] < box[3] && box[1] < b[3],
      )
    )
      continue;
    boxes.push(box);
    ctx.textAlign = 'left';
    ctx.strokeStyle = theme.halo;
    ctx.lineWidth = 3;
    ctx.strokeText(text, left, y);
    ctx.fillStyle = theme.text;
    ctx.fillText(text, left, y);
    labels++;
  }

  ctx.restore();
  return { level, stations: placed.length, labels };
}

import { geoDistance, geoPath, type GeoProjection } from 'd3-geo';
import type { LineCategory, Theme } from '@railprint/style';
import { maxRank, type BasemapData } from './basemap.ts';
import { chunkVisible, viewRadius, type Chunk } from './chunks.ts';
import { levelFor } from './prepare.ts';
import { createProjection, type View } from './projection.ts';
import type { RenderData, RenderLine, RenderStation } from './types.ts';

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
  | 'rect'
  | 'clip'
  | 'shadowColor'
  | 'shadowBlur'
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
  highlight?: Highlight;
  /**
   * A flat map projection to draw through instead of the globe of `view`,
   * for image export: no globe outline and nothing culled. `view` still sets
   * the zoom that styles depend on.
   */
  projection?: GeoProjection;
  /**
   * Device pixels per CSS pixel. Geometry is simplified for device pixels,
   * so a high-resolution export keeps its detail (default 1).
   */
  pixelRatio?: number;
  /** Draw stations, their symbols and names (default true). */
  places?: boolean;
}

/** What the reader is pointing at or has selected; ids from the release. */
export interface Highlight {
  /** Selected line: drawn on top with its stations, other lines fade. */
  line?: string;
  /** Line under the pointer. */
  hover?: string;
  /** Selected station (`osm` property). */
  station?: string;
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
  /** Stations of the selected line. */
  lineStations: 30,
  lineStationLabels: 60,
} as const;

/** Opacity of the other lines while one is selected. */
const FADED = 0.3;

/** Symbol radius in CSS pixels at full size. */
const RADIUS = { endpoint: 2.8, intermediate: 1.8 } as const;

/** Line widths grow gently with zoom around this reference. */
const REFERENCE_PIXELS_PER_DEGREE = 20;

const LABEL_SIZE = 12;

export function widthScale(pixelsPerDegree: number): number {
  const scale = (pixelsPerDegree / REFERENCE_PIXELS_PER_DEGREE) ** 0.35;
  return Math.min(2.4, Math.max(0.6, scale));
}

/**
 * Whether a station gets a symbol and a name at this zoom. Junctions
 * (线路所) never get a name unless selected.
 */
export function stationDisplay(
  s: RenderStation,
  pixelsPerDegree: number,
  stations: 'endpoints' | 'all' = 'endpoints',
  highlight: Highlight = {},
): { symbol: boolean; label: boolean } {
  const ppd = pixelsPerDegree;
  if (s.properties.osm === highlight.station)
    return { symbol: true, label: true };
  const endpoint = s.properties.endpoint;
  const onLine =
    highlight.line !== undefined && s.properties.lines.includes(highlight.line);
  const named = s.properties.kind !== 'junction';
  if (onLine)
    return {
      symbol: ppd >= ZOOM.lineStations,
      label: named && ppd >= ZOOM.lineStationLabels,
    };
  if (!endpoint && stations !== 'all') return { symbol: false, label: false };
  return {
    symbol: ppd >= (endpoint ? ZOOM.endpointSymbols : ZOOM.stations),
    label:
      named && ppd >= (endpoint ? ZOOM.endpointLabels : ZOOM.stationLabels),
  };
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
  highlight = {},
  projection: flat,
  pixelRatio = 1,
  places = true,
}: DrawOptions): DrawStats {
  const projection = flat ?? createProjection(view, width, height);
  const path = geoPath(projection, ctx as unknown as CanvasRenderingContext2D);
  const ppd = view.pixelsPerDegree;
  const level = levelFor(ppd * pixelRatio);
  const scale = widthScale(ppd);
  // Only the parts of lines near the viewport are projected and drawn.
  const reach = flat ? Math.PI : viewRadius(view, width, height);
  const trace = (chunks: Chunk[]) => {
    for (const c of chunks)
      if (chunkVisible(c, view.center, reach))
        path({ type: 'LineString', coordinates: c.points });
  };

  ctx.save();
  if (!terrain) {
    ctx.fillStyle = theme.background;
    ctx.fillRect(0, 0, width, height);
  }
  // The glow is cast by the disc but only shows outside it, so the terrain
  // layer underneath is not covered. Once the globe fills the viewport there
  // is no edge to glow.
  const edgeShown = !flat && reach >= Math.PI / 2;
  if (edgeShown) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    path({ type: 'Sphere' });
    ctx.clip('evenodd');
    ctx.beginPath();
    path({ type: 'Sphere' });
    ctx.shadowColor = theme.glow.color;
    ctx.shadowBlur = theme.glow.blur;
    ctx.fillStyle = theme.sphere;
    ctx.fill();
    ctx.restore();
  }
  if (!flat) {
    ctx.beginPath();
    path({ type: 'Sphere' });
    if (!terrain) {
      ctx.fillStyle = theme.sea;
      ctx.fill();
    }
    ctx.strokeStyle = theme.sphere;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  // Rivers and lake outlines, most important first so they stay on top.
  if (basemap && basemapOpacity > 0) {
    ctx.globalAlpha = basemapOpacity;
    const rank = maxRank(ppd);
    const detail = ppd * pixelRatio < 60 ? 0 : 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = theme.water.lakeOutline;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    for (const lake of basemap.lakes) {
      if (lake.rank > rank) break;
      trace(lake.levels[detail]);
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
        trace(river.levels[detail]);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  // Lines: one path per category, drawn bottom to top.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (highlight.line) ctx.globalAlpha = FADED;
  let i = 0;
  while (i < data.lines.length) {
    const category: LineCategory = data.lines[i]!.category;
    ctx.beginPath();
    for (; i < data.lines.length && data.lines[i]!.category === category; i++) {
      trace(data.lines[i]!.chunks[level]!);
    }
    const style = theme.lines[category];
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.width * scale;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const emphasise = (line: RenderLine | undefined, factor: number) => {
    if (!line) return;
    const style = theme.lines[line.category];
    const width = Math.max(2, style.width * scale * factor);
    ctx.beginPath();
    trace(line.chunks[level]!);
    ctx.strokeStyle = theme.halo;
    ctx.lineWidth = width + 3;
    ctx.stroke();
    ctx.strokeStyle = style.color;
    ctx.lineWidth = width;
    ctx.stroke();
  };
  const byId = (id: string | undefined) =>
    id === undefined
      ? undefined
      : data.lines.find((l) => l.properties.id === id);
  emphasise(byId(highlight.line), 1.6);
  if (highlight.hover !== highlight.line) emphasise(byId(highlight.hover), 1.4);

  // Stations. All line endpoints are treated alike: names appear first,
  // written on the station; symbols follow when zoomed in and the names move
  // beside them. Junctions (线路所) get a symbol but no name.
  const visible = (s: RenderStation) =>
    flat !== undefined ||
    geoDistance(s.coordinates, view.center) < Math.PI / 2 - 0.01;
  const placed: {
    x: number;
    y: number;
    s: RenderStation;
    symbol: boolean;
    label: boolean;
  }[] = [];
  for (const s of places ? data.stations : []) {
    const { symbol, label } = stationDisplay(s, ppd, stations, highlight);
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
  // When names collide, the selection keeps its names first, then stations
  // where more lines meet.
  const priority = (s: RenderStation) =>
    (s.properties.osm === highlight.station ? 2000 : 0) +
    (highlight.line && s.properties.lines.includes(highlight.line) ? 1000 : 0) +
    s.properties.lines.length;
  placed.sort((a, b) => priority(b.s) - priority(a.s));

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
    if (s.properties.osm === highlight.station) {
      ctx.beginPath();
      ctx.arc(x, y, r + 3.5, 0, Math.PI * 2);
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.lineWidth = 1.2;
    }
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

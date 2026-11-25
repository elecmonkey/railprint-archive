import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvas } from '@napi-rs/canvas';
import { geoConicConformal, geoPath, type GeoProjection } from 'd3-geo';
import type { DataLayout } from '@railprint/layout';
import {
  dataPoints,
  draw,
  prepareBasemap,
  prepareData,
  tileLevelFor,
  type BasemapCollection,
  type LinesCollection,
  type StationsCollection,
  type View,
} from '@railprint/render';
import type { Theme } from '@railprint/style';
import sharp from 'sharp';
import { frameBox, paintTerrain, TileSampler } from './terrain.ts';

/** Standard parallels of the Lambert conformal conic used for China. */
const PARALLELS: [number, number] = [25, 47];

export interface Frame {
  projection: GeoProjection;
  /** Image size in CSS pixels. */
  width: number;
  height: number;
  /** The zoom styles depend on: pixels per degree at the centre. */
  view: View;
}

/**
 * A Lambert conformal conic centred on `points` that fits them into `width`
 * CSS pixels with `padding` on every side; the height follows from their
 * shape.
 */
export function fitFrame(
  points: [number, number][],
  width: number,
  padding: number,
): Frame {
  const lons = points.map((p) => p[0]);
  const lats = points.map((p) => p[1]);
  const center: [number, number] = [
    (Math.min(...lons) + Math.max(...lons)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
  const shape = { type: 'MultiPoint' as const, coordinates: points };
  const projection = geoConicConformal()
    .parallels(PARALLELS)
    .rotate([-center[0], 0])
    .fitWidth(width - 2 * padding, shape);
  const [[x0, y0], [, y1]] = geoPath(projection).bounds(shape);
  const [tx, ty] = projection.translate();
  projection.translate([tx - x0 + padding, ty - y0 + padding]);
  const height = Math.ceil(y1 - y0 + 2 * padding);
  // One degree of latitude at the centre, in pixels.
  const a = projection([center[0], center[1] - 0.5])!;
  const b = projection([center[0], center[1] + 0.5])!;
  const pixelsPerDegree = Math.hypot(a[0] - b[0], a[1] - b[1]);
  return { projection, width, height, view: { center, pixelsPerDegree } };
}

export interface ExportOptions {
  layout: DataLayout;
  theme: Theme;
  /** Image width in CSS pixels; styles are sized as on screen at this width. */
  width: number;
  /** Device pixels per CSS pixel. */
  scale: number;
  /** Room around the network, in CSS pixels. */
  padding: number;
  format: ImageFormat;
}

export type ImageFormat = 'webp' | 'jpg' | 'png';

/** Lossy quality: at 85 the lines show no artefacts at full size. */

/** Largest side WebP can encode. */
const WEBP_MAX = 16383;
const QUALITY = 85;

export interface ExportResult {
  image: Buffer;
  /** Size in device pixels. */
  width: number;
  height: number;
}

const readJson = async <T>(path: string) =>
  JSON.parse(await readFile(path, 'utf8')) as T;

/** Renders the release with its basemap as an image. */
export async function renderExport(
  options: ExportOptions,
): Promise<ExportResult> {
  const { layout, theme, scale } = options;
  const assets = join(layout.root, 'packages', 'basemap', 'assets');
  const data = prepareData(
    await readJson<LinesCollection>(join(layout.release, 'lines.geojson')),
    await readJson<StationsCollection>(
      join(layout.release, 'stations.geojson'),
    ),
  );
  const basemap = prepareBasemap(
    await readJson<BasemapCollection>(join(assets, 'rivers.geojson')),
    await readJson<BasemapCollection>(join(assets, 'lakes.geojson')),
  );
  const frame = fitFrame(dataPoints(data), options.width, options.padding);
  const width = Math.round(frame.width * scale);
  const height = Math.round(frame.height * scale);
  if (options.format === 'webp' && Math.max(width, height) > WEBP_MAX)
    throw new Error(
      `WebP allows at most ${WEBP_MAX} px a side, this is ${width}×${height}; export as .jpg`,
    );
  // The tiles the web app uses, at about one texel per output pixel.
  const tiles = await TileSampler.load(
    join(layout.root, 'packages', 'tiles', 'dist'),
    tileLevelFor(1 / (frame.view.pixelsPerDegree * scale)),
    frameBox(frame.projection, frame.width, frame.height),
  ).catch((error: unknown) => {
    throw new Error(
      `No terrain tiles in packages/tiles/dist; run \`pnpm tiles\` (${String(error)})`,
    );
  });
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  const image = ctx.createImageData(width, height);
  image.data.set(
    paintTerrain(frame.projection, width, height, scale, tiles, theme),
  );
  ctx.putImageData(image, 0, 0);
  ctx.scale(scale, scale);
  draw({
    context: ctx,
    width: frame.width,
    height: frame.height,
    view: frame.view,
    projection: frame.projection,
    pixelRatio: scale,
    data,
    theme,
    basemap,
    terrain: true,
    basemapOpacity: theme.terrain.opacity,
    // No stations: their names would need the web app's Chinese font, which a canvas
    // outside the browser cannot load the same way.
    places: false,
  });
  const pixels = sharp(canvas.data(), {
    raw: { width, height, channels: 4 },
    limitInputPixels: false,
  }).removeAlpha();
  const encoded = await (
    options.format === 'webp'
      ? pixels.webp({ quality: QUALITY })
      : options.format === 'jpg'
        ? pixels.jpeg({ quality: QUALITY, mozjpeg: true })
        : pixels.png()
  ).toBuffer();
  return { image: encoded, width, height };
}

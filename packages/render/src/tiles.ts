/**
 * Terrain tiles: a pyramid of equirectangular tiles in data encoding (see
 * packages/tiles). Level 0 is the coarsest; every level halves the cell.
 * Tiles are counted from 180°W and from the north pole. A level lists the
 * tiles it has; a missing tile is open sea.
 */

/** Pixels on each side of a tile. */
export const TILE_SIZE = 450;

/** Cell size of each level in arc seconds, coarsest first. */
export const TILE_LEVELS = [480, 240, 120, 60, 30] as const;

/** tiles.json, next to the tiles. */
export interface TileIndex {
  /** sha256 over every tile's pixels; the web app checks it. */
  hash: string;
  tileSize: number;
  /** Per level, `x,y` of every tile that exists. */
  levels: { cellArcsec: number; tiles: string[] }[];
}

/** Degrees a tile spans at `level`. */
export function tileSpan(level: number): number {
  return (TILE_LEVELS[level]! / 3600) * TILE_SIZE;
}

export function tileKey(level: number, x: number, y: number): string {
  return `${level}/${x}/${y}`;
}

/** The tile's extent: [west, south, east, north] in degrees. */
export function tileBounds(
  level: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const span = tileSpan(level);
  return [
    -180 + x * span,
    90 - (y + 1) * span,
    -180 + (x + 1) * span,
    90 - y * span,
  ];
}

/** Columns and rows of tiles covering the globe at `level`. */
export function tileCount(level: number): [number, number] {
  const span = tileSpan(level);
  return [Math.round(360 / span), Math.round(180 / span)];
}

/**
 * The coarsest level whose cells are no larger than `degreesPerPixel`, so a
 * texel covers at most one device pixel; the finest level when zoomed in
 * further.
 */
export function tileLevelFor(degreesPerPixel: number): number {
  for (let level = 0; level < TILE_LEVELS.length; level++)
    if (TILE_LEVELS[level]! / 3600 <= degreesPerPixel) return level;
  return TILE_LEVELS.length - 1;
}

/**
 * Tiles at `level` overlapping [west, south, east, north]; `west` may exceed
 * `east` when the box crosses the antimeridian.
 */
export function tilesInBox(
  level: number,
  [west, south, east, north]: [number, number, number, number],
): [number, number][] {
  const span = tileSpan(level);
  const [columns, rows] = tileCount(level);
  const y0 = Math.max(0, Math.floor((90 - north) / span));
  const y1 = Math.min(rows - 1, Math.floor((90 - south) / span));
  const xs = (w: number, e: number) => {
    const x0 = Math.max(0, Math.floor((w + 180) / span));
    const x1 = Math.min(columns - 1, Math.floor((e + 180) / span));
    return Array.from({ length: Math.max(0, x1 - x0 + 1) }, (_, i) => x0 + i);
  };
  const columnsIn =
    west <= east ? xs(west, east) : [...xs(west, 180), ...xs(-180, east)];
  const out: [number, number][] = [];
  for (let y = y0; y <= y1; y++) for (const x of columnsIn) out.push([x, y]);
  return out;
}

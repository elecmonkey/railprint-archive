/**
 * Design tokens shared by the web app and exporters. Map drawing reads these
 * values directly; the UI gets the same values as CSS custom properties, so
 * both always agree and a theme switch changes one place.
 */

/**
 * Visual category of a line: lines with EMU (动车) service, conventional trunk
 * lines, and everything else (regional conventional lines and links).
 */
export type LineCategory = 'emu' | 'trunk' | 'other';

export interface LineStyle {
  color: string;
  /** Stroke width in CSS pixels at the reference zoom. */
  width: number;
  /** Drawing order; higher draws on top. */
  z: number;
}

export interface Theme {
  name: 'light' | 'dark';
  background: string;
  sea: string;
  land: string;
  /** Outline of the globe disc. */
  sphere: string;
  text: string;
  textMuted: string;
  /** Halo behind labels and line casing. */
  halo: string;
  accent: string;
  surface: string;
  border: string;
  lines: Record<LineCategory, LineStyle>;
  station: {
    fill: string;
    stroke: string;
    radius: number;
    endpointRadius: number;
  };
  terrain: TerrainStyle;
  water: { river: string; riverWidth: number; lakeOutline: string };
  font: string;
}

/** Colours and strengths the terrain shader blends; see render/src/terrain.ts. */
export interface TerrainStyle {
  /** Land colour at sea level and at the top of the elevation ramp. */
  landLow: string;
  landHigh: string;
  /** 0–1: how strongly hillshade darkens and lightens land. */
  shade: number;
  /** 0–1: hillshade on the sea floor. */
  seaShade: number;
}

const FONT =
  '"PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif';

export const light: Theme = {
  name: 'light',
  background: '#e9eef0',
  sea: '#dbe6ea',
  land: '#f6f3ea',
  sphere: '#c6d3d8',
  text: '#23303a',
  textMuted: '#62707a',
  halo: '#f6f3ea',
  accent: '#b8432f',
  surface: 'rgba(255, 255, 255, 0.86)',
  border: 'rgba(35, 48, 58, 0.14)',
  lines: {
    emu: { color: '#c0392b', width: 2.3, z: 3 },
    trunk: { color: '#2e3f4c', width: 1.9, z: 2 },
    other: { color: '#8a99a3', width: 1.1, z: 1 },
  },
  station: {
    fill: '#ffffff',
    stroke: '#23303a',
    radius: 1.4,
    endpointRadius: 2.8,
  },
  terrain: {
    landLow: '#f4f1e6',
    landHigh: '#d9cfb8',
    shade: 0.6,
    seaShade: 0.12,
  },
  water: { river: '#9dbac4', riverWidth: 0.9, lakeOutline: '#9dbac4' },
  font: FONT,
};

export const dark: Theme = {
  name: 'dark',
  background: '#0f1519',
  sea: '#131c22',
  land: '#1d262c',
  sphere: '#2a363e',
  text: '#e4e9ec',
  textMuted: '#93a1aa',
  halo: '#1d262c',
  accent: '#ef6f55',
  surface: 'rgba(24, 32, 38, 0.88)',
  border: 'rgba(228, 233, 236, 0.14)',
  lines: {
    emu: { color: '#ff6b52', width: 2.3, z: 3 },
    trunk: { color: '#d7dee3', width: 1.9, z: 2 },
    other: { color: '#6f7f89', width: 1.1, z: 1 },
  },
  station: {
    fill: '#1d262c',
    stroke: '#e4e9ec',
    radius: 1.4,
    endpointRadius: 2.8,
  },
  terrain: {
    landLow: '#222c32',
    landHigh: '#3a4248',
    shade: 0.65,
    seaShade: 0.15,
  },
  water: { river: '#2f4c58', riverWidth: 0.9, lakeOutline: '#2f4c58' },
  font: FONT,
};

export const themes = { light, dark } as const;

/** Minimal shape of a release line needed to pick its category. */
export interface CategorizableLine {
  group:
    | { scope: '跨省线路'; class: string }
    | { scope: '省内线路'; province: string };
  lineClass: 'high-speed' | 'intercity' | 'link' | 'conventional';
}

/** Inter-province groups whose lines carry EMU (动车) trains. */
const EMU_GROUPS = new Set(['客运专线', '动分客货共线']);

export function lineCategory(line: CategorizableLine): LineCategory {
  if (line.lineClass === 'link') return 'other';
  if (line.group.scope === '跨省线路')
    return EMU_GROUPS.has(line.group.class) ? 'emu' : 'trunk';
  return line.lineClass === 'conventional' ? 'other' : 'emu';
}

/** CSS custom properties for UI code, e.g. `--rp-text`. */
export function cssVariables(theme: Theme): Record<string, string> {
  const vars: Record<string, string> = {
    '--rp-background': theme.background,
    '--rp-text': theme.text,
    '--rp-text-muted': theme.textMuted,
    '--rp-accent': theme.accent,
    '--rp-surface': theme.surface,
    '--rp-border': theme.border,
    '--rp-font': theme.font,
  };
  for (const [category, style] of Object.entries(theme.lines)) {
    vars[`--rp-line-${category}`] = style.color;
  }
  return vars;
}

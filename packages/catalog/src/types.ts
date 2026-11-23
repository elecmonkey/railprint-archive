/**
 * The line catalog: every railway section the map draws, divided the way the
 * author divides the network, and how each one corresponds to OSM. Two files
 * in data/catalog/: lines.json (this model) and paths.json (the confirmed
 * track paths, see paths.ts).
 */

/** How a line is drawn and routed. */
export const LINE_CATEGORIES = ['emu', 'conventional', 'link'] as const;
/** emu: lines with 动车 (red); conventional: 普速 (black); link: 联络线 (grey). */
export type LineCategory = (typeof LINE_CATEGORIES)[number];

/** An OSM object written as `node/123` or `way/456`. */
export type OsmRef = `${'node' | 'way'}/${number}`;

export interface RelationRef {
  id: number;
  /** OSM name at confirmation time, for readability only. */
  name: string;
}

/**
 * Correspondence with OSM. Written by `pnpm match confirm`; endpoints may also
 * be set by hand where OSM has no named object (e.g. an unnamed junction).
 */
export interface LineOsm {
  /** Object the line starts at: a station, junction or bare track node. */
  from?: OsmRef;
  to?: OsmRef;
  /** Infrastructure relations the path follows. */
  relations?: RelationRef[];
  /** Date (YYYY-MM-DD) the author confirmed the line; its path is then in paths.json. */
  confirmed?: string;
}

export interface CatalogLine {
  /**
   * Stable identifier, `<name>/<from>-<to>` when created. Never changed
   * afterwards, even if the name or endpoints are corrected; paths.json refers
   * to lines by id.
   */
  id: string;
  /** Display name, e.g. 西延高铁. */
  name: string;
  /** Other names for the same section (高速线 / 高铁 / 客专 variants, OSM names). */
  aliases?: string[];
  /** Endpoint in catalog notation, see endpoint.ts. */
  from: string;
  to: string;
  category: LineCategory;
  osm?: LineOsm;
  /** Free-form remarks, including open questions for review. */
  notes?: string[];
}

export interface Catalog {
  version: 2;
  lines: CatalogLine[];
}

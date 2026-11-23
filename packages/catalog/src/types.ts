/**
 * Grouping that mirrors how the author organizes the network. Values are the
 * author's own Chinese labels; they are display and organization data, not
 * an official railway classification.
 */
export type LineGroup =
  | { scope: '跨省线路'; class: InterProvinceClass }
  | { scope: '省内线路'; province: string };

export const INTER_PROVINCE_CLASSES = [
  '客运专线',
  '普速三横五纵',
  '动分客货共线',
  '其它线路',
] as const;
export type InterProvinceClass = (typeof INTER_PROVINCE_CLASSES)[number];

/**
 * One section of railway the map draws, exactly as the author divides the
 * network. A section may correspond to part of one OSM route relation, to
 * several relations, or to a split of one; that correspondence lives in
 * data/mapping/, never here.
 */
export interface CatalogLine {
  /**
   * Stable identifier referenced from mapping files. Derived from the
   * original name at creation time and never changed afterwards, even if
   * `name` or the endpoints are later corrected.
   */
  id: string;
  /** Display name, e.g. 西延高铁. */
  name: string;
  /** Other names for the same section (e.g. 高速线 / 高铁 / 客专 variants). */
  aliases?: string[];
  /** Endpoint in catalog notation, see endpoint.ts. */
  from: string;
  to: string;
  group: LineGroup;
  /**
   * Map category chosen by the author, overriding the automatic one:
   * emu (lines with 动车), trunk (conventional trunk), other.
   */
  category?: LineCategoryName;
  /** Free-form remarks, including open questions for review. */
  notes?: string[];
}

export const LINE_CATEGORIES = ['emu', 'trunk', 'other'] as const;
export type LineCategoryName = (typeof LINE_CATEGORIES)[number];

export interface Catalog {
  version: 1;
  lines: CatalogLine[];
}

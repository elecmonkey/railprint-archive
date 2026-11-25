import type { RenderStation } from '@railprint/render';
import type { LineCategory } from '@railprint/style';

export const CATEGORY_LABEL: Record<LineCategory, string> = {
  emu: '动车线路',
  conventional: '普速线路',
  link: '联络线',
};

export function formatKm(km: number): string {
  return km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1);
}

/**
 * A station's name in full: the map writes junctions `<十里岩>`, titles
 * spell them out as 十里岩线路所.
 */
export function fullName(station: RenderStation): string {
  const { name, kind } = station.properties;
  if (kind !== 'junction') return name;
  const bare = name.replace(/^<(.*)>$/, '$1');
  return bare.endsWith('所') ? bare : `${bare}线路所`;
}

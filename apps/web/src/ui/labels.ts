import type { LineCategory } from '@railprint/style';

export const CATEGORY_LABEL: Record<LineCategory, string> = {
  emu: '动车线路',
  conventional: '普速线路',
  link: '联络线',
};

export function formatKm(km: number): string {
  return km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1);
}

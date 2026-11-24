import type { LineCategory } from '@railprint/style';
import type { ReleaseStationProperties } from '@railprint/render';

export const CATEGORY_LABEL: Record<LineCategory, string> = {
  emu: '动车线路',
  conventional: '普速线路',
  link: '联络线',
};

export const STATION_KIND_LABEL: Record<
  ReleaseStationProperties['kind'],
  string
> = {
  station: '车站',
  junction: '线路所',
  'non-passenger': '无客运业务',
};

export function formatKm(km: number): string {
  return km >= 100 ? Math.round(km).toLocaleString() : km.toFixed(1);
}

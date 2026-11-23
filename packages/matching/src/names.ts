/**
 * Name normalization shared by endpoint and relation matching. Chinese railway
 * names vary in suffixes (高铁 / 高速线 / 客专 …) and OSM adds 站 / 线路所 to
 * place names; matching compares the normalized forms.
 */

const PLACE_SUFFIXES = ['线路所', '车站', '站'];

/** Strip whitespace and place-type suffixes: "耿镇线路所" → "耿镇". */
export function placeKey(name: string): string {
  let key = name.replace(/\s+/g, '');
  for (const suffix of PLACE_SUFFIXES) {
    if (key.length > suffix.length && key.endsWith(suffix)) {
      key = key.slice(0, -suffix.length);
      break;
    }
  }
  return key;
}

/** Line classes; only names of the same class are considered the same line. */
export type LineClass = 'high-speed' | 'intercity' | 'link' | 'conventional';

const CLASS_SUFFIXES: [string, LineClass][] = [
  ['高速铁路', 'high-speed'],
  ['客运专线', 'high-speed'],
  ['高速线', 'high-speed'],
  ['客专线', 'high-speed'],
  ['客专', 'high-speed'],
  ['高铁', 'high-speed'],
  ['城际铁路', 'intercity'],
  ['城际线', 'intercity'],
  ['城际', 'intercity'],
  ['联络线', 'link'],
  ['疏解线', 'link'],
  ['铁路', 'conventional'],
  ['线', 'conventional'],
];

export interface LineKey {
  stem: string;
  class: LineClass;
}

/**
 * "西渝高速铁路" → { stem: 西渝, class: high-speed }; "(原)沪杭线" → 沪杭,
 * conventional; "杭昌高速线杭黄段" → 杭昌, high-speed (section suffix dropped).
 */
export function lineKey(name: string): LineKey {
  let s = name.replace(/\s+/g, '').replace(/^[(（]原[)）]/, '');
  s = s.replace(/[(（][^)）]*[)）]$/, '');
  for (const [suffix, cls] of CLASS_SUFFIXES) {
    const at = s.indexOf(suffix);
    // A trailing "…段" after the class suffix names a section of the line.
    if (at > 0 && (at + suffix.length === s.length || s.endsWith('段'))) {
      return { stem: s.slice(0, at), class: cls };
    }
  }
  return { stem: s, class: 'conventional' };
}

export const lineKeyString = (key: LineKey) => `${key.class}:${key.stem}`;

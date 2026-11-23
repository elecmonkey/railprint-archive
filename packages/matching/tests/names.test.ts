import { expect, test } from 'rstack/test';
import { lineKey, placeKey } from '../src/names.ts';

test.each([
  ['耿镇线路所', '耿镇'],
  ['长沙站', '长沙'],
  ['西安东', '西安东'],
  ['站', '站'],
])('placeKey(%s)', (name, key) => {
  expect(placeKey(name)).toBe(key);
});

test.each([
  ['西渝高铁', '西渝', 'high-speed'],
  ['西渝高速铁路', '西渝', 'high-speed'],
  ['包西高速线', '包西', 'high-speed'],
  ['胶济客专线', '胶济', 'high-speed'],
  ['大西客专', '大西', 'high-speed'],
  ['沪宁城际线', '沪宁', 'intercity'],
  ['郑开城际', '郑开', 'intercity'],
  ['桐庐联络线', '桐庐', 'link'],
  ['京沪线', '京沪', 'conventional'],
  ['(原)沪杭线', '沪杭', 'conventional'],
  ['甬台温铁路', '甬台温', 'conventional'],
  ['杭昌高速线杭黄段', '杭昌', 'high-speed'],
  ['京沪高铁联络线', '京沪高铁', 'link'],
])('lineKey(%s)', (name, stem, cls) => {
  expect(lineKey(name)).toEqual({ stem, class: cls });
});

test.each([
  ['emu', 'high-speed'],
  ['conventional', 'conventional'],
  ['link', 'any'],
] as const)('speedPreference(%s) = %s', async (category, expected) => {
  const { speedPreference } = await import('../src/match.ts');
  expect(
    speedPreference({ id: 'x', name: 'x', from: 'a', to: 'b', category }),
  ).toBe(expected);
});

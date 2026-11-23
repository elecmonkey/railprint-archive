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
  ['宁蓉线', { scope: '跨省线路', class: '客运专线' }, 'high-speed'],
  ['杭深线', { scope: '跨省线路', class: '动分客货共线' }, 'any'],
  ['京沪线', { scope: '跨省线路', class: '普速三横五纵' }, 'conventional'],
  ['郑开城际', { scope: '省内线路', province: '河南省' }, 'high-speed'],
  ['桐庐联络线', { scope: '省内线路', province: '浙江省' }, 'any'],
] as const)('speedPreference(%s)', async (name, group, expected) => {
  const { speedPreference } = await import('../src/match.ts');
  expect(speedPreference({ id: 'x', name, from: 'a', to: 'b', group })).toBe(
    expected,
  );
});

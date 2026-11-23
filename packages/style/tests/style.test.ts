import { expect, test } from 'rstack/test';
import { cssVariables, dark, light, lineCategory } from '../src/index.ts';

test.each([
  [{ scope: '跨省线路', class: '客运专线' }, 'high-speed', 'emu'],
  [{ scope: '跨省线路', class: '动分客货共线' }, 'conventional', 'emu'],
  [{ scope: '跨省线路', class: '普速三横五纵' }, 'conventional', 'trunk'],
  [{ scope: '跨省线路', class: '其它线路' }, 'conventional', 'trunk'],
  [{ scope: '跨省线路', class: '其它线路' }, 'link', 'other'],
  [{ scope: '省内线路', province: '浙江省' }, 'intercity', 'emu'],
  [{ scope: '省内线路', province: '浙江省' }, 'conventional', 'trunk'],
] as const)('lineCategory(%j, %s) = %s', (group, lineClass, category) => {
  expect(lineCategory({ group, lineClass })).toBe(category);
});

test('both themes define every token', () => {
  expect(Object.keys(dark.lines)).toEqual(Object.keys(light.lines));
  expect(Object.keys(cssVariables(dark))).toEqual(
    Object.keys(cssVariables(light)),
  );
  expect(cssVariables(light)['--rp-line-emu']).toBe(light.lines.emu.color);
});

test('the author category wins', () => {
  const link = {
    group: { scope: '省内线路', province: '浙江省' },
    lineClass: 'link',
  } as const;
  expect(lineCategory(link)).toBe('other');
  expect(lineCategory({ ...link, category: 'trunk' })).toBe('trunk');
});

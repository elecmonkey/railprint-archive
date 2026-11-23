import { expect, test } from 'rstack/test';
import { cssVariables, dark, light } from '../src/index.ts';

test('both themes define every token', () => {
  expect(Object.keys(dark.lines)).toEqual(['emu', 'conventional', 'link']);
  expect(Object.keys(dark.lines)).toEqual(Object.keys(light.lines));
  expect(Object.keys(cssVariables(dark))).toEqual(
    Object.keys(cssVariables(light)),
  );
  expect(cssVariables(light)['--rp-line-emu']).toBe(light.lines.emu.color);
});

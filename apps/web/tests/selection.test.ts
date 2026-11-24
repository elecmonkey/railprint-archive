import type { Hit, RenderLine, RenderStation } from '@railprint/render';
import { expect, test } from 'rstack/test';
import { readHash, selectFromHit, writeHash } from '../src/map/selection';

const line = (id: string) =>
  ({
    properties: { id },
    category: 'emu',
    levels: [],
  }) as unknown as RenderLine;
const station = (osm: string, lines: string[]) =>
  ({
    properties: { osm, lines },
    coordinates: [0, 0],
  }) as unknown as RenderStation;
const onLines = (...ids: string[]): Hit => ({
  lines: ids.map((id) => ({ line: line(id), distance: 1, km: 0 })),
});

test('clicking selects the line under the pointer, every time', () => {
  const hit = onLines('a', 'b');
  expect(selectFromHit({}, hit)).toEqual({ line: 'a' });
  expect(selectFromHit({ line: 'a' }, hit)).toEqual({ line: 'a' });
});

test('a station keeps the selected line only when on it', () => {
  const hit: Hit = { station: station('node/1', ['a']), lines: [] };
  expect(selectFromHit({ line: 'a' }, hit)).toEqual({
    line: 'a',
    station: 'node/1',
  });
  expect(selectFromHit({ line: 'b' }, hit)).toEqual({ station: 'node/1' });
});

test('clicking empty map clears the selection', () => {
  expect(selectFromHit({ line: 'a' }, { lines: [] })).toEqual({});
});

test('the selection round-trips through the URL hash', () => {
  const selection = { line: '京沪线/北京-上海', station: 'node/124205138' };
  expect(readHash(writeHash(selection))).toEqual(selection);
  expect(writeHash({})).toBe('');
  expect(readHash('')).toEqual({});
});

import { fileURLToPath } from 'node:url';
import type { CatalogLine } from '@railprint/catalog';
import { loadRailNetwork } from '@railprint/railnet';
import { beforeAll, expect, test } from 'rstack/test';
import { Matcher } from '../src/match.ts';

const fixture = fileURLToPath(
  new URL('../../osm/tests/fixtures/mini.osm.pbf', import.meta.url),
);
let matcher: Matcher;

beforeAll(async () => {
  matcher = new Matcher(await loadRailNetwork(fixture));
});

const line = (over: Partial<CatalogLine>): CatalogLine => ({
  id: 'x',
  name: '甲丙高铁',
  from: '甲',
  to: '丙',
  category: 'emu',
  ...over,
});

test('matches a line by relation name and endpoints', () => {
  const m = matcher.match(line({}));
  expect(m.status).toBe('ok');
  expect(m.relations.map((r) => r.name)).toEqual(['甲丙高速线']);
  expect(m.path?.coverage).toBe(1);
  expect(m.path?.segments).toEqual([
    { way: 10, from: 1, to: 3 },
    { way: 11, from: 3, to: 5 },
  ]);
  expect(m.to.place).toMatchObject({ type: 'node', id: 5, railway: 'station' });
});

test('resolves junction endpoints written as <name>', () => {
  const m = matcher.match(line({ from: '<乙>' }));
  expect(m.from.place).toMatchObject({ id: 3, railway: 'junction' });
  expect(m.path?.segments).toEqual([{ way: 11, from: 3, to: 5 }]);
});

test('prefers the relation of the named line', () => {
  // 甲丙线 only contains the siding, so the path follows it between 2 and 4.
  const m = matcher.match(line({ name: '甲丙线' }));
  expect(m.path?.segments.map((s) => s.way)).toEqual([10, 12, 11]);
  expect(m.issues.map((i) => i.code)).toContain('low-coverage');
});

test('flags renamed, mismatched and missing endpoints', () => {
  const renamed = matcher.match(line({ to: '丁' }));
  expect(renamed.issues.map((i) => i.code)).toContain('endpoint-renamed');
  expect(renamed.status).toBe('review');

  const kind = matcher.match(line({ to: '<丙>' }));
  expect(kind.issues.map((i) => i.code)).toContain('endpoint-kind');

  const missing = matcher.match(line({ to: '戊' }));
  expect(missing.status).toBe('failed');
  expect(missing.issues.map((i) => i.code)).toEqual(['endpoint-missing']);
});

test('reports lines without a same-name relation', () => {
  const m = matcher.match(line({ name: '某某线' }));
  expect(m.issues.map((i) => i.code)).toContain('no-relation');
  expect(m.path).toBeDefined();
});

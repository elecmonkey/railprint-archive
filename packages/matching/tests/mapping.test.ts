import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogLine } from '@railprint/catalog';
import { loadRailNetwork } from '@railprint/railnet';
import { beforeAll, expect, test } from 'rstack/test';
import {
  loadPaths,
  parseMapping,
  savePaths,
  type StoredSegment,
} from '../src/mapping.ts';
import { confirmMatch, Matcher } from '../src/match.ts';

const fixture = fileURLToPath(
  new URL('../../osm/tests/fixtures/mini.osm.pbf', import.meta.url),
);
let matcher: Matcher;

beforeAll(async () => {
  matcher = new Matcher(await loadRailNetwork(fixture));
});

const line: CatalogLine = {
  id: 'x',
  name: '甲丙高铁',
  from: '甲',
  to: '丙',
  group: { scope: '跨省线路', class: '客运专线' },
};

test('validates mapping entries against catalog ids', () => {
  expect(() =>
    parseMapping(
      { version: 1, lines: { y: {}, x: { from: { osm: 'node/x' } } } },
      new Set(['x']),
    ),
  ).toThrow(/no catalog line[\s\S]*node\/<id>/);
  const ok = parseMapping(
    {
      version: 1,
      lines: {
        x: { from: { osm: 'node/1', name: '甲' }, confirmed: '2026-01-01' },
      },
    },
    new Set(['x']),
  );
  expect(ok.lines.x?.from?.osm).toBe('node/1');
});

test('writes paths one line per catalog line and reads them back', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-paths-'));
  const segments: StoredSegment[] = [
    [10, 1, 3],
    [11, 3, 5],
  ];
  await savePaths(dir, { version: 1, lines: { x: segments } }, ['x']);
  expect(readFileSync(join(dir, 'paths.json'), 'utf8')).toBe(
    '{\n  "version": 1,\n  "lines": {\n    "x": [[10,1,3],[11,3,5]]\n  }\n}\n',
  );
  expect((await loadPaths(dir, new Set(['x']))).lines.x).toEqual(segments);
});

test('pins an unnamed track node as an endpoint', () => {
  const m = matcher.match(line, { to: { osm: 'node/4', name: '无名' } });
  expect(m.to).toMatchObject({
    pinned: true,
    place: { id: 4, railway: 'track', name: '无名' },
  });
  expect(m.path?.segments.at(-1)).toEqual({ way: 11, from: 3, to: 4 });
});

test('a confirmed line keeps its stored path', () => {
  const first = matcher.match(line);
  const mapping = confirmMatch(first, {}, '2026-01-01');
  // A detour over the siding, stored as confirmed, is kept as is.
  const stored: StoredSegment[] = [
    [10, 1, 2],
    [12, 2, 4],
    [11, 4, 5],
  ];
  const kept = matcher.match(line, mapping, stored);
  expect(kept.status).toBe('confirmed');
  expect(kept.path?.segments.map((s) => s.way)).toEqual([10, 12, 11]);
});

test('a broken stored path is reported and routed again', () => {
  const mapping = confirmMatch(matcher.match(line), {}, '2026-01-01');
  const broken = matcher.match(line, mapping, [[999, 1, 5]]);
  expect(broken.status).toBe('review');
  expect(broken.issues.map((i) => i.code)).toEqual(['path-broken']);
  expect(broken.path?.segments.map((s) => s.way)).toEqual([10, 11]);
});

test('a missing pinned object fails the line', () => {
  const m = matcher.match(line, { from: { osm: 'node/424242' } });
  expect(m.status).toBe('failed');
  expect(m.issues.map((i) => i.code)).toEqual(['pin-missing']);
});

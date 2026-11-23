import { fileURLToPath } from 'node:url';
import type { CatalogLine, StoredSegment } from '@railprint/catalog';
import { loadRailNetwork } from '@railprint/railnet';
import { beforeAll, expect, test } from 'rstack/test';
import { audit } from '../src/audit.ts';
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
  category: 'emu',
};

test('pins an unnamed track node as an endpoint', () => {
  const m = matcher.match(line, { to: 'node/4' });
  expect(m.to).toMatchObject({
    pinned: true,
    place: { id: 4, railway: 'track', name: '丙' },
  });
  expect(m.path?.segments.at(-1)).toEqual({ way: 11, from: 3, to: 4 });
});

test('confirming records endpoints, relations and the date', () => {
  expect(confirmMatch(matcher.match(line), '2026-01-01')).toEqual({
    from: 'node/1',
    to: 'node/5',
    relations: [{ id: 100, name: '甲丙高速线' }],
    confirmed: '2026-01-01',
  });
});

test('a confirmed line keeps its stored path', () => {
  const osm = confirmMatch(matcher.match(line), '2026-01-01');
  // A detour over the siding, stored as confirmed, is kept as is.
  const stored: StoredSegment[] = [
    [10, 1, 2],
    [12, 2, 4],
    [11, 4, 5],
  ];
  const kept = matcher.match({ ...line, osm }, osm, stored);
  expect(kept.status).toBe('confirmed');
  expect(kept.path?.segments.map((s) => s.way)).toEqual([10, 12, 11]);
});

test('a broken stored path is reported and routed again', () => {
  const osm = confirmMatch(matcher.match(line), '2026-01-01');
  const broken = matcher.match(line, osm, [[999, 1, 5]]);
  expect(broken.status).toBe('review');
  expect(broken.issues.map((i) => i.code)).toEqual(['path-broken']);
  expect(broken.path?.segments.map((s) => s.way)).toEqual([10, 11]);
});

test('a missing pinned object fails the line', () => {
  const m = matcher.match(line, { from: 'node/424242' });
  expect(m.status).toBe('failed');
  expect(m.issues.map((i) => i.code)).toEqual(['pin-missing']);
});

test('audit flags confirmed paths that a fresh route would change', () => {
  const confirmed = {
    ...line,
    osm: confirmMatch(matcher.match(line), '2026-01-01'),
  };
  const catalog = { version: 2 as const, lines: [confirmed] };
  const detour: StoredSegment[] = [
    [10, 1, 2],
    [12, 2, 4],
    [11, 4, 5],
  ];
  const direct: StoredSegment[] = [
    [10, 1, 3],
    [11, 3, 5],
  ];
  const flagged = audit(matcher, catalog, { version: 1, lines: { x: detour } });
  expect(flagged.map((f) => f.id)).toEqual(['x']);
  expect(flagged[0]!.reasons.join()).toMatch(/重新求路/);
  expect(audit(matcher, catalog, { version: 1, lines: { x: direct } })).toEqual(
    [],
  );
});

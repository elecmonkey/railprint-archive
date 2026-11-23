import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'rstack/test';
import { formatEndpoint, parseEndpoint } from '../src/endpoint.ts';
import { loadPaths, savePaths, type StoredSegment } from '../src/paths.ts';
import { summarizeCatalog } from '../src/summary.ts';
import { CatalogError, parseCatalog, parseRef } from '../src/validate.ts';

const line = {
  id: '西延高铁/延安-西安东',
  name: '西延高铁',
  from: '延安',
  to: '西安东',
  category: 'emu',
} as const;

test.each([
  ['西安东', { kind: 'station', name: '西安东' }],
  ['<耿镇>', { kind: 'junction', name: '耿镇' }],
  ['[吕河]', { kind: 'non-passenger', name: '吕河' }],
  [' <K141> ', { kind: 'junction', name: 'K141' }],
])('parseEndpoint(%s)', (text, expected) => {
  expect(parseEndpoint(text)).toEqual(expected);
  expect(formatEndpoint(parseEndpoint(text))).toBe(text.trim());
});

test.each(['', '<>', '<a', 'a/b', '[a>'])(
  'parseEndpoint rejects %j',
  (text) => {
    expect(() => parseEndpoint(text)).toThrow(/Invalid endpoint/);
  },
);

test('accepts a valid catalog and drops empty optional parts', () => {
  const catalog = parseCatalog({
    version: 2,
    lines: [{ ...line, aliases: [], osm: {} }],
  });
  expect(catalog.lines[0]).toEqual(line);
});

test('accepts an OSM block', () => {
  const osm = {
    from: 'node/1',
    to: 'way/2',
    relations: [{ id: 3, name: '包西高速线' }],
    fixedRelations: true,
    confirmed: '2026-11-23',
  };
  expect(
    parseCatalog({ version: 2, lines: [{ ...line, osm }] }).lines[0]?.osm,
  ).toEqual(osm);
  expect(parseRef('way/2')).toEqual({ type: 'way', id: 2 });
});

test('collects every problem at once', () => {
  try {
    parseCatalog({
      version: 2,
      lines: [
        line,
        { ...line, extra: 1 },
        { ...line, id: 'x', to: '延安' },
        { ...line, id: 'y', from: '西安东', to: '延安' },
        { ...line, id: 'z', category: 'red' },
        { ...line, id: 'w', aliases: ['西延高铁'] },
        {
          ...line,
          id: 'v',
          name: '另一条',
          osm: { from: 'node/x', confirmed: '2026-11-23' },
        },
      ],
    });
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(CatalogError);
    const problems = (error as CatalogError).problems.join('\n');
    expect(problems).toMatch(/lines\[1\].*duplicates the id/);
    expect(problems).toMatch(/unknown key "extra"/);
    expect(problems).toMatch(/same endpoint/);
    expect(problems).toMatch(/lines\[3\].*repeats the section of lines\[0\]/);
    expect(problems).toMatch(/category must be one of/);
    expect(problems).toMatch(/aliases repeats the name/);
    expect(problems).toMatch(/osm\.from must be "node\/<id>"/);
    expect(problems).toMatch(/confirmed line needs both endpoints/);
    expect(problems).toMatch(
      /lines\[3\] \(y\)\.id must be "西延高铁\/西安东-延安"/,
    );
  }
});

test('rejects the old catalog format', () => {
  expect(() => parseCatalog({ version: 1, lines: [] })).toThrow(
    /version must be 2/,
  );
});

test('summarizes categories and endpoint kinds', () => {
  const summary = summarizeCatalog(
    parseCatalog({
      version: 2,
      lines: [
        {
          ...line,
          osm: { from: 'node/1', to: 'node/2', confirmed: '2026-11-23' },
        },
        {
          ...line,
          id: '西延高铁/耿镇-西安东',
          from: '<耿镇>',
          category: 'link',
        },
      ],
    }),
  );
  expect(summary.byCategory).toEqual({ emu: 1, conventional: 0, link: 1 });
  expect(summary.endpointKinds).toEqual({ station: 3, junction: 1 });
  expect(summary.confirmed).toBe(1);
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
  await expect(loadPaths(dir, new Set(['y']))).rejects.toThrow(
    /no catalog line/,
  );
});

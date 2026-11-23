import { expect, test } from 'rstack/test';
import { formatEndpoint, parseEndpoint } from '../src/endpoint.ts';
import { summarizeCatalog } from '../src/summary.ts';
import { CatalogError, parseCatalog } from '../src/validate.ts';

const line = {
  id: '西延高铁/延安-西安东',
  name: '西延高铁',
  from: '延安',
  to: '西安东',
  group: { scope: '省内线路', province: '陕西省' },
};

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

test('accepts a valid catalog and drops empty optional lists', () => {
  const catalog = parseCatalog({
    version: 1,
    lines: [{ ...line, aliases: [] }],
  });
  expect(catalog.lines[0]).toEqual(line);
});

test('collects every problem at once', () => {
  try {
    parseCatalog({
      version: 1,
      lines: [
        line,
        { ...line, extra: 1 },
        { ...line, id: 'x', to: '延安' },
        { ...line, id: 'y', from: '西安东', to: '延安' },
        { ...line, id: 'z', group: { scope: '跨省线路', class: '高铁' } },
        { ...line, id: 'w', aliases: ['西延高铁'] },
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
    expect(problems).toMatch(/group.class must be one of/);
    expect(problems).toMatch(/aliases repeats the name/);
  }
});

test('summarizes groups and endpoint kinds', () => {
  const summary = summarizeCatalog(
    parseCatalog({
      version: 1,
      lines: [
        line,
        {
          ...line,
          id: 'b',
          from: '<耿镇>',
          group: { scope: '跨省线路', class: '客运专线' },
        },
      ],
    }),
  );
  expect(summary.byGroup).toEqual([
    { label: '省内线路/陕西省', lines: 1 },
    { label: '跨省线路/客运专线', lines: 1 },
  ]);
  expect(summary.endpointKinds).toEqual({ station: 3, junction: 1 });
});

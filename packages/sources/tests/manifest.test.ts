import { expect, test } from 'rstack/test';
import { parseManifest, selectSources } from '../src/manifest.ts';

const license = {
  id: 'ODbL-1.0',
  attribution: '© OSM',
  url: 'https://example.org/l',
};
const base = {
  id: 'a',
  title: 'A',
  provider: 'P',
  url: 'https://example.org/a.bin',
  path: 'x/a.bin',
  license,
};

test('accepts a valid manifest and normalizes paths', () => {
  const manifest = parseManifest({
    version: 1,
    sources: [
      { ...base, path: 'x/./a.bin' },
      { ...base, id: 'b', path: 'b.bin', optional: true },
    ],
  });
  expect(manifest.sources[0]?.path).toBe('x/a.bin');
  expect(manifest.sources[1]?.optional).toBe(true);
});

test.each([
  [{ ...base, id: 'Bad_Id' }, /kebab-case/],
  [{ ...base, path: '../escape' }, /inside data\/sources/],
  [{ ...base, path: '/abs' }, /inside data\/sources/],
  [{ ...base, url: 'ftp://x' }, /http/],
  [
    { ...base, checksum: { algorithm: 'crc', url: 'https://x' } },
    /md5 or sha256/,
  ],
  [{ ...base, checksum: { algorithm: 'md5' } }, /exactly one/],
  [
    {
      ...base,
      checksum: { algorithm: 'md5', url: 'https://x', suffix: '.md5' },
    },
    /exactly one/,
  ],
])('rejects invalid source %#', (source, message) => {
  expect(() => parseManifest({ version: 1, sources: [source] })).toThrow(
    message,
  );
});

test('rejects duplicate ids and paths', () => {
  expect(() => parseManifest({ version: 1, sources: [base, base] })).toThrow(
    /duplicate id/,
  );
  expect(() =>
    parseManifest({ version: 1, sources: [base, { ...base, id: 'b' }] }),
  ).toThrow(/duplicate path/);
});

test('selectSources skips optional sources unless named', () => {
  const manifest = parseManifest({
    version: 1,
    sources: [base, { ...base, id: 'b', path: 'b', optional: true }],
  });
  expect(selectSources(manifest, []).map((s) => s.id)).toEqual(['a']);
  expect(selectSources(manifest, ['b']).map((s) => s.id)).toEqual(['b']);
  expect(() => selectSources(manifest, ['zzz'])).toThrow(/Unknown source/);
});

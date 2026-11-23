import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import {
  recordLockEntry,
  sha256File,
  type LockEntry,
  type SourceDefinition,
} from '@railprint/sources';
import { afterAll, beforeAll, expect, test } from 'rstack/test';
import { readPbf, readPbfHeader } from '../src/pbf.ts';
import { parseState, sequencePath, updateOsmSource } from '../src/update.ts';

const fixture = fileURLToPath(
  new URL('./fixtures/replicated.osm.pbf', import.meta.url),
);
const hasOsmium = spawnSync('osmium', ['--version']).status === 0;

const change = (body: string) =>
  gzipSync(
    `<?xml version="1.0" encoding="UTF-8"?>\n<osmChange version="0.6">${body}</osmChange>\n`,
  );

const files: Record<string, Buffer | string> = {
  '/state.txt':
    '#comment\nsequenceNumber=3\ntimestamp=2026-01-03T00\\:00\\:00Z\n',
  '/000/000/002.osc.gz': change(
    '<modify><node id="5" version="2" lat="30" lon="100.04"><tag k="railway" v="station"/><tag k="name" v="丙新"/></node></modify>',
  ),
  '/000/000/003.osc.gz': change(
    '<create><node id="8" version="1" lat="30.01" lon="100.05"><tag k="railway" v="halt"/><tag k="name" v="戊"/></node></create>',
  ),
};

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    const body = files[req.url ?? ''];
    if (body === undefined) res.writeHead(404).end();
    else res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('parses state.txt and replication paths', () => {
  expect(parseState(files['/state.txt'] as string)).toEqual({
    sequence: 3,
    timestamp: '2026-01-03T00:00:00Z',
  });
  expect(sequencePath(4979)).toBe('000/004/979');
  expect(sequencePath(1_234_567)).toBe('001/234/567');
});

test.skipIf(!hasOsmium)(
  'applies change files and records the update in the lock',
  async () => {
    const sourcesDir = mkdtempSync(join(tmpdir(), 'railprint-update-'));
    mkdirSync(join(sourcesDir, 'osm'));
    const file = join(sourcesDir, 'osm', 'x.osm.pbf');
    copyFileSync(fixture, file);
    const lockFile = join(sourcesDir, 'sources.lock.json');
    const source: SourceDefinition = {
      id: 'x',
      title: 'X',
      provider: 'P',
      url: 'https://example.org/x-latest.osm.pbf',
      path: 'osm/x.osm.pbf',
      license: {
        id: 'ODbL-1.0',
        attribution: 'OSM',
        url: 'https://example.org',
      },
    };
    const entry: LockEntry = {
      id: 'x',
      url: source.url,
      resolvedUrl: 'https://example.org/x-260101.osm.pbf',
      path: source.path,
      bytes: readFileSync(file).length,
      sha256: await sha256File(file),
      upstreamChecksum: { algorithm: 'md5', value: 'abc' },
      fetchedAt: '2026-01-01T00:00:00.000Z',
    };
    await recordLockEntry(lockFile, entry);

    const result = await updateOsmSource(source, entry, {
      sourcesDir,
      lockFile,
      baseUrl,
    });
    expect(result).toMatchObject({ state: 'updated', from: 1, to: 3 });

    const header = await readPbfHeader(file);
    expect(header.replicationSequenceNumber).toBe(3);
    expect(header.replicationTimestamp).toBe('2026-01-03T00:00:00.000Z');

    const names = new Map<number, string>();
    await readPbf(file, {
      node: (id, _x, _y, tags) => tags?.name && names.set(id, tags.name),
    });
    expect(names.get(5)).toBe('丙新');
    expect(names.get(8)).toBe('戊');
    expect(
      existsSync(join(sourcesDir, 'osm', 'changes', 'x', '2.osc.gz')),
    ).toBe(false);

    const locked = (
      JSON.parse(readFileSync(lockFile, 'utf8')) as {
        entries: Record<string, LockEntry>;
      }
    ).entries.x!;
    expect(locked.sha256).toBe(await sha256File(file));
    expect(locked.upstreamChecksum).toBeUndefined();
    expect(locked.osmUpdate).toMatchObject({
      sequence: 3,
      timestamp: '2026-01-03T00:00:00Z',
      base: {
        sequence: 1,
        sha256: entry.sha256,
        upstreamChecksum: { value: 'abc' },
      },
    });

    // A second run finds nothing to do.
    const again = await updateOsmSource(source, locked, {
      sourcesDir,
      lockFile,
      baseUrl,
    });
    expect(again).toEqual({ state: 'up-to-date', sequence: 3 });
  },
);

import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'rstack/test';
import {
  downloadSource,
  parseChecksumFile,
  parseContentRange,
} from '../src/download.ts';
import type { SourceDefinition } from '../src/manifest.ts';

const payload = Buffer.from(Array.from({ length: 200_000 }, (_, i) => i % 251));
const md5 = createHash('md5').update(payload).digest('hex');
const sha256 = createHash('sha256').update(payload).digest('hex');
const ETAG = '"v1"';

let server: Server;
let origin: string;
/** Request log, so tests can assert on what the client sent. */
const requests: { path: string; range?: string; ifRange?: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const range = req.headers.range;
    const ifRange = req.headers['if-range'] as string | undefined;
    requests.push({
      path: req.url ?? '',
      ...(range ? { range } : {}),
      ...(ifRange ? { ifRange } : {}),
    });
    if (req.url === '/file.bin.md5') {
      res.end(`${md5}  file.bin\n`);
      return;
    }
    if (req.url === '/bad.bin.md5') {
      res.end(`${'0'.repeat(32)}  bad.bin\n`);
      return;
    }
    if (req.url === '/no-length') {
      // Mimics a server that omits Content-Length and drops the connection
      // early, but reports the total in Content-Range.
      const m = /bytes=(\d+)-/.exec(range ?? '');
      const from = m?.[1] ? Number(m[1]) : 0;
      if (!range) {
        res.writeHead(200);
        res.end(payload.subarray(0, 1000));
        return;
      }
      const end = Math.min(payload.length, from + 60_000);
      res.writeHead(206, {
        'content-range': `bytes ${from}-${payload.length - 1}/${payload.length}`,
        etag: ETAG,
      });
      res.end(payload.subarray(from, end));
      return;
    }
    if (req.url === '/stall') {
      res.writeHead(200, { 'content-length': '10' });
      res.write('a');
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(302, { location: '/file.bin' }).end();
      return;
    }
    const match = range && ifRange === ETAG ? /bytes=(\d+)-/.exec(range) : null;
    const start = match?.[1] ? Number(match[1]) : 0;
    const body = payload.subarray(start);
    res.writeHead(start ? 206 : 200, {
      etag: ETAG,
      'content-length': String(body.length),
      ...(start
        ? {
            'content-range': `bytes ${start}-${payload.length - 1}/${payload.length}`,
          }
        : {}),
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function source(path: string, checksum = true): SourceDefinition {
  return {
    id: 'test',
    title: 'T',
    provider: 'P',
    url: `${origin}/${path}`,
    path: 'test.bin',
    license: { id: 'x', attribution: 'x', url: 'https://example.org' },
    ...(checksum
      ? { checksum: { algorithm: 'md5' as const, suffix: '.md5' } }
      : {}),
  };
}

const options = () => ({
  maxAttempts: 1,
  now: () => new Date('2026-01-01T00:00:00Z'),
});

test('downloads, verifies md5 and records sha256', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const entry = await downloadSource(
    source('file.bin'),
    join(dir, 'file.bin'),
    options(),
  );
  expect(readFileSync(join(dir, 'file.bin')).equals(payload)).toBe(true);
  expect(entry).toMatchObject({
    bytes: payload.length,
    sha256,
    etag: ETAG,
    upstreamChecksum: { algorithm: 'md5', value: md5 },
    fetchedAt: '2026-01-01T00:00:00.000Z',
  });
});

test('resumes a partial file with Range and If-Range', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const destination = join(dir, 'file.bin');
  const src = source('file.bin');
  writeFileSync(`${destination}.part`, payload.subarray(0, 50_000));
  writeFileSync(
    `${destination}.part.json`,
    JSON.stringify({ url: src.url, etag: ETAG }),
  );
  requests.length = 0;
  const entry = await downloadSource(src, destination, options());
  expect(requests[0]).toMatchObject({ range: 'bytes=50000-', ifRange: ETAG });
  expect(entry.sha256).toBe(sha256);
  expect(readFileSync(destination).equals(payload)).toBe(true);
});

test('restarts when the partial file has no resume record', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const destination = join(dir, 'file.bin');
  writeFileSync(`${destination}.part`, Buffer.from('garbage'));
  requests.length = 0;
  const entry = await downloadSource(
    source('file.bin'),
    destination,
    options(),
  );
  expect(requests[0]).toMatchObject({ range: 'bytes=0-' });
  expect(requests[0]?.ifRange).toBeUndefined();
  expect(entry.sha256).toBe(sha256);
});

test('follows redirects and records the resolved URL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const entry = await downloadSource(
    source('redirect', false),
    join(dir, 'f'),
    options(),
  );
  expect(entry.resolvedUrl).toBe(`${origin}/file.bin`);
});

test('rejects a checksum mismatch and leaves no file behind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const destination = join(dir, 'bad.bin');
  await expect(
    downloadSource(source('bad.bin'), destination, options()),
  ).rejects.toThrow(/failed after 1 attempts/);
  expect(() => readFileSync(destination)).toThrow();
});

test('verifies the checksum of the redirect target, not the alias', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  requests.length = 0;
  const entry = await downloadSource(
    source('redirect'),
    join(dir, 'f'),
    options(),
  );
  expect(entry.upstreamChecksum?.value).toBe(md5);
  expect(requests.map((r) => r.path)).toContain('/file.bin.md5');
});

test('resumes against the pinned resolved URL', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const destination = join(dir, 'file.bin');
  const src = source('redirect');
  writeFileSync(`${destination}.part`, payload.subarray(0, 1000));
  writeFileSync(
    `${destination}.part.json`,
    JSON.stringify({
      url: src.url,
      resolvedUrl: `${origin}/file.bin`,
      etag: ETAG,
    }),
  );
  requests.length = 0;
  const entry = await downloadSource(src, destination, options());
  expect(requests[0]).toMatchObject({
    path: '/file.bin',
    range: 'bytes=1000-',
  });
  expect(entry.sha256).toBe(sha256);
});

test('detects truncation via Content-Range and resumes to completion', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  const entry = await downloadSource(
    source('no-length', false),
    join(dir, 'f'),
    {
      maxAttempts: 5,
      retryDelayMs: 1,
    },
  );
  expect(entry.bytes).toBe(payload.length);
  expect(entry.sha256).toBe(sha256);
});

test('aborts a stalled transfer', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'railprint-dl-'));
  await expect(
    downloadSource(source('stall', false), join(dir, 'f'), {
      maxAttempts: 1,
      idleTimeoutMs: 200,
    }),
  ).rejects.toThrow(/failed after 1 attempts/);
});

test('parses checksum files and content ranges', () => {
  expect(parseChecksumFile(`${md5.toUpperCase()}  f\n`, 'md5')).toBe(md5);
  expect(() => parseChecksumFile('nope', 'md5')).toThrow();
  expect(parseContentRange('bytes 10-99/100')).toEqual({
    start: 10,
    total: 100,
  });
  expect(parseContentRange('bytes 10-99/*')).toEqual({ start: 10 });
  expect(parseContentRange(null)).toBeUndefined();
});

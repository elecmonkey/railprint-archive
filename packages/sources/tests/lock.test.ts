import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'rstack/test';
import { LockedError, withFileLock } from '../src/file-lock.ts';
import { readLock, recordLockEntry } from '../src/lock.ts';

const entry = (id: string) => ({
  id,
  url: `https://example.org/${id}`,
  path: id,
  bytes: 1,
  sha256: 'x',
  fetchedAt: '2026-01-01T00:00:00.000Z',
});

test('concurrent recordLockEntry calls keep every entry', async () => {
  const file = join(
    mkdtempSync(join(tmpdir(), 'railprint-lock-')),
    'sources.lock.json',
  );
  await Promise.all(
    ['a', 'b', 'c', 'd', 'e'].map((id) => recordLockEntry(file, entry(id))),
  );
  expect(Object.keys((await readLock(file)).entries).sort()).toEqual([
    'a',
    'b',
    'c',
    'd',
    'e',
  ]);
});

test('a held lock rejects a second holder without waiting', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'railprint-lock-')), 'x.lock');
  await withFileLock(path, async () => {
    await expect(
      withFileLock(path, () => Promise.resolve(1)),
    ).rejects.toBeInstanceOf(LockedError);
  });
  // Released afterwards.
  await expect(withFileLock(path, () => Promise.resolve(2))).resolves.toBe(2);
});

test('a lock left by a dead process is taken over', async () => {
  const path = join(mkdtempSync(join(tmpdir(), 'railprint-lock-')), 'x.lock');
  writeFileSync(path, '999999999');
  await expect(withFileLock(path, () => Promise.resolve('ok'))).resolves.toBe(
    'ok',
  );
});

test('creates the lock directory when missing', async () => {
  const path = join(
    mkdtempSync(join(tmpdir(), 'railprint-lock-')),
    'a',
    'b',
    'x.lock',
  );
  await expect(withFileLock(path, () => Promise.resolve(3))).resolves.toBe(3);
});

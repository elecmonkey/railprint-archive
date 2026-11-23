import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'rstack/test';
import { dataLayout, findRepoRoot } from '../src/index.ts';

test('findRepoRoot walks up to the workspace marker', () => {
  const root = mkdtempSync(join(tmpdir(), 'railprint-layout-'));
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  const nested = join(root, 'packages', 'x', 'src');
  mkdirSync(nested, { recursive: true });
  expect(findRepoRoot(nested)).toBe(root);
});

test('findRepoRoot fails outside a workspace', () => {
  const lonely = mkdtempSync(join(tmpdir(), 'railprint-none-'));
  expect(() => findRepoRoot(lonely)).toThrow(/repository root/);
});

test('dataLayout places everything under data/', () => {
  const layout = dataLayout('/repo');
  expect(layout.sources).toBe('/repo/data/sources');
  expect(layout.sourcesLock).toBe('/repo/data/sources.lock.json');
  expect(layout.catalog).toBe('/repo/data/catalog');
});

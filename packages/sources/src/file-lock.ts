import { link, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Lock file is held by another live process. */
export class LockedError extends Error {
  readonly holder: number;
  constructor(path: string, holder: number) {
    super(`${path} is held by process ${holder}`);
    this.name = 'LockedError';
    this.holder = holder;
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Create the lock atomically: write the pid to a private file, then hard-link
 * it into place. `link` fails if the lock exists, and readers never see a
 * lock without its pid.
 */
async function tryAcquire(path: string): Promise<boolean> {
  const temporary = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
  await writeFile(temporary, String(process.pid));
  try {
    await link(temporary, path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  const holder = Number(await readFile(path, 'utf8').catch(() => ''));
  if (
    holder === process.pid ||
    (Number.isInteger(holder) && holder > 0 && isAlive(holder))
  ) {
    throw new LockedError(path, holder);
  }
  // Left behind by a process that no longer exists.
  await rm(path, { force: true });
  return tryAcquire(path);
}

export interface FileLockOptions {
  /** Keep retrying while another process holds the lock, up to this long. */
  waitMs?: number;
}

/**
 * Run `fn` while holding an exclusive lock file at `path`. The file stores
 * the holder's pid, so a lock left by a crashed process is taken over.
 */
export async function withFileLock<T>(
  path: string,
  fn: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> {
  await mkdir(dirname(path), { recursive: true });
  const deadline = Date.now() + (options.waitMs ?? 0);
  for (;;) {
    try {
      if (await tryAcquire(path)) break;
    } catch (error) {
      if (!(error instanceof LockedError) || Date.now() >= deadline)
        throw error;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(path, { force: true });
  }
}

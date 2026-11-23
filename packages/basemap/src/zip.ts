import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';

/** Extract entries matching `patterns` from `zip` into `dir` with the system `unzip`. */
export async function unzip(
  zip: string,
  dir: string,
  patterns: readonly string[],
): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn('unzip', ['-o', '-q', zip, ...patterns, '-d', dir], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`unzip ${zip} failed (${code}): ${stderr.trim()}`)),
    );
  });
  return readdir(dir, { recursive: true });
}

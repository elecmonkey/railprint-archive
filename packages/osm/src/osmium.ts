import { spawn } from 'node:child_process';

export const OSMIUM_MIN_VERSION = [1, 16] as const;

export class OsmiumError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OsmiumError';
  }
}

interface RunResult {
  stdout: string;
  stderr: string;
}

function run(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('osmium', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stdout += chunk));
    child.stderr
      .setEncoding('utf8')
      .on('data', (chunk: string) => (stderr += chunk));
    child.on('error', (error: NodeJS.ErrnoException) => {
      reject(
        error.code === 'ENOENT'
          ? new OsmiumError(
              'osmium not found; install it with `brew install osmium-tool`',
            )
          : error,
      );
    });
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new OsmiumError(
            `osmium ${args[0]} exited with ${code}: ${stderr.trim()}`,
          ),
        );
    });
  });
}

/** Installed osmium version, e.g. "1.19.1". Fails if missing or too old. */
export async function osmiumVersion(): Promise<string> {
  const { stdout } = await run(['--version']);
  const match = /osmium version (\d+)\.(\d+)(?:\.(\d+))?/.exec(stdout);
  if (!match)
    throw new OsmiumError(
      `Cannot parse osmium version from "${stdout.trim()}"`,
    );
  const [major, minor] = [Number(match[1]), Number(match[2])];
  const [needMajor, needMinor] = OSMIUM_MIN_VERSION;
  if (major < needMajor || (major === needMajor && minor < needMinor)) {
    throw new OsmiumError(
      `osmium ${match[0]} is too old; need ${needMajor}.${needMinor}+`,
    );
  }
  return match[0].replace('osmium version ', '');
}

/**
 * `osmium tags-filter`: keep objects matching any expression, plus the nodes
 * and members they reference.
 */
export async function tagsFilter(
  input: string,
  expressions: readonly string[],
  output: string,
): Promise<void> {
  await run([
    'tags-filter',
    input,
    ...expressions,
    '-o',
    output,
    '--overwrite',
    '--no-progress',
  ]);
}

/**
 * `osmium apply-changes`: apply OSM change files to `input`, writing `output`
 * with the given header options.
 */
export async function applyChanges(
  input: string,
  changes: readonly string[],
  output: string,
  header: Record<string, string>,
): Promise<void> {
  const headerArgs = Object.entries(header).flatMap(([key, value]) => [
    '--output-header',
    `${key}=${value}`,
  ]);
  await run([
    'apply-changes',
    input,
    ...changes,
    ...headerArgs,
    '-o',
    output,
    '--overwrite',
    '--no-progress',
  ]);
}

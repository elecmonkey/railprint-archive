import { createHash, type Hash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import type { LockEntry } from './lock.ts';
import type { SourceDefinition, UpstreamChecksum } from './manifest.ts';

/** Uses Node's built-in fetch; set NODE_USE_ENV_PROXY=1 to use HTTP(S)_PROXY. */
export interface DownloadOptions {
  /** Progress and diagnostic output; one line per call. */
  log?: (line: string) => void;
  /** Attempts per source; each attempt resumes from the partial file. */
  maxAttempts?: number;
  /** Abort a transfer when no data arrives for this long. */
  idleTimeoutMs?: number;
  /** Interval between progress lines. */
  progressIntervalMs?: number;
  /** Base delay of the exponential retry backoff. */
  retryDelayMs?: number;
  userAgent?: string;
  /** Injectable clock for deterministic lock timestamps in tests. */
  now?: () => Date;
}

/** Non-2xx response. 4xx (except 429) is permanent and not retried. */
export class HttpStatusError extends Error {
  readonly status: number;
  constructor(url: string, status: number) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpStatusError';
    this.status = status;
  }
}

/** Short description of a failure, including the network cause fetch hides. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return `${error.message}: ${code ? `${code} ` : ''}${cause.message}`;
  }
  return error.message;
}

/**
 * Sidecar describing an unfinished `.part` file. `resolvedUrl` pins the
 * concrete upstream file behind a moving alias such as `*-latest`, so a resume
 * after the provider publishes a new snapshot continues the same snapshot.
 */
interface PartialState {
  url: string;
  resolvedUrl: string;
  etag?: string;
  lastModified?: string;
  totalBytes?: number;
}

const DEFAULT_USER_AGENT = 'railprint-data-fetch/0.1';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const mib = (bytes: number) => (bytes / 1048576).toFixed(1);

async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readPartialState(
  path: string,
): Promise<Partial<PartialState> | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Partial<PartialState>;
  } catch {
    return undefined;
  }
}

async function hashExisting(path: string, hashes: Hash[]): Promise<void> {
  for await (const chunk of createReadStream(path)) {
    for (const hash of hashes) hash.update(chunk as Buffer);
  }
}

/** Parse `<hex>  <filename>` (or a bare hex digest) checksum files. */
export function parseChecksumFile(
  text: string,
  algorithm: 'md5' | 'sha256',
): string {
  const length = algorithm === 'md5' ? 32 : 64;
  const match = new RegExp(`^\\s*([0-9a-fA-F]{${length}})\\b`).exec(text);
  if (!match?.[1]) throw new Error(`Unrecognised ${algorithm} checksum file`);
  return match[1].toLowerCase();
}

/** Parse the start offset and total size of a `Content-Range` header. */
export function parseContentRange(
  header: string | null,
): { start: number; total?: number } | undefined {
  const match = header && /^bytes (\d+)-\d+\/(\d+|\*)$/.exec(header.trim());
  if (!match?.[1]) return undefined;
  const total = match[2] === '*' || !match[2] ? undefined : Number(match[2]);
  return { start: Number(match[1]), ...(total !== undefined ? { total } : {}) };
}

/** URL of the checksum belonging to the file actually downloaded. */
export function checksumUrl(
  checksum: UpstreamChecksum,
  resolvedUrl: string,
): string {
  return 'url' in checksum ? checksum.url : `${resolvedUrl}${checksum.suffix}`;
}

/**
 * Fetch with an idle watchdog: the request is aborted when neither headers nor
 * body data arrive for `idleMs`. Call `touch()` whenever data arrives.
 */
function watchedFetch(url: string, init: RequestInit, idleMs: number) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(
      () => controller.abort(new Error(`No data for ${idleMs / 1000}s`)),
      idleMs,
    );
  };
  const done = () => clearTimeout(timer);
  touch();
  const response = fetch(url, { ...init, signal: controller.signal });
  return { response, touch, done };
}

/** GET a small text resource, with the same idle timeout as downloads. */
export async function fetchText(
  url: string,
  options: DownloadOptions = {},
): Promise<string> {
  const { response, done } = watchedFetch(
    url,
    { headers: { 'user-agent': options.userAgent ?? DEFAULT_USER_AGENT } },
    options.idleTimeoutMs ?? 60_000,
  );
  try {
    const res = await response;
    if (!res.ok) throw new HttpStatusError(url, res.status);
    return await res.text();
  } finally {
    done();
  }
}

/**
 * Download one source to `destination`, resuming an earlier partial transfer
 * when the server still serves the same file. The file only appears at
 * `destination` after its size and upstream checksum are verified.
 */
export async function downloadSource(
  source: SourceDefinition,
  destination: string,
  options: DownloadOptions = {},
): Promise<LockEntry> {
  const log = options.log ?? (() => {});
  const maxAttempts = options.maxAttempts ?? 8;
  const retryDelay = options.retryDelayMs ?? 2_000;
  await mkdir(dirname(destination), { recursive: true });

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await attemptDownload(source, destination, options, log);
    } catch (error) {
      lastError = error;
      if (
        error instanceof HttpStatusError &&
        error.status < 500 &&
        error.status !== 429
      ) {
        throw error;
      }
      log(
        `${source.id}: attempt ${attempt}/${maxAttempts} failed: ${describeError(error)}`,
      );
      if (attempt < maxAttempts)
        await sleep(Math.min(60_000, retryDelay * 2 ** (attempt - 1)));
    }
  }
  throw new Error(
    `${source.id}: download failed after ${maxAttempts} attempts`,
    {
      cause: lastError,
    },
  );
}

async function attemptDownload(
  source: SourceDefinition,
  destination: string,
  options: DownloadOptions,
  log: (line: string) => void,
): Promise<LockEntry> {
  const part = `${destination}.part`;
  const stateFile = `${destination}.part.json`;
  const previous = await readPartialState(stateFile);
  let offset = (await fileSize(part)) ?? 0;
  // Only resume a partial file started from the same declared URL and whose
  // server version identifier is known; otherwise start over.
  const validator = previous?.etag ?? previous?.lastModified;
  if (offset > 0 && (previous?.url !== source.url || !validator)) {
    log(
      `${source.id}: discarding partial file without a matching resume record`,
    );
    offset = 0;
  }
  const requestUrl =
    offset > 0 ? (previous?.resolvedUrl ?? source.url) : source.url;

  const headers: Record<string, string> = {
    'user-agent': options.userAgent ?? DEFAULT_USER_AGENT,
  };
  // Always ask for a range: some servers omit Content-Length on a plain GET
  // but report the total size in Content-Range, which lets us detect a
  // silently truncated transfer.
  headers.range = `bytes=${offset}-`;
  if (offset > 0 && validator) headers['if-range'] = validator;
  const watch = watchedFetch(
    requestUrl,
    { headers, redirect: 'follow' },
    options.idleTimeoutMs ?? 60_000,
  );
  try {
    const response = await watch.response;
    watch.touch();
    const resolvedUrl = response.url || requestUrl;

    if (response.status === 416 || response.status === 404) {
      // The pinned snapshot is gone or the range is invalid: start afresh
      // from the declared URL on the next attempt.
      await response.body?.cancel();
      if (offset > 0) {
        await rm(part, { force: true });
        await rm(stateFile, { force: true });
        throw new Error(
          `HTTP ${response.status} while resuming; restarting from zero`,
        );
      }
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new HttpStatusError(requestUrl, response.status);
    }

    let totalBytes: number | undefined;
    if (response.status === 206) {
      const range = parseContentRange(response.headers.get('content-range'));
      if (!range || range.start !== offset) {
        await response.body?.cancel();
        await rm(part, { force: true });
        throw new Error(
          'Unexpected Content-Range in resumed response; restarting',
        );
      }
      totalBytes = range.total;
    } else {
      // 200: a full body, either a fresh start or the server ignored If-Range
      // because the file changed upstream.
      if (offset > 0)
        log(`${source.id}: upstream changed or range unsupported; restarting`);
      offset = 0;
      const length = response.headers.get('content-length');
      totalBytes = length ? Number(length) : undefined;
    }

    const etag = response.headers.get('etag') ?? previous?.etag ?? undefined;
    const lastModified =
      response.headers.get('last-modified') ??
      previous?.lastModified ??
      undefined;
    const state: PartialState = {
      url: source.url,
      resolvedUrl,
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      ...(totalBytes !== undefined ? { totalBytes } : {}),
    };
    await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`);

    const sha256 = createHash('sha256');
    const md5 =
      source.checksum?.algorithm === 'md5' ? createHash('md5') : undefined;
    const hashes = md5 ? [sha256, md5] : [sha256];
    if (offset > 0) await hashExisting(part, hashes);

    log(
      `${source.id}: ${offset > 0 ? `resuming at ${mib(offset)} MiB` : 'starting'}` +
        `${totalBytes !== undefined ? ` of ${mib(totalBytes)} MiB` : ''}` +
        `${resolvedUrl !== source.url ? ` (${resolvedUrl})` : ''}`,
    );

    const handle = await open(part, offset > 0 ? 'a' : 'w');
    let received = offset;
    const started = Date.now();
    let lastReport = started;
    const interval = options.progressIntervalMs ?? 10_000;
    try {
      if (!response.body) throw new Error('Response has no body');
      for await (const chunk of response.body as AsyncIterable<Uint8Array>) {
        watch.touch();
        await handle.write(chunk);
        for (const hash of hashes) hash.update(chunk);
        received += chunk.byteLength;
        const now = Date.now();
        if (now - lastReport >= interval) {
          lastReport = now;
          const rate = (received - offset) / ((now - started) / 1000);
          const percent =
            totalBytes !== undefined
              ? ` (${((received / totalBytes) * 100).toFixed(1)}%)`
              : '';
          log(
            `${source.id}: ${mib(received)} MiB${percent} at ${mib(rate)} MiB/s`,
          );
        }
      }
    } finally {
      await handle.close();
    }
    watch.done();

    if (totalBytes !== undefined && received !== totalBytes) {
      throw new Error(
        `Incomplete transfer: ${received} of ${totalBytes} bytes`,
      );
    }

    const digest = sha256.digest('hex');
    let upstreamChecksum: LockEntry['upstreamChecksum'];
    if (source.checksum) {
      const expected = parseChecksumFile(
        await fetchText(checksumUrl(source.checksum, resolvedUrl), options),
        source.checksum.algorithm,
      );
      const actual =
        source.checksum.algorithm === 'md5' ? md5?.digest('hex') : digest;
      if (actual !== expected) {
        await rm(part, { force: true });
        await rm(stateFile, { force: true });
        throw new Error(
          `${source.checksum.algorithm} mismatch: expected ${expected}, got ${actual}`,
        );
      }
      upstreamChecksum = {
        algorithm: source.checksum.algorithm,
        value: expected,
      };
    }

    await rename(part, destination);
    await rm(stateFile, { force: true });
    log(
      `${source.id}: done, ${mib(received)} MiB` +
        `${upstreamChecksum ? `, ${upstreamChecksum.algorithm} verified` : ''}`,
    );

    return {
      id: source.id,
      url: source.url,
      ...(resolvedUrl !== source.url ? { resolvedUrl } : {}),
      path: source.path,
      bytes: received,
      sha256: digest,
      ...(upstreamChecksum ? { upstreamChecksum } : {}),
      ...(etag ? { etag } : {}),
      ...(lastModified ? { lastModified } : {}),
      fetchedAt: (options.now?.() ?? new Date()).toISOString(),
    };
  } finally {
    watch.done();
  }
}

/** Recompute the sha256 of a downloaded file. */
export async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256');
  await hashExisting(path, [hash]);
  return hash.digest('hex');
}

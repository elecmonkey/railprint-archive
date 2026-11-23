import { open } from 'node:fs/promises';
import { inflateSync, zstdDecompressSync } from 'node:zlib';
import {
  packedVarints,
  ProtoReader,
  utf8,
  WIRE_BYTES,
  WIRE_VARINT,
} from './protobuf.ts';

export type Tags = Record<string, string>;
export type MemberType = 'node' | 'way' | 'relation';

export interface OsmWay {
  id: number;
  tags: Tags;
  nodes: number[];
}

export interface OsmMember {
  type: MemberType;
  ref: number;
  role: string;
}

export interface OsmRelation {
  id: number;
  tags: Tags;
  members: OsmMember[];
}

/**
 * Callbacks for each element. `node` receives `tags` only for tagged nodes,
 * so the millions of untagged geometry nodes allocate nothing.
 */
export interface PbfHandlers {
  node?: (id: number, lon: number, lat: number, tags: Tags | undefined) => void;
  way?: (way: OsmWay) => void;
  relation?: (relation: OsmRelation) => void;
}

export interface PbfHeader {
  requiredFeatures: string[];
  optionalFeatures: string[];
  writingProgram?: string;
  replicationTimestamp?: string;
  replicationSequenceNumber?: number;
  replicationBaseUrl?: string;
}

export interface PbfSummary {
  header: PbfHeader;
  nodes: number;
  ways: number;
  relations: number;
}

const SUPPORTED_FEATURES = new Set(['OsmSchema-V0.6', 'DenseNodes']);
const MEMBER_TYPES: MemberType[] = ['node', 'way', 'relation'];
const MAX_HEADER = 64 * 1024;
const MAX_BLOB = 32 * 1024 * 1024;

function decodeBlob(data: Uint8Array): Uint8Array {
  const r = new ProtoReader(data);
  let rawSize: number | undefined;
  let payload: Uint8Array | undefined;
  let kind: 'raw' | 'zlib' | 'zstd' | 'unsupported' | undefined;
  while (!r.done) {
    const tag = r.tag();
    const field = tag >>> 3;
    if (field === 1) [payload, kind] = [r.bytes(), 'raw'];
    else if (field === 2) rawSize = r.varint();
    else if (field === 3) [payload, kind] = [r.bytes(), 'zlib'];
    else if (field === 7) [payload, kind] = [r.bytes(), 'zstd'];
    else if (field === 4 || field === 5 || field === 6) {
      r.skip(tag & 7);
      kind = 'unsupported';
    } else r.skip(tag & 7);
  }
  if (!payload || kind === 'unsupported' || !kind) {
    throw new Error(
      'Unsupported PBF blob compression (expected raw, zlib or zstd)',
    );
  }
  const raw =
    kind === 'raw'
      ? payload
      : kind === 'zlib'
        ? inflateSync(payload)
        : zstdDecompressSync(payload);
  if (rawSize !== undefined && raw.length !== rawSize) {
    throw new Error('PBF blob size mismatch after decompression');
  }
  return raw;
}

function decodeHeader(data: Uint8Array): PbfHeader {
  const r = new ProtoReader(data);
  const header: PbfHeader = { requiredFeatures: [], optionalFeatures: [] };
  while (!r.done) {
    const tag = r.tag();
    switch (tag >>> 3) {
      case 4:
        header.requiredFeatures.push(utf8(r.bytes()));
        break;
      case 5:
        header.optionalFeatures.push(utf8(r.bytes()));
        break;
      case 16:
        header.writingProgram = utf8(r.bytes());
        break;
      case 32:
        header.replicationTimestamp = new Date(r.int64() * 1000).toISOString();
        break;
      case 33:
        header.replicationSequenceNumber = r.int64();
        break;
      case 34:
        header.replicationBaseUrl = utf8(r.bytes());
        break;
      default:
        r.skip(tag & 7);
    }
  }
  for (const feature of header.requiredFeatures) {
    if (!SUPPORTED_FEATURES.has(feature)) {
      throw new Error(`Unsupported PBF required feature "${feature}"`);
    }
  }
  return header;
}

function tagsOf(keys: number[], values: number[], strings: string[]): Tags {
  if (keys.length !== values.length)
    throw new Error('OSM tag key/value count mismatch');
  const tags: Tags = {};
  for (let i = 0; i < keys.length; i++)
    tags[strings[keys[i]!]!] = strings[values[i]!]!;
  return tags;
}

interface BlockContext {
  strings: string[];
  granularity: number;
  latOffset: number;
  lonOffset: number;
}

/** Coordinates in degrees, rounded to the 1e-7 grid OSM uses. */
function coordinate(
  offset: number,
  granularity: number,
  value: number,
): number {
  return Math.round(offset / 100 + (granularity / 100) * value) / 1e7;
}

function decodeDense(
  r: ProtoReader,
  ctx: BlockContext,
  handlers: PbfHandlers,
): number {
  let ids: number[] = [];
  let lats: number[] = [];
  let lons: number[] = [];
  let keysVals: number[] = [];
  while (!r.done) {
    const tag = r.tag();
    const field = tag >>> 3;
    if (field === 1) ids = packedVarints(r, true);
    else if (field === 8) lats = packedVarints(r, true);
    else if (field === 9) lons = packedVarints(r, true);
    else if (field === 10) keysVals = packedVarints(r, false);
    else r.skip(tag & 7);
  }
  if (ids.length !== lats.length || ids.length !== lons.length) {
    throw new Error('Dense node coordinate count mismatch');
  }
  const handler = handlers.node;
  if (!handler) return ids.length;
  let id = 0;
  let lat = 0;
  let lon = 0;
  let kv = 0;
  for (let i = 0; i < ids.length; i++) {
    id += ids[i]!;
    lat += lats[i]!;
    lon += lons[i]!;
    let tags: Tags | undefined;
    if (keysVals.length) {
      while (kv < keysVals.length && keysVals[kv] !== 0) {
        tags ??= {};
        tags[ctx.strings[keysVals[kv]!]!] = ctx.strings[keysVals[kv + 1]!]!;
        kv += 2;
      }
      kv++; // delimiter
    }
    handler(
      id,
      coordinate(ctx.lonOffset, ctx.granularity, lon),
      coordinate(ctx.latOffset, ctx.granularity, lat),
      tags,
    );
  }
  return ids.length;
}

function decodeNode(
  r: ProtoReader,
  ctx: BlockContext,
  handlers: PbfHandlers,
): void {
  let id = 0;
  let lat = 0;
  let lon = 0;
  let keys: number[] = [];
  let values: number[] = [];
  while (!r.done) {
    const tag = r.tag();
    const field = tag >>> 3;
    if (field === 1) id = r.svarint();
    else if (field === 2) keys = packedVarints(r, false);
    else if (field === 3) values = packedVarints(r, false);
    else if (field === 8) lat = r.svarint();
    else if (field === 9) lon = r.svarint();
    else r.skip(tag & 7);
  }
  handlers.node?.(
    id,
    coordinate(ctx.lonOffset, ctx.granularity, lon),
    coordinate(ctx.latOffset, ctx.granularity, lat),
    keys.length ? tagsOf(keys, values, ctx.strings) : undefined,
  );
}

function decodeWay(r: ProtoReader, ctx: BlockContext): OsmWay {
  let id = 0;
  let keys: number[] = [];
  let values: number[] = [];
  let refs: number[] = [];
  while (!r.done) {
    const tag = r.tag();
    const field = tag >>> 3;
    if (field === 1) id = r.varint();
    else if (field === 2) keys = packedVarints(r, false);
    else if (field === 3) values = packedVarints(r, false);
    else if (field === 8) refs = packedVarints(r, true);
    else r.skip(tag & 7);
  }
  let ref = 0;
  const nodes = refs.map((delta) => (ref += delta));
  return { id, tags: tagsOf(keys, values, ctx.strings), nodes };
}

function decodeRelation(r: ProtoReader, ctx: BlockContext): OsmRelation {
  let id = 0;
  let keys: number[] = [];
  let values: number[] = [];
  let roles: number[] = [];
  let memids: number[] = [];
  let types: number[] = [];
  while (!r.done) {
    const tag = r.tag();
    const field = tag >>> 3;
    if (field === 1) id = r.varint();
    else if (field === 2) keys = packedVarints(r, false);
    else if (field === 3) values = packedVarints(r, false);
    else if (field === 8) roles = packedVarints(r, false);
    else if (field === 9) memids = packedVarints(r, true);
    else if (field === 10) types = packedVarints(r, false);
    else r.skip(tag & 7);
  }
  if (roles.length !== memids.length || types.length !== memids.length) {
    throw new Error(`Relation ${id}: member field count mismatch`);
  }
  let ref = 0;
  const members = memids.map((delta, i): OsmMember => {
    ref += delta;
    const type = MEMBER_TYPES[types[i]!];
    if (!type) throw new Error(`Relation ${id}: invalid member type`);
    return { type, ref, role: ctx.strings[roles[i]!] ?? '' };
  });
  return { id, tags: tagsOf(keys, values, ctx.strings), members };
}

interface Counts {
  nodes: number;
  ways: number;
  relations: number;
}

function decodePrimitiveBlock(
  data: Uint8Array,
  handlers: PbfHandlers,
  counts: Counts,
): void {
  const r = new ProtoReader(data);
  const ctx: BlockContext = {
    strings: [],
    granularity: 100,
    latOffset: 0,
    lonOffset: 0,
  };
  const groups: [number, number][] = [];
  while (!r.done) {
    const tag = r.tag();
    const field = tag >>> 3;
    if (field === 1) {
      const table = r.sub();
      while (!table.done) {
        const t = table.tag();
        if (t >>> 3 === 1 && (t & 7) === WIRE_BYTES)
          ctx.strings.push(utf8(table.bytes()));
        else table.skip(t & 7);
      }
    } else if (field === 2) groups.push(r.lengthDelimited());
    else if (field === 17 && (tag & 7) === WIRE_VARINT)
      ctx.granularity = r.varint();
    else if (field === 19) ctx.latOffset = r.int64();
    else if (field === 20) ctx.lonOffset = r.int64();
    else r.skip(tag & 7);
  }
  // Groups are decoded after the block header fields, which may follow them.
  for (const [start, end] of groups) {
    const g = new ProtoReader(data, start, end);
    while (!g.done) {
      const tag = g.tag();
      const field = tag >>> 3;
      if (field === 1) {
        decodeNode(g.sub(), ctx, handlers);
        counts.nodes++;
      } else if (field === 2)
        counts.nodes += decodeDense(g.sub(), ctx, handlers);
      else if (field === 3) {
        const sub = g.sub();
        if (handlers.way) handlers.way(decodeWay(sub, ctx));
        counts.ways++;
      } else if (field === 4) {
        const sub = g.sub();
        if (handlers.relation) handlers.relation(decodeRelation(sub, ctx));
        counts.relations++;
      } else g.skip(tag & 7);
    }
  }
}

/**
 * Stream an OSM PBF file, calling the handlers for every element in file
 * order (nodes, then ways, then relations for sorted files).
 */
export async function readPbf(
  path: string,
  handlers: PbfHandlers = {},
  options: { headerOnly?: boolean } = {},
): Promise<PbfSummary> {
  const file = await open(path, 'r');
  const counts: Counts = { nodes: 0, ways: 0, relations: 0 };
  let header: PbfHeader | undefined;
  let position = 0;

  async function read(
    length: number,
    allowEof = false,
  ): Promise<Uint8Array | undefined> {
    const buffer = Buffer.allocUnsafe(length);
    let offset = 0;
    while (offset < length) {
      const { bytesRead } = await file.read(
        buffer,
        offset,
        length - offset,
        position,
      );
      if (bytesRead === 0) {
        if (allowEof && offset === 0) return undefined;
        throw new Error(`Truncated PBF at byte ${position}`);
      }
      offset += bytesRead;
      position += bytesRead;
    }
    return buffer;
  }

  try {
    for (;;) {
      const lengthBytes = await read(4, true);
      if (!lengthBytes) break;
      const headerLength = Buffer.from(lengthBytes).readUInt32BE(0);
      if (headerLength > MAX_HEADER)
        throw new Error('Invalid PBF blob header length');
      const blobHeader = new ProtoReader((await read(headerLength))!);
      let type = '';
      let size = 0;
      while (!blobHeader.done) {
        const tag = blobHeader.tag();
        if (tag >>> 3 === 1) type = utf8(blobHeader.bytes());
        else if (tag >>> 3 === 3) size = blobHeader.varint();
        else blobHeader.skip(tag & 7);
      }
      if (size > MAX_BLOB) throw new Error('Oversized PBF blob');
      const data = decodeBlob((await read(size))!);
      if (type === 'OSMHeader') {
        header = decodeHeader(data);
        if (options.headerOnly) break;
      } else if (type === 'OSMData') {
        if (!header) throw new Error('PBF data block before header');
        decodePrimitiveBlock(data, handlers, counts);
      } else throw new Error(`Unexpected PBF blob type "${type}"`);
    }
  } finally {
    await file.close();
  }
  if (!header) throw new Error('PBF has no header block');
  return { header, ...counts };
}

/** Read only the header block of a PBF file. */
export async function readPbfHeader(path: string): Promise<PbfHeader> {
  return (await readPbf(path, {}, { headerOnly: true })).header;
}

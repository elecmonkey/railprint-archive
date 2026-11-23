/**
 * Minimal protobuf wire-format reader for the OSM PBF schema. Values are
 * plain numbers: OSM ids and coordinates fit in 2^53, so 64-bit varints are
 * decoded with arithmetic instead of BigInt.
 */
export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_BYTES = 2;
export const WIRE_FIXED32 = 5;

export class ProtoReader {
  readonly buf: Uint8Array;
  pos: number;
  readonly end: number;

  constructor(buf: Uint8Array, start = 0, end = buf.length) {
    this.buf = buf;
    this.pos = start;
    this.end = end;
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  varint(): number {
    const buf = this.buf;
    let result = 0;
    let multiplier = 1;
    for (;;) {
      if (this.pos >= this.end) throw new Error('Truncated protobuf varint');
      const byte = buf[this.pos++]!;
      result += (byte & 0x7f) * multiplier;
      if (byte < 0x80) return result;
      multiplier *= 128;
      if (multiplier > 2 ** 63) throw new Error('Protobuf varint too long');
    }
  }

  /** Zigzag-decoded signed varint (sint32 / sint64). */
  svarint(): number {
    const n = this.varint();
    return n % 2 === 1 ? -(n + 1) / 2 : n / 2;
  }

  /**
   * Signed varint (int32 / int64) in two's complement. Negative values are
   * encoded as ten bytes; only small negative numbers occur in OSM data.
   */
  int64(): number {
    const n = this.varint();
    return n >= 2 ** 63 ? n - 2 ** 64 : n;
  }

  /** Read a field tag; returns `fieldNumber * 8 + wireType`. */
  tag(): number {
    return this.varint();
  }

  /** Start and end offsets of a length-delimited field's payload. */
  lengthDelimited(): [number, number] {
    const length = this.varint();
    const start = this.pos;
    this.pos += length;
    if (this.pos > this.end) throw new Error('Truncated protobuf field');
    return [start, this.pos];
  }

  bytes(): Uint8Array {
    const [start, end] = this.lengthDelimited();
    return this.buf.subarray(start, end);
  }

  sub(): ProtoReader {
    const [start, end] = this.lengthDelimited();
    return new ProtoReader(this.buf, start, end);
  }

  skip(wire: number): void {
    switch (wire) {
      case WIRE_VARINT:
        this.varint();
        return;
      case WIRE_FIXED64:
        this.pos += 8;
        return;
      case WIRE_BYTES:
        this.lengthDelimited();
        return;
      case WIRE_FIXED32:
        this.pos += 4;
        return;
      default:
        throw new Error(`Unsupported protobuf wire type ${wire}`);
    }
  }
}

const decoder = new TextDecoder();

export function utf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

/** Decode a packed repeated varint field into an array. */
export function packedVarints(reader: ProtoReader, signed: boolean): number[] {
  const packed = reader.sub();
  const out: number[] = [];
  while (!packed.done) out.push(signed ? packed.svarint() : packed.varint());
  return out;
}

/**
 * Minimal ESRI Shapefile reader for polygon (5) and polyline (3) layers with
 * their DBF attributes, enough for Natural Earth data.
 */
export type Ring = [number, number][];

export interface ShapeRecord {
  /** Shape type 5: rings (outer and holes, even-odd); type 3: line parts. */
  parts: Ring[];
  properties: Record<string, string | number>;
}

export interface Shapefile {
  type: 'polygon' | 'polyline';
  records: ShapeRecord[];
}

function readDbf(buf: Buffer): Record<string, string | number>[] {
  const count = buf.readUInt32LE(4);
  const headerLength = buf.readUInt16LE(8);
  const recordLength = buf.readUInt16LE(10);
  const fields: { name: string; type: string; length: number }[] = [];
  for (let at = 32; buf[at] !== 0x0d && at < headerLength; at += 32) {
    const name = buf.toString('latin1', at, at + 11).replace(/\0.*$/s, '');
    fields.push({
      name,
      type: String.fromCharCode(buf[at + 11]!),
      length: buf[at + 16]!,
    });
  }
  const rows: Record<string, string | number>[] = [];
  for (let r = 0; r < count; r++) {
    let at = headerLength + r * recordLength + 1;
    const row: Record<string, string | number> = {};
    for (const field of fields) {
      // Fields are padded with spaces or NULs.
      const raw = buf
        .toString('utf8', at, at + field.length)
        .replace(/\0/g, '')
        .trim();
      at += field.length;
      row[field.name] =
        field.type === 'N' || field.type === 'F' ? Number(raw) : raw;
    }
    rows.push(row);
  }
  return rows;
}

export function readShapefile(shp: Buffer, dbf: Buffer): Shapefile {
  const fileType = shp.readInt32LE(32);
  if (fileType !== 5 && fileType !== 3)
    throw new Error(`Unsupported shape type ${fileType}`);
  const attributes = readDbf(dbf);
  const records: ShapeRecord[] = [];
  let at = 100;
  let index = 0;
  while (at < shp.length) {
    const contentLength = shp.readInt32BE(at + 4) * 2;
    const content = at + 8;
    const type = shp.readInt32LE(content);
    const parts: Ring[] = [];
    if (type === fileType) {
      const numParts = shp.readInt32LE(content + 36);
      const numPoints = shp.readInt32LE(content + 40);
      const partsAt = content + 44;
      const pointsAt = partsAt + numParts * 4;
      for (let p = 0; p < numParts; p++) {
        const start = shp.readInt32LE(partsAt + p * 4);
        const end =
          p + 1 < numParts ? shp.readInt32LE(partsAt + (p + 1) * 4) : numPoints;
        const ring: Ring = [];
        for (let i = start; i < end; i++) {
          ring.push([
            shp.readDoubleLE(pointsAt + i * 16),
            shp.readDoubleLE(pointsAt + i * 16 + 8),
          ]);
        }
        parts.push(ring);
      }
    }
    records.push({ parts, properties: attributes[index] ?? {} });
    index++;
    at = content + contentLength;
  }
  return { type: fileType === 5 ? 'polygon' : 'polyline', records };
}

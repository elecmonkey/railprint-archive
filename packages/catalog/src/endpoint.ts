/**
 * Endpoint notation used throughout the catalog:
 *
 *   西安东   a station
 *   <耿镇>   a junction (线路所)
 *
 * The notation is kept as plain strings in the catalog file because it is
 * compact and readable when editing by hand; this module is the only place
 * that interprets it.
 */
export type EndpointKind = 'station' | 'junction';

export interface Endpoint {
  name: string;
  kind: EndpointKind;
}

const FORBIDDEN = /[<>[\]/]/;

export function parseEndpoint(text: string): Endpoint {
  const trimmed = text.trim();
  if (trimmed.startsWith('<') && trimmed.endsWith('>'))
    return { kind: 'junction', name: checkName(trimmed.slice(1, -1), text) };
  return { kind: 'station', name: checkName(trimmed, text) };
}

function checkName(name: string, original: string): string {
  const trimmed = name.trim();
  if (!trimmed || FORBIDDEN.test(trimmed)) {
    throw new Error(`Invalid endpoint "${original}"`);
  }
  return trimmed;
}

export function formatEndpoint(endpoint: Endpoint): string {
  return endpoint.kind === 'junction' ? `<${endpoint.name}>` : endpoint.name;
}

/** A line's id: its name and endpoints as written, e.g. `西延高铁/延安-<耿镇>`. */
export function lineId(name: string, from: string, to: string): string {
  return `${name}/${formatEndpoint(parseEndpoint(from))}-${formatEndpoint(parseEndpoint(to))}`;
}

/**
 * Endpoint notation used throughout the catalog:
 *
 *   西安东     a passenger station
 *   <耿镇>     a junction / 线路所 (no passenger service)
 *   [吕河]     a station without passenger service (freight or technical)
 *
 * The notation is kept as plain strings in the catalog file because it is
 * compact and readable when editing by hand; this module is the only place
 * that interprets it.
 */
export type EndpointKind = 'station' | 'junction' | 'non-passenger';

export interface Endpoint {
  name: string;
  kind: EndpointKind;
}

const WRAPPERS: Record<Exclude<EndpointKind, 'station'>, [string, string]> = {
  junction: ['<', '>'],
  'non-passenger': ['[', ']'],
};

const FORBIDDEN = /[<>[\]/]/;

export function parseEndpoint(text: string): Endpoint {
  const trimmed = text.trim();
  for (const [kind, [open, close]] of Object.entries(WRAPPERS) as [
    Exclude<EndpointKind, 'station'>,
    [string, string],
  ][]) {
    if (trimmed.startsWith(open) && trimmed.endsWith(close)) {
      return { kind, name: checkName(trimmed.slice(1, -1), text) };
    }
  }
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
  if (endpoint.kind === 'station') return endpoint.name;
  const [open, close] = WRAPPERS[endpoint.kind];
  return `${open}${endpoint.name}${close}`;
}

/** A line's id: its name and endpoint names, e.g. `西延高铁/延安-耿镇`. */
export function lineId(name: string, from: string, to: string): string {
  return `${name}/${parseEndpoint(from).name}-${parseEndpoint(to).name}`;
}

import {
  parseEndpoint,
  type Endpoint,
  type EndpointKind,
} from '@railprint/catalog';
import type { RailNetwork, RailPlace } from '@railprint/railnet';
import { placeKey } from './names.ts';

/** `railway=*` values acceptable for each catalog endpoint kind. */
const KIND_RAILWAY: Record<EndpointKind, ReadonlySet<string>> = {
  station: new Set(['station', 'halt']),
  junction: new Set(['junction', 'service_station', 'crossover']),
  'non-passenger': new Set(['station', 'halt', 'yard']),
};

export interface PlaceMatch {
  endpoint: Endpoint;
  /** Places of the expected kind, or of any kind when none matched. */
  candidates: RailPlace[];
  /** True when no place of the expected kind exists and another kind was used. */
  kindMismatch: boolean;
  /** True when candidates were found only through their former names. */
  byOldName: boolean;
}

/** Index of railway places by normalized name. */
export class PlaceIndex {
  private readonly byName = new Map<string, RailPlace[]>();
  private readonly byOldName = new Map<string, RailPlace[]>();

  constructor(network: RailNetwork) {
    for (const place of network.places) {
      add(this.byName, place.names, place);
      add(this.byOldName, place.oldNames, place);
    }
  }

  resolve(text: string): PlaceMatch {
    const endpoint = parseEndpoint(text);
    const key = placeKey(endpoint.name);
    const current = pick(this.byName.get(key) ?? [], endpoint);
    if (current.candidates.length)
      return { endpoint, ...current, byOldName: false };
    const former = pick(this.byOldName.get(key) ?? [], endpoint);
    return { endpoint, ...former, byOldName: former.candidates.length > 0 };
  }
}

function add(
  index: Map<string, RailPlace[]>,
  names: string[],
  place: RailPlace,
): void {
  for (const key of new Set(names.map(placeKey))) {
    let list = index.get(key);
    if (!list) index.set(key, (list = []));
    list.push(place);
  }
}

/** Prefer places of the expected kind; fall back to other kinds. */
function pick(all: RailPlace[], endpoint: Endpoint) {
  const expected = all.filter((p) =>
    KIND_RAILWAY[endpoint.kind].has(p.railway),
  );
  if (expected.length) return { candidates: expected, kindMismatch: false };
  // A yard or depot sharing a station's name is no substitute for the station.
  const fallback = all.filter(
    (p) => p.railway !== 'yard' || endpoint.kind !== 'station',
  );
  return { candidates: fallback, kindMismatch: fallback.length > 0 };
}

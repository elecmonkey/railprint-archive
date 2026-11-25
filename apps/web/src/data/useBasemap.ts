import { useEffect, useState } from 'react';
import {
  prepareBasemap,
  type BasemapCollection,
  type BasemapData,
} from '@railprint/render';

// Imported rather than served as they are, so each file gets a name with a
// content hash and can be cached for good.
import lakesUrl from '../../../../packages/basemap/assets/lakes.geojson?url';
import riversUrl from '../../../../packages/basemap/assets/rivers.geojson?url';

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Load the rivers and lakes (packages/basemap/assets) once `start` is set,
 * so they do not compete with the railway data for bandwidth. The map works
 * without them. Terrain comes from the tiles (see TerrainCanvas).
 */
export function useBasemap(start: boolean): BasemapData | undefined {
  const [vectors, setVectors] = useState<BasemapData>();
  useEffect(() => {
    if (!start) return;
    let cancelled = false;
    Promise.all([
      getJson<BasemapCollection>(riversUrl),
      getJson<BasemapCollection>(lakesUrl),
    ])
      .then(([rivers, lakes]) => {
        if (!cancelled) setVectors(prepareBasemap(rivers, lakes));
      })
      .catch((error: unknown) => console.warn('basemap:', error));
    return () => {
      cancelled = true;
    };
  }, [start]);
  return vectors;
}

import { useEffect, useState } from 'react';
import {
  prepareBasemap,
  type BasemapCollection,
  type BasemapData,
  type TerrainGrid,
  type TerrainTexture,
} from '@railprint/render';

// Imported rather than served as they are, so each file gets a name with a
// content hash and can be cached for good.
import lakesUrl from '../../../../packages/basemap/assets/lakes.geojson?url';
import riversUrl from '../../../../packages/basemap/assets/rivers.geojson?url';
import terrainIndex from '../../../../packages/basemap/assets/terrain.json';
import eastUrl from '../../../../packages/basemap/assets/terrain-east-asia-east.webp';
import westUrl from '../../../../packages/basemap/assets/terrain-east-asia-west.webp';
import globalUrl from '../../../../packages/basemap/assets/terrain-global.webp';

interface TerrainIndex {
  textures: { name: string; file: string; grid: TerrainGrid }[];
}

/** URL of each texture file terrain.json names. */
const TEXTURE_URLS: Record<string, string> = {
  'terrain-global.webp': globalUrl,
  'terrain-east-asia-west.webp': westUrl,
  'terrain-east-asia-east.webp': eastUrl,
};

export interface Basemap {
  vectors?: BasemapData;
  global?: TerrainTexture;
  /** Sharper regional textures, in the order terrain.json lists them. */
  regional: TerrainTexture[];
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Load the basemap assets (packages/basemap/assets) once `start` is set, so
 * they do not compete with the railway data for bandwidth. Each part arrives
 * independently, the global terrain before the regional ones; the map works
 * without any of them.
 */
export function useBasemap(start: boolean): Basemap {
  const [basemap, setBasemap] = useState<Basemap>({ regional: [] });
  useEffect(() => {
    if (!start) return;
    let cancelled = false;
    const update = (part: (current: Basemap) => Partial<Basemap>) => {
      if (!cancelled)
        setBasemap((current) => ({ ...current, ...part(current) }));
    };
    const warn = (error: unknown) => console.warn('basemap:', error);

    Promise.all([
      getJson<BasemapCollection>(riversUrl),
      getJson<BasemapCollection>(lakesUrl),
    ])
      .then(([rivers, lakes]) =>
        update(() => ({ vectors: prepareBasemap(rivers, lakes) })),
      )
      .catch(warn);

    (async () => {
      for (const entry of (terrainIndex as TerrainIndex).textures) {
        const url = TEXTURE_URLS[entry.file];
        if (!url) throw new Error(`no URL for ${entry.file}`);
        const texture = { grid: entry.grid, image: await loadImage(url) };
        update((current) =>
          entry.name === 'global'
            ? { global: texture }
            : { regional: [...current.regional, texture] },
        );
      }
    })().catch(warn);

    return () => {
      cancelled = true;
    };
  }, [start]);
  return basemap;
}

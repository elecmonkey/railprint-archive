import { useEffect, useState } from 'react';
import {
  prepareBasemap,
  type BasemapCollection,
  type BasemapData,
  type TerrainGrid,
  type TerrainTexture,
} from '@railprint/render';

interface TerrainIndex {
  textures: { name: string; file: string; grid: TerrainGrid }[];
}

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
 * Load the basemap assets (packages/basemap/assets, served at the site root).
 * Each part arrives independently, the global terrain before the regional
 * ones; the map works without any of them.
 */
export function useBasemap(): Basemap {
  const [basemap, setBasemap] = useState<Basemap>({ regional: [] });
  useEffect(() => {
    let cancelled = false;
    const update = (part: (current: Basemap) => Partial<Basemap>) => {
      if (!cancelled)
        setBasemap((current) => ({ ...current, ...part(current) }));
    };
    const warn = (error: unknown) => console.warn('basemap:', error);

    Promise.all([
      getJson<BasemapCollection>('rivers.geojson'),
      getJson<BasemapCollection>('lakes.geojson'),
    ])
      .then(([rivers, lakes]) =>
        update(() => ({ vectors: prepareBasemap(rivers, lakes) })),
      )
      .catch(warn);

    getJson<TerrainIndex>('terrain.json')
      .then(async (index) => {
        for (const entry of index.textures) {
          const image = await loadImage(entry.file);
          const texture = { grid: entry.grid, image };
          update((current) =>
            entry.name === 'global'
              ? { global: texture }
              : { regional: [...current.regional, texture] },
          );
        }
      })
      .catch(warn);

    return () => {
      cancelled = true;
    };
  }, []);
  return basemap;
}

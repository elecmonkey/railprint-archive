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
  regional?: TerrainTexture;
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
 * one; the map works without any of them.
 */
export function useBasemap(): Basemap {
  const [basemap, setBasemap] = useState<Basemap>({});
  useEffect(() => {
    let cancelled = false;
    const update = (part: Partial<Basemap>) => {
      if (!cancelled) setBasemap((current) => ({ ...current, ...part }));
    };
    const warn = (error: unknown) => console.warn('basemap:', error);

    Promise.all([
      getJson<BasemapCollection>('rivers.geojson'),
      getJson<BasemapCollection>('lakes.geojson'),
    ])
      .then(([rivers, lakes]) =>
        update({ vectors: prepareBasemap(rivers, lakes) }),
      )
      .catch(warn);

    getJson<TerrainIndex>('terrain.json')
      .then(async (index) => {
        for (const entry of index.textures) {
          const image = await loadImage(entry.file);
          update(
            entry.name === 'global'
              ? { global: { grid: entry.grid, image } }
              : { regional: { grid: entry.grid, image } },
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

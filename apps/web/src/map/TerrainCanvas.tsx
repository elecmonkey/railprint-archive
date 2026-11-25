import { useEffect, useRef, useState } from 'react';
import { TerrainRenderer, type TileIndex, type View } from '@railprint/render';
import type { Theme } from '@railprint/style';
import { TILES } from '../data/tiles';
import styles from './MapCanvas.module.css';

/**
 * How the terrain stands: drawn; drawn from tiles other than the ones this
 * build was made with; or not available.
 */
export type TerrainStatus = 'ready' | 'mismatch' | 'failed';

interface Props {
  view: View | undefined;
  theme: Theme;
  /** Start loading; the railway comes first. */
  load: boolean;
  /** Layer opacity, 0–1; applied in CSS so changing it needs no redraw. */
  opacity: number;
  onStatus: (status: TerrainStatus) => void;
}

/** WebGL terrain layer underneath the 2D map canvas, drawn from the tiles. */
export function TerrainCanvas({ view, theme, load, opacity, onStatus }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderer, setRenderer] = useState<TerrainRenderer>();
  const [size, setSize] = useState<{ width: number; height: number }>();
  // Bumped when a tile arrives, to draw again.
  const [tiles, setTiles] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!load || !canvas) return;
    let live = true;
    (async () => {
      const response = await fetch(`${TILES.url}tiles.json`, {
        cache: 'no-cache',
      });
      if (!response.ok) throw new Error(`tiles.json: HTTP ${response.status}`);
      const index = (await response.json()) as TileIndex;
      const gl = canvas.getContext('webgl2', {
        premultipliedAlpha: true,
        antialias: false,
      });
      if (!gl) throw new Error('WebGL2 unavailable');
      if (!live) return;
      setRenderer(
        new TerrainRenderer(gl, {
          url: TILES.url,
          index,
          onTile: () => live && setTiles((n) => n + 1),
        }),
      );
      onStatus(index.hash === TILES.hash ? 'ready' : 'mismatch');
    })().catch((error: unknown) => {
      console.warn('terrain:', error);
      if (live) onStatus('failed');
    });
    return () => {
      live = false;
    };
  }, [load, onStatus]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !renderer || !size || !view) return;
    const frame = requestAnimationFrame(() => {
      const ratio = window.devicePixelRatio || 1;
      const w = Math.round(size.width * ratio);
      const h = Math.round(size.height * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      renderer.draw(view, size.width, size.height, ratio, theme);
    });
    return () => cancelAnimationFrame(frame);
  }, [renderer, view, theme, size, tiles]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${styles.under}`}
      aria-hidden="true"
      style={{ opacity }}
    />
  );
}

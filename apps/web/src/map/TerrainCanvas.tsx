import { useEffect, useRef, useState } from 'react';
import {
  TerrainRenderer,
  type TerrainTexture,
  type View,
} from '@railprint/render';
import type { Theme } from '@railprint/style';
import styles from './MapCanvas.module.css';

interface Props {
  view: View | undefined;
  theme: Theme;
  global?: TerrainTexture;
  regional?: TerrainTexture;
  /** Reports whether terrain is being drawn, so the 2D layer can go transparent. */
  onReady: (ready: boolean) => void;
}

/** WebGL terrain layer underneath the 2D map canvas. */
export function TerrainCanvas({
  view,
  theme,
  global,
  regional,
  onReady,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<TerrainRenderer | null>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [texturesVersion, setTexturesVersion] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl2', {
      premultipliedAlpha: true,
      antialias: false,
    });
    if (!gl) {
      console.warn('terrain: WebGL2 unavailable');
      return;
    }
    try {
      renderer.current = new TerrainRenderer(gl);
    } catch (error) {
      console.warn('terrain:', error);
    }
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
    const r = renderer.current;
    if (!r || !global) return;
    r.setTextures(global, regional);
    setTexturesVersion((v) => v + 1);
    onReady(true);
  }, [global, regional, onReady]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const r = renderer.current;
    if (!canvas || !r?.ready || !size || !view) return;
    const frame = requestAnimationFrame(() => {
      const ratio = window.devicePixelRatio || 1;
      const w = Math.round(size.width * ratio);
      const h = Math.round(size.height * ratio);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      r.draw(view, size.width, size.height, ratio, theme);
    });
    return () => cancelAnimationFrame(frame);
  }, [view, theme, size, texturesVersion]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${styles.under}`}
      aria-hidden="true"
    />
  );
}

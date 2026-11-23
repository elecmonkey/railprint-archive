import { useEffect, useRef, useState } from 'react';
import {
  draw,
  type BasemapData,
  type RenderData,
  type View,
} from '@railprint/render';
import type { Theme } from '@railprint/style';
import { panView, wheelView } from './interaction';
import styles from './MapCanvas.module.css';

interface Props {
  data: RenderData;
  basemap?: BasemapData;
  /** A terrain layer is drawn underneath. */
  terrain: boolean;
  theme: Theme;
  view: View | undefined;
  /** Called with the canvas size once known, to set an initial view. */
  onSize: (width: number, height: number) => void;
  onViewChange: (view: View) => void;
}

/** Full-size canvas that draws the map and turns pointer input into views. */
export function MapCanvas({
  data,
  basemap,
  terrain,
  theme,
  view,
  onSize,
  onViewChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  // Latest view, so several input events within one frame build on each
  // other instead of all starting from the last rendered view.
  const latest = useRef(view);
  latest.current = view;

  // Track the element size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSize({ width, height });
      onSize(width, height);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [onSize]);

  // Redraw on the next frame whenever inputs change.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size || !view) return;
    const frame = requestAnimationFrame(() => {
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(size.width * ratio);
      canvas.height = Math.round(size.height * ratio);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw({
        context,
        width: size.width,
        height: size.height,
        view,
        data,
        theme,
        ...(basemap ? { basemap } : {}),
        terrain,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [data, basemap, terrain, theme, view, size]);

  // Wheel needs a non-passive listener to prevent page scrolling and the
  // browser's own pinch zoom.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const current = latest.current;
      if (!current) return;
      const rect = canvas.getBoundingClientRect();
      const anchor: [number, number] = [
        event.clientX - rect.left,
        event.clientY - rect.top,
      ];
      const next = wheelView(current, event, anchor, size.width, size.height);
      latest.current = next;
      onViewChange(next);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [size, onViewChange]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${styles.over}`}
      aria-label="铁路地图"
      onPointerDown={(event) => {
        if (!view) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, y: event.clientY, view };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || !size) return;
        const next = panView(
          start.view,
          event.clientX - start.x,
          event.clientY - start.y,
          size.width,
          size.height,
        );
        latest.current = next;
        onViewChange(next);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  );
}

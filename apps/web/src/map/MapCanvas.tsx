import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  draw,
  Picker,
  stationDisplay,
  type BasemapData,
  type Highlight,
  type Hit,
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
  /** Opacity of rivers and lakes, matching the terrain layer. */
  basemapOpacity: number;
  theme: Theme;
  view: View | undefined;
  /** Called with the canvas size once known, to set an initial view. */
  onSize: (width: number, height: number) => void;
  onViewChange: (view: View) => void;
  highlight: Highlight;
  /** What is under the mouse, at a point relative to the canvas; none when it leaves. */
  onHover: (hover: { hit: Hit; x: number; y: number } | undefined) => void;
  /** A click or tap that did not drag the map. */
  onPick: (hit: Hit) => void;
}

/** Pick radius in CSS pixels. */
const TOLERANCE = { mouse: 7, touch: 14 } as const;
/** Movement beyond this many pixels makes a press a drag, not a click. */
const CLICK_SLOP = 5;

const empty = (hit: Hit) => !hit.station && hit.lines.length === 0;

/** Full-size canvas that draws the map and turns pointer input into views. */
export function MapCanvas({
  data,
  basemap,
  terrain,
  basemapOpacity,
  theme,
  view,
  onSize,
  onViewChange,
  highlight,
  onHover,
  onPick,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ width: number; height: number }>();
  const [pointing, setPointing] = useState(false);
  const drag = useRef<{
    x: number;
    y: number;
    view: View;
    moved: boolean;
  } | null>(null);
  const hoverFrame = useRef(0);
  const picker = useMemo(() => new Picker(data), [data]);
  // Latest view, so several input events within one frame build on each
  // other instead of all starting from the last rendered view.
  const latest = useRef(view);
  latest.current = view;

  const pick = useCallback(
    (clientX: number, clientY: number, tolerance: number) => {
      const canvas = canvasRef.current;
      const current = latest.current;
      if (!canvas || !size || !current) return undefined;
      const rect = canvas.getBoundingClientRect();
      const point: [number, number] = [clientX - rect.left, clientY - rect.top];
      const ppd = current.pixelsPerDegree;
      const hit = picker.pick(current, size.width, size.height, point, {
        tolerance,
        stations: (s) => {
          const shown = stationDisplay(s, ppd, 'endpoints', highlight);
          return shown.symbol || shown.label;
        },
        z: (line) => theme.lines[line.category].z,
      });
      return { hit, x: point[0], y: point[1] };
    },
    [picker, size, highlight, theme],
  );

  const hover = (found: { hit: Hit; x: number; y: number } | undefined) => {
    const hit = found && !empty(found.hit) ? found : undefined;
    setPointing(hit !== undefined);
    onHover(hit);
  };

  useEffect(() => () => cancelAnimationFrame(hoverFrame.current), []);
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
        basemapOpacity,
        highlight,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [data, basemap, terrain, basemapOpacity, theme, view, size, highlight]);

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
      // What was under the pointer has moved away.
      setPointing(false);
      onHover(undefined);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [size, onViewChange, onHover]);

  return (
    <canvas
      ref={canvasRef}
      className={`${styles.canvas} ${styles.over} ${pointing ? styles.pointing : ''}`}
      aria-label="铁路地图"
      onPointerDown={(event) => {
        if (!view) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          y: event.clientY,
          view,
          moved: false,
        };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start) {
          if (event.pointerType !== 'mouse') return;
          const { clientX, clientY } = event;
          cancelAnimationFrame(hoverFrame.current);
          hoverFrame.current = requestAnimationFrame(() =>
            hover(pick(clientX, clientY, TOLERANCE.mouse)),
          );
          return;
        }
        if (!size) return;
        if (
          !start.moved &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) >
            CLICK_SLOP
        ) {
          start.moved = true;
          hover(undefined);
        }
        if (!start.moved) return;
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
      onPointerUp={(event) => {
        const start = drag.current;
        drag.current = null;
        if (!start || start.moved) return;
        const found = pick(
          event.clientX,
          event.clientY,
          event.pointerType === 'mouse' ? TOLERANCE.mouse : TOLERANCE.touch,
        );
        if (found) onPick(found.hit);
      }}
      onPointerCancel={() => (drag.current = null)}
      onPointerLeave={() => {
        cancelAnimationFrame(hoverFrame.current);
        if (!drag.current) hover(undefined);
      }}
    />
  );
}

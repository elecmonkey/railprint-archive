import { clampZoom, createProjection, type View } from '@railprint/render';

/** Furthest latitude the globe centre may reach; keeps north up and usable. */
export const MAX_CENTER_LAT = 80;

/**
 * View after moving the map content by (dx, dy) CSS pixels, as when dragging.
 * The globe stays north-up: dragging changes the centre's longitude and
 * latitude, with longitude scaled so horizontal motion feels even at any
 * latitude.
 */
export function panView(view: View, dx: number, dy: number): View {
  const ppd = view.pixelsPerDegree;
  const cos = Math.max(0.2, Math.cos((view.center[1] * Math.PI) / 180));
  const lat = Math.max(
    -MAX_CENTER_LAT,
    Math.min(MAX_CENTER_LAT, view.center[1] + dy / ppd),
  );
  let lon = view.center[0] - dx / (ppd * cos);
  lon = ((((lon + 180) % 360) + 360) % 360) - 180;
  return { ...view, center: [lon, lat] };
}

/** Wheel input, normalised to CSS pixels. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

const LINE_PX = 16;
const PINCH_SENSITIVITY = 0.01;

/**
 * Trackpad-style wheel handling: scrolling pans in both directions; a pinch
 * (reported as wheel with ctrlKey) or Ctrl/⌘ + wheel zooms around `anchor`.
 */
export function wheelView(
  view: View,
  input: WheelInput,
  anchor: [number, number],
  width: number,
  height: number,
): View {
  const unit =
    input.deltaMode === 1 ? LINE_PX : input.deltaMode === 2 ? height : 1;
  const dx = input.deltaX * unit;
  const dy = input.deltaY * unit;
  if (input.ctrlKey || input.metaKey) {
    return zoomView(
      view,
      Math.exp(-dy * PINCH_SENSITIVITY),
      anchor,
      width,
      height,
    );
  }
  return panView(view, -dx, -dy);
}

/**
 * View after zooming by `factor`, keeping the geographic point under
 * `anchor` (CSS pixels) where it is.
 */
export function zoomView(
  view: View,
  factor: number,
  anchor: [number, number],
  width: number,
  height: number,
): View {
  const before = createProjection(view, width, height);
  const target = before.invert?.(anchor);
  let zoomed: View = {
    ...view,
    pixelsPerDegree: clampZoom(view.pixelsPerDegree * factor),
  };
  if (!target || !Number.isFinite(target[0])) return zoomed;
  // Moving the centre rotates the globe, so refine a few times.
  for (let i = 0; i < 6; i++) {
    const after = createProjection(zoomed, width, height);
    const moved = after(target);
    if (!moved) break;
    const dx = moved[0] - anchor[0];
    const dy = moved[1] - anchor[1];
    if (Math.hypot(dx, dy) < 0.001) break;
    const center = after.invert?.([width / 2 + dx, height / 2 + dy]);
    if (!center) break;
    zoomed = { ...zoomed, center: [center[0], center[1]] };
  }
  return zoomed;
}

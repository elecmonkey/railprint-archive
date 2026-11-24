import { createProjection, type View } from '@railprint/render';
import { expect, test } from 'rstack/test';
import { panView, wheelView, zoomView } from '../src/map/interaction';

const W = 800;
const H = 600;

test('dragging moves the centre opposite to the drag', () => {
  const view: View = { center: [110, 30], pixelsPerDegree: 40 };
  const moved = panView(view, 40, 0);
  expect(moved.center[0]).toBeLessThan(110);
  expect(moved.center[0]).toBeGreaterThan(108);
});

test('dragging the globe keeps north up and clamps latitude', () => {
  const view: View = { center: [179, 60], pixelsPerDegree: 10 };
  const moved = panView(view, -30, 300);
  // 3° of screen motion is 6° of longitude at 60°N; wraps past 180°.
  expect(moved.center[0]).toBeCloseTo(-175, 6);
  expect(moved.center[1]).toBe(80);
});

test('scrolling pans and pinching zooms', () => {
  const view: View = { center: [110, 30], pixelsPerDegree: 40 };
  const input = {
    deltaX: 0,
    deltaY: 80,
    deltaMode: 0,
    ctrlKey: false,
    metaKey: false,
  };
  const scrolled = wheelView(view, input, [400, 300], W, H);
  expect(scrolled.pixelsPerDegree).toBe(40);
  expect(scrolled.center[1]).toBeLessThan(30);
  const pinched = wheelView(
    view,
    { ...input, deltaY: -50, ctrlKey: true },
    [400, 300],
    W,
    H,
  );
  expect(pinched.pixelsPerDegree).toBeCloseTo(40 * Math.exp(0.5), 6);
  expect(pinched.center[0]).toBeCloseTo(110, 6);
});

test('zooming keeps the point under the cursor', () => {
  const view: View = { center: [110, 30], pixelsPerDegree: 40 };
  const anchor: [number, number] = [600, 200];
  const before = createProjection(view, W, H).invert!(anchor)!;
  const zoomed = zoomView(view, 2, anchor, W, H);
  expect(zoomed.pixelsPerDegree).toBe(80);
  const [x, y] = createProjection(zoomed, W, H)(before)!;
  expect(x).toBeCloseTo(anchor[0], 3);
  expect(y).toBeCloseTo(anchor[1], 3);
});

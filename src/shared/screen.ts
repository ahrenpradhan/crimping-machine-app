/**
 * Screen-size handling shared by the main process (which applies the zoom) and the checks.
 *
 * The UI is laid out for these classes of screen (CSS pixels):
 *   7"   800x480 / 1024x600  -> compact layout (renderer, `useCompact`) below 960 x 590
 *   10"  1280x800 / 1280x720 -> the standard layout, 1:1
 *   12"+ 1366x768 and up      -> the standard layout, zoomed in so it looks like the
 *                               1366x768 design (1920x1080 -> 1.4x): buttons, values and
 *                               graphs stay comfortable to touch on a large panel
 */

/** Below this (CSS px) the renderer switches to the compact layout. Keep in step with styles.css. */
export const COMPACT_MAX_WIDTH = 959;
export const COMPACT_MAX_HEIGHT = 589;

/** The layout is designed for about this much room; larger windows are zoomed. */
const BASE_WIDTH = 1366;
const BASE_HEIGHT = 768;
const MIN_ZOOM = 1;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.05;

/**
 * Zoom factor for a window of `widthDip` x `heightDip` (device-independent pixels):
 * 1 up to 1366x768, then growing with the window so the page keeps about the same
 * proportions (1920x1080 -> 1.4, 2560x1440 -> 1.85; steps of 0.05), never above 2.
 * Never below 1 - small screens get the compact layout instead of tiny buttons.
 */
export function uiZoomFor(widthDip: number, heightDip: number): number {
  if (!(widthDip > 0) || !(heightDip > 0)) return 1;
  const ratio = Math.min(widthDip / BASE_WIDTH, heightDip / BASE_HEIGHT);
  // + 1e-9: 1366x768 * 1.05 must not fall a step short through floating point error
  const stepped = Math.round(Math.floor(ratio / ZOOM_STEP + 1e-9) * ZOOM_STEP * 100) / 100;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, stepped));
}

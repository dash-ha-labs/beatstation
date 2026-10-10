import { useEffect, useState } from 'react';
import type { RefObject } from 'react';

// Landscape fit — see docs/architecture.md → Landscape fit.
// On touch devices held in landscape the studio (Transport + Beat Editor + Song, ~930 px tall)
// is taller than a phone or small tablet is high. Instead of a CSS transform (which would
// desync the pointer-drag math in Splitter / Song clips / Knobs — visual-px deltas applied to
// layout-px values — and misplace the fixed-position Menus portaled to <body>), the page is
// rendered at a wider *layout viewport* and the browser scales it to fit the screen. Media
// queries, window.innerWidth, getBoundingClientRect and pointer coordinates then share one
// coordinate space, so no interaction or audio code changes.

/** index.html's default viewport; restored whenever the fit is inactive and on unmount. */
export const DEFAULT_VIEWPORT = 'width=device-width, initial-scale=1.0';
/**
 * Never scale below this: on very short viewports (split-screen) scaling would not help, so
 * the fit gives up and the page keeps its native scrolling layout.
 */
export const LANDSCAPE_FIT_MIN_SCALE = 0.35;
/** Layout-width change worth a meta write (stops width oscillation between reflows). */
const WRITE_TOLERANCE = 8;
/** visualViewport scale this far from the one implied by our meta = the user pinch-zooming. */
const PINCH_TOLERANCE = 0.05;
/** Visible height below this fraction of the screen height = on-screen keyboard. */
const KEYBOARD_RATIO = 0.75;
/** Frames to wait for the Workspace root to mount (lazy screen + workspace fetch). */
const MOUNT_FRAMES = 300;

/**
 * Layout viewport width that fits a `studioH`-tall studio into a `physW × physH` physical
 * viewport. Null when nothing should be scaled: portrait (keep the narrow scrolling layout),
 * a viewport already tall enough (desktop window, large tablet), or one so short the minimum
 * scale would not help (split screen).
 */
export function planFit(physW: number, physH: number, studioH: number): number | null {
  if (!(physW > 0) || !(physH > 0) || !(studioH > 0)) return null;
  if (physW <= physH) return null; // portrait: unscaled narrow layout
  const scale = physH / studioH;
  if (scale >= 1) return null; // tall enough: native size
  if (scale < LANDSCAPE_FIT_MIN_SCALE) return null; // hopeless: native scrolling layout
  // ceil rounds the scale down a hair, which can only leave slack, never overflow.
  return Math.ceil(physW / scale);
}

/**
 * Scales the Workspace to fit a touch device's landscape screen (see planFit). While true the
 * root locks to exactly one screen (class `fit-screen`, index.css) and the Song section gives
 * way internally instead of the page scrolling, so the transport and drum pads always stay
 * visible. The default viewport is restored in portrait, on unmount (e.g. navigating Home)
 * and while the on-screen keyboard is open, so the browser can scroll the focused input.
 */
export function useLandscapeFit(root: RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = useState(false);

  useEffect(() => {
    const meta = document.querySelector('meta[name="viewport"]');
    if (!meta) return;
    const coarse = window.matchMedia('(pointer: coarse)');
    const orientation = window.matchMedia('(orientation: landscape)');

    // Physical (screen) size. While our own meta is applied, window.innerWidth is the layout
    // width, so `phys` is cached from the last time the default viewport was active; only the
    // height is refreshed live (visualViewport) to catch the keyboard and browser chrome.
    const phys = { w: 0, h: 0 };
    let lastWidth = 0;
    let raf = 0;

    const isDefault = () => (meta.getAttribute('content') ?? '').startsWith('width=device-width');
    const metaWidth = () => {
      const m = /^width=(\d+)/.exec(meta.getAttribute('content') ?? '');
      return m ? Number(m[1]) : null;
    };

    // The pinch guard must compare against the scale *we* set, not 1: while the fit is active
    // the page is intentionally zoomed out, which is not the user pinch-zooming.
    const pinched = () => {
      const s = window.visualViewport?.scale;
      if (s === undefined) return false;
      const w = metaWidth();
      const expected = w !== null && phys.w > 0 ? phys.w / w : 1;
      return Math.abs(s - expected) > PINCH_TOLERANCE;
    };
    const keyboard = () => {
      const vv = window.visualViewport;
      if (!vv || phys.h <= 0) return false;
      return vv.height * vv.scale < phys.h * KEYBOARD_RATIO;
    };

    // Natural (unclamped) studio height: drop the one-screen clamp and the min-height floor
    // for a synchronous measurement and restore them in the same task, so no paint happens
    // in between (avoids the measurement feeding back on the viewport it just set).
    const naturalHeight = () => {
      const el = root.current;
      if (!el) return 0;
      const clamped = el.classList.contains('fit-screen');
      const minHeight = el.style.minHeight;
      el.classList.toggle('fit-screen', false);
      el.style.minHeight = '0';
      const h = el.scrollHeight;
      el.style.minHeight = minHeight;
      if (clamped) el.classList.add('fit-screen');
      return h;
    };

    const restore = () => {
      lastWidth = 0;
      root.current?.classList.remove('fit-screen');
      if (!isDefault()) meta.setAttribute('content', DEFAULT_VIEWPORT);
    };

    const update = () => {
      raf = 0;
      if (!root.current) return; // still loading the workspace
      if (pinched()) return; // user is zooming: don't fight the gesture
      if (isDefault()) {
        // Default viewport: window sizes ARE the physical sizes (rotation, chrome included).
        phys.w = window.innerWidth;
        phys.h = window.innerHeight;
      }
      if (!coarse.matches || keyboard()) {
        restore();
        setActive(false);
        return;
      }
      const width = planFit(phys.w, phys.h, naturalHeight());
      if (width === null) {
        restore();
        setActive(false);
        return;
      }
      setActive(true);
      if (Math.abs(width - lastWidth) > WRITE_TOLERANCE) {
        lastWidth = width;
        meta.setAttribute('content', `width=${width}`);
      }
      root.current.classList.add('fit-screen');
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    // Rotating re-uses the cached (now wrong) physical size: reset to defaults first, then
    // re-measure (the resize event follows the orientation change).
    const onOrientationChange = () => {
      restore();
      schedule();
    };
    // The root ref appears only once the workspace screen (lazy chunk) has mounted; wait for
    // it so the fit activates without needing an external resize event.
    const waitForMount = (frames: number) => {
      if (root.current || frames <= 0) {
        schedule();
        return;
      }
      requestAnimationFrame(() => waitForMount(frames - 1));
    };

    waitForMount(MOUNT_FRAMES);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    coarse.addEventListener('change', schedule);
    orientation.addEventListener('change', onOrientationChange);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      coarse.removeEventListener('change', schedule);
      orientation.removeEventListener('change', onOrientationChange);
      restore();
    };
  }, [root]);

  return active;
}

import { useEffect, useState } from 'react';

const KEY = 'finance.ui-scale';
const MIN = 0.7;
const MAX = 1.3;
const DEFAULT_SCALE = 1;

function clamp(n: number): number {
  return Math.min(MAX, Math.max(MIN, n));
}

function readStored(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SCALE;
    const n = Number(raw);
    return Number.isFinite(n) ? clamp(n) : DEFAULT_SCALE;
  } catch {
    return DEFAULT_SCALE;
  }
}

/**
 * Whole-interface zoom level, independent of the browser's own page zoom —
 * a knob for "this UI reads too big on my monitor" that the person sets once
 * instead of reaching for Ctrl+/Ctrl- every session. Persisted per device,
 * same reasoning as the theme preference in App.tsx.
 *
 * Applied via the CSS `zoom` property on `<html>`, not by scaling the root
 * font-size: this stylesheet is written entirely in px, not rem, so a
 * font-size change would do nothing to the vast majority of it (padding,
 * gaps, borders, fixed-size icons). `zoom` scales the whole rendered page as
 * a unit — the same mechanism the browser's own zoom uses — so it works
 * without touching a single existing CSS rule, and `position: fixed`
 * elements (modals, the toast, the Settings overlay) still correctly track
 * the real viewport because it's applied at the document root, not to some
 * inner wrapper further down the tree.
 */
export function useUIScale(): [number, (scale: number) => void] {
  const [scale, setScaleState] = useState<number>(readStored);

  useEffect(() => {
    document.documentElement.style.setProperty('zoom', String(scale));
  }, [scale]);

  function setScale(next: number): void {
    const clamped = clamp(next);
    setScaleState(clamped);
    try {
      localStorage.setItem(KEY, String(clamped));
    } catch {
      // ignore — scale just won't persist across reloads
    }
  }

  return [scale, setScale];
}

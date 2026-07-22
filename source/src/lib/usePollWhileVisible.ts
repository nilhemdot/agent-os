"use client";

import { useEffect, useRef } from "react";

/**
 * Polls `fn` every `intervalMs` while the tab is visible.
 * Pauses immediately when the tab goes hidden (no fetches, no CLI spawns).
 * Resumes — and fires once immediately — when the tab comes back.
 *
 * This is the single biggest perf win for the dashboard: without it, every page
 * with a useEffect setInterval keeps running while you're in another tab,
 * spawning child processes for nothing.
 *
 * Usage:
 *   usePollWhileVisible(refresh, 5000, [openId]);
 */
export function usePollWhileVisible(
  fn: () => void,
  intervalMs: number,
  deps: ReadonlyArray<unknown> = [],
) {
  // Keep the latest fn in a ref so deps don't have to include it.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;

    const start = () => {
      if (timer) return;
      // Fire once on (re)start, then on interval.
      if (!cancelled) fnRef.current();
      timer = setInterval(() => { if (!cancelled) fnRef.current(); }, intervalMs);
    };
    const stop = () => {
      if (timer) { clearInterval(timer); timer = null; }
    };
    const onVisChange = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisChange);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisChange);
    };
  }, [intervalMs, ...deps]);
}

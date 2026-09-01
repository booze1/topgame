import { useEffect, useRef, useState } from 'react';

/** Tracks the user's motion preference live, so a mid-session change applies. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);

  return reduced;
}

/**
 * Counts a number up when `active` turns on, which makes the contested stat
 * feel like a reveal rather than a value that was always sitting there.
 * Skipped entirely when the user has asked for reduced motion.
 */
export function useCountUp(target: number, active: boolean, durationMs = 650): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(active ? target : 0);
  const frame = useRef(0);

  useEffect(() => {
    if (!active) {
      setValue(0);
      return;
    }
    if (reduced || durationMs <= 0) {
      setValue(target);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      // Ease-out cubic: quick off the mark, gentle landing on the real number.
      const eased = 1 - (1 - progress) ** 3;
      setValue(target * eased);
      if (progress < 1) frame.current = requestAnimationFrame(step);
      else setValue(target);
    };
    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [target, active, durationMs, reduced]);

  return value;
}

/** Fires `callback` after `delay`, restarting whenever the delay changes. */
export function useTimeout(callback: () => void, delay: number | null): void {
  const saved = useRef(callback);
  saved.current = callback;

  useEffect(() => {
    if (delay === null) return;
    const timer = setTimeout(() => saved.current(), Math.max(0, delay));
    return () => clearTimeout(timer);
  }, [delay]);
}

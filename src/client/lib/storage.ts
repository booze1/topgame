/**
 * Local storage, defensively.
 *
 * Private windows and locked-down browsers throw on access rather than
 * returning null, so every read and write is wrapped. Losing a preference is
 * fine; a blank screen is not.
 */

const PREFIX = 'toptrumps.';

export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, value);
  } catch {
    /* Storage is unavailable; carry on without persistence. */
  }
}

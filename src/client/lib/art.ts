/**
 * Generated card art.
 *
 * Real photographs are the point of this game, but they arrive via
 * `npm run fetch-images` and any single one can fail. Rather than show a
 * broken image icon, each card falls back to art derived from its own id: the
 * same card always produces the same picture, and it uses the deck's colours,
 * so a deck with no photos at all still looks deliberate.
 */

import type { DeckTheme } from '../../shared/types';

/** FNV-1a: tiny, stable, and good enough to scatter blob positions. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A deterministic 0..1 sequence seeded from the card id. */
function sequence(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 10000) / 10000;
  };
}

export interface Blob {
  cx: number;
  cy: number;
  r: number;
  opacity: number;
  fill: string;
}

export interface GeneratedArt {
  blobs: Blob[];
  rotation: number;
  gradientFrom: string;
  gradientTo: string;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  const int = Number.parseInt(full.slice(0, 6), 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

function rgbToHex(rgb: [number, number, number]): string {
  return `#${rgb.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
}

/** Mix towards white for amount > 0, towards black for amount < 0. */
export function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const target = amount > 0 ? 255 : 0;
  const ratio = Math.abs(amount);
  return rgbToHex([
    r + (target - r) * ratio,
    g + (target - g) * ratio,
    b + (target - b) * ratio,
  ]);
}

export function generateArt(cardId: string, theme: DeckTheme): GeneratedArt {
  const next = sequence(hash(cardId));
  const palette = [theme.accent, shade(theme.accent, 0.35), shade(theme.primary, 0.4), theme.ink];

  const blobs: Blob[] = [];
  const count = 3 + Math.floor(next() * 3);
  for (let i = 0; i < count; i++) {
    blobs.push({
      cx: 10 + next() * 80,
      cy: 10 + next() * 80,
      r: 16 + next() * 34,
      opacity: 0.12 + next() * 0.3,
      fill: palette[Math.floor(next() * palette.length)] ?? theme.accent,
    });
  }

  return {
    blobs,
    rotation: next() * 360,
    gradientFrom: shade(theme.primary, -0.25),
    gradientTo: shade(theme.primary, 0.18),
  };
}

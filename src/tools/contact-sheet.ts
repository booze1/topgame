/**
 * The contact sheet: one page showing every card's photograph at the exact
 * crop the game uses.
 *
 * This exists because a fetch can only tell you it got *an* image. It cannot
 * tell you the Ford GT photo is the wrong generation, or that a dinosaur card
 * came back as a size-comparison diagram rather than the animal. Those need
 * eyes, and eyes need all of them on one page.
 */

import type { Deck } from '../shared/types';

export interface SheetEntry {
  deckId: string;
  cardId: string;
  /** True when the image came from an exact pinned file rather than a lead image. */
  pinned: boolean;
}

export interface SheetSkip {
  deckId: string;
  cardId: string;
  reason: string;
}

export type SheetManifest = Record<string, Record<string, Record<string, string>>>;

/** Escapes text going into the contact sheet's HTML. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Writes a single page showing every card's photograph at card proportions.
 *
 * This is the only way to actually know the set is right. An automated fetch
 * can tell you it got *an* image; it cannot tell you the Ford GT photo is the
 * wrong generation, or that a dinosaur card came back as a size-comparison
 * diagram. Those need eyes, and eyes need all 120 on one page.
 */
export function contactSheet(
  decks: Deck[],
  manifest: SheetManifest,
  resolved: SheetEntry[],
  skipped: SheetSkip[],
): string {
  const pinnedIds = new Set(resolved.filter((r) => r.pinned).map((r) => `${r.deckId}/${r.cardId}`));
  const skippedById = new Map(
    skipped.map((entry) => [`${entry.deckId}/${entry.cardId}`, entry.reason]),
  );

  const sections = decks
    .map((deck) => {
      const tiles = deck.cards
        .map((card) => {
          const key = `${deck.id}/${card.id}`;
          const photo = manifest[deck.id]?.[card.id];
          const reason = skippedById.get(key);
          const badge = pinnedIds.has(key)
            ? '<span class="badge badge--pin">pinned</span>'
            : photo
              ? '<span class="badge">lead</span>'
              : '';

          const fit = card.fit ?? deck.art?.fit ?? 'cover';
          const band = fit === 'contain' ? (deck.art?.background ?? '#f4f6fb') : '#0b1020';
          const style = [
            `object-fit:${fit}`,
            card.focus ? `object-position:${escapeHtml(card.focus)}` : '',
          ]
            .filter(Boolean)
            .join(';');
          const art = photo?.['image']
            ? `<img src="..${escapeHtml(photo['image'])}" alt="" loading="lazy" style="${style}" />`
            : `<div class="missing">${escapeHtml(reason ?? 'no photo')}</div>`;

          return `
      <figure class="tile${photo ? '' : ' tile--missing'}">
        <div class="art" style="background:${escapeHtml(band)}">${art}</div>
        <figcaption>
          <strong>${escapeHtml(card.name)}</strong>${badge}
          <span class="meta">${escapeHtml(card.wikipedia)}</span>
          <span class="meta">${escapeHtml(photo?.['licence'] ?? '')} ${escapeHtml(photo?.['artist'] ?? '')}</span>
        </figcaption>
      </figure>`;
        })
        .join('');

      const withPhotos = deck.cards.filter((card) => manifest[deck.id]?.[card.id]).length;
      return `
  <section>
    <h2>${escapeHtml(deck.name)} <small>${withPhotos}/${deck.cards.length} with photos</small></h2>
    <div class="grid">${tiles}</div>
  </section>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Card photo contact sheet</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #0b1020; color: #e8edf7;
         font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; }
  h1 { margin: 0 0 4px; }
  .intro { color: #93a1bd; margin: 0 0 24px; max-width: 70ch; }
  h2 { margin: 32px 0 12px; font-size: 1.1rem; }
  h2 small { color: #6b7a99; font-weight: 400; }
  .grid { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); }
  .tile { margin: 0; background: #151d31; border: 1px solid #26314a; border-radius: 10px;
          overflow: hidden; }
  .tile--missing { border-color: #7f1d1d; }
  /* Same 16:9 band and centre-crop the real card uses, so what you see here
     is what the card shows. */
  .art { aspect-ratio: 16 / 9; background: #0b1020; }
  .art img { width: 100%; height: 100%; display: block; }
  .missing { display: grid; place-items: center; height: 100%; padding: 8px; text-align: center;
             color: #f87171; font-size: 11px; }
  figcaption { padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
  .meta { color: #6b7a99; font-size: 11px; overflow: hidden; text-overflow: ellipsis;
          white-space: nowrap; }
  .badge { margin-left: 6px; padding: 1px 6px; border-radius: 999px; background: #26314a;
           color: #93a1bd; font-size: 10px; }
  .badge--pin { background: #3b2f0b; color: #f5c451; }
</style>
</head>
<body>
  <h1>Card photo contact sheet</h1>
  <p class="intro">
    Every card, cropped exactly as the game crops it. Check that each picture is
    the right subject, not just a picture. A card marked <span class="badge badge--pin">pinned</span>
    came from an exact <code>commonsFile</code>; one marked <span class="badge">lead</span> came from
    whatever the Wikipedia article leads with and is the more likely to be wrong.
    To correct one, set <code>"commonsFile"</code> on that card in <code>decks/*.json</code>
    and re-run <code>npm run fetch-images --force</code>. If a subject is cropped badly,
    set <code>"focus"</code> (for example <code>"top"</code>).
  </p>
  ${sections}
</body>
</html>
`;
}

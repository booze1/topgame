/**
 * Deck loading.
 *
 * Decks are plain JSON in /decks so a new topic is a new file and nothing
 * else. They are validated once at boot: a malformed deck should stop the
 * server rather than surface as a strange bug three rounds into a match.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ArtFit, Deck, PhotoCredit, StatDef } from '../shared/types';

/**
 * Shape of public/cards/attributions.json. Values are typed as `unknown`
 * because the file is written by a script but read as untrusted input.
 */
export type PhotoManifest = Record<string, Record<string, Record<string, unknown>>>;

function fail(file: string, message: string): never {
  throw new Error(`Invalid deck ${file}: ${message}`);
}

/**
 * Deck and card ids end up in file paths (public/cards/<deck>/<card>.jpg) and
 * in URLs, so they are restricted to a safe alphabet. A deck file copied from
 * somewhere else should not be able to reach outside the cards directory.
 */
const SAFE_ID = /^[a-z0-9][a-z0-9_-]*$/i;

/**
 * Allowed CSS object-position values for a card's focal point. Restricted to
 * keywords and percentage pairs so nothing arbitrary reaches a style
 * attribute, and so a typo is caught at boot rather than silently ignored by
 * the browser.
 */
/** Colours reach a style attribute, so only plain hex is accepted. */
const isColour = (value: unknown): boolean =>
  typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);

/**
 * A drawing committed next to the deck, named by bare filename. Restricted to
 * the same safe alphabet as an id plus an image extension, so a deck file
 * copied from somewhere else cannot point the client at an arbitrary path.
 */
const SAFE_ART = /^[a-z0-9][a-z0-9_-]*\.(?:svg|png|jpg|jpeg|webp)$/i;

const SAFE_FOCUS =
  /^(?:(?:top|bottom|left|right|center)(?: (?:top|bottom|left|right|center))?|\d{1,3}% \d{1,3}%)$/;

function validateStat(file: string, value: unknown, index: number): StatDef {
  const stat = value as Partial<StatDef>;
  if (!stat || typeof stat.id !== 'string' || !stat.id) fail(file, `stat ${index} has no id`);
  if (typeof stat.label !== 'string' || !stat.label) fail(file, `stat "${stat.id}" has no label`);
  if (typeof stat.higherWins !== 'boolean') fail(file, `stat "${stat.id}" needs higherWins`);
  if (stat.grouped !== undefined && typeof stat.grouped !== 'boolean') {
    fail(file, `stat "${stat.id}" has a non-boolean grouped`);
  }
  return stat as StatDef;
}

function validateDeck(file: string, raw: unknown): Deck {
  const deck = raw as Partial<Deck>;
  if (!deck || typeof deck !== 'object') fail(file, 'not an object');
  for (const key of ['id', 'name', 'tagline', 'emoji'] as const) {
    if (typeof deck[key] !== 'string' || !deck[key]) fail(file, `missing "${key}"`);
  }
  if (!SAFE_ID.test(deck.id as string)) {
    fail(file, `id "${deck.id}" must be letters, digits, dashes or underscores`);
  }
  if (!deck.theme?.primary || !deck.theme.accent || !deck.theme.ink) fail(file, 'missing theme');
  if (deck.art !== undefined) {
    const fit = deck.art.fit;
    if (fit !== undefined && fit !== 'cover' && fit !== 'contain') {
      fail(file, `art.fit must be "cover" or "contain", not "${String(fit)}"`);
    }
    const background = deck.art.background;
    if (background !== undefined && !isColour(background)) {
      fail(file, `art.background "${String(background)}" is not a colour`);
    }
  }
  if (!Array.isArray(deck.stats) || deck.stats.length === 0) fail(file, 'needs at least one stat');
  const stats = deck.stats.map((s, i) => validateStat(file, s, i));

  if (!Array.isArray(deck.cards) || deck.cards.length < 2) fail(file, 'needs at least two cards');
  if (deck.cards.length % 2 !== 0) fail(file, 'needs an even number of cards so the deal is fair');

  const seen = new Set<string>();
  for (const card of deck.cards) {
    if (!card?.id || typeof card.id !== 'string') fail(file, 'a card has no id');
    if (!SAFE_ID.test(card.id)) {
      fail(file, `card id "${card.id}" must be letters, digits, dashes or underscores`);
    }
    if (seen.has(card.id)) fail(file, `duplicate card id "${card.id}"`);
    seen.add(card.id);
    for (const key of ['name', 'subtitle', 'emoji', 'wikipedia'] as const) {
      if (typeof card[key] !== 'string') fail(file, `card "${card.id}" is missing "${key}"`);
    }
    if (card.commonsFile !== undefined && typeof card.commonsFile !== 'string') {
      fail(file, `card "${card.id}" has a non-string commonsFile`);
    }
    if (card.localArt !== undefined && (typeof card.localArt !== 'string' || !SAFE_ART.test(card.localArt))) {
      fail(file, `card "${card.id}" has an invalid localArt "${String(card.localArt)}"`);
    }
    if (card.focus !== undefined && (typeof card.focus !== 'string' || !SAFE_FOCUS.test(card.focus))) {
      fail(file, `card "${card.id}" has an invalid focus "${String(card.focus)}"`);
    }
    const fit: ArtFit | undefined = card.fit;
    if (fit !== undefined && fit !== 'cover' && fit !== 'contain') {
      fail(file, `card "${card.id}" has an invalid fit "${String(fit)}"`);
    }
    for (const stat of stats) {
      const value = card.stats?.[stat.id];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        fail(file, `card "${card.id}" has no numeric "${stat.id}"`);
      }
    }
  }
  return deck as Deck;
}

/**
 * Photos live outside the repo (they belong to their photographers), so the
 * manifest written by `npm run fetch-images` is optional. Without it every
 * card falls back to generated art and the game plays exactly the same.
 */
function loadManifest(searchPaths: string[]): PhotoManifest {
  for (const path of searchPaths) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as PhotoManifest;
      if (parsed && typeof parsed === 'object') return parsed;
    } catch (error) {
      console.warn(`[decks] ignoring unreadable photo manifest at ${path}:`, error);
    }
  }
  return {};
}

export function loadDecks(rootDir: string): Deck[] {
  const dir = join(rootDir, 'decks');
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort();
  if (files.length === 0) throw new Error(`No decks found in ${dir}`);

  const manifest = loadManifest([
    join(rootDir, 'dist/client/cards/attributions.json'),
    join(rootDir, 'public/cards/attributions.json'),
  ]);

  const decks: Deck[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const deck = validateDeck(file, JSON.parse(readFileSync(join(dir, file), 'utf8')));
    if (ids.has(deck.id)) throw new Error(`Two decks share the id "${deck.id}"`);
    ids.add(deck.id);

    const photos = manifest[deck.id] ?? {};
    deck.cards = deck.cards.map((card) => {
      // A drawing committed with the deck was chosen deliberately, so it beats
      // anything the fetcher happened to find. It carries no photo credit
      // because there is no photographer to credit.
      if (card.localArt) return { ...card, image: `/cards/${deck.id}/${card.localArt}` };

      const photo = photos[card.id];
      if (!photo) return card;

      // The manifest is generated, but it is also a plain file somebody can
      // edit, so nothing from it is trusted: the image must be exactly the
      // path shape the fetcher writes, and links must be https. Anything else
      // falls back to generated art rather than failing the boot.
      const text = (value: unknown): string => (typeof value === 'string' ? value : '');
      const image = text(photo.image);
      if (!image.startsWith(`/cards/${deck.id}/`) || image.includes('..')) return card;

      const sourceUrl = text(photo.sourceUrl);
      const credit: PhotoCredit = {
        file: text(photo.file),
        artist: text(photo.artist) || 'Unknown author',
        licence: text(photo.licence),
        licenceUrl: text(photo.licenceUrl),
        sourceUrl: sourceUrl.startsWith('https://') ? sourceUrl : '',
      };
      return { ...card, image, credit };
    });
    decks.push(deck);
  }

  const withPhotos = decks.reduce(
    (total, deck) => total + deck.cards.filter((c) => c.image && !c.localArt).length,
    0,
  );
  const drawn = decks.reduce((total, deck) => total + deck.cards.filter((c) => c.localArt).length, 0);
  const totalCards = decks.reduce((total, deck) => total + deck.cards.length, 0);
  console.log(
    `[decks] loaded ${decks.length} decks, ${totalCards} cards, ${withPhotos} with photos` +
      (drawn > 0 ? `, ${drawn} with drawn art` : '') +
      (withPhotos === 0 ? ' (run `npm run fetch-images` to add real photos)' : ''),
  );
  return decks;
}

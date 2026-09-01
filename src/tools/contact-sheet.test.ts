import { describe, expect, it } from 'vitest';
import { contactSheet, escapeHtml } from './contact-sheet';
import type { SheetManifest } from './contact-sheet';
import type { Deck } from '../shared/types';

/**
 * The contact sheet is how a human decides whether the photo set is right, so
 * a card silently missing from it would defeat the entire point of having one.
 */
const deck: Deck = {
  id: 'cars',
  name: 'Cars',
  tagline: '',
  emoji: 'C',
  theme: { primary: '#000', accent: '#fff', ink: '#fff' },
  stats: [{ id: 'power', label: 'Power', higherWins: true }],
  cards: [
    {
      id: 'gt',
      name: 'Ford GT',
      subtitle: '',
      emoji: 'G',
      wikipedia: 'Ford GT',
      commonsFile: 'File:Ford GT.jpg',
      focus: 'top',
      stats: { power: 647 },
    },
    { id: 'f40', name: 'Ferrari F40', subtitle: '', emoji: 'F', wikipedia: 'Ferrari F40', stats: { power: 471 } },
    { id: 'gone', name: 'Missing Car', subtitle: '', emoji: 'M', wikipedia: 'Nope', stats: { power: 1 } },
  ],
};

const manifest: SheetManifest = {
  cars: {
    gt: { image: '/cards/cars/gt.jpg', file: 'Ford GT.jpg', artist: 'Ann', licence: 'CC BY 4.0' },
    f40: { image: '/cards/cars/f40.jpg', file: 'F40.jpg', artist: 'Bob', licence: 'CC0' },
  },
};

const html = contactSheet(
  deck.cards.length ? [deck] : [],
  manifest,
  [
    { deckId: 'cars', cardId: 'gt', pinned: true },
    { deckId: 'cars', cardId: 'f40', pinned: false },
  ],
  [{ deckId: 'cars', cardId: 'gone', reason: 'no lead image on Wikipedia' }],
);

describe('contactSheet', () => {
  it('shows every card, including the ones with no photo', () => {
    for (const card of deck.cards) expect(html).toContain(card.name);
  });

  it('points at each downloaded image', () => {
    expect(html).toContain('src="../cards/cars/gt.jpg"');
    expect(html).toContain('src="../cards/cars/f40.jpg"');
  });

  it('distinguishes a pinned file from a lead image, since leads are likelier to be wrong', () => {
    const pinnedTile = html.slice(html.indexOf('Ford GT'), html.indexOf('Ferrari F40'));
    const leadTile = html.slice(html.indexOf('Ferrari F40'), html.indexOf('Missing Car'));
    expect(pinnedTile).toContain('badge--pin');
    expect(leadTile).toContain('>lead<');
    expect(leadTile).not.toContain('badge--pin');
  });

  it('explains why a card has no photo instead of showing a blank tile', () => {
    expect(html).toContain('no lead image on Wikipedia');
    expect(html).toContain('tile--missing');
  });

  it('reproduces the focal point so the preview matches the real card', () => {
    expect(html).toContain('object-position:top');
  });

  it('reports how many cards in each deck ended up with a photo', () => {
    expect(html).toContain('2/3 with photos');
  });

  it('crops previews the same 16:9 way the game does', () => {
    expect(html).toContain('aspect-ratio: 16 / 9');
    expect(html).toContain('object-fit: cover');
  });

  it('escapes card names rather than injecting them raw', () => {
    const nasty: Deck = {
      ...deck,
      cards: [{ ...deck.cards[0]!, name: '<script>alert(1)</script>', commonsFile: undefined }],
    };
    const out = contactSheet([nasty], {}, [], []);
    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
  });
});

describe('escapeHtml', () => {
  it('escapes the characters that would break out of markup', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
  });
});

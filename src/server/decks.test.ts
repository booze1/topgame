import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDecks } from './decks';

/**
 * The deck loader is the boundary between a JSON file somebody dropped in and
 * the running game, so it is worth proving that a bad file stops the server
 * rather than producing a strange bug several rounds in.
 */
let root: string;

const validDeck = (): {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  theme: { primary: string; accent: string; ink: string };
  stats: { id: string; label: string; higherWins: boolean }[];
  cards: {
    id: string;
    name: string;
    subtitle: string;
    emoji: string;
    wikipedia: string;
    stats: Record<string, number>;
    localArt?: string;
  }[];
} => ({
  id: 'test',
  name: 'Test',
  tagline: 'A deck',
  emoji: 'T',
  theme: { primary: '#000', accent: '#fff', ink: '#fff' },
  stats: [{ id: 'power', label: 'Power', higherWins: true }],
  cards: [
    { id: 'a', name: 'A', subtitle: '', emoji: 'A', wikipedia: 'A', stats: { power: 2 } },
    { id: 'b', name: 'B', subtitle: '', emoji: 'B', wikipedia: 'B', stats: { power: 1 } },
  ],
});

function writeDeck(deck: unknown, name = 'test.json'): void {
  writeFileSync(join(root, 'decks', name), JSON.stringify(deck));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'decks-'));
  mkdirSync(join(root, 'decks'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('loadDecks', () => {
  it('loads a well-formed deck', () => {
    writeDeck(validDeck());
    const [deck] = loadDecks(root);
    expect(deck?.id).toBe('test');
    expect(deck?.cards).toHaveLength(2);
  });

  it.each([
    ['no stats', { stats: [] }],
    ['an odd number of cards', { cards: [validDeck().cards[0]] }],
    ['a missing name', { name: '' }],
    ['no theme', { theme: undefined }],
  ])('refuses a deck with %s', (_label, patch) => {
    writeDeck({ ...validDeck(), ...patch });
    expect(() => loadDecks(root)).toThrow(/Invalid deck/);
  });

  it('refuses a card missing a value for a declared stat', () => {
    const deck = validDeck();
    writeDeck({ ...deck, cards: [deck.cards[0], { ...deck.cards[1], stats: {} }] });
    expect(() => loadDecks(root)).toThrow(/no numeric "power"/);
  });

  it('refuses duplicate card ids', () => {
    const deck = validDeck();
    deck.cards[1]!.id = 'a';
    writeDeck(deck);
    expect(() => loadDecks(root)).toThrow(/duplicate card id/);
  });

  it('refuses two decks that share an id', () => {
    writeDeck(validDeck(), 'one.json');
    writeDeck(validDeck(), 'two.json');
    expect(() => loadDecks(root)).toThrow(/share the id/);
  });

  // Ids become file paths under public/cards and URLs in the client.
  it.each(['../escape', 'a/b', 'with space', '.hidden', ''])(
    'refuses the unsafe card id %j',
    (id) => {
      const deck = validDeck();
      deck.cards[0]!.id = id;
      writeDeck(deck);
      expect(() => loadDecks(root)).toThrow(/Invalid deck/);
    },
  );

  it('refuses an unsafe deck id', () => {
    writeDeck({ ...validDeck(), id: '../../etc' });
    expect(() => loadDecks(root)).toThrow(/must be letters/);
  });
});

describe('photo manifest', () => {
  function writeManifest(manifest: unknown): void {
    mkdirSync(join(root, 'public', 'cards'), { recursive: true });
    writeFileSync(join(root, 'public', 'cards', 'attributions.json'), JSON.stringify(manifest));
  }

  it('attaches photos and credits to the right cards', () => {
    writeDeck(validDeck());
    writeManifest({
      test: {
        a: {
          image: '/cards/test/a.jpg',
          file: 'A.jpg',
          artist: 'Ann',
          licence: 'CC BY 4.0',
          licenceUrl: 'https://creativecommons.org/licenses/by/4.0/',
          sourceUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
        },
      },
    });

    const [deck] = loadDecks(root);
    expect(deck?.cards[0]?.image).toBe('/cards/test/a.jpg');
    expect(deck?.cards[0]?.credit?.artist).toBe('Ann');
    expect(deck?.cards[1]?.image).toBeUndefined();
  });

  it.each([
    ['a path outside the deck folder', '/../../etc/passwd'],
    ['a traversal segment inside the prefix', '/cards/test/../../assets/app.js'],
    ['another deck folder', '/cards/other/a.jpg'],
    ['a non-string', 42],
  ])('ignores an image that is %s', (_label, image) => {
    writeDeck(validDeck());
    writeManifest({
      test: { a: { image, file: '', artist: '', licence: 'CC0', licenceUrl: '', sourceUrl: '' } },
    });
    expect(loadDecks(root)[0]?.cards[0]?.image).toBeUndefined();
  });

  it('replaces non-string credit fields rather than throwing', () => {
    writeDeck(validDeck());
    writeManifest({
      test: {
        a: {
          image: '/cards/test/a.jpg',
          file: { nested: true },
          artist: null,
          licence: 7,
          licenceUrl: [],
          sourceUrl: { href: 'https://example.com' },
        },
      },
    });
    const credit = loadDecks(root)[0]?.cards[0]?.credit;
    expect(credit).toEqual({
      file: '',
      artist: 'Unknown author',
      licence: '',
      licenceUrl: '',
      sourceUrl: '',
    });
  });

  it('drops a credit link that is not https', () => {
    writeDeck(validDeck());
    writeManifest({
      test: {
        a: {
          image: '/cards/test/a.jpg',
          file: 'A.jpg',
          artist: 'Ann',
          licence: 'CC0',
          licenceUrl: '',
          // Exactly the thing that must not reach an href.
          sourceUrl: 'javascript:alert(1)',
        },
      },
    });
    expect(loadDecks(root)[0]?.cards[0]?.credit?.sourceUrl).toBe('');
  });

  it('resolves a drawing committed with the deck', () => {
    const deck = validDeck();
    deck.cards[0]!.localArt = 'a.svg';
    writeDeck(deck);
    const card = loadDecks(root)[0]?.cards[0];
    expect(card?.image).toBe('/cards/test/a.svg');
    // Nobody to credit: it was drawn for the deck, not taken by a photographer.
    expect(card?.credit).toBeUndefined();
  });

  it('prefers a drawing to whatever the fetcher found', () => {
    const deck = validDeck();
    deck.cards[0]!.localArt = 'a.svg';
    writeDeck(deck);
    writeManifest({
      test: {
        a: {
          image: '/cards/test/a.jpg',
          file: 'A.jpg',
          artist: 'Ann',
          licence: 'CC0',
          licenceUrl: '',
          sourceUrl: 'https://example.com',
        },
      },
    });
    expect(loadDecks(root)[0]?.cards[0]?.image).toBe('/cards/test/a.svg');
  });

  it.each([
    ['a path', '../../etc/passwd.svg'],
    ['a subdirectory', 'guns/a.svg'],
    ['an executable extension', 'a.html'],
    ['no extension', 'a'],
  ])('refuses localArt that is %s', (_label, art) => {
    const deck = validDeck();
    deck.cards[0]!.localArt = art;
    writeDeck(deck);
    expect(() => loadDecks(root)).toThrow(/invalid localArt/);
  });

  it('carries on when the manifest is corrupt', () => {
    writeDeck(validDeck());
    mkdirSync(join(root, 'public', 'cards'), { recursive: true });
    writeFileSync(join(root, 'public', 'cards', 'attributions.json'), 'not json');
    expect(loadDecks(root)[0]?.cards[0]?.image).toBeUndefined();
  });
});

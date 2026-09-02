import { describe, expect, it } from 'vitest';
import {
  advancePhase,
  canPick,
  chooseStatForBot,
  compareStat,
  createMatch,
  formatStatValue,
  forfeit,
  mulberry32,
  playRound,
  shuffle,
  statPercentile,
} from './rules';
import type { Deck, MatchState } from './types';

/**
 * A tiny deck with one "higher wins" stat and one "lower wins" stat, so the
 * direction handling is exercised without depending on the shipped decks.
 */
const deck: Deck = {
  id: 'test',
  name: 'Test',
  tagline: '',
  emoji: '🧪',
  theme: { primary: '#000', accent: '#fff', ink: '#fff' },
  stats: [
    { id: 'power', label: 'Power', higherWins: true },
    { id: 'time', label: 'Time', higherWins: false, decimals: 1 },
  ],
  cards: [
    { id: 'a', name: 'A', subtitle: '', emoji: '🅰️', wikipedia: 'A', stats: { power: 100, time: 1 } },
    { id: 'b', name: 'B', subtitle: '', emoji: '🅱️', wikipedia: 'B', stats: { power: 80, time: 2 } },
    { id: 'c', name: 'C', subtitle: '', emoji: '©️', wikipedia: 'C', stats: { power: 60, time: 3 } },
    { id: 'd', name: 'D', subtitle: '', emoji: '🆔', wikipedia: 'D', stats: { power: 100, time: 4 } },
  ],
};

/** Build an exact match state so each rule can be tested in isolation. */
function state(
  handA: string[],
  handB: string[],
  extra: Partial<MatchState> = {},
): MatchState {
  return {
    deckId: deck.id,
    hands: [handA, handB],
    pot: [],
    activeSeat: 0,
    round: 0,
    phase: 'picking',
    outcome: null,
    history: [],
    winner: null,
    endReason: null,
    roundCap: 0,
    ...extra,
  };
}

describe('shuffle and dealing', () => {
  it('is deterministic for a given seed', () => {
    const one = createMatch(deck, { seed: 42 });
    const two = createMatch(deck, { seed: 42 });
    expect(one.hands).toEqual(two.hands);
  });

  it('produces a different order for a different seed', () => {
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) => createMatch(deck, { seed }).hands.flat().join()),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('deals every card exactly once, alternating between seats', () => {
    const match = createMatch(deck, { seed: 7 });
    const all = [...match.hands[0], ...match.hands[1]].sort();
    expect(all).toEqual(['a', 'b', 'c', 'd']);
    expect(match.hands[0]).toHaveLength(2);
    expect(match.hands[1]).toHaveLength(2);
  });

  it('keeps every element when shuffling', () => {
    const input = ['a', 'b', 'c', 'd', 'e'];
    expect(shuffle(input, mulberry32(3)).sort()).toEqual(input);
  });

  it('starts on the requested seat, picking, with an empty pot', () => {
    const match = createMatch(deck, { seed: 1, startingSeat: 1 });
    expect(match.activeSeat).toBe(1);
    expect(match.phase).toBe('picking');
    expect(match.pot).toEqual([]);
  });
});

describe('compareStat', () => {
  const higher = deck.stats[0]!;
  const lower = deck.stats[1]!;

  it('gives a "higher wins" stat to the bigger number', () => {
    expect(compareStat(higher, 100, 80)).toBe(0);
    expect(compareStat(higher, 80, 100)).toBe(1);
  });

  it('gives a "lower wins" stat to the smaller number', () => {
    expect(compareStat(lower, 2.5, 3.9)).toBe(0);
    expect(compareStat(lower, 3.9, 2.5)).toBe(1);
  });

  it('returns null when the values are equal', () => {
    expect(compareStat(higher, 5, 5)).toBeNull();
    expect(compareStat(lower, 5, 5)).toBeNull();
  });
});

describe('playRound - a decisive round', () => {
  it('moves both cards to the back of the winner pile, own card last', () => {
    const next = playRound(deck, state(['a', 'c'], ['b', 'd']), 'power');
    // Seat 0 played a (100) against b (80) and won.
    expect(next.hands[0]).toEqual(['c', 'b', 'a']);
    expect(next.hands[1]).toEqual(['d']);
    expect(next.pot).toEqual([]);
  });

  it('hands the next pick to the winner', () => {
    const next = playRound(deck, state(['c', 'a'], ['b', 'd'], { activeSeat: 0 }), 'power');
    // c (60) loses to b (80), so seat 1 picks next.
    expect(next.outcome?.winner).toBe(1);
    expect(next.activeSeat).toBe(1);
  });

  it('honours "lower wins" stats', () => {
    const next = playRound(deck, state(['d', 'a'], ['b', 'c'], { activeSeat: 0 }), 'time');
    // d has time 4, b has time 2 - lower wins, so seat 1 takes it.
    expect(next.outcome?.winner).toBe(1);
    expect(next.hands[1]).toEqual(['c', 'd', 'b']);
  });

  it('records a full outcome for the history', () => {
    const next = playRound(deck, state(['a', 'c'], ['b', 'd']), 'power');
    expect(next.outcome).toMatchObject({
      round: 1,
      statId: 'power',
      pickedBy: 0,
      cardIds: ['a', 'b'],
      values: [100, 80],
      result: 'win',
      winner: 0,
      potBefore: 0,
      cardsWon: 2,
      counts: [3, 1],
    });
    expect(next.history).toHaveLength(1);
  });

  it('does not mutate the state it was given', () => {
    const before = state(['a', 'c'], ['b', 'd']);
    const snapshot = JSON.parse(JSON.stringify(before));
    playRound(deck, before, 'power');
    expect(before).toEqual(snapshot);
  });

  it('refuses to play outside the picking phase', () => {
    expect(() => playRound(deck, state(['a'], ['b'], { phase: 'reveal' }), 'power')).toThrow();
  });

  it('rejects a stat the deck does not have', () => {
    expect(() => playRound(deck, state(['a'], ['b']), 'nope')).toThrow(/not in deck/);
  });
});

describe('playRound - draws and the pot', () => {
  it('puts both cards in the pot and leaves the pick where it was', () => {
    const next = playRound(deck, state(['a', 'c'], ['d', 'b'], { activeSeat: 0 }), 'power');
    // a and d are both 100.
    expect(next.outcome?.result).toBe('draw');
    expect(next.pot).toEqual(['a', 'd']);
    expect(next.hands).toEqual([['c'], ['b']]);
    expect(next.activeSeat).toBe(0);
    expect(next.outcome?.cardsWon).toBe(0);
  });

  it('awards the whole pot to the next winner', () => {
    const drawn = playRound(deck, state(['a', 'c'], ['d', 'b'], { activeSeat: 0 }), 'power');
    const decided = playRound(deck, advancePhase(drawn), 'power');
    // c (60) versus b (80): seat 1 takes its own card, c, and the two-card pot.
    expect(decided.outcome?.winner).toBe(1);
    expect(decided.outcome?.potBefore).toBe(2);
    expect(decided.outcome?.cardsWon).toBe(4);
    expect(decided.hands[1]).toEqual(['a', 'd', 'c', 'b']);
    expect(decided.hands[0]).toEqual([]);
    expect(decided.pot).toEqual([]);
  });

  it('keeps stacking through a chain of draws', () => {
    let match = state(['a', 'd', 'b'], ['d', 'a', 'c'], { activeSeat: 1, roundCap: 0 });
    // Two consecutive draws on power (100 v 100, then 100 v 100).
    match = advancePhase(playRound(deck, match, 'power'));
    match = advancePhase(playRound(deck, match, 'power'));
    expect(match.pot).toHaveLength(4);
    const decided = playRound(deck, match, 'power');
    // b (80) versus c (60): seat 0 wins the pair plus the four-card pot.
    expect(decided.outcome?.cardsWon).toBe(6);
    expect(decided.hands[0]).toHaveLength(6);
  });
});

describe('end conditions', () => {
  it('ends the match when a player runs out of cards', () => {
    const next = playRound(deck, state(['a'], ['b']), 'power');
    expect(next.phase).toBe('gameover');
    expect(next.winner).toBe(0);
    expect(next.endReason).toBe('cards');
  });

  it('gives a stranded pot to the survivor when a draw empties a hand', () => {
    const next = playRound(deck, state(['a'], ['d', 'b'], { activeSeat: 0 }), 'power');
    // Drawn: a and d go to the pot, which empties seat 0.
    expect(next.winner).toBe(1);
    expect(next.endReason).toBe('cards');
    expect(next.pot).toEqual([]);
    expect(next.hands[1]).toEqual(['b', 'a', 'd']);
  });

  it('calls a genuine tie when a draw empties both hands at once', () => {
    const next = playRound(deck, state(['a'], ['d'], { activeSeat: 0 }), 'power');
    expect(next.phase).toBe('gameover');
    expect(next.winner).toBeNull();
    expect(next.endReason).toBe('cards');
  });

  it('awards the win to the larger hand at the round cap', () => {
    const next = playRound(
      deck,
      state(['c', 'd'], ['b'], { activeSeat: 1, round: 4, roundCap: 5 }),
      'power',
    );
    // b (80) beats c (60): seat 1 ends on 3 cards, seat 0 on 1.
    expect(next.phase).toBe('gameover');
    expect(next.endReason).toBe('roundcap');
    expect(next.winner).toBe(1);
  });

  it('calls a tie at the round cap when the hands are level', () => {
    const next = playRound(
      deck,
      state(['a', 'c'], ['d', 'b'], { activeSeat: 0, round: 9, roundCap: 10 }),
      'power',
    );
    // Drawn round leaves one card each.
    expect(next.endReason).toBe('roundcap');
    expect(next.winner).toBeNull();
  });

  it('never triggers the round cap when it is disabled', () => {
    const next = playRound(deck, state(['a', 'c'], ['b', 'd'], { round: 999, roundCap: 0 }), 'power');
    expect(next.phase).toBe('reveal');
    expect(next.winner).toBeNull();
  });
});

describe('turn gating and lifecycle', () => {
  it('only lets the active seat pick, and only while picking', () => {
    const picking = state(['a'], ['b'], { activeSeat: 1 });
    expect(canPick(picking, 1)).toBe(true);
    expect(canPick(picking, 0)).toBe(false);
    expect(canPick({ ...picking, phase: 'reveal' }, 1)).toBe(false);
    expect(canPick({ ...picking, phase: 'gameover', winner: 1 }, 1)).toBe(false);
  });

  it('returns to picking after a reveal, and leaves a finished match alone', () => {
    expect(advancePhase(state(['a'], ['b'], { phase: 'reveal' })).phase).toBe('picking');
    const over = state(['a'], [], { phase: 'gameover', winner: 0 });
    expect(advancePhase(over)).toBe(over);
  });

  it('awards a forfeit to the other seat', () => {
    const next = forfeit(state(['a', 'c'], ['b', 'd']), 0);
    expect(next.winner).toBe(1);
    expect(next.endReason).toBe('forfeit');
    expect(next.phase).toBe('gameover');
  });

  it('does not overwrite the result of a finished match', () => {
    const over = state([], ['b'], { phase: 'gameover', winner: 1, endReason: 'cards' });
    expect(forfeit(over, 1)).toBe(over);
  });
});

describe('a full match always terminates with one winner', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])('seed %i', (seed) => {
    const rng = mulberry32(seed * 977);
    let match = createMatch(deck, { seed, roundCap: 200 });
    let guard = 0;
    while (match.phase !== 'gameover') {
      if (guard++ > 500) throw new Error('match failed to terminate');
      const stat = deck.stats[Math.floor(rng() * deck.stats.length)]!;
      match = advancePhase(playRound(deck, match, stat.id));
    }
    const total = match.hands[0].length + match.hands[1].length + match.pot.length;
    expect(total).toBe(deck.cards.length);
    if (match.endReason === 'cards' && match.winner !== null) {
      expect(match.hands[match.winner]).toHaveLength(deck.cards.length);
    }
  });
});

describe('computer opponent', () => {
  const cardA = deck.cards[0]!;
  const cardC = deck.cards[2]!;

  it('scores a stat by how much of the deck it beats', () => {
    // a has the joint-best power (beats b and c, ties d) and the best time.
    expect(statPercentile(deck, cardA, deck.stats[0]!)).toBeCloseTo(2 / 3);
    expect(statPercentile(deck, cardA, deck.stats[1]!)).toBe(1);
    expect(statPercentile(deck, cardC, deck.stats[0]!)).toBe(0);
  });

  it('plays the strongest stat on hard', () => {
    expect(chooseStatForBot(deck, cardA, 'hard', mulberry32(1))).toBe('time');
    // c is poor at power but middling at time.
    expect(chooseStatForBot(deck, cardC, 'hard', mulberry32(1))).toBe('time');
  });

  it('stays inside the deck on easy, including at the top of the range', () => {
    const ids = deck.stats.map((s) => s.id);
    for (const value of [0, 0.49, 0.5, 0.999999, 1]) {
      expect(ids).toContain(chooseStatForBot(deck, cardA, 'easy', () => value));
    }
  });
});

describe('formatStatValue', () => {
  it('applies decimals, units and prefixes', () => {
    expect(formatStatValue({ id: 'x', label: 'X', higherWins: true }, 1234)).toBe('1,234');
    expect(
      formatStatValue({ id: 'x', label: 'X', higherWins: false, decimals: 1, unit: 's' }, 2.45),
    ).toBe('2.5s');
    expect(
      formatStatValue({ id: 'x', label: 'X', higherWins: true, prefix: '$', unit: 'k' }, 250),
    ).toBe('$250k');
  });

  it('drops the thousands separator when a stat asks it to', () => {
    // A founding year is written 1759, not 1,759.
    expect(
      formatStatValue({ id: 'founded', label: 'Founded', higherWins: false, grouped: false }, 1759),
    ).toBe('1759');
  });
});

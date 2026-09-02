/**
 * The rules of the game, as pure functions.
 *
 * Nothing in here touches the network, the clock or global state, so the whole
 * rule set is testable in isolation and the server can trust it completely.
 *
 * House rules (classic Top Trumps):
 *  - The active player names a stat. Both top cards are compared.
 *  - The winner takes both cards plus anything in the pot, and picks next.
 *  - A draw puts both cards in the pot; the same player picks again and the
 *    next winner takes the lot.
 *  - You win by taking every card. A round cap breaks stalemates by awarding
 *    the win to the larger hand.
 */

import type {
  AiDifficulty,
  CardDef,
  Deck,
  MatchState,
  RoundOutcome,
  Seat,
  StatDef,
  StatId,
} from './types';

export const DEFAULT_ROUND_CAP = 80;

/** Small, fast, seedable PRNG. Deterministic across platforms. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates, returning a new array. */
export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

export function cardById(deck: Deck, id: string): CardDef {
  const card = deck.cards.find((c) => c.id === id);
  if (!card) throw new Error(`Card "${id}" is not in deck "${deck.id}"`);
  return card;
}

export function statById(deck: Deck, id: StatId): StatDef {
  const stat = deck.stats.find((s) => s.id === id);
  if (!stat) throw new Error(`Stat "${id}" is not in deck "${deck.id}"`);
  return stat;
}

export interface CreateMatchOptions {
  seed?: number;
  startingSeat?: Seat;
  roundCap?: number;
}

/**
 * Deal a fresh match. The deck is shuffled and dealt alternately, so an odd
 * deck size leaves seat 0 one card ahead — which is why decks ship with an
 * even number of cards.
 */
export function createMatch(deck: Deck, options: CreateMatchOptions = {}): MatchState {
  const seed = options.seed ?? (Math.random() * 2 ** 32) >>> 0;
  const order = shuffle(
    deck.cards.map((c) => c.id),
    mulberry32(seed),
  );

  const hands: [string[], string[]] = [[], []];
  order.forEach((id, index) => hands[index % 2]!.push(id));

  return {
    deckId: deck.id,
    hands,
    pot: [],
    activeSeat: options.startingSeat ?? 0,
    round: 0,
    phase: 'picking',
    outcome: null,
    history: [],
    winner: null,
    endReason: null,
    roundCap: options.roundCap ?? DEFAULT_ROUND_CAP,
  };
}

export function topCard(state: MatchState, seat: Seat): string | null {
  return state.hands[seat][0] ?? null;
}

export const otherSeat = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/**
 * Compare a stat across two cards.
 * Returns the winning seat, or null when the values are equal.
 */
export function compareStat(stat: StatDef, valueA: number, valueB: number): Seat | null {
  if (valueA === valueB) return null;
  const aWins = stat.higherWins ? valueA > valueB : valueA < valueB;
  return aWins ? 0 : 1;
}

export function statValue(card: CardDef, statId: StatId): number {
  const value = card.stats[statId];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Card "${card.id}" has no numeric value for stat "${statId}"`);
  }
  return value;
}

/** Whether `seat` is allowed to name a stat right now. */
export function canPick(state: MatchState, seat: Seat): boolean {
  return state.phase === 'picking' && state.activeSeat === seat && state.winner === null;
}

/**
 * Play one round and return the resulting state. The input is not mutated.
 *
 * Throws when the move is illegal, so callers should gate on `canPick` first —
 * the server does, and treats a throw as a protocol error.
 */
export function playRound(deck: Deck, state: MatchState, statId: StatId): MatchState {
  if (state.phase !== 'picking') {
    throw new Error(`Cannot play a round while phase is "${state.phase}"`);
  }
  const stat = statById(deck, statId);

  const idA = topCard(state, 0);
  const idB = topCard(state, 1);
  if (!idA || !idB) throw new Error('A player has no card to play');

  const cardA = cardById(deck, idA);
  const cardB = cardById(deck, idB);
  const valueA = statValue(cardA, statId);
  const valueB = statValue(cardB, statId);
  const winner = compareStat(stat, valueA, valueB);

  const restA = state.hands[0].slice(1);
  const restB = state.hands[1].slice(1);
  const round = state.round + 1;
  const potBefore = state.pot.length;

  let hands: [string[], string[]];
  let pot: string[];
  let cardsWon: number;
  let activeSeat: Seat;

  if (winner === null) {
    // Draw: both cards join the pot and the same player picks again.
    hands = [restA, restB];
    pot = [...state.pot, idA, idB];
    cardsWon = 0;
    activeSeat = state.activeSeat;
  } else {
    // The winner collects the pot, then the loser's card, and finally puts
    // their own card at the very back of their pile.
    const winnerId = winner === 0 ? idA : idB;
    const loserId = winner === 0 ? idB : idA;
    const winnerRest = winner === 0 ? restA : restB;
    const loserRest = winner === 0 ? restB : restA;

    const collected = [...winnerRest, ...state.pot, loserId, winnerId];
    hands = winner === 0 ? [collected, loserRest] : [loserRest, collected];
    pot = [];
    cardsWon = state.pot.length + 2;
    activeSeat = winner;
  }

  const outcome: RoundOutcome = {
    round,
    statId,
    pickedBy: state.activeSeat,
    cardIds: [idA, idB],
    values: [valueA, valueB],
    result: winner === null ? 'draw' : 'win',
    winner,
    potBefore,
    cardsWon,
    counts: [hands[0].length, hands[1].length],
  };

  const next: MatchState = {
    ...state,
    hands,
    pot,
    activeSeat,
    round,
    phase: 'reveal',
    outcome,
    history: [...state.history, outcome],
    winner: null,
    endReason: null,
  };

  return applyEndConditions(next);
}

/**
 * Decide whether the match is over once a round has been resolved.
 *
 * A player who cannot field a card has lost, even if cards of theirs are still
 * sitting in the pot — those go to the opponent. If a drawn round empties both
 * hands at once the match is a genuine tie.
 */
function applyEndConditions(state: MatchState): MatchState {
  const [a, b] = [state.hands[0].length, state.hands[1].length];

  if (a === 0 && b === 0) {
    return { ...state, winner: null, endReason: 'cards', phase: 'gameover' };
  }
  if (a === 0 || b === 0) {
    const winner: Seat = a === 0 ? 1 : 0;
    // Whatever is stranded in the pot belongs to the survivor.
    const hands: [string[], string[]] = [state.hands[0].slice(), state.hands[1].slice()];
    hands[winner] = [...hands[winner], ...state.pot];
    return { ...state, hands, pot: [], winner, endReason: 'cards', phase: 'gameover' };
  }
  if (state.roundCap > 0 && state.round >= state.roundCap) {
    const winner: Seat | null = a === b ? null : a > b ? 0 : 1;
    return { ...state, winner, endReason: 'roundcap', phase: 'gameover' };
  }
  return state;
}

/** Move from the reveal back to picking. No-op once the match is over. */
export function advancePhase(state: MatchState): MatchState {
  if (state.phase !== 'reveal') return state;
  return { ...state, phase: 'picking' };
}

/** End the match early, e.g. because an opponent left for good. */
export function forfeit(state: MatchState, loser: Seat): MatchState {
  if (state.phase === 'gameover') return state;
  return { ...state, phase: 'gameover', winner: otherSeat(loser), endReason: 'forfeit' };
}

// ---------------------------------------------------------------------------
// Presentation helpers (shared so the table and the history agree)
// ---------------------------------------------------------------------------

export function formatStatValue(stat: StatDef, value: number): string {
  const decimals = stat.decimals ?? 0;
  const body = value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    // A year is not written "1,759". Decks say so per stat.
    useGrouping: stat.grouped ?? true,
  });
  return `${stat.prefix ?? ''}${body}${stat.unit ?? ''}`;
}

// ---------------------------------------------------------------------------
// Computer opponent
// ---------------------------------------------------------------------------

/**
 * How good a card's stat is relative to the rest of the deck, from 0 (worst in
 * the deck) to 1 (best). Direction-aware, so a low 0-60 time scores highly.
 */
export function statPercentile(deck: Deck, card: CardDef, stat: StatDef): number {
  const mine = statValue(card, stat.id);
  let beaten = 0;
  let comparable = 0;
  for (const other of deck.cards) {
    if (other.id === card.id) continue;
    const theirs = statValue(other, stat.id);
    comparable += 1;
    if (stat.higherWins ? mine > theirs : mine < theirs) beaten += 1;
  }
  return comparable === 0 ? 0 : beaten / comparable;
}

/**
 * Pick a stat for the computer.
 *
 * `hard` plays the stat that beats the largest share of the deck — the same
 * reasoning a good human uses. `easy` chooses at random, which is beatable but
 * never obviously silly.
 */
export function chooseStatForBot(
  deck: Deck,
  card: CardDef,
  difficulty: AiDifficulty,
  rng: () => number = Math.random,
): StatId {
  if (deck.stats.length === 0) throw new Error(`Deck "${deck.id}" has no stats`);

  if (difficulty === 'easy') {
    const index = Math.floor(rng() * deck.stats.length);
    return deck.stats[Math.min(index, deck.stats.length - 1)]!.id;
  }

  let best = deck.stats[0]!;
  let bestScore = -1;
  for (const stat of deck.stats) {
    // A whisker of noise breaks ties without ever choosing a weak stat.
    const score = statPercentile(deck, card, stat) + rng() * 1e-3;
    if (score > bestScore) {
      bestScore = score;
      best = stat;
    }
  }
  return best.id;
}

import type { EndReason, MatchView, Seat, StatDef } from '../../shared/types';
import { formatStatValue } from '../../shared/rules';

/** Mirrors the server's own normalisation so the input never disagrees. */
export function normaliseCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
}

/** Room codes are read aloud; screen readers should spell them out. */
export function spellOut(code: string): string {
  return code.split('').join(' ');
}

export function shareUrlFor(code: string): string {
  const url = new URL(window.location.href);
  url.search = `?room=${code}`;
  url.hash = '';
  return url.toString();
}

/**
 * A single sentence describing the round that just resolved, used both for the
 * on-screen banner and for the screen-reader live region.
 */
export function describeOutcome(view: MatchView, stat: StatDef | undefined): string {
  const outcome = view.outcome;
  if (!outcome || !stat) return '';

  const mine = outcome.values[view.seat];
  const theirs = outcome.values[view.seat === 0 ? 1 : 0];
  const myValue = formatStatValue(stat, mine);
  const theirValue = formatStatValue(stat, theirs);

  if (outcome.result === 'draw') {
    return `Draw on ${stat.label}: both ${myValue}. Both cards go into the pot.`;
  }
  const won = outcome.winner === view.seat;
  const verb = won ? 'beats' : 'loses to';
  const tail = won
    ? `You take ${outcome.cardsWon} cards.`
    : `They take ${outcome.cardsWon} cards.`;
  return `${stat.label}: your ${myValue} ${verb} their ${theirValue}. ${tail}`;
}

export function describeEnding(view: MatchView): { headline: string; detail: string } {
  const won = view.winner === view.seat;
  const opponent = view.players[view.seat === 0 ? 1 : 0]?.name ?? 'Your opponent';

  if (view.winner === null) {
    return {
      headline: 'Dead heat',
      detail: 'You finished level. Nobody could take the last card.',
    };
  }

  const reasons: Record<EndReason, string> = {
    cards: won
      ? `You took every card off ${opponent}.`
      : `${opponent} took every card off you.`,
    roundcap: won
      ? `The round limit was reached and you were holding more cards.`
      : `The round limit was reached and ${opponent} was holding more cards.`,
    forfeit: won
      ? `${opponent} left the game.`
      : `You left the game.`,
  };

  return {
    headline: won ? 'You win' : 'You lose',
    detail: view.endReason ? reasons[view.endReason] : '',
  };
}

export function seatName(view: MatchView, seat: Seat): string {
  return seat === view.seat ? 'You' : (view.players[seat]?.name ?? 'Opponent');
}

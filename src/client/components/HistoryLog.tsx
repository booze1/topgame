import { formatStatValue } from '../../shared/rules';
import type { Deck, MatchView } from '../../shared/types';

interface HistoryLogProps {
  view: MatchView;
  deck: Deck;
  open: boolean;
  onToggle: () => void;
}

/** Every round played so far, newest first. Collapsed by default on a phone. */
export function HistoryLog({ view, deck, open, onToggle }: HistoryLogProps): JSX.Element {
  const rounds = [...view.history].reverse();
  const cardName = (id: string) => deck.cards.find((card) => card.id === id)?.name ?? id;
  const opponentSeat = view.seat === 0 ? 1 : 0;

  return (
    <section className="history">
      <button
        type="button"
        className="history__toggle"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="history-list"
      >
        Round history
        <span className="history__count">{view.history.length}</span>
        <span className="history__chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>

      <ol className="history__list" id="history-list" hidden={!open}>
        {rounds.length === 0 && <li className="history__empty">No rounds yet.</li>}
        {rounds.map((round) => {
          const stat = deck.stats.find((candidate) => candidate.id === round.statId);
          if (!stat) return null;
          const mine = round.values[view.seat];
          const theirs = round.values[opponentSeat];
          const tone =
            round.result === 'draw' ? 'draw' : round.winner === view.seat ? 'win' : 'lose';

          return (
            <li key={round.round} className={`history__row history__row--${tone}`}>
              <span className="history__round">{round.round}</span>
              <span className="history__detail">
                <strong>{stat.label}</strong>
                <span className="history__cards">
                  {cardName(round.cardIds[view.seat])} {formatStatValue(stat, mine)}
                  {' vs '}
                  {cardName(round.cardIds[opponentSeat])} {formatStatValue(stat, theirs)}
                </span>
              </span>
              <span className="history__result">
                {round.result === 'draw'
                  ? 'Draw'
                  : round.winner === view.seat
                    ? `+${round.cardsWon}`
                    : `−${round.cardsWon}`}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

import { formatStatValue } from '../../shared/rules';
import { useCountUp } from '../lib/hooks';
import { CardArt } from './CardArt';
import type { CardDef, Deck, StatDef } from '../../shared/types';

export type CardResult = 'win' | 'lose' | 'draw' | null;

interface CardProps {
  card: CardDef;
  deck: Deck;
  /** Whose side of the table this card sits on. */
  side: 'mine' | 'theirs';
  /** The stat being contested this round, highlighted on both cards. */
  activeStat?: string | null;
  /** Set during a reveal to tint the card and announce the result. */
  result?: CardResult;
  /** When set, each stat becomes a button. */
  onPick?: (statId: string) => void;
  /** Count the contested value up rather than showing it flat. */
  animateValue?: boolean;
  /** Plays the flip-in animation, used when the opponent card turns over. */
  flipIn?: boolean;
}

export function Card({
  card,
  deck,
  side,
  activeStat = null,
  result = null,
  onPick,
  animateValue = false,
  flipIn = false,
}: CardProps): JSX.Element {
  const classes = [
    'card',
    `card--${side}`,
    result ? `card--${result}` : '',
    onPick ? 'card--pickable' : '',
    flipIn ? 'card--flip-in' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <article
      className={classes}
      style={
        {
          '--deck-primary': deck.theme.primary,
          '--deck-accent': deck.theme.accent,
          '--deck-ink': deck.theme.ink,
        } as React.CSSProperties
      }
      aria-label={`${side === 'mine' ? 'Your card' : 'Opponent card'}: ${card.name}`}
    >
      <CardArt card={card} deck={deck} />

      <header className="card__header">
        <h3 className="card__name">{card.name}</h3>
        <p className="card__subtitle">{card.subtitle}</p>
      </header>

      <ul className="card__stats">
        {deck.stats.map((stat) => (
          <StatRow
            key={stat.id}
            stat={stat}
            value={card.stats[stat.id] ?? 0}
            active={activeStat === stat.id}
            dimmed={activeStat !== null && activeStat !== stat.id}
            animate={animateValue && activeStat === stat.id}
            onPick={onPick}
          />
        ))}
      </ul>
    </article>
  );
}

interface StatRowProps {
  stat: StatDef;
  value: number;
  active: boolean;
  dimmed: boolean;
  animate: boolean;
  onPick?: (statId: string) => void;
}

function StatRow({ stat, value, active, dimmed, animate, onPick }: StatRowProps): JSX.Element {
  const counted = useCountUp(value, animate);
  const shown = animate ? counted : value;
  const formatted = formatStatValue(stat, shown);
  const finalText = formatStatValue(stat, value);

  const className = ['stat', active ? 'stat--active' : '', dimmed ? 'stat--dimmed' : '']
    .filter(Boolean)
    .join(' ');

  const direction = stat.higherWins ? 'higher wins' : 'lower wins';

  if (!onPick) {
    return (
      <li className={className}>
        <span className="stat__label">{stat.label}</span>
        {/* The animated number is decorative; the real one is read out. */}
        <span className="stat__value" aria-hidden="true">
          {formatted}
        </span>
        <span className="visually-hidden">{`${stat.label}: ${finalText}`}</span>
      </li>
    );
  }

  return (
    <li className={className}>
      <button
        type="button"
        className="stat__button"
        onClick={() => onPick(stat.id)}
        aria-label={`Play ${stat.label}, ${finalText}, ${direction}`}
      >
        <span className="stat__label">{stat.label}</span>
        <span className="stat__value" aria-hidden="true">
          {formatted}
        </span>
      </button>
    </li>
  );
}

/** The reverse of a card, shown while the opponent is still choosing. */
export function CardBack({ deck, label }: { deck: Deck; label: string }): JSX.Element {
  return (
    <div
      className="card card--back"
      style={
        {
          '--deck-primary': deck.theme.primary,
          '--deck-accent': deck.theme.accent,
          '--deck-ink': deck.theme.ink,
        } as React.CSSProperties
      }
      role="img"
      aria-label={label}
    >
      <div className="card-back__pattern" aria-hidden="true" />
      <span className="card-back__emoji" aria-hidden="true">
        {deck.emoji}
      </span>
      <span className="card-back__label">{label}</span>
    </div>
  );
}

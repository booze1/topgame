import { REACTIONS } from '../../shared/types';
import type { FloatingReaction } from '../lib/useGame';
import type { Seat } from '../../shared/types';

interface ReactionBarProps {
  onReact: (emoji: string) => void;
  disabled: boolean;
}

/**
 * A fixed set of emoji rather than free text: it keeps the game playful
 * without opening a channel for abuse between two strangers.
 */
export function ReactionBar({ onReact, disabled }: ReactionBarProps): JSX.Element {
  return (
    <div className="reactions" role="group" aria-label="Send a reaction">
      {REACTIONS.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reactions__button"
          onClick={() => onReact(emoji)}
          disabled={disabled}
          aria-label={`Send ${emoji}`}
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
    </div>
  );
}

interface FloatingReactionsProps {
  reactions: FloatingReaction[];
  mySeat: Seat;
}

export function FloatingReactions({ reactions, mySeat }: FloatingReactionsProps): JSX.Element {
  return (
    <div className="floaters" aria-hidden="true">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className={`floaters__item floaters__item--${reaction.seat === mySeat ? 'mine' : 'theirs'}`}
        >
          {reaction.emoji}
        </span>
      ))}
    </div>
  );
}

import { useState } from 'react';
import { shareUrlFor, spellOut } from '../lib/format';
import type { Deck, MatchView, RoomView } from '../../shared/types';

interface WaitingRoomProps {
  room: RoomView;
  view: MatchView;
  deck: Deck;
  onStart: () => void;
  onLeave: () => void;
}

export function WaitingRoom({ room, view, deck, onStart, onLeave }: WaitingRoomProps): JSX.Element {
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const isHost = view.seat === room.hostSeat;
  const opponent = view.players[view.seat === 0 ? 1 : 0];
  const opponentHere = Boolean(opponent?.connected) && opponent?.name !== 'Waiting…';

  const copy = async (what: 'code' | 'link') => {
    const text = what === 'code' ? room.code : shareUrlFor(room.code);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard access can be refused; the code is on screen to read out.
    }
  };

  return (
    <main className="waiting">
      <h1 className="waiting__title">Room ready</h1>
      <p className="waiting__deck">
        <span aria-hidden="true">{deck.emoji}</span> {deck.name}
      </p>

      <div className="code-card">
        <p className="code-card__label" id="code-label">
          Share this code
        </p>
        <p className="code-card__code" aria-labelledby="code-label" aria-label={spellOut(room.code)}>
          {room.code}
        </p>
        <div className="code-card__actions">
          <button type="button" className="button button--small" onClick={() => void copy('code')}>
            {copied === 'code' ? 'Copied' : 'Copy code'}
          </button>
          <button type="button" className="button button--small" onClick={() => void copy('link')}>
            {copied === 'link' ? 'Copied' : 'Copy invite link'}
          </button>
        </div>
      </div>

      <p className="waiting__status" role="status">
        {opponentHere
          ? `${opponent?.name} has joined.`
          : 'Waiting for your opponent to join…'}
      </p>

      {isHost ? (
        <button
          type="button"
          className="button button--primary"
          disabled={!opponentHere}
          onClick={onStart}
        >
          {opponentHere ? 'Deal the cards' : 'Waiting for a second player'}
        </button>
      ) : (
        <p className="notice">Waiting for the host to deal.</p>
      )}

      <button type="button" className="link-button" onClick={onLeave}>
        Leave room
      </button>
    </main>
  );
}

import { useState } from 'react';
import { Lobby } from './components/Lobby';
import { WaitingRoom } from './components/WaitingRoom';
import { Table } from './components/Table';
import { Attributions } from './components/Attributions';
import { useGame } from './lib/useGame';
import type { AiDifficulty } from '../shared/types';

export default function App(): JSX.Element {
  const game = useGame();
  const [showCredits, setShowCredits] = useState(false);

  const deck = game.view ? game.decks.find((candidate) => candidate.id === game.view!.deckId) : null;

  if (showCredits) {
    return <Attributions decks={game.decks} onClose={() => setShowCredits(false)} />;
  }

  let screen: JSX.Element;

  if (!game.room || !game.view) {
    screen = (
      <Lobby
        decks={game.decks}
        decksError={game.decksError}
        name={game.name}
        setName={game.setName}
        onCreate={(deckId) => game.create(deckId, 'multiplayer')}
        onCreateSolo={(deckId, difficulty: AiDifficulty) => game.create(deckId, 'ai', difficulty)}
        onJoin={game.join}
        onShowCredits={() => setShowCredits(true)}
        connecting={game.status !== 'open'}
      />
    );
  } else if (!deck) {
    // The room references a deck the client has not loaded yet.
    screen = <main className="notice notice--centred">Loading the deck…</main>;
  } else if (game.view.phase === 'lobby') {
    screen = (
      <WaitingRoom
        room={game.room}
        view={game.view}
        deck={deck}
        onStart={game.start}
        onLeave={game.leave}
      />
    );
  } else {
    screen = (
      <Table
        view={game.view}
        room={game.room}
        deck={deck}
        status={game.status}
        reactions={game.reactions}
        onPick={game.pick}
        onReact={game.react}
        onRematch={game.rematch}
        onLeave={game.leave}
      />
    );
  }

  return (
    <>
      {screen}
      {game.error && (
        <div className="toast" role="alert">
          <span>{game.error}</span>
          <button type="button" onClick={game.dismissError} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </>
  );
}

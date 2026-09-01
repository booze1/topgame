import { useEffect, useId, useState } from 'react';
import { normaliseCode } from '../lib/format';
import type { AiDifficulty, Deck } from '../../shared/types';

interface LobbyProps {
  decks: Deck[];
  decksError: string | null;
  name: string;
  setName: (name: string) => void;
  onCreate: (deckId: string, difficulty?: AiDifficulty) => void;
  onCreateSolo: (deckId: string, difficulty: AiDifficulty) => void;
  onJoin: (code: string) => void;
  onShowCredits: () => void;
  connecting: boolean;
}

export function Lobby({
  decks,
  decksError,
  name,
  setName,
  onCreate,
  onCreateSolo,
  onJoin,
  onShowCredits,
  connecting,
}: LobbyProps): JSX.Element {
  const [deckId, setDeckId] = useState('');
  const [code, setCode] = useState('');
  const [difficulty, setDifficulty] = useState<AiDifficulty>('hard');
  const [showJoin, setShowJoin] = useState(false);
  const nameId = useId();
  const codeId = useId();

  // Default to the first deck as soon as they load.
  useEffect(() => {
    if (!deckId && decks.length > 0) setDeckId(decks[0]!.id);
  }, [decks, deckId]);

  // A shared link lands here with the code already in it.
  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get('room');
    if (fromUrl) {
      setCode(normaliseCode(fromUrl));
      setShowJoin(true);
    }
  }, []);

  const selected = decks.find((deck) => deck.id === deckId) ?? null;
  const ready = Boolean(selected) && !connecting;

  return (
    <main className="lobby">
      <header className="lobby__hero">
        <p className="lobby__eyebrow">Two players, one stat at a time</p>
        <h1 className="lobby__title">
          Top <span>Trumps</span>
        </h1>
        <p className="lobby__blurb">
          Pick the stat you think beats theirs. Win the round, take both cards. Draw, and they go in
          the pot for whoever wins next. Take every card to win.
        </p>
      </header>

      <section className="panel">
        <label className="field">
          <span className="field__label" id={nameId}>
            Your name
          </span>
          <input
            className="field__input"
            aria-labelledby={nameId}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Player"
            maxLength={16}
            autoComplete="nickname"
          />
        </label>
      </section>

      <section className="panel" aria-labelledby="deck-heading">
        <h2 className="panel__heading" id="deck-heading">
          Choose a deck
        </h2>

        {decksError ? (
          <p className="notice notice--bad">
            Could not load the decks ({decksError}). Check the server is running.
          </p>
        ) : decks.length === 0 ? (
          <p className="notice">Loading decks…</p>
        ) : (
          <div className="deck-grid" role="radiogroup" aria-label="Deck">
            {decks.map((deck) => (
              <button
                key={deck.id}
                type="button"
                role="radio"
                aria-checked={deck.id === deckId}
                className={`deck-tile${deck.id === deckId ? ' deck-tile--on' : ''}`}
                style={
                  {
                    '--deck-primary': deck.theme.primary,
                    '--deck-accent': deck.theme.accent,
                    '--deck-ink': deck.theme.ink,
                  } as React.CSSProperties
                }
                onClick={() => setDeckId(deck.id)}
              >
                <span className="deck-tile__emoji" aria-hidden="true">
                  {deck.emoji}
                </span>
                <span className="deck-tile__name">{deck.name}</span>
                <span className="deck-tile__tagline">{deck.tagline}</span>
                <span className="deck-tile__meta">
                  {deck.cards.length} cards · {deck.stats.length} stats
                </span>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <ul className="stat-legend" aria-label={`Stats in the ${selected.name} deck`}>
            {selected.stats.map((stat) => (
              <li key={stat.id}>
                <strong>{stat.label}</strong>
                <span>{stat.higherWins ? 'higher wins' : 'lower wins'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel panel--actions" aria-labelledby="play-heading">
        <h2 className="panel__heading" id="play-heading">
          Play
        </h2>

        <button
          type="button"
          className="button button--primary"
          disabled={!ready}
          onClick={() => selected && onCreate(selected.id)}
        >
          Start an online game
          <small>You get a code to share with your opponent</small>
        </button>

        {showJoin ? (
          <form
            className="join"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === 4) onJoin(code);
            }}
          >
            <label className="field">
              <span className="field__label" id={codeId}>
                Room code
              </span>
              <input
                className="field__input field__input--code"
                aria-labelledby={codeId}
                value={code}
                onChange={(event) => setCode(normaliseCode(event.target.value))}
                placeholder="ABCD"
                inputMode="text"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={4}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the user just asked for this field
                autoFocus
              />
            </label>
            <button type="submit" className="button" disabled={code.length !== 4 || connecting}>
              Join game
            </button>
          </form>
        ) : (
          <button type="button" className="button" onClick={() => setShowJoin(true)}>
            Join with a code
            <small>Your opponent has already made a room</small>
          </button>
        )}

        <div className="solo">
          <button
            type="button"
            className="button"
            disabled={!ready}
            onClick={() => selected && onCreateSolo(selected.id, difficulty)}
          >
            Play the computer
            <small>No opponent needed</small>
          </button>
          <div className="segmented" role="radiogroup" aria-label="Computer difficulty">
            {(['easy', 'hard'] as const).map((level) => (
              <button
                key={level}
                type="button"
                role="radio"
                aria-checked={difficulty === level}
                className={`segmented__option${difficulty === level ? ' segmented__option--on' : ''}`}
                onClick={() => setDifficulty(level)}
              >
                {level === 'easy' ? 'Easy' : 'Hard'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <footer className="lobby__footer">
        <button type="button" className="link-button" onClick={onShowCredits}>
          Photo credits
        </button>
      </footer>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBack, type CardResult } from './Card';
import { HistoryLog } from './HistoryLog';
import { FloatingReactions, ReactionBar } from './Reactions';
import { describeEnding, describeOutcome } from '../lib/format';
import { usePrefersReducedMotion } from '../lib/hooks';
import { isMuted, setMuted, sounds } from '../lib/sound';
import type { ConnectionStatus } from '../lib/connection';
import type { FloatingReaction } from '../lib/useGame';
import type { Deck, MatchView, RoomView, Seat } from '../../shared/types';

/**
 * How the reveal unfolds. The server holds the match in `reveal` for a fixed
 * window and tells both clients when it ends, so these steps only decide what
 * is on screen during that window - they never advance the game itself.
 */
const STEP_AT = { compare: 420, verdict: 1050, transfer: 1700 } as const;
const FULL_SEQUENCE_MS = STEP_AT.transfer;
type RevealStep = 0 | 1 | 2 | 3;

interface TableProps {
  view: MatchView;
  room: RoomView;
  deck: Deck;
  status: ConnectionStatus;
  reactions: FloatingReaction[];
  onPick: (statId: string) => void;
  onReact: (emoji: string) => void;
  onRematch: () => void;
  onLeave: () => void;
}

export function Table({
  view,
  room,
  deck,
  status,
  reactions,
  onPick,
  onReact,
  onRematch,
  onLeave,
}: TableProps): JSX.Element {
  const reducedMotion = usePrefersReducedMotion();
  const [step, setStep] = useState<RevealStep>(3);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [muted, setMutedState] = useState(isMuted);
  /**
   * A pick is sent optimistically, but the buttons must go dead immediately:
   * otherwise an impatient second tap reaches a server that has already moved
   * on, and the player is told off for a move they were still allowed to make
   * when they made it.
   */
  const [pendingPick, setPendingPick] = useState<string | null>(null);

  const opponentSeat: Seat = view.seat === 0 ? 1 : 0;
  const me = view.players[view.seat];
  const them = view.players[opponentSeat];
  const outcome = view.outcome;
  const revealing = view.phase === 'reveal';
  const finished = view.phase === 'gameover';
  const myTurn = view.phase === 'picking' && view.activeSeat === view.seat && pendingPick === null;
  const awaitingMyPick = view.phase === 'picking' && view.activeSeat === view.seat;

  // Clear the optimistic lock as soon as the server sends any new position.
  useEffect(() => {
    setPendingPick(null);
  }, [view.phase, view.round, view.activeSeat]);

  const handlePick = (statId: string) => {
    if (pendingPick !== null) return;
    setPendingPick(statId);
    sounds.select();
    onPick(statId);
  };

  const activeStat = revealing || finished ? (outcome?.statId ?? null) : null;
  const stat = useMemo(
    () => deck.stats.find((candidate) => candidate.id === activeStat),
    [deck, activeStat],
  );

  // Drive the reveal steps from the round number, so a reconnect mid-reveal
  // simply re-runs the sequence rather than getting stuck half way.
  const roundKey = revealing ? outcome?.round : null;
  const revealWindow = view.nextRoundAt;
  useEffect(() => {
    if (roundKey === null || roundKey === undefined || reducedMotion) {
      setStep(3);
      return;
    }
    // Fit the choreography inside however long the server is holding the
    // reveal, so a shorter window compresses rather than getting cut off.
    const available = revealWindow ? revealWindow - Date.now() : FULL_SEQUENCE_MS;
    const scale = Math.min(1, Math.max(0.05, available / FULL_SEQUENCE_MS));

    setStep(0);
    const timers = [
      setTimeout(() => setStep(1), STEP_AT.compare * scale),
      setTimeout(() => setStep(2), STEP_AT.verdict * scale),
      setTimeout(() => setStep(3), STEP_AT.transfer * scale),
    ];
    return () => timers.forEach(clearTimeout);
  }, [roundKey, reducedMotion, revealWindow]);

  // Sound effects, fired once per round at the right beat.
  const soundedRound = useRef<number | null>(null);
  useEffect(() => {
    if (!revealing || !outcome) return;
    if (soundedRound.current === outcome.round) return;
    if (step >= 2) {
      soundedRound.current = outcome.round;
      if (outcome.result === 'draw') sounds.draw();
      else if (outcome.winner === view.seat) sounds.win();
      else sounds.lose();
    } else if (step === 0) {
      sounds.flip();
    }
  }, [revealing, outcome, step, view.seat]);

  const endedRound = useRef(false);
  useEffect(() => {
    if (!finished) {
      endedRound.current = false;
      return;
    }
    if (endedRound.current) return;
    endedRound.current = true;
    if (view.winner === view.seat) sounds.victory();
    else if (view.winner !== null) sounds.defeat();
  }, [finished, view.winner, view.seat]);

  // Card counts lag the server during a reveal so the transfer can be seen.
  const showPreTransfer = revealing && step < 3;
  const counts = useMemo<[number, number]>(() => {
    if (!showPreTransfer || !outcome) return [view.players[0].count, view.players[1].count];
    if (outcome.result === 'draw') {
      return [outcome.counts[0] + 1, outcome.counts[1] + 1];
    }
    const winner = outcome.winner as Seat;
    const loser: Seat = winner === 0 ? 1 : 0;
    const before: [number, number] = [0, 0];
    before[winner] = outcome.counts[winner] + 1 - outcome.cardsWon;
    before[loser] = outcome.counts[loser] + 1;
    return before;
  }, [showPreTransfer, outcome, view.players]);

  const potCount = showPreTransfer && outcome ? outcome.potBefore : view.potCount;

  const myResult: CardResult =
    revealing && outcome && step >= 2
      ? outcome.result === 'draw'
        ? 'draw'
        : outcome.winner === view.seat
          ? 'win'
          : 'lose'
      : null;
  const theirResult: CardResult =
    myResult === null ? null : myResult === 'draw' ? 'draw' : myResult === 'win' ? 'lose' : 'win';

  const announcement = finished
    ? `${describeEnding(view).headline}. ${describeEnding(view).detail}`
    : revealing && step >= 2
      ? describeOutcome(view, stat)
      : myTurn
        ? 'Your turn. Choose a stat.'
        : view.phase === 'picking'
          ? `${them.name} is choosing.`
          : '';

  const toggleSound = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) sounds.select();
  };

  return (
    <main className="table" data-phase={view.phase}>
      <ConnectionBanner status={status} room={room} view={view} />

      <header className="table__bar">
        <div className="table__player">
          <span className="table__name">{them.name}</span>
          <Stack count={counts[opponentSeat]} label={`${them.name} has`} />
          {!them.connected && !them.isBot && <span className="pill pill--warn">reconnecting…</span>}
        </div>

        <div className="table__meta">
          <span className="table__round">
            Round {Math.max(1, view.round + (revealing ? 0 : 1))}
          </span>
          {potCount > 0 && (
            <span className="pill pill--pot" aria-label={`${potCount} cards in the pot`}>
              Pot {potCount}
            </span>
          )}
        </div>

        <div className="table__player table__player--me">
          <span className="table__name">{me.name} (you)</span>
          <Stack count={counts[view.seat]} label="You have" />
        </div>

        <div className="table__tools">
          <button
            type="button"
            className="icon-button"
            onClick={toggleSound}
            aria-pressed={muted}
            aria-label={muted ? 'Unmute sound effects' : 'Mute sound effects'}
            title={muted ? 'Sound off' : 'Sound on'}
          >
            <span aria-hidden="true">{muted ? '🔇' : '🔊'}</span>
          </button>
          <button type="button" className="icon-button" onClick={onLeave} aria-label="Leave game">
            <span aria-hidden="true">✕</span>
          </button>
        </div>
      </header>

      <div className={`felt${revealing ? ' felt--revealing' : ''}`}>
        <section className="felt__side felt__side--theirs" aria-label="Opponent card">
          {revealing || finished ? (
            view.opponentCard ? (
              <Card
                card={view.opponentCard}
                deck={deck}
                side="theirs"
                activeStat={step >= 1 ? activeStat : null}
                result={theirResult}
                animateValue={step >= 1}
                flipIn={!reducedMotion}
              />
            ) : (
              <CardBack deck={deck} label="No card" />
            )
          ) : (
            <CardBack
              deck={deck}
              label={
                view.phase === 'picking' && view.activeSeat === opponentSeat
                  ? `${them.name} is choosing…`
                  : `${them.name}'s card`
              }
            />
          )}
        </section>

        <div className="felt__middle">
          <Verdict
            view={view}
            step={step}
            revealing={revealing}
            myTurn={myTurn}
            sent={awaitingMyPick && pendingPick !== null}
            opponentName={them.name}
            statLabel={stat?.label ?? ''}
          />
        </div>

        <section className="felt__side felt__side--mine" aria-label="Your card">
          {view.myCard ? (
            <Card
              card={view.myCard}
              deck={deck}
              side="mine"
              activeStat={revealing || finished ? (step >= 1 ? activeStat : null) : null}
              result={myResult}
              animateValue={revealing && step >= 1}
              onPick={myTurn ? handlePick : undefined}
            />
          ) : (
            <CardBack deck={deck} label="You are out of cards" />
          )}
        </section>
      </div>

      <ReactionBar onReact={onReact} disabled={status !== 'open'} />
      <HistoryLog
        view={view}
        deck={deck}
        open={historyOpen}
        onToggle={() => setHistoryOpen((open) => !open)}
      />

      <FloatingReactions reactions={reactions} mySeat={view.seat} />

      <p className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </p>

      {finished && (
        <GameOver view={view} onRematch={onRematch} onLeave={onLeave} isSolo={room.mode === 'ai'} />
      )}
    </main>
  );
}

function Stack({ count, label }: { count: number; label: string }): JSX.Element {
  // Three shadow layers is enough to read as a pile without drawing 30 cards.
  const layers = Math.min(3, Math.max(0, count));
  return (
    <span className="stack" aria-label={`${label} ${count} cards`}>
      <span className="stack__pile" aria-hidden="true" data-layers={layers} />
      <span className="stack__count" aria-hidden="true">
        {count}
      </span>
    </span>
  );
}

interface VerdictProps {
  view: MatchView;
  step: RevealStep;
  revealing: boolean;
  myTurn: boolean;
  /** The player has chosen and we are waiting for the server to confirm. */
  sent: boolean;
  opponentName: string;
  statLabel: string;
}

function Verdict({
  view,
  step,
  revealing,
  myTurn,
  sent,
  opponentName,
  statLabel,
}: VerdictProps): JSX.Element {
  if (view.phase === 'gameover') {
    return <p className="verdict verdict--muted">Match over</p>;
  }

  if (revealing && view.outcome) {
    if (step < 1) {
      return <p className="verdict verdict--muted">{statLabel}</p>;
    }
    if (step < 2) {
      return <p className="verdict verdict--vs">{statLabel}</p>;
    }
    const { outcome } = view;
    if (outcome.result === 'draw') {
      return (
        <p className="verdict verdict--draw">
          Draw
          <small>Both cards into the pot</small>
        </p>
      );
    }
    const won = outcome.winner === view.seat;
    return (
      <p className={`verdict ${won ? 'verdict--win' : 'verdict--lose'}`}>
        {won ? 'You win the round' : `${opponentName} wins the round`}
        <small>
          {won ? '+' : '−'}
          {outcome.cardsWon} cards
        </small>
      </p>
    );
  }

  if (sent) {
    return (
      <p className="verdict verdict--waiting">
        Playing your stat
        <span className="dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </p>
    );
  }

  if (myTurn) {
    return (
      <p className="verdict verdict--prompt">
        Your call
        <small>Pick the stat you think wins</small>
      </p>
    );
  }

  return (
    <p className="verdict verdict--waiting">
      {opponentName} is choosing
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}

interface GameOverProps {
  view: MatchView;
  isSolo: boolean;
  onRematch: () => void;
  onLeave: () => void;
}

function GameOver({ view, isSolo, onRematch, onLeave }: GameOverProps): JSX.Element {
  const { headline, detail } = describeEnding(view);
  const opponentSeat: Seat = view.seat === 0 ? 1 : 0;
  const iAsked = view.players[view.seat].wantsRematch;
  const theyAsked = view.players[opponentSeat].wantsRematch;
  const tone = view.winner === null ? 'draw' : view.winner === view.seat ? 'win' : 'lose';

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-labelledby="gameover-title">
      <div className={`overlay__panel overlay__panel--${tone}`}>
        <h2 className="overlay__title" id="gameover-title">
          {headline}
        </h2>
        <p className="overlay__detail">{detail}</p>

        <dl className="overlay__scores">
          <div>
            <dt>You</dt>
            <dd>{view.players[view.seat].count}</dd>
          </div>
          <div>
            <dt>{view.players[opponentSeat].name}</dt>
            <dd>{view.players[opponentSeat].count}</dd>
          </div>
          <div>
            <dt>Rounds</dt>
            <dd>{view.round}</dd>
          </div>
        </dl>

        <div className="overlay__actions">
          <button
            type="button"
            className="button button--primary"
            onClick={onRematch}
            disabled={iAsked && !isSolo && !theyAsked}
          >
            {iAsked && !isSolo && !theyAsked ? 'Waiting for opponent…' : 'Play again'}
          </button>
          <button type="button" className="button" onClick={onLeave}>
            Back to the lobby
          </button>
        </div>

        {theyAsked && !iAsked && (
          <p className="overlay__nudge">Your opponent wants a rematch.</p>
        )}
      </div>
    </div>
  );
}

function ConnectionBanner({
  status,
  room,
  view,
}: {
  status: ConnectionStatus;
  room: RoomView;
  view: MatchView;
}): JSX.Element | null {
  const opponentSeat: Seat = view.seat === 0 ? 1 : 0;
  const opponent = view.players[opponentSeat];

  if (status !== 'open') {
    return (
      <div className="banner banner--warn" role="status">
        Reconnecting to the game…
      </div>
    );
  }
  if (!opponent.connected && !opponent.isBot && view.phase !== 'gameover') {
    return (
      <div className="banner banner--warn" role="status">
        {opponent.name} has dropped out. Waiting for them to come back
        {room.reconnectDeadline ? <Countdown deadline={room.reconnectDeadline} /> : null}.
      </div>
    );
  }
  return null;
}

function Countdown({ deadline }: { deadline: number }): JSX.Element {
  const [remaining, setRemaining] = useState(() => Math.max(0, deadline - Date.now()));

  useEffect(() => {
    const tick = setInterval(() => setRemaining(Math.max(0, deadline - Date.now())), 500);
    return () => clearInterval(tick);
  }, [deadline]);

  return <> ({Math.ceil(remaining / 1000)}s)</>;
}

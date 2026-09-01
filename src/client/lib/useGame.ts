/**
 * The client's single source of truth.
 *
 * Everything the UI renders comes from the server's per-seat view; this hook
 * just holds the latest one, keeps the socket alive and exposes the handful of
 * actions a player can take.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GameConnection, type ConnectionStatus } from './connection';
import { readStored, writeStored } from './storage';
import type {
  AiDifficulty,
  Deck,
  MatchView,
  Mode,
  RoomView,
  Seat,
  ServerMessage,
} from '../../shared/types';

export interface FloatingReaction {
  id: number;
  seat: Seat;
  emoji: string;
}

export interface GameApi {
  status: ConnectionStatus;
  decks: Deck[];
  decksError: string | null;
  room: RoomView | null;
  view: MatchView | null;
  error: string | null;
  reactions: FloatingReaction[];
  name: string;
  setName: (name: string) => void;
  create: (deckId: string, mode: Mode, difficulty?: AiDifficulty) => void;
  join: (code: string) => void;
  start: () => void;
  pick: (statId: string) => void;
  rematch: () => void;
  react: (emoji: string) => void;
  leave: () => void;
  dismissError: () => void;
}

export function useGame(): GameApi {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [decksError, setDecksError] = useState<string | null>(null);
  const [room, setRoom] = useState<RoomView | null>(null);
  const [view, setView] = useState<MatchView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reactions, setReactions] = useState<FloatingReaction[]>([]);
  const [name, setNameState] = useState(() => readStored('name') ?? '');

  const connectionRef = useRef<GameConnection | null>(null);
  const reactionId = useRef(0);

  const handleMessage = useCallback((message: ServerMessage) => {
    switch (message.type) {
      case 'session':
        writeStored('token', message.token);
        connectionRef.current?.setResumeToken(message.token);
        setRoom(message.room);
        setView(message.view);
        setError(null);
        return;
      case 'room':
        setRoom(message.room);
        return;
      case 'view':
        setView(message.view);
        return;
      case 'reaction': {
        const id = ++reactionId.current;
        setReactions((current) => [...current, { id, seat: message.seat, emoji: message.emoji }]);
        setTimeout(() => setReactions((current) => current.filter((r) => r.id !== id)), 2200);
        return;
      }
      case 'error':
        // A dead session is expected after a server restart: drop the stale
        // token quietly and show the lobby rather than an alarming message.
        if (message.code === 'session-expired') {
          writeStored('token', null);
          connectionRef.current?.setResumeToken(null);
          setRoom(null);
          setView(null);
          return;
        }
        setError(message.message);
        return;
      case 'pong':
        return;
    }
  }, []);

  useEffect(() => {
    const connection = new GameConnection(handleMessage, setStatus);
    connectionRef.current = connection;
    connection.setResumeToken(readStored('token'));
    connection.connect();
    return () => {
      connection.close();
      connectionRef.current = null;
    };
  }, [handleMessage]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/decks')
      .then((response) => {
        if (!response.ok) throw new Error(`Server said ${response.status}`);
        return response.json() as Promise<Deck[]>;
      })
      .then((loaded) => {
        if (!cancelled) setDecks(loaded);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setDecksError(cause instanceof Error ? cause.message : 'Unknown error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setName = useCallback((next: string) => {
    setNameState(next);
    writeStored('name', next);
  }, []);

  const send = useCallback((message: Parameters<GameConnection['send']>[0]) => {
    connectionRef.current?.send(message);
  }, []);

  const api = useMemo<GameApi>(
    () => ({
      status,
      decks,
      decksError,
      room,
      view,
      error,
      reactions,
      name,
      setName,
      create: (deckId, mode, difficulty) =>
        send({ type: 'create', deckId, name: name || 'Player', mode, difficulty }),
      join: (code) => send({ type: 'join', code, name: name || 'Player' }),
      start: () => send({ type: 'start' }),
      pick: (statId) => send({ type: 'pick', statId }),
      rematch: () => send({ type: 'rematch' }),
      react: (emoji) => send({ type: 'react', emoji }),
      leave: () => {
        send({ type: 'leave' });
        writeStored('token', null);
        connectionRef.current?.setResumeToken(null);
        setRoom(null);
        setView(null);
      },
      dismissError: () => setError(null),
    }),
    [status, decks, decksError, room, view, error, reactions, name, setName, send],
  );

  return api;
}

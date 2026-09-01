/**
 * Rooms, sessions and the match clock.
 *
 * The server owns every match. Clients send intent ("I pick top speed") and
 * receive a per-seat view; they are never told the opponent's card before the
 * reveal, so no amount of poking at the browser console will show it early.
 *
 * The reveal is server-timed: after a round resolves, the server holds the
 * match in `reveal` for REVEAL_MS and tells both clients when it will move on.
 * Both screens therefore animate in step without trusting either of them to
 * advance the game.
 */

import { randomInt, randomUUID } from 'node:crypto';
import {
  advancePhase,
  canPick,
  cardById,
  chooseStatForBot,
  createMatch,
  forfeit,
  otherSeat,
  playRound,
} from '../shared/rules';
import type {
  AiDifficulty,
  ClientMessage,
  Deck,
  ErrorCode,
  MatchState,
  MatchView,
  Mode,
  PlayerView,
  RoomView,
  Seat,
  ServerMessage,
} from '../shared/types';
import { REACTIONS } from '../shared/types';

/** Just enough of a WebSocket for this module to be testable without one. */
export interface Connection {
  send(data: string): void;
  close(): void;
}

export interface RoomConfig {
  /** How long both cards stay face up before the next round. */
  revealMs: number;
  /** How long a dropped player has to come back before forfeiting. */
  reconnectGraceMs: number;
  /** Rooms with nobody connected are swept after this long. */
  idleRoomMs: number;
  botThinkMinMs: number;
  botThinkMaxMs: number;
  maxRooms: number;
}

export const DEFAULT_CONFIG: RoomConfig = {
  revealMs: 3400,
  reconnectGraceMs: 60_000,
  idleRoomMs: 30 * 60_000,
  botThinkMinMs: 700,
  botThinkMaxMs: 1700,
  maxRooms: 2000,
};

/** No I, O, 0 or 1 - codes get read aloud down the phone. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 4;
const MAX_NAME_LENGTH = 16;
const REACTION_WINDOW_MS = 10_000;
const MAX_REACTIONS_PER_WINDOW = 5;
const MAX_MESSAGES_PER_WINDOW = 60;
const MESSAGE_WINDOW_MS = 10_000;

interface Player {
  seat: Seat;
  name: string;
  token: string;
  connection: Connection | null;
  isBot: boolean;
  difficulty: AiDifficulty;
  /** When they dropped, or null while connected. */
  droppedAt: number | null;
}

interface Room {
  code: string;
  mode: Mode;
  deck: Deck;
  players: [Player | null, Player | null];
  match: MatchState;
  hostSeat: Seat;
  /** Seat that starts the next match; alternates so nobody keeps the advantage. */
  nextStartingSeat: Seat;
  rematchVotes: Set<Seat>;
  nextRoundAt: number | null;
  reconnectDeadline: number | null;
  timers: { reveal?: NodeJS.Timeout; bot?: NodeJS.Timeout; grace?: NodeJS.Timeout };
  reactionLog: Map<Seat, number[]>;
  lastActivity: number;
}

interface Attachment {
  code: string;
  seat: Seat;
}

class ProtocolError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly tokens = new Map<string, Attachment>();
  private readonly attached = new Map<Connection, Attachment>();
  private readonly messageLog = new Map<Connection, number[]>();
  private readonly decks: Map<string, Deck>;
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    decks: Deck[],
    private readonly config: RoomConfig = DEFAULT_CONFIG,
    private readonly now: () => number = Date.now,
  ) {
    this.decks = new Map(decks.map((deck) => [deck.id, deck]));
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  startSweeper(intervalMs = 60_000): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => this.sweep(), intervalMs);
    this.sweeper.unref?.();
  }

  stop(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    for (const room of this.rooms.values()) this.clearTimers(room);
    this.rooms.clear();
    this.tokens.clear();
    this.attached.clear();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  // -------------------------------------------------------------------------
  // Message handling
  // -------------------------------------------------------------------------

  handle(connection: Connection, raw: string): void {
    if (!this.allowMessage(connection)) {
      this.sendError(connection, 'rate-limited', 'Slow down a moment.');
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(connection, 'bad-request', 'That was not valid JSON.');
      return;
    }
    if (!message || typeof message !== 'object' || typeof message.type !== 'string') {
      this.sendError(connection, 'bad-request', 'Message had no type.');
      return;
    }

    try {
      this.dispatch(connection, message);
    } catch (error) {
      if (error instanceof ProtocolError) {
        this.sendError(connection, error.code, error.message);
        return;
      }
      console.error('[rooms] unexpected error handling message:', error);
      this.sendError(connection, 'bad-request', 'Something went wrong with that move.');
    }
  }

  private dispatch(connection: Connection, message: ClientMessage): void {
    switch (message.type) {
      case 'ping':
        this.send(connection, { type: 'pong' });
        return;
      case 'create':
        this.createRoom(connection, message);
        return;
      case 'join':
        this.joinRoom(connection, message);
        return;
      case 'resume':
        this.resume(connection, message.token);
        return;
      case 'start':
        this.startMatch(connection);
        return;
      case 'pick':
        this.pick(connection, message.statId);
        return;
      case 'rematch':
        this.rematch(connection);
        return;
      case 'react':
        this.react(connection, message.emoji);
        return;
      case 'leave':
        this.leave(connection);
        return;
      default:
        throw new ProtocolError('bad-request', 'Unknown message type.');
    }
  }

  /** Called when a socket closes for any reason. */
  detach(connection: Connection): void {
    this.messageLog.delete(connection);
    const attachment = this.attached.get(connection);
    if (!attachment) return;
    this.attached.delete(connection);

    const room = this.rooms.get(attachment.code);
    const player = room?.players[attachment.seat];
    if (!room || !player || player.connection !== connection) return;

    player.connection = null;
    player.droppedAt = this.now();

    if (room.match.phase === 'gameover' || room.match.phase === 'lobby') {
      // Nothing to forfeit; the room will be swept once it goes quiet.
      this.broadcast(room);
      return;
    }

    room.reconnectDeadline = this.now() + this.config.reconnectGraceMs;
    clearTimeout(room.timers.grace);
    room.timers.grace = setTimeout(() => {
      const stillGone = room.players[attachment.seat]?.connection === null;
      if (!stillGone) return;
      room.reconnectDeadline = null;
      room.match = forfeit(room.match, attachment.seat);
      this.clearPlayTimers(room);
      this.broadcast(room);
    }, this.config.reconnectGraceMs);
    room.timers.grace.unref?.();

    this.broadcast(room);
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  private createRoom(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'create' }>,
  ): void {
    if (this.rooms.size >= this.config.maxRooms) {
      throw new ProtocolError('bad-request', 'The server is full. Try again shortly.');
    }
    const deck = this.deckOrThrow(message.deckId);
    const mode: Mode = message.mode === 'ai' ? 'ai' : 'multiplayer';
    const difficulty: AiDifficulty = message.difficulty === 'easy' ? 'easy' : 'hard';

    const code = this.uniqueCode();
    const host: Player = {
      seat: 0,
      name: sanitiseName(message.name),
      token: randomUUID(),
      connection,
      isBot: false,
      difficulty,
      droppedAt: null,
    };

    const room: Room = {
      code,
      mode,
      deck,
      players: [host, null],
      match: { ...createMatch(deck), phase: 'lobby' },
      hostSeat: 0,
      nextStartingSeat: 0,
      rematchVotes: new Set(),
      nextRoundAt: null,
      reconnectDeadline: null,
      timers: {},
      reactionLog: new Map(),
      lastActivity: this.now(),
    };

    if (mode === 'ai') {
      room.players[1] = {
        seat: 1,
        name: difficulty === 'hard' ? 'Computer (hard)' : 'Computer (easy)',
        token: randomUUID(),
        connection: null,
        isBot: true,
        difficulty,
        droppedAt: null,
      };
    }

    this.rooms.set(code, room);
    this.bind(connection, host.token, code, 0);
    this.sendSession(connection, room, 0, host.token);

    if (mode === 'ai') this.beginMatch(room);
  }

  private joinRoom(
    connection: Connection,
    message: Extract<ClientMessage, { type: 'join' }>,
  ): void {
    const code = normaliseCode(message.code);
    const room = this.rooms.get(code);
    if (!room) throw new ProtocolError('room-not-found', `No room with the code ${code}.`);
    if (room.mode === 'ai' || room.players[1]) {
      throw new ProtocolError('room-full', 'That room already has two players.');
    }

    const guest: Player = {
      seat: 1,
      name: sanitiseName(message.name),
      token: randomUUID(),
      connection,
      isBot: false,
      difficulty: 'hard',
      droppedAt: null,
    };
    room.players[1] = guest;
    room.lastActivity = this.now();

    this.bind(connection, guest.token, room.code, 1);
    this.sendSession(connection, room, 1, guest.token);
    this.broadcast(room);
  }

  private resume(connection: Connection, token: unknown): void {
    if (typeof token !== 'string' || token.length > 64) {
      throw new ProtocolError('bad-request', 'Bad session token.');
    }
    const attachment = this.tokens.get(token);
    const room = attachment ? this.rooms.get(attachment.code) : undefined;
    const player = room && attachment ? room.players[attachment.seat] : null;
    if (!room || !attachment || !player || player.token !== token) {
      throw new ProtocolError('session-expired', 'That game is no longer running.');
    }

    // Replace any socket still holding the seat, so a stale tab cannot play on.
    if (player.connection && player.connection !== connection) {
      this.attached.delete(player.connection);
      try {
        player.connection.close();
      } catch {
        /* the old socket is already gone */
      }
    }

    player.connection = connection;
    player.droppedAt = null;
    room.reconnectDeadline = null;
    clearTimeout(room.timers.grace);
    room.lastActivity = this.now();

    this.attached.set(connection, attachment);
    this.sendSession(connection, room, attachment.seat, token);
    this.broadcast(room);
  }

  private startMatch(connection: Connection): void {
    const { room, seat } = this.locate(connection);
    if (seat !== room.hostSeat) {
      throw new ProtocolError('bad-request', 'Only the host can start the match.');
    }
    if (room.match.phase !== 'lobby') return;
    if (!room.players[0] || !room.players[1]) {
      throw new ProtocolError('bad-request', 'Waiting for a second player.');
    }
    this.beginMatch(room);
  }

  private pick(connection: Connection, statId: unknown): void {
    const { room, seat } = this.locate(connection);
    if (typeof statId !== 'string') throw new ProtocolError('bad-request', 'Bad stat.');
    if (!room.deck.stats.some((stat) => stat.id === statId)) {
      throw new ProtocolError('bad-request', 'That stat is not on this card.');
    }
    if (!canPick(room.match, seat)) {
      throw new ProtocolError('not-your-turn', 'It is not your turn to choose.');
    }
    this.resolveRound(room, statId);
  }

  private rematch(connection: Connection): void {
    const { room, seat } = this.locate(connection);
    if (room.match.phase !== 'gameover') return;

    room.rematchVotes.add(seat);
    const opponent = room.players[otherSeat(seat)];
    const needsOpponent = opponent !== null && !opponent.isBot && opponent.connection !== null;
    if (needsOpponent && !room.rematchVotes.has(otherSeat(seat))) {
      this.broadcast(room);
      return;
    }
    this.beginMatch(room);
  }

  private react(connection: Connection, emoji: unknown): void {
    const { room, seat } = this.locate(connection);
    if (typeof emoji !== 'string' || !(REACTIONS as readonly string[]).includes(emoji)) {
      throw new ProtocolError('bad-request', 'Unknown reaction.');
    }
    const now = this.now();
    const recent = (room.reactionLog.get(seat) ?? []).filter((at) => now - at < REACTION_WINDOW_MS);
    if (recent.length >= MAX_REACTIONS_PER_WINDOW) {
      throw new ProtocolError('rate-limited', 'Easy on the emoji.');
    }
    recent.push(now);
    room.reactionLog.set(seat, recent);
    this.broadcastRaw(room, { type: 'reaction', seat, emoji });
  }

  private leave(connection: Connection): void {
    const attachment = this.attached.get(connection);
    if (!attachment) return;
    const room = this.rooms.get(attachment.code);
    if (!room) return;

    const player = room.players[attachment.seat];
    if (player) {
      this.tokens.delete(player.token);
      player.connection = null;
      player.droppedAt = this.now();
    }
    this.attached.delete(connection);

    if (room.match.phase !== 'gameover' && room.match.phase !== 'lobby') {
      room.match = forfeit(room.match, attachment.seat);
      this.clearPlayTimers(room);
    }
    room.reconnectDeadline = null;
    clearTimeout(room.timers.grace);
    this.broadcast(room);

    if (!this.anyoneConnected(room)) this.destroy(room);
  }

  // -------------------------------------------------------------------------
  // Match flow
  // -------------------------------------------------------------------------

  private beginMatch(room: Room): void {
    this.clearPlayTimers(room);
    room.match = createMatch(room.deck, { startingSeat: room.nextStartingSeat });
    room.nextStartingSeat = otherSeat(room.nextStartingSeat);
    room.rematchVotes.clear();
    room.nextRoundAt = null;
    room.lastActivity = this.now();
    this.broadcast(room);
    this.scheduleBot(room);
  }

  private resolveRound(room: Room, statId: string): void {
    room.match = playRound(room.deck, room.match, statId);
    room.lastActivity = this.now();

    if (room.match.phase === 'gameover') {
      room.nextRoundAt = null;
      this.broadcast(room);
      return;
    }

    room.nextRoundAt = this.now() + this.config.revealMs;
    this.broadcast(room);

    clearTimeout(room.timers.reveal);
    room.timers.reveal = setTimeout(() => {
      room.match = advancePhase(room.match);
      room.nextRoundAt = null;
      this.broadcast(room);
      this.scheduleBot(room);
    }, this.config.revealMs);
    room.timers.reveal.unref?.();
  }

  /** If it is the computer's turn, give it a believable pause and then play. */
  private scheduleBot(room: Room): void {
    clearTimeout(room.timers.bot);
    const active = room.players[room.match.activeSeat];
    if (!active?.isBot || !canPick(room.match, active.seat)) return;

    const spread = Math.max(1, this.config.botThinkMaxMs - this.config.botThinkMinMs);
    const delay = this.config.botThinkMinMs + randomInt(spread);
    room.timers.bot = setTimeout(() => {
      if (!canPick(room.match, active.seat)) return;
      const cardId = room.match.hands[active.seat][0];
      if (!cardId) return;
      const card = cardById(room.deck, cardId);
      this.resolveRound(room, chooseStatForBot(room.deck, card, active.difficulty));
    }, delay);
    room.timers.bot.unref?.();
  }

  // -------------------------------------------------------------------------
  // Views and sending
  // -------------------------------------------------------------------------

  private viewFor(room: Room, seat: Seat): MatchView {
    const match = room.match;
    const opponentSeat = otherSeat(seat);
    const revealed = match.phase === 'reveal' || match.phase === 'gameover';
    const outcome = match.outcome;

    // During a reveal the played cards have already moved, so the cards on the
    // table come from the outcome rather than the top of each pile.
    const myCardId = revealed && outcome ? outcome.cardIds[seat] : match.hands[seat][0];
    const opponentCardId = revealed && outcome ? outcome.cardIds[opponentSeat] : null;

    return {
      deckId: room.deck.id,
      phase: match.phase,
      round: match.round,
      roundCap: match.roundCap,
      activeSeat: match.activeSeat,
      potCount: match.pot.length,
      seat,
      players: [this.playerView(room, 0), this.playerView(room, 1)],
      myCard: myCardId ? cardById(room.deck, myCardId) : null,
      opponentCard: opponentCardId ? cardById(room.deck, opponentCardId) : null,
      outcome,
      history: match.history.slice(-30),
      winner: match.winner,
      endReason: match.endReason,
      nextRoundAt: room.nextRoundAt,
    };
  }

  private playerView(room: Room, seat: Seat): PlayerView {
    const player = room.players[seat];
    return {
      name: player?.name ?? 'Waiting…',
      connected: player ? player.isBot || player.connection !== null : false,
      count: room.match.hands[seat].length,
      isBot: player?.isBot ?? false,
      wantsRematch: room.rematchVotes.has(seat),
    };
  }

  private roomView(room: Room): RoomView {
    return {
      code: room.code,
      mode: room.mode,
      deckId: room.deck.id,
      hostSeat: room.hostSeat,
      reconnectDeadline: room.reconnectDeadline,
    };
  }

  private sendSession(connection: Connection, room: Room, seat: Seat, token: string): void {
    this.send(connection, {
      type: 'session',
      token,
      room: this.roomView(room),
      view: this.viewFor(room, seat),
    });
  }

  private broadcast(room: Room): void {
    for (const seat of [0, 1] as const) {
      const player = room.players[seat];
      if (!player?.connection) continue;
      this.send(player.connection, { type: 'room', room: this.roomView(room) });
      this.send(player.connection, { type: 'view', view: this.viewFor(room, seat) });
    }
  }

  private broadcastRaw(room: Room, message: ServerMessage): void {
    for (const player of room.players) {
      if (player?.connection) this.send(player.connection, message);
    }
  }

  private send(connection: Connection, message: ServerMessage): void {
    try {
      connection.send(JSON.stringify(message));
    } catch (error) {
      console.warn('[rooms] failed to send to a client:', error);
    }
  }

  private sendError(connection: Connection, code: ErrorCode, message: string): void {
    this.send(connection, { type: 'error', code, message });
  }

  // -------------------------------------------------------------------------
  // Plumbing
  // -------------------------------------------------------------------------

  private bind(connection: Connection, token: string, code: string, seat: Seat): void {
    const attachment: Attachment = { code, seat };
    this.tokens.set(token, attachment);
    this.attached.set(connection, attachment);
  }

  private locate(connection: Connection): { room: Room; seat: Seat } {
    const attachment = this.attached.get(connection);
    const room = attachment ? this.rooms.get(attachment.code) : undefined;
    if (!attachment || !room) throw new ProtocolError('session-expired', 'You are not in a game.');
    return { room, seat: attachment.seat };
  }

  private deckOrThrow(deckId: unknown): Deck {
    const deck = typeof deckId === 'string' ? this.decks.get(deckId) : undefined;
    if (!deck) throw new ProtocolError('unknown-deck', 'That deck does not exist.');
    return deck;
  }

  private uniqueCode(): string {
    for (let attempt = 0; attempt < 200; attempt++) {
      let code = '';
      for (let i = 0; i < CODE_LENGTH; i++) {
        code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new ProtocolError('bad-request', 'Could not allocate a room code.');
  }

  private allowMessage(connection: Connection): boolean {
    const now = this.now();
    const recent = (this.messageLog.get(connection) ?? []).filter(
      (at) => now - at < MESSAGE_WINDOW_MS,
    );
    if (recent.length >= MAX_MESSAGES_PER_WINDOW) {
      this.messageLog.set(connection, recent);
      return false;
    }
    recent.push(now);
    this.messageLog.set(connection, recent);
    return true;
  }

  private anyoneConnected(room: Room): boolean {
    return room.players.some((player) => player && !player.isBot && player.connection !== null);
  }

  private clearPlayTimers(room: Room): void {
    clearTimeout(room.timers.reveal);
    clearTimeout(room.timers.bot);
    room.timers.reveal = undefined;
    room.timers.bot = undefined;
    room.nextRoundAt = null;
  }

  private clearTimers(room: Room): void {
    this.clearPlayTimers(room);
    clearTimeout(room.timers.grace);
    room.timers.grace = undefined;
  }

  private destroy(room: Room): void {
    this.clearTimers(room);
    for (const player of room.players) {
      if (player) this.tokens.delete(player.token);
    }
    this.rooms.delete(room.code);
  }

  /** Drop rooms nobody has touched in a while, so memory stays flat. */
  private sweep(): void {
    const now = this.now();
    for (const room of [...this.rooms.values()]) {
      const idle = now - room.lastActivity > this.config.idleRoomMs;
      if (!this.anyoneConnected(room) && idle) this.destroy(room);
    }
  }
}

/**
 * Names are shown to a stranger, so strip anything that is not printable.
 *
 * Control and format characters go, except the zero-width joiner, which would
 * otherwise split a compound emoji into its pieces. Whitespace of any kind is
 * then collapsed to single spaces, so a pasted newline separates words rather
 * than silently welding them together.
 */
export function sanitiseName(input: unknown): string {
  if (typeof input !== 'string') return 'Player';
  const cleaned = input
    .replace(/[^\P{C}\s\u200D]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || 'Player';
}

export function normaliseCode(input: unknown): string {
  if (typeof input !== 'string') return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

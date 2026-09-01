import { beforeEach, describe, expect, it } from 'vitest';
import { RoomManager, DEFAULT_CONFIG, normaliseCode, sanitiseName } from './rooms';
import type { Connection } from './rooms';
import type { Deck, MatchView, RoomView, ServerMessage } from '../shared/types';

/**
 * The room manager only needs something it can `send` to, so these tests drive
 * it with a fake connection rather than a real websocket.
 */
class FakeConnection implements Connection {
  readonly messages: ServerMessage[] = [];
  closed = false;

  send(data: string): void {
    this.messages.push(JSON.parse(data) as ServerMessage);
  }
  close(): void {
    this.closed = true;
  }

  /** The most recent match view this client was sent. */
  get view(): MatchView {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i]!;
      if (message.type === 'view' || message.type === 'session') return message.view;
    }
    throw new Error('no view received');
  }
  get room(): RoomView {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const message = this.messages[i]!;
      if (message.type === 'room' || message.type === 'session') return message.room;
    }
    throw new Error('no room received');
  }
  get token(): string {
    const session = this.messages.find((m) => m.type === 'session');
    if (session?.type !== 'session') throw new Error('no session received');
    return session.token;
  }
  get errors(): Extract<ServerMessage, { type: 'error' }>[] {
    return this.messages.filter((m) => m.type === 'error') as Extract<
      ServerMessage,
      { type: 'error' }
    >[];
  }
}

const deck: Deck = {
  id: 'test',
  name: 'Test',
  tagline: '',
  emoji: 'T',
  theme: { primary: '#000', accent: '#fff', ink: '#fff' },
  stats: [{ id: 'power', label: 'Power', higherWins: true }],
  cards: [
    { id: 'a', name: 'A', subtitle: '', emoji: 'A', wikipedia: 'A', stats: { power: 4 } },
    { id: 'b', name: 'B', subtitle: '', emoji: 'B', wikipedia: 'B', stats: { power: 3 } },
    { id: 'c', name: 'C', subtitle: '', emoji: 'C', wikipedia: 'C', stats: { power: 2 } },
    { id: 'd', name: 'D', subtitle: '', emoji: 'D', wikipedia: 'D', stats: { power: 1 } },
  ],
};

let manager: RoomManager;
const send = (connection: Connection, payload: unknown) =>
  manager.handle(connection, JSON.stringify(payload));

beforeEach(() => {
  manager = new RoomManager([deck], {
    ...DEFAULT_CONFIG,
    revealMs: 5,
    botThinkMinMs: 1,
    botThinkMaxMs: 2,
  });
});

function seatedPair() {
  const host = new FakeConnection();
  const guest = new FakeConnection();
  send(host, { type: 'create', deckId: 'test', name: 'Host', mode: 'multiplayer' });
  send(guest, { type: 'join', code: host.room.code, name: 'Guest' });
  send(host, { type: 'start' });
  return { host, guest };
}

describe('creating and joining', () => {
  it('issues a four character code and seats the host first', () => {
    const host = new FakeConnection();
    send(host, { type: 'create', deckId: 'test', name: 'Host', mode: 'multiplayer' });
    expect(host.room.code).toMatch(/^[A-HJ-NP-Z2-9]{4}$/);
    expect(host.view.seat).toBe(0);
    expect(host.view.phase).toBe('lobby');
  });

  it('rejects an unknown deck and an unknown code', () => {
    const player = new FakeConnection();
    send(player, { type: 'create', deckId: 'nope', name: 'X', mode: 'multiplayer' });
    expect(player.errors[0]?.code).toBe('unknown-deck');
    send(player, { type: 'join', code: 'ZZZZ', name: 'X' });
    expect(player.errors[1]?.code).toBe('room-not-found');
  });

  it('turns away a third player', () => {
    const { host } = seatedPair();
    const third = new FakeConnection();
    send(third, { type: 'join', code: host.room.code, name: 'Third' });
    expect(third.errors[0]?.code).toBe('room-full');
  });

  it('only lets the host start, and only with two players', () => {
    const host = new FakeConnection();
    send(host, { type: 'create', deckId: 'test', name: 'Host', mode: 'multiplayer' });
    send(host, { type: 'start' });
    expect(host.errors[0]?.message).toMatch(/second player/i);

    const guest = new FakeConnection();
    send(guest, { type: 'join', code: host.room.code, name: 'Guest' });
    send(guest, { type: 'start' });
    expect(guest.errors[0]?.message).toMatch(/host/i);
    expect(guest.view.phase).toBe('lobby');
  });
});

describe('information hiding', () => {
  it('never sends the opponent card while a player is choosing', () => {
    const { host, guest } = seatedPair();
    expect(host.view.phase).toBe('picking');
    expect(host.view.myCard).not.toBeNull();
    expect(host.view.opponentCard).toBeNull();
    expect(guest.view.opponentCard).toBeNull();

    // The guest's card id appears nowhere in anything the host was ever sent.
    const guestCardId = guest.view.myCard!.id;
    expect(JSON.stringify(host.messages)).not.toContain(`"id":"${guestCardId}"`);
  });

  it('reveals both cards to both players once a stat is chosen', () => {
    const { host, guest } = seatedPair();
    const picker = host.view.activeSeat === 0 ? host : guest;
    send(picker, { type: 'pick', statId: 'power' });

    for (const player of [host, guest]) {
      expect(player.view.phase).toBe('reveal');
      expect(player.view.myCard).not.toBeNull();
      expect(player.view.opponentCard).not.toBeNull();
      expect(player.view.outcome?.statId).toBe('power');
    }
    // Both players see the same pair of cards, each from their own side.
    expect(host.view.myCard!.id).toBe(guest.view.opponentCard!.id);
    expect(host.view.opponentCard!.id).toBe(guest.view.myCard!.id);
  });
});

describe('turn gating', () => {
  it('refuses a pick from the player whose turn it is not', () => {
    const { host, guest } = seatedPair();
    const waiting = host.view.activeSeat === 0 ? guest : host;
    send(waiting, { type: 'pick', statId: 'power' });
    expect(waiting.errors.at(-1)?.code).toBe('not-your-turn');
  });

  it('refuses a stat the deck does not have', () => {
    const { host, guest } = seatedPair();
    const picker = host.view.activeSeat === 0 ? host : guest;
    send(picker, { type: 'pick', statId: 'wingspan' });
    expect(picker.errors.at(-1)?.code).toBe('bad-request');
  });

  it('refuses a second pick during the reveal', () => {
    const { host, guest } = seatedPair();
    const picker = host.view.activeSeat === 0 ? host : guest;
    send(picker, { type: 'pick', statId: 'power' });
    send(picker, { type: 'pick', statId: 'power' });
    expect(picker.errors.at(-1)?.code).toBe('not-your-turn');
  });
});

describe('reconnecting', () => {
  it('lets a dropped player resume with their token and keeps the match', () => {
    const { host, guest } = seatedPair();
    const before = host.view.myCard!.id;

    manager.detach(host);
    expect(guest.view.players[0]?.connected).toBe(false);
    expect(guest.room.reconnectDeadline).toBeGreaterThan(0);

    const returning = new FakeConnection();
    send(returning, { type: 'resume', token: host.token });
    expect(returning.view.seat).toBe(0);
    expect(returning.view.myCard!.id).toBe(before);
    expect(guest.view.players[0]?.connected).toBe(true);
    expect(guest.room.reconnectDeadline).toBeNull();
  });

  it('closes a stale tab that still holds the seat', () => {
    const { host } = seatedPair();
    const returning = new FakeConnection();
    send(returning, { type: 'resume', token: host.token });
    expect(host.closed).toBe(true);
  });

  it('rejects an unknown token', () => {
    const player = new FakeConnection();
    send(player, { type: 'resume', token: 'not-a-real-token' });
    expect(player.errors[0]?.code).toBe('session-expired');
  });

  it('ends the match when a player leaves deliberately', () => {
    const { host, guest } = seatedPair();
    send(host, { type: 'leave' });
    expect(guest.view.phase).toBe('gameover');
    expect(guest.view.winner).toBe(1);
    expect(guest.view.endReason).toBe('forfeit');
  });
});

describe('reactions', () => {
  it('passes an allowed emoji to both players', () => {
    const { host, guest } = seatedPair();
    send(host, { type: 'react', emoji: '\u{1F525}' });
    expect(guest.messages.at(-1)).toEqual({ type: 'reaction', seat: 0, emoji: '\u{1F525}' });
  });

  it('rejects anything not on the list', () => {
    const { host } = seatedPair();
    send(host, { type: 'react', emoji: '<script>alert(1)</script>' });
    expect(host.errors.at(-1)?.code).toBe('bad-request');
  });

  it('rate limits a spammer', () => {
    const { host } = seatedPair();
    for (let i = 0; i < 8; i++) send(host, { type: 'react', emoji: '\u{1F44D}' });
    expect(host.errors.at(-1)?.code).toBe('rate-limited');
  });
});

describe('malformed input', () => {
  it('survives junk without throwing', () => {
    const player = new FakeConnection();
    manager.handle(player, 'not json at all');
    manager.handle(player, '[]');
    manager.handle(player, '{"type":123}');
    manager.handle(player, '{"type":"pick"}');
    expect(player.errors).toHaveLength(4);
  });

  it('rate limits a flood of messages', () => {
    const player = new FakeConnection();
    for (let i = 0; i < 80; i++) manager.handle(player, '{"type":"ping"}');
    expect(player.errors.some((error) => error.code === 'rate-limited')).toBe(true);
  });
});

describe('single player', () => {
  it('seats a bot and starts immediately', () => {
    const player = new FakeConnection();
    send(player, { type: 'create', deckId: 'test', name: 'Me', mode: 'ai', difficulty: 'hard' });
    expect(player.view.players[1]?.isBot).toBe(true);
    expect(player.view.players[1]?.connected).toBe(true);
    expect(player.view.phase).toBe('picking');
  });

  it('has the bot take its turn without being asked', async () => {
    const player = new FakeConnection();
    send(player, { type: 'create', deckId: 'test', name: 'Me', mode: 'ai' });
    if (player.view.activeSeat === 0) send(player, { type: 'pick', statId: 'power' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(player.view.round).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('collapses whitespace, clamps length and never returns empty', () => {
    expect(sanitiseName('  Ralph  ')).toBe('Ralph');
    expect(sanitiseName('x'.repeat(40))).toHaveLength(16);
    expect(sanitiseName('')).toBe('Player');
    expect(sanitiseName(42)).toBe('Player');
    expect(sanitiseName('a\n\n\nb')).toBe('a b');
  });

  it('strips control characters from a name', () => {
    expect(sanitiseName(`bad${String.fromCharCode(7)}name`)).toBe('badname');
  });

  it('normalises room codes typed in any case', () => {
    expect(normaliseCode(' ab2c ')).toBe('AB2C');
    expect(normaliseCode('a-b-2-c-d')).toBe('AB2C');
    expect(normaliseCode(null)).toBe('');
  });
});

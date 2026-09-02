/**
 * Types shared by the server and the client.
 *
 * The server is authoritative: it owns the full MatchState and never sends a
 * player anything they should not be able to see. What each client receives is
 * a MatchView, derived per seat.
 */

export type StatId = string;

export interface StatDef {
  /** Key used in `CardDef.stats`. */
  id: StatId;
  label: string;
  /** Suffix appended when the value is displayed, e.g. " m" or " mph". */
  unit?: string;
  /** Prefix, e.g. "$". */
  prefix?: string;
  /** Decimal places used for display. Defaults to 0. */
  decimals?: number;
  /**
   * True when a bigger number beats a smaller one. False for stats where low
   * is good, such as a 0-60 time or kerb weight.
   */
  higherWins: boolean;
  /**
   * Whether to group thousands with a separator. True by default, which is
   * right for a mass or a price and wrong for a year: "1,759" is not how a
   * founding date is written.
   */
  grouped?: boolean;
  /** Shown in the deck browser to explain what the stat measures. */
  description?: string;
}

export interface CardDef {
  id: string;
  name: string;
  subtitle: string;
  /** Fallback glyph drawn on the generated art when no photo is available. */
  emoji: string;
  /**
   * Title of the English Wikipedia article for this subject. `npm run
   * fetch-images` uses it to pull the lead photo and its licence.
   */
  wikipedia: string;
  /**
   * An exact Wikimedia Commons file to use instead of whatever the article
   * happens to lead with, e.g. "File:Tyrannosaurus BW.jpg".
   *
   * Lead images change, and for some subjects they are a diagram, the wrong
   * variant, or the wrong generation of a car entirely. Pinning a file is how
   * a card is made permanently correct.
   */
  commonsFile?: string;
  /**
   * Filename of a drawing committed alongside the deck, in
   * public/cards/<deck>/. Set on cards where no free photograph exists and one
   * was drawn instead - the Fortnite weapons, where every real image is Epic's
   * copyright. Takes precedence over anything the fetcher found, and is
   * skipped by `npm run fetch-images` entirely.
   */
  localArt?: string;
  /**
   * Where to anchor the photo inside the card's 16:9 band, as a CSS
   * object-position value ("top", "50% 20%"). Encyclopedia photographs are not
   * composed for a letterbox, so a tall subject often needs anchoring high to
   * avoid being cropped through the head.
   */
  focus?: string;
  /** Overrides the deck's art fit for this one card. */
  fit?: ArtFit;
  stats: Record<StatId, number>;
  /**
   * Path to a fetched photo, filled in by the server from the attribution
   * manifest. Absent until `npm run fetch-images` has run, in which case the
   * client draws generated art instead.
   */
  image?: string;
  credit?: PhotoCredit;
}

/** Where a fetched photo came from and what licence it carries. */
export interface PhotoCredit {
  /** Original file name on Wikimedia Commons. */
  file: string;
  artist: string;
  licence: string;
  licenceUrl: string;
  /** Commons description page, which is the correct place to link back to. */
  sourceUrl: string;
}

/**
 * How a picture sits in the card's 16:9 band. Photographs suit `cover`, which
 * fills the band and crops. Wide illustrations - a sauropod in side profile -
 * need `contain`, or the head and tail are cropped away.
 */
export type ArtFit = 'cover' | 'contain';

export interface DeckArt {
  fit?: ArtFit;
  /** Band colour behind a `contain` image, where the picture does not reach. */
  background?: string;
}

export interface DeckTheme {
  /** Dominant deck colour. */
  primary: string;
  /** Highlight used for the selected stat and win states. */
  accent: string;
  /** Text colour that reads well on `primary`. */
  ink: string;
}

export interface Deck {
  id: string;
  name: string;
  tagline: string;
  emoji: string;
  theme: DeckTheme;
  /** Defaults for how this deck's pictures are framed. */
  art?: DeckArt;
  /** Always six, so every card in the game has the same shape. */
  stats: StatDef[];
  cards: CardDef[];
}

export type Seat = 0 | 1;

export type Phase =
  /** Waiting for both players before the first round. */
  | 'lobby'
  /** The active seat is choosing a stat; cards are face down to the opponent. */
  | 'picking'
  /** Both cards are face up and the result is being shown. */
  | 'reveal'
  | 'gameover';

export type RoundResult = 'win' | 'draw';

export type EndReason =
  /** Somebody ran out of cards. */
  | 'cards'
  /** The round cap was reached; the larger hand wins. */
  | 'roundcap'
  /** An opponent left or failed to reconnect. */
  | 'forfeit';

export interface RoundOutcome {
  round: number;
  statId: StatId;
  pickedBy: Seat;
  /** Card ids that were face up this round, indexed by seat. */
  cardIds: [string, string];
  values: [number, number];
  result: RoundResult;
  /** Null on a draw. */
  winner: Seat | null;
  /** Cards already in the pot when the round began. */
  potBefore: number;
  /** How many cards changed hands (0 on a draw). */
  cardsWon: number;
  /** Hand sizes once the round was resolved, indexed by seat. */
  counts: [number, number];
}

export interface MatchState {
  deckId: string;
  /** Card ids per seat; index 0 is the top of the pile. */
  hands: [string[], string[]];
  /** Cards held over from drawn rounds, won by whoever takes the next round. */
  pot: string[];
  /** Seat whose turn it is to choose a stat. */
  activeSeat: Seat;
  round: number;
  phase: Phase;
  /** The round just played, or null before the first one. */
  outcome: RoundOutcome | null;
  history: RoundOutcome[];
  winner: Seat | null;
  endReason: EndReason | null;
  /**
   * Safety net so a match cannot run forever. When this many rounds have been
   * played the bigger hand wins. Set to 0 to disable.
   */
  roundCap: number;
}

export type AiDifficulty = 'easy' | 'hard';

export type Mode = 'multiplayer' | 'ai';

// ---------------------------------------------------------------------------
// Per-seat views
// ---------------------------------------------------------------------------

export interface PlayerView {
  name: string;
  connected: boolean;
  /** Number of cards held. */
  count: number;
  isBot: boolean;
  /** Has asked for a rematch on the game-over screen. */
  wantsRematch: boolean;
}

export interface MatchView {
  deckId: string;
  phase: Phase;
  round: number;
  roundCap: number;
  activeSeat: Seat;
  potCount: number;
  /** Your seat. */
  seat: Seat;
  players: [PlayerView, PlayerView];
  /** Your top card. Null once your hand is empty. */
  myCard: CardDef | null;
  /**
   * The opponent's top card. Only populated during `reveal` and `gameover` —
   * before that the server withholds it, so it cannot be read off the wire.
   */
  opponentCard: CardDef | null;
  outcome: RoundOutcome | null;
  history: RoundOutcome[];
  winner: Seat | null;
  endReason: EndReason | null;
  /** Wall-clock ms (Date.now) at which the server moves on from the reveal. */
  nextRoundAt: number | null;
}

export interface RoomView {
  code: string;
  mode: Mode;
  deckId: string;
  hostSeat: Seat;
  /** Set while a player is disconnected: ms since epoch when they forfeit. */
  reconnectDeadline: number | null;
}

// ---------------------------------------------------------------------------
// Wire protocol
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'create'; deckId: string; name: string; mode: Mode; difficulty?: AiDifficulty }
  | { type: 'join'; code: string; name: string }
  | { type: 'resume'; token: string }
  | { type: 'start' }
  | { type: 'pick'; statId: StatId }
  | { type: 'rematch' }
  | { type: 'react'; emoji: string }
  | { type: 'leave' }
  | { type: 'ping' };

export type ServerMessage =
  | { type: 'session'; token: string; room: RoomView; view: MatchView }
  | { type: 'room'; room: RoomView }
  | { type: 'view'; view: MatchView }
  | { type: 'reaction'; seat: Seat; emoji: string }
  | { type: 'error'; code: ErrorCode; message: string }
  | { type: 'pong' };

export type ErrorCode =
  | 'room-not-found'
  | 'room-full'
  | 'bad-request'
  | 'not-your-turn'
  | 'unknown-deck'
  | 'session-expired'
  | 'rate-limited';

/** Emoji a player may send. Anything else is rejected by the server. */
export const REACTIONS = ['👍', '😂', '😮', '😤', '🔥', '🤝'] as const;
export type Reaction = (typeof REACTIONS)[number];

/**
 * Websocket plumbing.
 *
 * The socket reconnects on its own with backoff, and re-presents the session
 * token when it comes back, so a flaky train tunnel or a page refresh puts you
 * straight back into the same match rather than losing it.
 */

import type { ClientMessage, ServerMessage } from '../../shared/types';

export type ConnectionStatus = 'connecting' | 'open' | 'offline';

const MAX_BACKOFF_MS = 10_000;
const BASE_BACKOFF_MS = 500;

export class GameConnection {
  private socket: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;
  /** Sent the moment the socket opens, before anything else. */
  private resumeToken: string | null = null;

  constructor(
    private readonly onMessage: (message: ServerMessage) => void,
    private readonly onStatus: (status: ConnectionStatus) => void,
  ) {}

  get url(): string {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${location.host}/ws`;
  }

  setResumeToken(token: string | null): void {
    this.resumeToken = token;
  }

  connect(): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) return;
    this.closedByUs = false;
    this.onStatus('connecting');

    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.attempts = 0;
      this.onStatus('open');
      if (this.resumeToken) this.send({ type: 'resume', token: this.resumeToken });
    });

    socket.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        this.onMessage(JSON.parse(event.data) as ServerMessage);
      } catch {
        // A message we cannot parse is not worth tearing the socket down for.
      }
    });

    socket.addEventListener('close', () => {
      this.socket = null;
      if (this.closedByUs) return;
      this.onStatus('offline');
      this.scheduleRetry();
    });

    // 'error' is always followed by 'close', so retrying is handled there.
    socket.addEventListener('error', () => this.onStatus('offline'));
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const delay = Math.min(BASE_BACKOFF_MS * 2 ** this.attempts, MAX_BACKOFF_MS);
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  close(): void {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close();
    this.socket = null;
  }
}

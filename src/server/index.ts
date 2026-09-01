/**
 * Entry point: one Node process serving the built client, a tiny JSON API and
 * the game websocket on a single port. That keeps deployment to "run this
 * container", which works on Render, Fly, Railway, a VPS or your laptop.
 */

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadDecks } from './decks';
import { DEFAULT_CONFIG, RoomManager } from './rooms';
import { serveStatic } from './static';

const here = dirname(fileURLToPath(import.meta.url));
// dist/server/index.js and src/server/index.ts are both two levels down.
const ROOT = join(here, '..', '..');
const CLIENT_DIR = join(ROOT, 'dist', 'client');

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
/** Comma separated list. When set, websocket upgrades from other origins are refused. */
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

/** Anything larger than this is not a legitimate move. */
const MAX_MESSAGE_BYTES = 4 * 1024;
const HEARTBEAT_MS = 30_000;

/** Positive integer from the environment, or the default if unset or nonsense. */
function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const decks = loadDecks(ROOT);
const rooms = new RoomManager(decks, {
  ...DEFAULT_CONFIG,
  // Shortening the reveal makes automated play-throughs quick; the client
  // scales its animation to whatever window the server advertises.
  revealMs: envMs('REVEAL_MS', DEFAULT_CONFIG.revealMs),
  reconnectGraceMs: envMs('RECONNECT_GRACE_MS', DEFAULT_CONFIG.reconnectGraceMs),
});
rooms.startSweeper();

const publicDecks = JSON.stringify(decks);
const hasClientBuild = existsSync(join(CLIENT_DIR, 'index.html'));

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

  if (url.pathname === '/api/health') {
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, rooms: rooms.roomCount, decks: decks.length }));
    return;
  }

  if (url.pathname === '/api/decks') {
    response
      .writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
      .end(publicDecks);
    return;
  }

  if (hasClientBuild && serveStatic(CLIENT_DIR, request, response)) return;

  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(
    hasClientBuild
      ? 'Not found'
      : 'The client has not been built yet. Run `npm run build`, or use `npm run dev`.',
  );
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  if (ALLOWED_ORIGINS.length > 0) {
    const origin = request.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
  }
  wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
});

/** Sockets that missed the last heartbeat are assumed dead and closed. */
const alive = new WeakSet<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
  alive.add(ws);
  ws.on('pong', () => alive.add(ws));

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    rooms.handle(ws, data.toString('utf8'));
  });

  ws.on('error', (error) => console.warn('[ws] socket error:', error.message));
  ws.on('close', () => rooms.detach(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.has(ws)) {
      ws.terminate();
      continue;
    }
    alive.delete(ws);
    ws.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();

server.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST}:${PORT}`);
  if (!hasClientBuild) {
    console.log('[server] no client build found - run `npm run dev` for the Vite dev server');
  }
});

function shutdown(signal: string): void {
  console.log(`[server] ${signal} received, shutting down`);
  clearInterval(heartbeat);
  rooms.stop();
  for (const ws of wss.clients) ws.close(1001, 'Server shutting down');
  server.close(() => process.exit(0));
  // Do not hang forever on a stuck connection.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

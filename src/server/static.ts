/**
 * A small static file handler for the built client.
 *
 * Deliberately tiny: the production server has exactly one job beyond the
 * websocket, which is to hand out the files Vite produced.
 */

import { createReadStream, statSync } from 'node:fs';
import { normalize, join, extname, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveWithin(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  // A NUL byte can truncate a path inside some syscalls; refuse outright.
  if (decoded.includes('\0')) return null;

  const candidate = normalize(join(root, decoded));
  // normalize() collapses "..", so this check is what keeps requests inside root.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null;
  return candidate;
}

/**
 * Serves `root`, falling back to index.html so client-side routes work.
 * Returns false when the request was not handled at all.
 */
export function serveStatic(
  root: string,
  request: IncomingMessage,
  response: ServerResponse,
): boolean {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false;

  const urlPath = new URL(request.url ?? '/', 'http://localhost').pathname;
  const resolved = resolveWithin(root, urlPath === '/' ? '/index.html' : urlPath);
  if (!resolved) {
    response.writeHead(400).end('Bad path');
    return true;
  }

  const file = pickFile(resolved, root);
  if (!file) {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
    return true;
  }

  const ext = extname(file).toLowerCase();
  // Hashed asset names make long caching safe; everything else must revalidate.
  const immutable = file.includes(`${sep}assets${sep}`);
  response.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (request.method === 'HEAD') {
    response.end();
    return true;
  }
  createReadStream(file).pipe(response);
  return true;
}

function pickFile(candidate: string, root: string): string | null {
  try {
    const stats = statSync(candidate);
    if (stats.isFile()) return candidate;
    if (stats.isDirectory()) {
      const index = join(candidate, 'index.html');
      return statSync(index).isFile() ? index : null;
    }
  } catch {
    // Fall through to the SPA entry point below.
  }
  // Unknown path with no file extension: let the client-side app handle it.
  if (!extname(candidate)) {
    const index = join(root, 'index.html');
    try {
      return statSync(index).isFile() ? index : null;
    } catch {
      return null;
    }
  }
  return null;
}

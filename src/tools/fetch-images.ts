/**
 * Downloads a real photograph for every card.
 *
 *   npm run fetch-images
 *
 * Two ways a card gets its picture:
 *
 *  - `"commonsFile": "File:Something.jpg"` in decks/*.json downloads that exact
 *    file. This is how a card is made permanently correct, and it is the only
 *    way to be certain: lead images change, and for some subjects they are a
 *    diagram, the wrong variant, or the wrong generation of a car entirely.
 *  - Otherwise the script takes whatever the named Wikipedia article currently
 *    leads with, which is usually right and sometimes is not.
 *
 * Either way the licence comes from Wikimedia Commons, anything not freely
 * licensed is refused, and public/cards/attributions.json records who took each
 * photo for the in-game credits page.
 *
 * It also writes public/cards/contact-sheet.html: every card at the exact crop
 * the game uses, so the set can actually be checked rather than assumed. Open
 * it after every run.
 *
 * Photos are not committed to the repository - they belong to their
 * photographers, and this brings them back in one command.
 *
 * Options:
 *   --force            re-download files that are already on disk
 *   --deck=<id>        only this deck (repeatable)
 *   --width=<px>       longest edge to request (default 900)
 *   --dry-run          report what would be fetched, write nothing
 *   --concurrency=<n>  parallel downloads (default 4) */

import { mkdir, readFile, readdir, rm, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici';
import {
  chunk,
  extensionFor,
  findImage,
  isFreeLicence,
  canReuseDownload,
  readLicence,
  readPinnedFile,
  toFileTitle,
  type ExtMetadataResponse,
  type Licence,
  type WikiQueryResponse,
} from './wikimedia';
import { contactSheet } from './contact-sheet';
import type { Deck } from '../shared/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECK_DIR = join(ROOT, 'decks');
const OUT_DIR = join(ROOT, 'public', 'cards');
const MANIFEST = join(OUT_DIR, 'attributions.json');
const CONTACT_SHEET = join(OUT_DIR, 'contact-sheet.html');

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';

/**
 * Wikimedia asks automated clients to identify themselves and to say where to
 * complain. Set FETCH_IMAGES_CONTACT to your own address if you run this a lot.
 */
const CONTACT = process.env.FETCH_IMAGES_CONTACT ?? 'https://github.com/booze1/topgame';
const USER_AGENT = `topgame-card-fetcher/1.0 (${CONTACT})`;

/** Titles per API request. The API allows 50 for anonymous clients. */
const TITLES_PER_REQUEST = 40;
/** Politeness gap between API calls. */
const REQUEST_GAP_MS = 250;
/** Pause between image downloads, so a whole deck does not arrive as a burst. */
const DOWNLOAD_GAP_MS = 200;
const MAX_BYTES = 4 * 1024 * 1024;

interface Options {
  force: boolean;
  decks: string[];
  width: number;
  dryRun: boolean;
  concurrency: number;
}

function parseOptions(argv: string[]): Options {
  const decks: string[] = [];
  let width = 900;
  let concurrency = 2;

  for (const arg of argv) {
    if (arg.startsWith('--deck=')) decks.push(arg.slice('--deck='.length));
    if (arg.startsWith('--width=')) width = Number(arg.slice('--width='.length)) || width;
    if (arg.startsWith('--concurrency=')) {
      concurrency = Math.max(1, Number(arg.slice('--concurrency='.length)) || concurrency);
    }
  }
  return {
    force: argv.includes('--force'),
    dryRun: argv.includes('--dry-run'),
    decks,
    width: Math.min(2000, Math.max(200, width)),
    concurrency,
  };
}

/**
 * Route requests through an HTTP proxy when one is configured.
 *
 * Node's built-in fetch ignores HTTPS_PROXY entirely, unlike curl and most
 * other tooling. Behind a corporate proxy that silently means every request
 * leaves the machine the wrong way and comes back as a connection error or a
 * 403, which looks like Wikipedia refusing us rather than a proxy we never
 * used. Installing the dispatcher up front makes fetch behave like everything
 * else on the machine; with no proxy set it is a no-op.
 */
function useProxyIfConfigured(): void {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (!proxy) return;
  setGlobalDispatcher(new EnvHttpProxyAgent());
  console.log(`Using proxy ${proxy}`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls a MediaWiki API endpoint, backing off when it asks us to.
 *
 * The APIs rate-limit as readily as the image servers do, and a run that dies
 * on the first 429 loses every card. Wikimedia also answers an over-eager
 * client with a plain-text notice rather than JSON, so a body that will not
 * parse is treated as the same signal.
 */
async function getJson<T>(
  api: string,
  params: Record<string, string>,
  attempts = 5,
): Promise<T> {
  const url = new URL(api);
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();

  let wait = 5000;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
    });
    const body = await response.text();

    if (response.ok) {
      try {
        return JSON.parse(body) as T;
      } catch {
        if (attempt >= attempts) {
          throw new Error(`${url.host} sent a non-JSON reply: ${body.slice(0, 80)}`);
        }
      }
    } else if (response.status !== 429 && response.status !== 503) {
      throw new Error(`${url.host} answered ${response.status}`);
    } else if (attempt >= attempts) {
      throw new Error(`${url.host} answered ${response.status} after ${attempts} attempts`);
    }

    const header = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(header) && header > 0 ? header * 1000 : wait;
    console.log(`  ${url.host} is rate limiting; waiting ${Math.round(delay / 1000)}s`);
    await sleep(Math.min(delay, 60_000));
    wait *= 2;
  }
}

interface Candidate {
  deckId: string;
  deckName: string;
  cardId: string;
  cardName: string;
  title: string;
  /** Exact Commons file to use instead of the article's lead image. */
  commonsFile?: string;
}

interface Resolved extends Candidate {
  file: string;
  url: string;
  licence: Licence;
  /** True when this came from an explicitly pinned file rather than a lead image. */
  pinned: boolean;
}

/**
 * Resolves cards that name an exact Commons file. Asking for `url` with
 * `iiurlwidth` returns a scaled image and the licence in the same response, so
 * a pinned card costs one request rather than two.
 */
async function findPinned(
  candidates: Candidate[],
  width: number,
): Promise<{ resolved: Resolved[]; unusable: { candidate: Candidate; reason: string }[] }> {
  const resolved: Resolved[] = [];
  const unusable: { candidate: Candidate; reason: string }[] = [];

  for (const batch of chunk(candidates, TITLES_PER_REQUEST)) {
    const response = await getJson<ExtMetadataResponse>(COMMONS_API, {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'url|extmetadata',
      iiurlwidth: String(width),
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
      titles: [...new Set(batch.map((c) => toFileTitle(c.commonsFile!)))].join('|'),
    });

    for (const candidate of batch) {
      const fileTitle = toFileTitle(candidate.commonsFile!);
      const found = readPinnedFile(fileTitle, response);
      if (!found) {
        // A pinned name is exact; a typo means the file simply is not there.
        unusable.push({ candidate, reason: `pinned file not found on Commons: ${fileTitle}` });
        continue;
      }
      if (!isFreeLicence(found.licence.licence, found.licence.licenceUrl)) {
        unusable.push({ candidate, reason: `pinned file licence "${found.licence.licence}"` });
        continue;
      }
      resolved.push({
        ...candidate,
        file: fileTitle.replace(/^File:/, ''),
        url: found.url,
        licence: found.licence,
        pinned: true,
      });
    }
    await sleep(REQUEST_GAP_MS);
  }
  return { resolved, unusable };
}

/** Asks Wikipedia for the lead image of every requested article. */
async function findImages(candidates: Candidate[], width: number) {
  const found: { candidate: Candidate; file: string; url: string }[] = [];
  const missing: Candidate[] = [];

  for (const batch of chunk(candidates, TITLES_PER_REQUEST)) {
    const response = await getJson<WikiQueryResponse>(WIKI_API, {
      action: 'query',
      prop: 'pageimages',
      piprop: 'thumbnail|name',
      pithumbsize: String(width),
      redirects: '1',
      titles: batch.map((entry) => entry.title).join('|'),
    });

    for (const candidate of batch) {
      const image = findImage(candidate.title, response);
      if (image?.url && image.file) found.push({ candidate, ...image });
      else missing.push(candidate);
    }
    await sleep(REQUEST_GAP_MS);
  }
  return { found, missing };
}

/** Asks Commons who owns each file and under what terms. */
async function findLicences(
  found: { candidate: Candidate; file: string; url: string }[],
): Promise<{ resolved: Resolved[]; unusable: { candidate: Candidate; reason: string }[] }> {
  const resolved: Resolved[] = [];
  const unusable: { candidate: Candidate; reason: string }[] = [];

  for (const batch of chunk(found, TITLES_PER_REQUEST)) {
    const titles = [...new Set(batch.map((entry) => toFileTitle(entry.file)))];
    const response = await getJson<ExtMetadataResponse>(COMMONS_API, {
      action: 'query',
      prop: 'imageinfo',
      iiprop: 'extmetadata|url',
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|Credit',
      titles: titles.join('|'),
    });

    for (const entry of batch) {
      const fileTitle = toFileTitle(entry.file);
      const licence = readLicence(fileTitle, response);
      if (!licence) {
        // Usually a non-free file uploaded locally to Wikipedia rather than
        // to Commons; either way there is nothing here we may republish.
        unusable.push({ candidate: entry.candidate, reason: 'no licence information on Commons' });
        continue;
      }
      if (!isFreeLicence(licence.licence, licence.licenceUrl)) {
        unusable.push({ candidate: entry.candidate, reason: `licence "${licence.licence}"` });
        continue;
      }
      resolved.push({
        ...entry.candidate,
        file: entry.file,
        url: entry.url,
        licence,
        pinned: false,
      });
    }
    await sleep(REQUEST_GAP_MS);
  }
  return { resolved, unusable };
}

/**
 * Fetches with backoff on the responses that mean "not now".
 *
 * Wikimedia rate-limits bulk image downloads, and a whole deck fetched flat out
 * gets a wall of 429s. Retrying politely - honouring Retry-After when it is
 * given - turns that from a failed run into a slightly slower one.
 */
async function fetchWithRetry(url: string, attempts = 4): Promise<Response> {
  let wait = 1000;
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, { headers: { 'user-agent': USER_AGENT } });
    if (response.ok) return response;

    const retryable = response.status === 429 || response.status === 503;
    if (!retryable || attempt >= attempts) return response;

    const header = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(header) && header > 0 ? header * 1000 : wait;
    await sleep(Math.min(delay, 30_000));
    wait *= 2;
  }
}

/** Any already-downloaded file for this card, whatever extension it has. */
async function existingFile(deckDir: string, cardId: string): Promise<string | null> {
  try {
    const names = await readdir(deckDir);
    return names.find((name) => name.replace(/\.[^.]+$/, '') === cardId) ?? null;
  } catch {
    return null;
  }
}

async function download(
  entry: Resolved,
  options: Options,
  previous: Record<string, string> | undefined,
): Promise<string | null> {
  const deckDir = join(OUT_DIR, entry.deckId);
  const existing = await existingFile(deckDir, entry.cardId);

  // Keep what is on disk only when it came from the same Commons file.
  if (!options.force && existing && canReuseDownload(previous?.['file'], entry.file)) {
    return `/cards/${entry.deckId}/${existing}`;
  }

  const response = await fetchWithRetry(entry.url);
  if (!response.ok) throw new Error(`image download answered ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`image is ${Math.round(buffer.byteLength / 1024)} kB, over the size cap`);
  }

  const extension = extensionFor(response.headers.get('content-type'), entry.url);
  const relative = `/cards/${entry.deckId}/${entry.cardId}${extension}`;
  if (options.dryRun) return relative;

  await mkdir(deckDir, { recursive: true });
  // Commons serves some PNG originals as JPEG thumbnails, so the extension can
  // change between runs; drop the old file rather than leaving both behind.
  if (existing && existing !== `${entry.cardId}${extension}`) {
    await rm(join(deckDir, existing), { force: true });
  }
  await writeFile(join(deckDir, `${entry.cardId}${extension}`), buffer);
  return relative;
}

/** Runs `worker` over `items`, at most `limit` at a time. */
async function pooled<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
  gapMs = 0,
) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]!);
      if (gapMs > 0) await sleep(gapMs);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  useProxyIfConfigured();
  const options = parseOptions(process.argv.slice(2));

  const files = (await readdir(DECK_DIR)).filter((name) => name.endsWith('.json')).sort();
  const decks: Deck[] = [];
  for (const file of files) {
    const deck = JSON.parse(await readFile(join(DECK_DIR, file), 'utf8')) as Deck;
    if (options.decks.length === 0 || options.decks.includes(deck.id)) decks.push(deck);
  }
  if (decks.length === 0) throw new Error('No decks matched');

  // Cards with a drawing committed next to the deck have nothing to fetch.
  // The Fortnite weapons are all of these: every real image of one is Epic's
  // copyright, so they are drawn rather than photographed.
  const drawn = decks.reduce(
    (total, deck) => total + deck.cards.filter((card) => card.localArt).length,
    0,
  );

  const candidates: Candidate[] = decks.flatMap((deck) =>
    deck.cards
      .filter((card) => !card.localArt)
      .map((card) => ({
        deckId: deck.id,
        deckName: deck.name,
        cardId: card.id,
        cardName: card.name,
        title: card.wikipedia,
        commonsFile: card.commonsFile,
      })),
  );

  const pinnedCandidates = candidates.filter((candidate) => candidate.commonsFile);
  const leadCandidates = candidates.filter((candidate) => !candidate.commonsFile);

  console.log(
    `Fetching photos for ${candidates.length} cards across ${decks.length} deck(s)` +
      (options.dryRun ? ' (dry run)' : ''),
  );
  console.log(
    `  ${pinnedCandidates.length} pinned to an exact file, ${leadCandidates.length} using article lead images` +
      (drawn > 0 ? `, ${drawn} using drawn art already in the repository` : ''),
  );

  // Pinned files first: they are the cards somebody has already decided about.
  const pinned = pinnedCandidates.length
    ? await findPinned(pinnedCandidates, options.width)
    : { resolved: [], unusable: [] };
  if (pinnedCandidates.length) {
    console.log(`  ${pinned.resolved.length}/${pinnedCandidates.length} pinned files resolved`);
  }

  const { found, missing } = leadCandidates.length
    ? await findImages(leadCandidates, options.width)
    : { found: [], missing: [] };
  const lead = found.length
    ? await findLicences(found)
    : { resolved: [], unusable: [] };
  if (leadCandidates.length) {
    console.log(
      `  ${found.length} articles have a lead image, ${missing.length} do not; ` +
        `${lead.resolved.length} are freely licensed`,
    );
  }

  const resolved = [...pinned.resolved, ...lead.resolved];
  const unusable = [...pinned.unusable, ...lead.unusable];

  // Start from the existing manifest so a per-deck run does not wipe the rest.
  let manifest: Record<string, Record<string, Record<string, string>>> = {};
  if (await exists(MANIFEST)) {
    try {
      manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
    } catch {
      console.warn('  existing manifest was unreadable and will be rebuilt');
    }
  }
  for (const deck of decks) if (options.force) delete manifest[deck.id];

  const failures: { candidate: Candidate; reason: string }[] = [];
  let downloaded = 0;

  await pooled(
    resolved,
    options.concurrency,
    async (entry) => {
      try {
          const relative = await download(entry, options, manifest[entry.deckId]?.[entry.cardId]);
        if (!relative) return;
        manifest[entry.deckId] ??= {};
        manifest[entry.deckId]![entry.cardId] = {
          image: relative,
          file: entry.file,
          artist: entry.licence.artist,
          licence: entry.licence.licence,
          licenceUrl: entry.licence.licenceUrl,
          sourceUrl: entry.licence.sourceUrl,
        };
        downloaded += 1;
        process.stdout.write(`\r  downloaded ${downloaded}/${resolved.length}`);
      } catch (error) {
        failures.push({
          candidate: entry,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    DOWNLOAD_GAP_MS,
  );
  process.stdout.write('\n');

  const skipped = [
    ...missing.map((candidate) => ({ candidate, reason: 'no lead image on Wikipedia' })),
    ...unusable,
    ...failures,
  ];

  if (!options.dryRun) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`  wrote ${MANIFEST}`);

    await writeFile(
      CONTACT_SHEET,
      contactSheet(
        decks,
        manifest,
        resolved.map((entry) => ({
          deckId: entry.deckId,
          cardId: entry.cardId,
          pinned: entry.pinned,
        })),
        skipped.map((entry) => ({
          deckId: entry.candidate.deckId,
          cardId: entry.candidate.cardId,
          reason: entry.reason,
        })),
      ),
    );
    console.log(`  wrote ${CONTACT_SHEET}`);
  }

  if (skipped.length > 0) {
    console.log(`\n${skipped.length} card(s) will use generated art instead:`);
    for (const { candidate, reason } of skipped) {
      console.log(`  ${candidate.deckId}/${candidate.cardId} (${candidate.cardName}): ${reason}`);
    }
    console.log(
      '\nTo fix one, either point its "wikipedia" field at a better article or pin an exact\n' +
        'image with "commonsFile": "File:Something.jpg" in decks/*.json.',
    );
  }

  console.log(
    `\nDone. ${downloaded} photo(s) ready. Open public/cards/contact-sheet.html to check them,\n` +
      'then restart the server to pick them up.',
  );
}

main().catch((error) => {
  console.error('\nfetch-images failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

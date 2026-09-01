/**
 * Downloads a real photograph for every card.
 *
 *   npm run fetch-images
 *
 * Each card in decks/*.json names an English Wikipedia article. This script
 * asks Wikipedia for that article's lead image, asks Wikimedia Commons who
 * took it and under what licence, keeps only freely licensed files, saves them
 * under public/cards/<deck>/<card>.jpg and writes public/cards/attributions.json
 * for the in-game credits page.
 *
 * Photos are not committed to the repository - they belong to their
 * photographers, and this brings them back in one command.
 *
 * Options:
 *   --force            re-download files that are already on disk
 *   --deck=<id>        only this deck (repeatable)
 *   --width=<px>       longest edge to request (default 900)
 *   --dry-run          report what would be fetched, write nothing
 *   --concurrency=<n>  parallel downloads (default 4)
 */

import { mkdir, readFile, readdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  chunk,
  extensionFor,
  findImage,
  isFreeLicence,
  readLicence,
  toFileTitle,
  type ExtMetadataResponse,
  type Licence,
  type WikiQueryResponse,
} from './wikimedia';
import type { Deck } from '../shared/types';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DECK_DIR = join(ROOT, 'decks');
const OUT_DIR = join(ROOT, 'public', 'cards');
const MANIFEST = join(OUT_DIR, 'attributions.json');

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
  let concurrency = 4;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getJson<T>(api: string, params: Record<string, string>): Promise<T> {
  const url = new URL(api);
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();

  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`${url.host} answered ${response.status}`);
  return (await response.json()) as T;
}

interface Candidate {
  deckId: string;
  cardId: string;
  cardName: string;
  title: string;
}

interface Resolved extends Candidate {
  file: string;
  url: string;
  licence: Licence;
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
      resolved.push({ ...entry.candidate, file: entry.file, url: entry.url, licence });
    }
    await sleep(REQUEST_GAP_MS);
  }
  return { resolved, unusable };
}

async function download(entry: Resolved, options: Options): Promise<string | null> {
  const deckDir = join(OUT_DIR, entry.deckId);
  const existingJpg = join(deckDir, `${entry.cardId}.jpg`);

  if (!options.force && (await exists(existingJpg))) {
    return `/cards/${entry.deckId}/${entry.cardId}.jpg`;
  }

  const response = await fetch(entry.url, { headers: { 'user-agent': USER_AGENT } });
  if (!response.ok) throw new Error(`image download answered ${response.status}`);

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) {
    throw new Error(`image is ${Math.round(buffer.byteLength / 1024)} kB, over the size cap`);
  }

  const extension = extensionFor(response.headers.get('content-type'), entry.url);
  const relative = `/cards/${entry.deckId}/${entry.cardId}${extension}`;
  if (options.dryRun) return relative;

  await mkdir(deckDir, { recursive: true });
  await writeFile(join(deckDir, `${entry.cardId}${extension}`), buffer);
  return relative;
}

/** Runs `worker` over `items`, at most `limit` at a time. */
async function pooled<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index]!);
    }
  });
  await Promise.all(runners);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));

  const files = (await readdir(DECK_DIR)).filter((name) => name.endsWith('.json')).sort();
  const decks: Deck[] = [];
  for (const file of files) {
    const deck = JSON.parse(await readFile(join(DECK_DIR, file), 'utf8')) as Deck;
    if (options.decks.length === 0 || options.decks.includes(deck.id)) decks.push(deck);
  }
  if (decks.length === 0) throw new Error('No decks matched');

  const candidates: Candidate[] = decks.flatMap((deck) =>
    deck.cards.map((card) => ({
      deckId: deck.id,
      cardId: card.id,
      cardName: card.name,
      title: card.wikipedia,
    })),
  );

  console.log(
    `Fetching photos for ${candidates.length} cards across ${decks.length} deck(s)` +
      (options.dryRun ? ' (dry run)' : ''),
  );

  const { found, missing } = await findImages(candidates, options.width);
  console.log(`  ${found.length} articles have a lead image, ${missing.length} do not`);

  const { resolved, unusable } = await findLicences(found);
  console.log(`  ${resolved.length} are freely licensed, ${unusable.length} are not usable`);

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

  await pooled(resolved, options.concurrency, async (entry) => {
    try {
      const relative = await download(entry, options);
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
  });
  process.stdout.write('\n');

  if (!options.dryRun) {
    await mkdir(OUT_DIR, { recursive: true });
    await writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
    console.log(`  wrote ${MANIFEST}`);
  }

  const skipped = [
    ...missing.map((candidate) => ({ candidate, reason: 'no lead image on Wikipedia' })),
    ...unusable,
    ...failures,
  ];
  if (skipped.length > 0) {
    console.log(`\n${skipped.length} card(s) will use generated art instead:`);
    for (const { candidate, reason } of skipped) {
      console.log(`  ${candidate.deckId}/${candidate.cardId} (${candidate.cardName}): ${reason}`);
    }
    console.log(
      '\nTo fix one, point its "wikipedia" field in decks/*.json at an article whose lead image is freely licensed.',
    );
  }

  console.log(`\nDone. ${downloaded} photo(s) ready. Restart the server to pick them up.`);
}

main().catch((error) => {
  console.error('\nfetch-images failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

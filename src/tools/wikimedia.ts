/**
 * Pure helpers for talking to the Wikipedia and Wikimedia Commons APIs.
 *
 * The network calls live in fetch-images.ts; everything that interprets a
 * response lives here so it can be tested without a connection. The responses
 * these functions parse are awkward in ways worth naming:
 *
 *  - A requested title may be normalised ("moon" to "Moon") and then followed
 *    through a redirect ("Orca" to "Killer whale") before it reaches a page,
 *    so mapping an answer back to the card that asked for it takes two hops.
 *  - Licence fields come back as HTML fragments, not plain text.
 *  - Some images are local, non-free uploads rather than freely licensed files
 *    on Commons, and those must not be redistributed.
 */

export interface WikiThumbnail {
  source: string;
  width: number;
  height: number;
}

export interface WikiPage {
  title: string;
  missing?: boolean;
  pageimage?: string;
  thumbnail?: WikiThumbnail;
}

export interface WikiQueryResponse {
  query?: {
    pages?: WikiPage[];
    normalized?: { from: string; to: string }[];
    redirects?: { from: string; to: string }[];
  };
}

export interface ExtMetadataResponse {
  query?: {
    pages?: {
      title: string;
      missing?: boolean;
      imageinfo?: {
        descriptionurl?: string;
        /** Full-size original. */
        url?: string;
        /** Scaled version, present when iiurlwidth was requested. */
        thumburl?: string;
        extmetadata?: Record<string, { value?: string }>;
      }[];
    }[];
  };
}

export interface Licence {
  artist: string;
  licence: string;
  licenceUrl: string;
  sourceUrl: string;
}

/** Split a list into batches, because the API caps titles per request. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Maps each title we asked for to the page title that actually answered it,
 * following normalisation and then any chain of redirects.
 */
export function resolveTitles(
  requested: readonly string[],
  response: WikiQueryResponse,
): Map<string, string> {
  const hops = new Map<string, string>();
  for (const step of response.query?.normalized ?? []) hops.set(step.from, step.to);
  for (const step of response.query?.redirects ?? []) hops.set(step.from, step.to);

  const resolved = new Map<string, string>();
  for (const title of requested) {
    let current = title;
    // Redirect chains are short, but a loop would hang us, so bound it.
    for (let step = 0; step < 8; step++) {
      const next = hops.get(current);
      if (!next || next === current) break;
      current = next;
    }
    resolved.set(title, current);
  }
  return resolved;
}

/** Finds the page for a requested title and returns its lead image, if any. */
export function findImage(
  requestedTitle: string,
  response: WikiQueryResponse,
): { file: string; url: string } | null {
  const resolved = resolveTitles([requestedTitle], response).get(requestedTitle);
  const page = response.query?.pages?.find(
    (candidate) => candidate.title === resolved || candidate.title === requestedTitle,
  );
  if (!page || page.missing || !page.thumbnail?.source) return null;
  return { file: page.pageimage ?? '', url: page.thumbnail.source };
}

/** Commons returns author and credit as HTML fragments. */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Whether a licence permits redistribution.
 *
 * Deliberately an allow-list: anything unrecognised is treated as not free, so
 * an unusual tag means a card falls back to generated art rather than the
 * project quietly republishing something it should not.
 */
export function isFreeLicence(licence: string, licenceUrl: string): boolean {
  const name = licence.trim().toLowerCase();
  if (!name) return false;
  if (/non-?free|fair use|copyright|all rights reserved|no license/.test(name)) return false;
  if (licenceUrl.includes('creativecommons.org')) return true;
  return /^(cc[\s-]|cc0|public domain|pd[\s-]?|attribution\b)/.test(name);
}

/** Pulls the licence block for one file out of an imageinfo response. */
export function readLicence(fileTitle: string, response: ExtMetadataResponse): Licence | null {
  const page = response.query?.pages?.find((candidate) => candidate.title === fileTitle);
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info) return null;

  const meta = info.extmetadata ?? {};
  const read = (key: string) => stripHtml(meta[key]?.value ?? '');

  const licence = read('LicenseShortName');
  const licenceUrl = meta['LicenseUrl']?.value?.trim() ?? '';
  const artist = read('Artist') || read('Credit') || 'Unknown author';

  if (!licence) return null;
  return {
    artist,
    licence,
    licenceUrl,
    sourceUrl:
      info.descriptionurl ??
      `https://commons.wikimedia.org/wiki/${encodeURIComponent(fileTitle.replace(/ /g, '_'))}`,
  };
}

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

/**
 * Picks a file extension from the content type, falling back to the URL and
 * finally to .jpg, which is what the thumbnailer returns most of the time.
 */
export function extensionFor(contentType: string | null, url: string): string {
  const type = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (EXTENSIONS[type]) return EXTENSIONS[type]!;
  const match = /\.(jpe?g|png|webp|gif|avif)(?:$|[?#])/i.exec(url);
  if (match) return `.${match[1]!.toLowerCase().replace('jpeg', 'jpg')}`;
  return '.jpg';
}

/** Commons file titles need the "File:" prefix and spaces, not underscores. */
export function toFileTitle(pageImage: string): string {
  const bare = pageImage.replace(/^File:/i, '').replace(/_/g, ' ');
  return `File:${bare}`;
}

/**
 * Reads a directly pinned Commons file: both where to download it and who owns
 * it, from the single imageinfo request that asked for `url|extmetadata`.
 *
 * Returns null when the file does not exist, which is the common failure for a
 * pinned name - Commons titles are exact, and a near miss is simply missing.
 */
export function readPinnedFile(
  fileTitle: string,
  response: ExtMetadataResponse,
): { url: string; licence: Licence } | null {
  const page = response.query?.pages?.find((candidate) => candidate.title === fileTitle);
  const info = page?.imageinfo?.[0];
  if (!page || page.missing || !info) return null;

  const url = info.thumburl || info.url;
  if (!url) return null;

  const licence = readLicence(fileTitle, response);
  if (!licence) return null;
  return { url, licence };
}

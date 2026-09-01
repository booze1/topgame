import { describe, expect, it } from 'vitest';
import {
  chunk,
  extensionFor,
  findImage,
  isFreeLicence,
  readLicence,
  resolveTitles,
  stripHtml,
  toFileTitle,
} from './wikimedia';
import type { ExtMetadataResponse, WikiQueryResponse } from './wikimedia';

/**
 * Fixtures shaped like real formatversion=2 responses. The photo fetcher runs
 * on the user's machine rather than in CI, so these tests are the only thing
 * standing between a bad parse and a deck full of missing pictures.
 */
const pageImages: WikiQueryResponse = {
  query: {
    normalized: [{ from: 'orca', to: 'Orca' }],
    redirects: [{ from: 'Orca', to: 'Killer whale' }],
    pages: [
      {
        title: 'Killer whale',
        pageimage: 'Killerwhales_jumping.jpg',
        thumbnail: {
          source: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/x/900px-x.jpg',
          width: 900,
          height: 600,
        },
      },
      { title: 'Nonexistent dinosaur', missing: true },
      { title: 'Textonly', pageimage: 'nope.jpg' },
    ],
  },
};

describe('resolveTitles', () => {
  it('follows normalisation and then a redirect', () => {
    expect(resolveTitles(['orca'], pageImages).get('orca')).toBe('Killer whale');
  });

  it('leaves a title that needed no hops alone', () => {
    expect(resolveTitles(['Tyrannosaurus'], pageImages).get('Tyrannosaurus')).toBe('Tyrannosaurus');
  });

  it('does not spin on a redirect loop', () => {
    const looping: WikiQueryResponse = {
      query: { redirects: [{ from: 'A', to: 'B' }, { from: 'B', to: 'A' }] },
    };
    expect(resolveTitles(['A'], looping).get('A')).toMatch(/^[AB]$/);
  });
});

describe('findImage', () => {
  it('finds the thumbnail for a redirected title', () => {
    expect(findImage('orca', pageImages)).toEqual({
      file: 'Killerwhales_jumping.jpg',
      url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/8f/x/900px-x.jpg',
    });
  });

  it('returns null for a page that does not exist', () => {
    expect(findImage('Nonexistent dinosaur', pageImages)).toBeNull();
  });

  it('returns null for a page with no thumbnail', () => {
    expect(findImage('Textonly', pageImages)).toBeNull();
  });

  it('returns null when the response carries no pages at all', () => {
    expect(findImage('Anything', {})).toBeNull();
  });
});

describe('stripHtml', () => {
  it('reduces a Commons author fragment to plain text', () => {
    expect(stripHtml('<a href="//commons.wikimedia.org/wiki/User:Bob">Bob&nbsp;Smith</a>')).toBe(
      'Bob Smith',
    );
  });

  it('decodes the entities Commons actually uses', () => {
    expect(stripHtml('Tom &amp; Jerry&#039;s &quot;photo&quot;')).toBe(`Tom & Jerry's "photo"`);
  });
});

describe('isFreeLicence', () => {
  it.each([
    ['CC BY-SA 4.0', ''],
    ['CC0', ''],
    ['Public domain', ''],
    ['PD-USGov', ''],
    ['Attribution', ''],
    ['Some unusual tag', 'https://creativecommons.org/licenses/by/4.0/'],
  ])('accepts %s', (licence, url) => {
    expect(isFreeLicence(licence, url)).toBe(true);
  });

  it.each([
    ['Fair use', ''],
    ['Non-free logo', ''],
    ['All rights reserved', ''],
    ['', ''],
    ['Screenshot of copyrighted software', ''],
  ])('rejects %s', (licence, url) => {
    expect(isFreeLicence(licence, url)).toBe(false);
  });

  it('rejects a tag it has never seen, rather than guessing', () => {
    expect(isFreeLicence('Bespoke museum permission', '')).toBe(false);
  });
});

describe('readLicence', () => {
  const response: ExtMetadataResponse = {
    query: {
      pages: [
        {
          title: 'File:Trex.jpg',
          imageinfo: [
            {
              descriptionurl: 'https://commons.wikimedia.org/wiki/File:Trex.jpg',
              extmetadata: {
                LicenseShortName: { value: 'CC BY-SA 3.0' },
                LicenseUrl: { value: 'https://creativecommons.org/licenses/by-sa/3.0' },
                Artist: { value: '<a href="/wiki/User:Ann">Ann Example</a>' },
              },
            },
          ],
        },
        {
          title: 'File:NoMeta.jpg',
          imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:NoMeta.jpg' }],
        },
        { title: 'File:Gone.jpg', missing: true },
      ],
    },
  };

  it('reads author, licence and source page', () => {
    expect(readLicence('File:Trex.jpg', response)).toEqual({
      artist: 'Ann Example',
      licence: 'CC BY-SA 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/3.0',
      sourceUrl: 'https://commons.wikimedia.org/wiki/File:Trex.jpg',
    });
  });

  it('falls back to Credit and then to a generic author', () => {
    const credited: ExtMetadataResponse = {
      query: {
        pages: [
          {
            title: 'File:X.jpg',
            imageinfo: [
              {
                extmetadata: {
                  LicenseShortName: { value: 'CC0' },
                  Credit: { value: '<span>NASA/JPL</span>' },
                },
              },
            ],
          },
        ],
      },
    };
    expect(readLicence('File:X.jpg', credited)?.artist).toBe('NASA/JPL');
  });

  it('returns null when there is no licence to report', () => {
    expect(readLicence('File:NoMeta.jpg', response)).toBeNull();
    expect(readLicence('File:Gone.jpg', response)).toBeNull();
    expect(readLicence('File:Never.jpg', response)).toBeNull();
  });
});

describe('extensionFor', () => {
  it('prefers the content type', () => {
    expect(extensionFor('image/png; charset=binary', 'https://x/y.jpg')).toBe('.png');
  });

  it('falls back to the URL', () => {
    expect(extensionFor(null, 'https://x/900px-y.JPEG?width=900')).toBe('.jpg');
    expect(extensionFor('application/octet-stream', 'https://x/y.webp')).toBe('.webp');
  });

  it('defaults to .jpg when nothing says otherwise', () => {
    expect(extensionFor(null, 'https://x/y')).toBe('.jpg');
  });
});

describe('toFileTitle', () => {
  it('normalises a pageimage name into a Commons title', () => {
    expect(toFileTitle('Killerwhales_jumping.jpg')).toBe('File:Killerwhales jumping.jpg');
    expect(toFileTitle('File:Already prefixed.png')).toBe('File:Already prefixed.png');
  });
});

describe('chunk', () => {
  it('splits into batches and keeps the remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });

  it('refuses a nonsense size', () => {
    expect(() => chunk([1], 0)).toThrow();
  });
});

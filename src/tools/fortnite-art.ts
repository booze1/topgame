/**
 * Draws the Fortnite deck's weapon art.
 *
 *   npm run fortnite-art
 *
 * Every other deck gets photographs from Wikimedia Commons. This one cannot:
 * there is no freely licensed picture of a Fortnite weapon anywhere, because
 * every screenshot and every asset belongs to Epic Games. So the weapons are
 * drawn here instead, from primitives, and the results are committed to
 * public/cards/fortnite/ as ordinary card art.
 *
 * Each weapon is a list of parts in a 320x180 frame with the muzzle pointing
 * right, over a background in its rarity colour. Regenerating is deterministic:
 * the same source produces byte-identical files, so a change to the drawing is
 * a reviewable diff rather than 30 replaced binaries.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'cards', 'fortnite');

/** Fortnite's rarity colours, which is what the card's background says. */
const RARITY = {
  common: ['#6b7280', '#374151'],
  uncommon: ['#3fb950', '#14532d'],
  rare: ['#2f81f7', '#0c2d6b'],
  epic: ['#a371f7', '#3b1a78'],
  legendary: ['#f0883e', '#7c2d12'],
  mythic: ['#ffd400', '#7a5c00'],
  exotic: ['#3ddad7', '#0c4a4a'],
} as const;

type Rarity = keyof typeof RARITY;

// ---------------------------------------------------------------------------
// Parts. Everything is drawn in silhouette: one dark fill for the body, one
// lighter accent for the details that read at card size (optics, magazines,
// muzzle flare). Finer detail than that disappears at 330px wide.
// ---------------------------------------------------------------------------

const BODY = '#12161f';
const TRIM = '#e2e8f0';

type Part = string;

const rect = (x: number, y: number, w: number, h: number, fill = BODY, r = 1): Part =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;

const poly = (points: number[][], fill = BODY): Part =>
  `<polygon points="${points.map(([x, y]) => `${x},${y}`).join(' ')}" fill="${fill}"/>`;

const circle = (cx: number, cy: number, r: number, fill = BODY): Part =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;

const ring = (cx: number, cy: number, r: number, w: number, stroke = BODY): Part =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${stroke}" stroke-width="${w}"/>`;

const line = (x1: number, y1: number, x2: number, y2: number, w: number, stroke = BODY): Part =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${stroke}" stroke-width="${w}" stroke-linecap="round"/>`;

const curve = (d: string, fill = BODY): Part => `<path d="${d}" fill="${fill}"/>`;

/** A barrel running right from `x` for `len`, centred on `y`. */
const barrel = (x: number, y: number, len: number, thickness = 7): Part =>
  rect(x, y - thickness / 2, len, thickness);

/** The blocky middle of a gun. */
const receiver = (x: number, y: number, w: number, h: number): Part => rect(x, y, w, h, BODY, 3);

/** A pistol grip, raked back like every real one. */
const grip = (x: number, y: number, h = 26, rake = 8): Part =>
  poly([
    [x, y],
    [x + 14, y],
    [x + 14 - rake, y + h],
    [x - rake - 1, y + h],
  ]);

/** A box magazine hanging below, optionally curved like an AK's. */
const mag = (x: number, y: number, w: number, h: number, banana = 0): Part =>
  banana === 0
    ? poly([
        [x, y],
        [x + w, y],
        [x + w - 2, y + h],
        [x + 2, y + h],
      ])
    : curve(
        `M ${x} ${y} L ${x + w} ${y} L ${x + w + banana} ${y + h} L ${x + banana - 2} ${y + h + 3} Z`,
      );

/** A shoulder stock. */
const stock = (x: number, y: number, w: number, h: number): Part =>
  poly([
    [x, y],
    [x + w, y - 2],
    [x + w, y + h],
    [x, y + h - 3],
  ]);

/** A skeleton stock: a tube back to a butt plate. */
const tubeStock = (x: number, y: number, w: number): Part =>
  [rect(x, y - 3, w, 6), rect(x - 4, y - 10, 5, 20)].join('');

/** A telescopic sight sitting above the receiver. */
const scope = (x: number, y: number, w: number, h = 10): Part =>
  [
    rect(x, y, w, h, BODY, 2),
    rect(x + w - 5, y - 2, 6, h + 4, BODY, 2),
    rect(x + w - 3, y, 3, h, TRIM, 1),
    rect(x + 4, y + h, 4, 6),
    rect(x + w - 12, y + h, 4, 6),
  ].join('');

/** Iron sights, for the guns that do not carry glass. */
const ironSights = (x1: number, x2: number, y: number): Part =>
  [rect(x1, y - 6, 3, 6), rect(x2, y - 5, 3, 5)].join('');

/** A muzzle brake or flash hider on the end of a barrel. */
const muzzle = (x: number, y: number, w = 16, h = 13): Part => rect(x, y - h / 2, w, h, BODY, 2);

/** A tube magazine under a shotgun barrel. */
const tubeMag = (x: number, y: number, len: number): Part => rect(x, y, len, 6, BODY, 3);

/** The sliding forend of a pump gun. */
const pump = (x: number, y: number, len: number): Part => rect(x, y, len, 11, BODY, 3);

/** A drum magazine, as on the Drum Gun. */
const drum = (cx: number, cy: number, r: number): Part =>
  [circle(cx, cy, r), ring(cx, cy, r - 5, 2, TRIM)].join('');

/** A folding bipod under a barrel. */
const bipod = (x: number, y: number): Part =>
  [line(x, y, x - 9, y + 17, 3), line(x, y, x + 9, y + 17, 3)].join('');

/** The accent flash at the muzzle, so every card reads as "this end is dangerous". */
const spark = (x: number, y: number, colour: string): Part =>
  [
    poly(
      [
        [x, y],
        [x + 18, y - 9],
        [x + 13, y],
        [x + 18, y + 9],
      ],
      colour,
    ),
    circle(x + 2, y, 4, colour),
  ].join('');

// ---------------------------------------------------------------------------
// The weapons. Each is drawn muzzle-right in a 320x180 frame; the muzzle x is
// returned so the accent flash lands in the right place.
// ---------------------------------------------------------------------------

interface Drawing {
  parts: Part[];
  /** Where the projectile leaves, for the accent flash. */
  muzzle: [number, number];
}

const WEAPONS: Record<string, { rarity: Rarity; draw: () => Drawing }> = {
  // --- Assault rifles ------------------------------------------------------
  scar: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        stock(38, 84, 46, 22),
        receiver(80, 80, 90, 26),
        rect(96, 74, 66, 5),
        barrel(170, 92, 78, 8),
        pump(170, 84, 52),
        muzzle(252, 92),
        grip(126, 106, 26, 7),
        mag(152, 106, 20, 30, 4),
        ironSights(104, 232, 74),
      ],
      muzzle: [268, 92],
    }),
  },
  heavyar: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        stock(36, 86, 50, 22),
        receiver(82, 82, 84, 26),
        barrel(166, 94, 88, 8),
        rect(166, 80, 46, 10),
        muzzle(254, 94, 14, 15),
        grip(124, 108, 26, 7),
        mag(148, 108, 22, 34, 12),
        ironSights(100, 236, 78),
      ],
      muzzle: [268, 94],
    }),
  },
  burstar: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        tubeStock(40, 92, 46),
        receiver(84, 82, 82, 26),
        poly([
          [96, 82],
          [156, 82],
          [156, 72],
          [104, 72],
        ]),
        barrel(166, 92, 84, 7),
        rect(166, 84, 40, 12, BODY, 3),
        muzzle(250, 92, 14, 12),
        grip(126, 108, 26, 7),
        mag(150, 108, 20, 30),
        ironSights(232, 100, 78),
      ],
      muzzle: [264, 92],
    }),
  },
  scopedar: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        stock(40, 88, 44, 22),
        receiver(82, 84, 88, 26),
        scope(108, 62, 62),
        barrel(170, 96, 80, 7),
        pump(170, 88, 44),
        muzzle(250, 96, 13, 11),
        grip(128, 110, 26, 7),
        mag(152, 110, 20, 28),
      ],
      muzzle: [263, 96],
    }),
  },

  // --- Shotguns ------------------------------------------------------------
  pumpshotgun: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        stock(34, 82, 56, 26),
        receiver(88, 80, 62, 28),
        barrel(150, 88, 114, 8),
        tubeMag(150, 100, 92),
        pump(184, 96, 46),
        muzzle(258, 88, 12, 14),
        ironSights(96, 250, 80),
      ],
      muzzle: [270, 88],
    }),
  },
  tacticalshotgun: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        tubeStock(42, 94, 44),
        receiver(84, 84, 66, 26),
        barrel(150, 92, 96, 9),
        tubeMag(150, 101, 80),
        pump(184, 99, 38),
        muzzle(240, 92, 12, 14),
        grip(122, 110, 26, 7),
      ],
      muzzle: [252, 92],
    }),
  },
  combatshotgun: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        stock(40, 88, 46, 22),
        receiver(84, 84, 74, 26),
        rect(100, 78, 50, 5),
        barrel(158, 92, 86, 10),
        tubeMag(158, 104, 68),
        muzzle(238, 92, 13, 16),
        grip(126, 110, 26, 7),
      ],
      muzzle: [250, 94],
    }),
  },
  chargeshotgun: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        // Bullpup: the action sits behind the grip, so the gun is short.
        receiver(60, 82, 108, 30),
        rect(76, 74, 74, 6),
        barrel(168, 94, 76, 10),
        muzzle(238, 94, 14, 16),
        grip(112, 112, 26, 7),
        rect(56, 78, 8, 34, BODY, 2),
        rect(150, 66, 14, 10, TRIM, 2),
      ],
      muzzle: [252, 94],
    }),
  },
  leveraction: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        stock(34, 82, 58, 26),
        receiver(90, 82, 54, 26),
        // The finger loop under the action is the whole silhouette.
        ring(114, 124, 15, 6),
        rect(96, 108, 26, 7),
        barrel(144, 88, 116, 9),
        tubeMag(144, 101, 100),
        muzzle(254, 88, 12, 14),
        ironSights(102, 248, 80),
      ],
      muzzle: [266, 88],
    }),
  },
  doublebarrel: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        // Sawn-off: a deep stock, a break-action hinge, and two bores you can
        // count from across the room.
        curve('M 46 128 q -10 -16 4 -32 q 12 -14 30 -14 l 30 0 l 0 30 l -30 4 q -14 2 -14 14 Z'),
        receiver(104, 78, 40, 34),
        circle(122, 112, 5, '#0b0e14'),
        barrel(146, 84, 96, 12),
        barrel(146, 104, 96, 12),
        rect(238, 76, 12, 36, BODY, 3),
        circle(244, 84, 4, '#0b0e14'),
        circle(244, 104, 4, '#0b0e14'),
        ring(126, 104, 9, 4),
      ],
      muzzle: [250, 94],
    }),
  },

  // --- Sniper rifles -------------------------------------------------------
  boltsniper: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        stock(24, 86, 62, 26),
        receiver(84, 84, 74, 26),
        scope(96, 58, 78, 12),
        line(150, 84, 166, 70, 5),
        circle(166, 70, 5),
        barrel(158, 96, 118, 8),
        muzzle(272, 96, 12, 12),
        mag(126, 110, 20, 20),
      ],
      muzzle: [284, 96],
    }),
  },
  heavysniper: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        stock(20, 84, 58, 30),
        receiver(76, 80, 92, 32),
        scope(92, 52, 86, 13),
        barrel(168, 98, 108, 11),
        rect(200, 92, 26, 6),
        muzzle(258, 98, 22, 20),
        mag(130, 112, 26, 24),
        bipod(214, 106),
      ],
      muzzle: [282, 98],
    }),
  },
  huntingrifle: {
    rarity: 'uncommon',
    draw: () => ({
      parts: [
        stock(30, 86, 66, 26),
        receiver(94, 86, 52, 24),
        line(138, 86, 152, 74, 5),
        circle(152, 74, 5),
        barrel(146, 96, 124, 8),
        rect(146, 88, 44, 9, BODY, 3),
        ironSights(160, 258, 88),
      ],
      muzzle: [272, 96],
    }),
  },

  // --- Machine guns --------------------------------------------------------
  minigun: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        rect(46, 74, 66, 44, BODY, 4),
        circle(120, 96, 24),
        // Six barrels, which is the whole point of the silhouette.
        ...[78, 86, 94, 102, 110].map((y) => rect(140, y - 2, 106, 5)),
        rect(140, 74, 10, 44, BODY, 2),
        rect(240, 72, 12, 48, BODY, 3),
        rect(60, 118, 12, 26, BODY, 2),
        rect(96, 118, 12, 26, BODY, 2),
        circle(120, 96, 8, TRIM),
      ],
      muzzle: [256, 96],
    }),
  },
  lmg: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        stock(30, 86, 50, 24),
        receiver(78, 80, 94, 32),
        rect(96, 72, 60, 6),
        barrel(172, 96, 92, 9),
        muzzle(258, 96, 14, 15),
        grip(120, 112, 26, 7),
        rect(146, 112, 44, 30, BODY, 3),
        bipod(214, 104),
      ],
      muzzle: [272, 96],
    }),
  },
  drumgun: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        stock(30, 82, 48, 24),
        receiver(76, 78, 84, 26),
        barrel(160, 90, 90, 8),
        rect(186, 78, 22, 14, BODY, 3),
        muzzle(246, 90, 12, 13),
        grip(100, 104, 24, 6),
        rect(176, 96, 16, 26, BODY, 3),
        drum(146, 116, 24),
        ironSights(92, 236, 76),
      ],
      muzzle: [258, 90],
    }),
  },

  // --- Submachine guns -----------------------------------------------------
  compactsmg: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        // The P90's wedge: a flat top with the magazine lying along it, a
        // sloped nose, and the trigger inside a big cut-out.
        poly([
          [62, 74],
          [186, 74],
          [200, 96],
          [200, 112],
          [150, 112],
          [138, 122],
          [104, 122],
          [92, 112],
          [62, 112],
        ]),
        rect(84, 64, 92, 11, BODY, 2),
        rect(96, 66, 68, 3, TRIM, 1),
        poly([
          [104, 96],
          [140, 96],
          [140, 112],
          [104, 112],
        ], '#0b0e14'),
        rect(120, 96, 6, 12),
        barrel(200, 100, 54, 8),
        muzzle(248, 100, 12, 13),
        rect(56, 78, 8, 32, BODY, 2),
      ],
      muzzle: [260, 100],
    }),
  },
  tacticalsmg: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        tubeStock(48, 92, 40),
        receiver(86, 82, 68, 26),
        barrel(154, 92, 62, 7),
        muzzle(214, 92, 12, 12),
        grip(112, 108, 24, 6),
        mag(136, 108, 18, 32, 8),
        ironSights(94, 200, 78),
      ],
      muzzle: [226, 92],
    }),
  },
  smg: {
    rarity: 'common',
    draw: () => ({
      parts: [
        tubeStock(44, 94, 44),
        receiver(86, 84, 76, 24),
        barrel(162, 94, 58, 7),
        rect(162, 86, 30, 10, BODY, 3),
        muzzle(216, 94, 12, 12),
        grip(114, 108, 24, 6),
        mag(140, 108, 18, 34),
      ],
      muzzle: [228, 94],
    }),
  },

  // --- Pistols -------------------------------------------------------------
  pistol: {
    rarity: 'common',
    draw: () => ({
      parts: [
        rect(112, 76, 92, 22, BODY, 3),
        rect(196, 82, 16, 12, BODY, 2),
        grip(120, 98, 40, 12),
        ring(140, 104, 10, 4),
        ironSights(200, 118, 76),
      ],
      muzzle: [214, 88],
    }),
  },
  suppressedpistol: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        rect(94, 76, 84, 22, BODY, 3),
        rect(176, 80, 76, 16, BODY, 6),
        grip(102, 98, 40, 12),
        ring(122, 104, 10, 4),
        ...[190, 206, 222, 238].map((x) => rect(x, 80, 2, 16, '#0b0e14')),
      ],
      muzzle: [254, 88],
    }),
  },
  handcannon: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        rect(100, 70, 108, 28, BODY, 3),
        poly([
          [208, 70],
          [222, 76],
          [222, 92],
          [208, 98],
        ]),
        rect(112, 96, 78, 8, BODY, 2),
        grip(108, 98, 44, 13),
        ring(132, 106, 11, 5),
        rect(186, 62, 16, 9, BODY, 2),
        ironSights(206, 118, 70),
      ],
      muzzle: [224, 84],
    }),
  },
  revolver: {
    rarity: 'uncommon',
    draw: () => ({
      parts: [
        rect(118, 78, 46, 22, BODY, 3),
        circle(140, 92, 17),
        ring(140, 92, 9, 3, TRIM),
        barrel(164, 84, 62, 12),
        rect(164, 74, 56, 5),
        grip(124, 100, 40, 14),
        ring(148, 106, 10, 4),
        poly([
          [116, 74],
          [126, 70],
          [126, 80],
        ]),
      ],
      muzzle: [228, 84],
    }),
  },
  flintknock: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        // A flintlock: the curved butt and the big external hammer are the tell.
        curve('M 62 128 q -12 -14 2 -30 q 12 -14 30 -14 l 34 0 l 0 26 l -32 4 q -14 2 -14 14 Z'),
        rect(122, 80, 52, 20, BODY, 3),
        curve('M 132 80 q 2 -18 18 -18 q -8 6 -8 18 Z'),
        rect(146, 72, 14, 5),
        barrel(174, 90, 92, 9),
        rect(174, 84, 60, 5),
        muzzle(258, 90, 10, 13),
        ring(140, 104, 9, 4),
      ],
      muzzle: [268, 90],
    }),
  },

  // --- Explosives ----------------------------------------------------------
  rocketlauncher: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        rect(50, 76, 190, 34, BODY, 8),
        poly([
          [50, 76],
          [50, 110],
          [28, 122],
          [28, 64],
        ]),
        rect(240, 80, 26, 26, BODY, 4),
        rect(104, 62, 70, 14, BODY, 3),
        rect(120, 50, 14, 12, BODY, 2),
        grip(112, 110, 28, 8),
        rect(168, 110, 34, 9, BODY, 3),
        rect(196, 84, 6, 18, TRIM, 2),
      ],
      muzzle: [268, 93],
    }),
  },
  grenadelauncher: {
    rarity: 'epic',
    draw: () => ({
      parts: [
        stock(30, 84, 44, 24),
        receiver(72, 78, 40, 34),
        // The revolving cylinder is what makes this read as a grenade launcher.
        circle(128, 95, 30),
        ring(128, 95, 20, 4, TRIM),
        ...[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2;
          return circle(128 + Math.cos(a) * 20, 95 + Math.sin(a) * 20, 6, '#0b0e14');
        }),
        barrel(158, 92, 84, 15),
        muzzle(238, 92, 16, 20),
        grip(104, 116, 26, 7),
        rect(96, 58, 60, 8, BODY, 2),
      ],
      muzzle: [256, 92],
    }),
  },
  guidedmissile: {
    rarity: 'legendary',
    draw: () => ({
      parts: [
        rect(56, 80, 178, 28, BODY, 8),
        poly([
          [56, 80],
          [56, 108],
          [34, 118],
          [34, 70],
        ]),
        // Fins and a camera housing: this one is flown, not just fired.
        poly([
          [204, 80],
          [232, 60],
          [232, 80],
        ]),
        poly([
          [204, 108],
          [232, 128],
          [232, 108],
        ]),
        rect(232, 84, 24, 20, BODY, 3),
        rect(114, 60, 56, 20, BODY, 3),
        rect(126, 66, 20, 9, TRIM, 2),
        grip(112, 108, 28, 8),
      ],
      muzzle: [258, 94],
    }),
  },
  boombow: {
    rarity: 'mythic',
    draw: () => ({
      parts: [
        // Bow limbs, drawn string, and an explosive head on the arrow.
        curve('M 108 34 q 44 26 44 62 q 0 36 -44 62 l -10 -6 q 38 -24 38 -56 q 0 -32 -38 -56 Z'),
        line(102, 40, 102, 152, 3, TRIM),
        line(102, 96, 156, 96, 3, TRIM),
        rect(120, 92, 118, 8),
        poly([
          [238, 84],
          [262, 96],
          [238, 108],
        ]),
        circle(228, 96, 12),
        circle(228, 96, 5, TRIM),
        rect(112, 100, 16, 34, BODY, 3),
      ],
      muzzle: [264, 96],
    }),
  },
  crossbow: {
    rarity: 'rare',
    draw: () => ({
      parts: [
        rect(70, 90, 168, 12, BODY, 3),
        stock(40, 92, 34, 20),
        curve('M 196 46 q 34 22 34 50 q 0 28 -34 50 l -8 -6 q 28 -20 28 -44 q 0 -24 -28 -44 Z'),
        line(190, 52, 190, 140, 3, TRIM),
        line(190, 96, 120, 96, 3, TRIM),
        poly([
          [230, 90],
          [252, 96],
          [230, 102],
        ]),
        grip(102, 102, 30, 9),
        ring(122, 108, 9, 4),
      ],
      muzzle: [254, 96],
    }),
  },

  // --- One of a kind -------------------------------------------------------
  zapotron: {
    rarity: 'exotic',
    draw: () => ({
      parts: [
        stock(26, 88, 52, 26),
        receiver(76, 82, 86, 30),
        // Energy coils instead of a magazine: it was never meant to exist.
        ...[100, 118, 136].map((x) => rect(x, 68, 10, 16, TRIM, 2)),
        ring(122, 97, 13, 4, TRIM),
        barrel(162, 97, 84, 9),
        ...[176, 196, 216].map((x) => rect(x, 86, 5, 22, TRIM, 2)),
        poly([
          [246, 82],
          [272, 97],
          [246, 112],
        ]),
        grip(112, 112, 26, 7),
      ],
      muzzle: [274, 97],
    }),
  },
};

// ---------------------------------------------------------------------------

function svg(id: string, rarity: Rarity, drawing: Drawing): string {
  const [light, dark] = RARITY[rarity];
  const parts = [
    ...drawing.parts,
    spark(drawing.muzzle[0], drawing.muzzle[1], light),
  ].join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 180" width="320" height="180" role="img" aria-label="${id}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${light}"/>
      <stop offset="1" stop-color="${dark}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.28"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="320" height="180" fill="url(#bg)"/>
  <rect width="320" height="180" fill="url(#glow)"/>
  <g opacity="0.14" fill="#000000">
    ${Array.from({ length: 9 }, (_, i) => `<rect x="${i * 36}" y="0" width="18" height="180"/>`).join('\n    ')}
  </g>
  <g>
    ${parts}
  </g>
</svg>
`;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const names = Object.keys(WEAPONS).sort();
  for (const id of names) {
    const weapon = WEAPONS[id]!;
    await writeFile(join(OUT_DIR, `${id}.svg`), svg(id, weapon.rarity, weapon.draw()));
  }
  console.log(`Drew ${names.length} weapons into ${OUT_DIR}`);
}

main().catch((error) => {
  console.error('fortnite-art failed:', error);
  process.exitCode = 1;
});

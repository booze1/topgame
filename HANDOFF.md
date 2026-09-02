# Handoff

Context for picking this project up in a fresh session. `README.md` covers how
the thing works; this file covers **what state it is in, what was already
decided, and what will waste your time if you rediscover it the hard way.**

---

## Status

A two-player Top Trumps card game, complete and working. Deployed on Render by
the repo owner.

- **Repo**: `booze1/topgame` — public
- **Branch**: `claude/top-trumps-card-game-8y1dyr` (this is GitHub's default
  branch; there is no `main`)
- **Eight decks, 240 cards.** The original four (animals, dinosaurs, space,
  supercars) plus four added since: **Fortnite Guns**, **Footballers**,
  **Alcohol**, **Ski Resorts**
- 139 tests, typecheck clean, end-to-end smoke test passing. One test is
  flaky — see "The flaky test" below; it is not new and not a product bug
- 236 of 240 cards have a picture. All four new decks are complete; the four
  gaps are the same dinosaur cards as before

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 139 tests
npm run build && npm run smoke   # drives two real browsers through a full match
```

---

## Decisions already made — do not relitigate these

These came from an explicit interview with the owner. Changing them needs their
say-so, not yours.

| Decision | Choice |
| --- | --- |
| Multiplayer | Authoritative Node + WebSocket server, four-letter room codes |
| Rules | Classic: winner picks next, draws build a pot, take every card to win |
| Stalemate breaker | 80-round cap, larger hand wins |
| Decks | Data-driven JSON, 30 cards and 6 stats each. Every deck keeps that shape |
| Fortnite art | **Drawn, not photographed** — no free image of a Fortnite weapon exists |
| Alcohol "age" | Year the **brand, brewery or distillery** was founded, oldest wins. Not the bottle's age statement |
| Footballers | **All eras**, not just the modern game, accepting that pre-1990 photos are scarcer |
| Client | React + TypeScript + Vite, hand-written CSS (no framework) |
| Deploy | One Node process serving client + API + websocket |
| Dinosaur art | **Palaeoart life restorations**, not skeletons |
| Testing | Unit tests + mobile-first/accessibility. CI and multiplayer integration tests were **explicitly declined** — don't add them uninvited |
| Photos | Fetched from Wikipedia/Commons, free licences only, committed to the repo |

---

## The four newer decks

| Deck | Pictures | Worth knowing |
| --- | --- | --- |
| `fortnite` | 30 drawn SVGs | Ranged weapons only. The Minigun's magazine and reload are genuinely `0` — it has neither |
| `footballers` | 30 photos | Eight cards carry `focus: "top"`; without it the 16:9 crop takes the head off |
| `alcohol` | 30 photos | `founded` is `higherWins: false` and `grouped: false`, so 1759 sorts oldest-wins and renders without a comma |
| `skiresorts` | 30 photos | Ski area and lift counts are for the **connected** domain, so no two cards share one (only Val Thorens for the Three Valleys, and so on) |

**Fortnite art is drawn, and that was a deliberate decision.** Every image of a
Fortnite weapon belongs to Epic Games, so there is nothing the fetcher may
legally bring back. `npm run fortnite-art` composes each weapon from labelled
parts (barrel, receiver, magazine, scope) over its rarity colour and writes
`public/cards/fortnite/*.svg`. It is deterministic — regenerate and you get
byte-identical files, so a change to the drawing is a readable diff. To change a
weapon, edit its entry in `src/tools/fortnite-art.ts` and re-run.

A card points at drawn art with `"localArt": "scar.svg"`. That file must sit in
`public/cards/<deck>/`, it beats anything in the photo manifest, `fetch-images`
skips it entirely, and it carries no photo credit because nobody photographed
it. The contact sheet shows it badged **drawn**.

## Things that will cost you an hour if you don't know them

**Photos are committed on purpose.** `public/cards/` is in the repo and must
stay there. I originally gitignored it, which broke the Render deployment —
Render only runs `npm ci && npm run build` and never fetches anything, so every
card fell back to generated art. Do not "tidy" them back out.

**Node's built-in `fetch` ignores `HTTPS_PROXY`.** curl honours it, undici does
not. Behind a proxy every request silently leaves the wrong way and returns a
403 that looks exactly like Wikipedia refusing you. `src/tools/fetch-images.ts`
installs a proxy dispatcher; any new outbound code needs the same.

**Wikimedia rate-limits bulk fetching hard**, especially from a shared cloud IP.
Both the API calls and the downloads back off and retry. If a run reports
failures, just run it again — anything on disk is skipped, so each pass only
picks up stragglers.

**In a cloud session, Wikimedia must be allowlisted** on the environment's
network policy (`en.wikipedia.org`, `commons.wikimedia.org`,
`upload.wikimedia.org` — the last one serves the image bytes and is easy to
miss). It is already allowlisted on the owner's `TopGame` environment. Without
it, `npm run fetch-images` fails at the first request.

**GitHub Pages cannot host this.** It needs a long-lived process for the
websocket. Pages, and Vercel/Netlify serverless functions, will give you a lobby
that loads and then can't reach the server.

**The contact sheet is the verification instrument.** `npm run fetch-images`
writes `public/cards/contact-sheet.html`: every card at the exact crop the game
uses. A fetch can only tell you it got *an* image — it cannot tell you the photo
is the wrong subject. Open it and look. That is how the dinosaur deck was caught
coming back as 30 skeletons.

**The smoke test needs a build first** (`npm run build && npm run smoke`). It
sets `REVEAL_MS=400` so a 30-card match takes seconds instead of minutes; the
client scales its reveal animation to whatever window the server advertises.

---

**Half the ski photos came back as summer.** Wikipedia's lead image for an
alpine village is very often a green valley in July, which is no use on a deck
called Ski Resorts. Fourteen of the thirty are pinned to a winter file found by
searching the resort's **Commons category** rather than by keyword — category
listing is far more reliable for this, since filenames like
`Laax Winter.JPG` say what keyword search cannot. Three are still summer
(Sölden, Mayrhofen, Megève have no good winter file on Commons); they are the
right resorts, so they were left.

**Brand articles usually have no lead image**, because their infobox logo is
non-free and therefore not in `pageimages`. Nine alcohol cards hit this and are
pinned by hand. Worse, several that *did* resolve came back as the distillery
buildings or the visitor centre car park rather than the drink — the contact
sheet is the only reason that was caught.

## The flaky test

`src/server/rooms.test.ts` → "never sends the opponent card while a player is
choosing" fails roughly one run in three. **It predates the new decks** — it
fails at the same rate on commit `13c454b` — and it is a bug in the test, not a
leak in the server.

The test scans *every* message the host has ever received for the guest's card
id. But the host is dealt a card in the lobby, before `start` reshuffles, so
their own earlier card is in that history; when the reshuffle happens to hand
that same card to the guest, the assertion matches the host's own card and
fails. Scoping the scan to messages sent after the match starts would fix it.
Left alone deliberately: it is the owner's information-hiding guard and not
what this session was asked to touch.

## Outstanding work

**Four dinosaur cards have no photo** — `deinonychus`, `triceratops`,
`baryonyx`, `styracosaurus`. They are pinned correctly (`File:Deinonychus BW.jpg`
and so on) but were rate-limited on the final pass, so they fall back to
generated art. Fix:

```bash
npm run fetch-images          # picks up only the missing four
# then shrink before committing — see "Photo sizes" below
git add public/cards && git commit
```

**Eris uses an artist's impression**, not a photograph — it has never been
resolved as a disc and its real image is a bare point of light that looked
broken on a card. Flagged to the owner; they may want the honest dot instead.
`decks/space.json`, card `eris`.

**Photo sizes.** The fetcher saves what Commons returns, which is wasteful for a
card rendering ~330px wide. Anything newly fetched needs shrinking before it is
committed. This is still a manual Pillow step — folding it into `fetch-images`
remains the worthwhile improvement. What the new decks were shrunk with:

```python
# cap the longest edge at 900, flatten transparency, save JPEG q=82
im = Image.open(path)
if im.mode in ('RGBA', 'LA', 'P'):
    im = im.convert('RGBA')
    # a light logo needs a dark ground and vice versa - pick by mean luminance
    ground = (0, 0, 0) if mean_luminance(im) < 110 else (255, 255, 255)
    flat = Image.new('RGB', im.size, ground); flat.paste(im, mask=im.split()[3]); im = flat
im.thumbnail((900, 900), Image.LANCZOS)
im.save(out, 'JPEG', quality=82, optimize=True, progressive=True)
```

**If that changes a `.png` to a `.jpg`, rewrite `attributions.json` too** — the
manifest records the path, and the deck loader refuses one that does not point
at a real file. Three cards needed this (`aperol`, `domperignon`, `stanton`).

**Three ski cards are still summer photographs** — `solden`, `mayrhofen`,
`megeve`. The right resorts, the wrong season; Commons has no better free file
that was findable. Fixable by pinning a `commonsFile` if one ever appears.

**Ideas not started**: an in-app deck editor, spectators, a Pages-hosted client
talking to a remote server (needs a configurable server origin plus CORS on
`/api/decks`).

---

## Map of the code

```
decks/*.json          the eight decks; add a file, get a deck (validated at boot)
src/shared/rules.ts   the whole rule set as pure functions — start here
src/shared/types.ts   types shared by client and server, including the wire protocol
src/server/rooms.ts   rooms, seats, reconnection, the reveal clock, the computer player
src/server/decks.ts   deck loading, validation, photo manifest handling
src/server/index.ts   one process: static files, /api, websocket
src/client/           React app; components/Table.tsx is the game screen
src/tools/            the photo fetcher, the contact sheet, the Fortnite weapon art
scripts/smoke.mjs     two real browsers, a full match, screenshots
```

**The server is authoritative.** Each client gets a view built for its seat; the
opponent's card is genuinely absent from the payload before the reveal, and
`src/server/rooms.test.ts` asserts it appears nowhere in the whole transcript.
Keep it that way.

**Rules are pure functions** — no clock, no socket, no globals. That is why the
pot chains and the awkward endings (a draw that empties a hand, a pot stranded
on the last card) are actually tested.

---

## How to verify a change

```bash
npm run typecheck && npm test          # fast
npm run build && npm run smoke         # real browsers, full match, both modes
npm run smoke -- --shots               # writes screenshots/ for a visual check
```

For anything touching card appearance, look at the screenshots. Two real bugs in
this project were found only by looking: the dinosaur deck being skeletons, and
a card with no photo rendering as an empty pale rectangle.

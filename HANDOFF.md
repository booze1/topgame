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
- **Last commit**: `9d3710b` Commit the card photographs so deployed instances have them
- 131 tests passing, typecheck clean, end-to-end smoke test passing
- 116 of 120 cards have real photographs

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # 131 tests
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
| Decks | Data-driven JSON, four decks of 30 cards, 6 stats each |
| Client | React + TypeScript + Vite, hand-written CSS (no framework) |
| Deploy | One Node process serving client + API + websocket |
| Dinosaur art | **Palaeoart life restorations**, not skeletons |
| Testing | Unit tests + mobile-first/accessibility. CI and multiplayer integration tests were **explicitly declined** — don't add them uninvited |
| Photos | Fetched from Wikipedia/Commons, free licences only, committed to the repo |

---

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
card rendering ~330px wide (one PNG was 3 MB). The committed set was downscaled
to 900px and converted to JPEG, with transparent images flattened onto the
colour their card shows behind them. Anything newly fetched should get the same
treatment before committing. This is currently a manual step using Pillow — a
worthwhile improvement would be folding it into `fetch-images` itself.

**Ideas not started**: an in-app deck editor, more decks, spectators, a
Pages-hosted client talking to a remote server (needs a configurable server
origin plus CORS on `/api/decks`).

---

## Map of the code

```
decks/*.json          the four decks; add a file, get a deck (validated at boot)
src/shared/rules.ts   the whole rule set as pure functions — start here
src/shared/types.ts   types shared by client and server, including the wire protocol
src/server/rooms.ts   rooms, seats, reconnection, the reveal clock, the computer player
src/server/decks.ts   deck loading, validation, photo manifest handling
src/server/index.ts   one process: static files, /api, websocket
src/client/           React app; components/Table.tsx is the game screen
src/tools/            the photo fetcher and the contact sheet generator
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

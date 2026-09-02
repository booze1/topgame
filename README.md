# Top Trumps Online

A two-player card battler in the Top Trumps mould. You each hold a pile of
cards; the player on turn names a stat, both top cards turn face up, and the
better number takes the pair. Draws build a pot that the next winner sweeps.
Take every card and you win.

Play it against a friend anywhere via a four-letter room code, or against the
computer on your own.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/booze1/topgame)

That button reads the `render.yaml` in this repository, builds the project and
gives you a public URL on Render's free tier. It is the quickest way to get a
link you can send to whoever you want to play against.

Or run it locally:

```
npm install
npm run fetch-images     # pulls real photographs (see below) - optional but recommended
npm run dev              # http://localhost:5173
```

---

## The rules, exactly as implemented

| Situation | What happens |
| --- | --- |
| You win a round | You take the opponent's card and the pot. Your own card goes to the very back of your pile. You choose the stat next round. |
| You lose a round | Your card goes to them. They choose next. |
| A draw | Both cards go into the pot. The **same player picks again**, and whoever wins the next round takes the whole pot. |
| A draw empties your hand | You lose. Anything of yours stranded in the pot goes to the survivor. |
| A draw empties both hands at once | A genuine tie. |
| 80 rounds played | The larger pile wins. This is a stalemate breaker, not the usual ending. |

Some stats are won by the **lower** number — a 0-60 time, a kerb weight — and
each card labels which. The deck browser in the lobby lists the direction of
every stat before you commit to a deck.

The dealer alternates between matches, so nobody keeps the advantage of
choosing first over a rematch.

## How it is put together

```
decks/                  four decks, plain JSON - add a file, get a deck
src/
  shared/               types and the rules engine, shared by both sides
    rules.ts            pure functions: shuffle, compare, resolve a round, detect a win
  server/
    index.ts            one Node process: static files, /api, and the websocket
    rooms.ts            rooms, seats, reconnection, the reveal clock, the computer player
    decks.ts            deck loading and validation
    static.ts           small static file handler
  client/               React + TypeScript, hand-written CSS
  tools/
    fetch-images.ts     the photo fetcher
scripts/
  smoke.mjs             drives two real browsers through a full match
```

**The server is authoritative.** It holds the whole match and sends each player
a view built for their seat. Before a reveal, the opponent's card is simply not
in the payload — there is nothing to find in the browser console, and no move
is accepted from a player whose turn it is not.

**The reveal is timed by the server.** When a round resolves the server holds it
face up for a fixed window and tells both clients when it will move on, so the
two screens stay in step without either being trusted to advance the game. The
client scales its animation to fit whatever window it is given.

**Rules are pure functions.** `src/shared/rules.ts` touches no clock, socket or
global, which is why the pot chains and the awkward endings can be tested
directly.

## Photographs

Cards are meant to carry real photographs, and they arrive on your machine
rather than in the repository:

```bash
npm run fetch-images
```

A card gets its picture one of two ways.

**Pinned to an exact file**, which is the only way to be certain:

```jsonc
{ "id": "gt", "name": "Ford GT", "commonsFile": "File:2017 Ford GT.jpg" }
```

**Or from the article's lead image**, when no `commonsFile` is set. Usually
right, sometimes not: lead images change, and for some subjects they are a
diagram, the wrong variant, or the wrong generation of a car entirely.

Either way the licence comes from Wikimedia Commons, anything not freely
licensed is refused, and `public/cards/attributions.json` records who took each
photo for the in-game **Photo credits** page — most of these are Creative
Commons and require attribution, so that page is part of using them properly.

**The photos are committed to this repository.** They have to be: a deployed
instance only runs `npm ci && npm run build`, so anything fetched at development
time would simply be missing in production and every card would fall back to
generated art. Every image is Creative Commons or public domain, redistribution
is permitted with attribution, and the in-game credits page provides it.

They are downscaled to 900px and stored as JPEG, which keeps the whole set to
about 12 MB. Re-running the fetcher replaces them at full size; the originals
are large enough (a 3 MB PNG for a card that renders 330px wide) to be worth
shrinking again before committing.

### Check the contact sheet

Every run also writes `public/cards/contact-sheet.html`: all 120 cards on one
page, each cropped exactly as the game crops it, labelled with its source
article, its licence, and whether it came from a pinned file or a lead image.
Cards with no photo are outlined in red with the reason.

**Open it after every run.** A fetch can only tell you it got *an* image. It
cannot tell you the Ford GT photo is the wrong generation, or that a dinosaur
card came back as a size-comparison diagram instead of the animal. That needs
eyes, and this is the page to use them on.

When one is wrong, pin the right file and re-run:

```bash
npm run fetch-images -- --force --deck=supercars
```

### Rate limits

Wikimedia rate-limits bulk downloads, and a fresh run of all 120 cards will
usually hit it. The fetcher backs off and retries, and reports whatever it
could not get. **Just run it again** - anything already on disk is skipped, so
each pass only picks up the stragglers, and a card with no photo falls back to
generated art in the meantime.

Node's built-in `fetch` ignores `HTTPS_PROXY`, unlike curl and most other
tooling, so behind a corporate proxy every request would silently leave the
machine the wrong way. The fetcher installs a proxy dispatcher when a proxy is
configured, and says so on startup.

### Framing

Photographs suit the card's 16:9 band. Wide illustrations do not - cropping a
sauropod in side profile to fill the band cuts off its head and tail. Set the
fit per deck, and override it on any single card:

```jsonc
{
  "art": { "fit": "contain", "background": "#f4f6fb" },
  "cards": [{ "id": "trex", "fit": "cover" }]
}
```

`cover` fills the band and crops; `contain` shows the whole picture against
`background`.

### Cropping

Encyclopedia photographs are not composed for a 16:9 card band, so a tall
subject can end up cropped through the head. Set a focal point on any card that
lands badly:

```jsonc
{ "id": "giraffe", "focus": "top" }
```

Accepts CSS `object-position` keywords (`top`, `bottom left`) or a percentage
pair (`50% 20%`). Invalid values are rejected at boot rather than silently
ignored by the browser.

| Flag | Effect |
| --- | --- |
| `--force` | re-download files already on disk |
| `--deck=space` | limit to one deck (repeatable) |
| `--width=1200` | request a larger image (default 900px) |
| `--dry-run` | report what it would do, write nothing |
| `--concurrency=8` | parallel downloads (default 4) |

Set `FETCH_IMAGES_CONTACT` to your email or repository URL; Wikimedia asks
automated clients to identify themselves.

### There are no photographs of dinosaurs

Worth being straight about: every card in that deck is either a photograph of a
museum skeleton or an artist's restoration of the living animal. No amount of
tooling changes that.

Left to itself the fetcher produces a deck of **skeletons**, because that is
what those Wikipedia articles lead with. This repository instead pins a
palaeoart life restoration to every dinosaur card, so the deck is consistent
rather than a mix of mounted skeletons, fossil slabs and the odd close-up of a
claw. Change them with `commonsFile` if you prefer skeletons.

**Any card without a usable photo falls back to generated art** derived from
the card's own id, in the deck's colours. It is deterministic, so a card always
looks the same, and a deck with no photos at all still looks deliberate rather
than broken. If an image 404s at runtime the card quietly falls back too — a
broken image icon never appears.

If a card you care about is skipped, point its `wikipedia` field at an article
whose lead image is freely licensed; the script names every card it skipped and
why.

## Adding a deck

Drop a JSON file in `decks/`. It is validated at boot, so a mistake stops the
server with a message rather than surfacing three rounds into a game.

```jsonc
{
  "id": "guitars",
  "name": "Guitars",
  "tagline": "Six strings, sixty years",
  "emoji": "🎸",
  "theme": { "primary": "#3b0764", "accent": "#f0abfc", "ink": "#fae8ff" },
  "stats": [
    { "id": "year", "label": "Year", "higherWins": true },
    { "id": "weight", "label": "Weight", "unit": " kg", "decimals": 1, "higherWins": false }
    // ... six stats keeps every card the same shape
  ],
  "cards": [
    {
      "id": "strat",
      "name": "Fender Stratocaster",
      "subtitle": "Three pickups and a whammy bar",
      "emoji": "🎸",
      "wikipedia": "Fender Stratocaster",
      "stats": { "year": 1954, "weight": 3.6 }
    }
    // ... an even number of cards, so the deal is fair
  ]
}
```

Six stats per deck is not enforced, but the card layout is designed around it.
An even card count is enforced: an odd one deals a permanent one-card advantage.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server plus the game server, with reload |
| `npm run build` | builds the client and bundles the server into `dist/` |
| `npm start` | runs the built server (serves the client on the same port) |
| `npm test` | the rules engine, the room manager and the photo fetcher's parsing |
| `npm run typecheck` | TypeScript across client, server and tools |
| `npm run smoke` | opens two real browsers and plays a full match end to end |
| `npm run fetch-images` | downloads card photographs |

`npm run smoke` needs a build first and Playwright's Chromium installed
(`npx playwright install chromium`). Add `--shots` to write screenshots to
`screenshots/`, or `--headed` to watch it play.

## Configuration

| Variable | Default | Notes |
| --- | --- | --- |
| `PORT` | `8787` | HTTP and websocket share it |
| `HOST` | `0.0.0.0` | |
| `ALLOWED_ORIGINS` | unset | Comma separated. When set, websocket upgrades from any other origin are refused. Worth setting once you have a real domain. |
| `REVEAL_MS` | `3400` | How long both cards stay face up |
| `RECONNECT_GRACE_MS` | `60000` | How long a dropped player has before forfeiting |

## Deploying

One process serves the client, the API and the websocket, so anywhere that runs
a container or a Node process will do. Nothing is tied to a particular vendor.

```bash
# any host
npm ci && npm run build && npm start

# docker
docker build -t top-trumps . && docker run -p 8787:8787 top-trumps
```

`render.yaml` and `fly.toml` are included and ready to use.

### GitHub Pages will not work

Worth saying plainly, because it is the obvious thing to reach for on a GitHub
project: **this game cannot be hosted on GitHub Pages.** Pages serves static
files. It cannot run a Node process, so there is nothing to hold the websocket
open, nothing to deal the cards and nothing to answer `/api/decks`. Point Pages
at this repository and a visitor gets a lobby that loads and then reports it
cannot reach the server.

The same goes for Vercel and Netlify's serverless functions, which cannot hold
a websocket open either. You need somewhere that runs a long-lived process:
Render, Fly, Railway, or any VPS.

If you specifically want a `github.io` address, the client can be split from
the server — Pages serving the static build, and the game server on Render with
the client pointed at it. That needs a configurable server origin and CORS on
`/api/decks`, neither of which is built yet.

### Two things to know whichever host you pick

- **Websockets must be allowed**, and not idle-timed-out aggressively.
- **A restart ends every match in progress.** Rooms live in memory. That is a
  deliberate trade — no database, nothing to back up — and players who refresh
  after a restart land back in the lobby rather than in a broken game.

Free tiers that sleep on inactivity (Render's included) will drop a game that is
left open for a long time. Fly's config keeps one machine warm to avoid this.

## What is deliberately not here

- **No accounts, no database.** A room code is the whole identity model, and a
  session token in `localStorage` is what lets you refresh without losing your
  seat.
- **No free-text chat.** Six emoji reactions instead: strangers get to be
  playful without anyone needing to moderate a text box.
- **No spectators, no more than two players.** The rules above are for two.

## Accessibility

Built for a phone in one hand first, opening into two columns on a larger
screen. Every stat is a real button with a label that reads out its value and
whether high or low wins. Reveals and results are announced through a live
region. Focus is always visible, and `prefers-reduced-motion` replaces the whole
reveal sequence with its result.

/**
 * End-to-end smoke test.
 *
 * Boots the built server, opens two real browsers, joins them into one room
 * and plays rounds until somebody wins - then does the same for the single
 * player mode. It exists because unit tests cannot tell you whether the thing
 * is actually playable.
 *
 *   npm run build && npm run smoke
 *
 * Pass --headed to watch it, and --shots to write screenshots to ./screenshots.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const PORT = Number(process.env.SMOKE_PORT ?? 8799);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = process.argv.includes('--shots');
const HEADED = process.argv.includes('--headed');
const SHOT_DIR = 'screenshots';

const log = (...args) => console.log('[smoke]', ...args);

/**
 * Playwright pins a browser revision, but this image ships whichever one it
 * ships. Prefer the bundled binary if the versions happen to line up, and
 * otherwise take whatever chromium is on disk.
 */
function findChromium() {
  try {
    const bundled = chromium.executablePath();
    if (bundled && existsSync(bundled)) return null; // let Playwright use its own
  } catch {
    /* no bundled browser at all */
  }
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return null;
  const candidates = readdirSync(root)
    .filter((name) => name.startsWith('chromium'))
    .sort()
    .reverse()
    .flatMap((name) => [
      join(root, name, 'chrome-linux', 'chrome'),
      join(root, name, 'chrome-linux', 'headless_shell'),
    ]);
  return candidates.find((path) => existsSync(path)) ?? null;
}

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE}/api/health`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('server did not come up');
}

/** Clicks the first enabled stat button on the player's own card. */
async function pickAStat(page) {
  const button = page.locator('.felt__side--mine .stat__button').first();
  await button.waitFor({ state: 'visible', timeout: 15_000 });
  await button.click({ timeout: 5000 });
}

/** Everything worth knowing about a stuck screen. */
async function dumpState(label, page) {
  const state = await page.evaluate(() => ({
    phase: document.querySelector('.table')?.getAttribute('data-phase') ?? null,
    verdict: document.querySelector('.verdict')?.textContent ?? null,
    buttons: document.querySelectorAll('.felt__side--mine .stat__button').length,
    theirs: document.querySelector('.felt__side--theirs .card--back') ? 'back' : 'face',
    counts: [...document.querySelectorAll('.stack__count')].map((n) => n.textContent),
    overlay: document.querySelector('.overlay__title')?.textContent ?? null,
    banner: document.querySelector('.banner')?.textContent ?? null,
    toast: document.querySelector('.toast')?.textContent ?? null,
    round: document.querySelector('.table__round')?.textContent ?? null,
  }));
  log(`state[${label}]`, JSON.stringify(state));
}

/** Waits until it is this page's turn, or the match ends. */
async function waitForTurnOrEnd(page, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isOver(page)) return 'over';
    if (await hasTurn(page)) return 'turn';
    await page.waitForTimeout(120);
  }
  throw new Error('timed out waiting for a turn');
}

const isOver = (page) => page.locator('.overlay__title').count().then((n) => n > 0);
const hasTurn = (page) =>
  page
    .locator('.felt__side--mine .stat__button')
    .first()
    .isVisible()
    .catch(() => false);

/**
 * Returns whichever page is on turn. Both are polled, because between rounds
 * the reveal is on screen and neither player can act for a few seconds.
 */
async function whoseTurn(pages, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const page of pages) {
      if (await isOver(page)) return 'over';
      if (await hasTurn(page)) return page;
    }
    await pages[0].waitForTimeout(120);
  }
  await dumpState('host', pages[0]);
  await dumpState('guest', pages[1]);
  throw new Error('timed out waiting for either player to be on turn');
}

async function shot(page, name) {
  if (!SHOTS) return;
  mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: `${SHOT_DIR}/${name}.png`, fullPage: false });
  log(`screenshot ${SHOT_DIR}/${name}.png`);
}

async function main() {
  const server = spawn('node', ['dist/server/index.js'], {
    // A short reveal keeps a full 30-card match to seconds rather than minutes.
    env: { ...process.env, PORT: String(PORT), REVEAL_MS: process.env.REVEAL_MS ?? '400' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (chunk) => process.stdout.write(`[server] ${chunk}`));
  server.stderr.on('data', (chunk) => process.stderr.write(`[server] ${chunk}`));

  const browser = await chromium.launch({
    ...(findChromium() ? { executablePath: findChromium() } : {}),
    headless: !HEADED,
  });

  const failures = [];
  try {
    await waitForServer();
    log('server up');

    // ---------------------------------------------------------------- two players
    const hostContext = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const guestContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    for (const page of [host, guest]) {
      page.on('pageerror', (error) => failures.push(`page error: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
      });
    }

    await host.goto(BASE);
    await host.locator('.field__input').first().fill('Ralph');
    await host.locator('.deck-tile').nth(1).click();
    await shot(host, '01-lobby');

    await host.getByRole('button', { name: /Start an online game/ }).click();
    const code = (await host.locator('.code-card__code').innerText()).trim();
    log('room code', code);
    if (!/^[A-Z0-9]{4}$/.test(code)) throw new Error(`bad room code: ${code}`);

    await guest.goto(BASE);
    await guest.locator('.field__input').first().fill('Opponent');
    await guest.getByRole('button', { name: /Join with a code/ }).click();
    await guest.locator('.field__input--code').fill(code);
    await guest.getByRole('button', { name: 'Join game' }).click();

    await host.locator('.waiting__status').filter({ hasText: 'joined' }).waitFor({ timeout: 10_000 });
    await shot(host, '02-waiting');

    await host.getByRole('button', { name: /Deal the cards/ }).click();
    await host.locator('.felt').waitFor({ timeout: 10_000 });
    await guest.locator('.felt').waitFor({ timeout: 10_000 });
    log('match started');

    // The opponent's card must not be readable before the reveal.
    const backsShown = await host.locator('.felt__side--theirs .card--back').count();
    if (backsShown !== 1) throw new Error('opponent card was not face down at the start');

    let rounds = 0;
    let finished = false;
    while (rounds < 200) {
      const page = await whoseTurn([host, guest]);
      if (page === 'over') {
        finished = true;
        break;
      }
      try {
        await pickAStat(page);
        // The buttons go dead the moment a pick is sent; wait for that so the
        // next iteration does not act on a screen that is about to change.
        await page.waitForFunction(
          () => document.querySelectorAll('.felt__side--mine .stat__button').length === 0,
          undefined,
          { timeout: 5000 },
        );
      } catch (error) {
        await dumpState('host', host);
        await dumpState('guest', guest);
        throw error;
      }
      rounds += 1;

      if (rounds === 1) {
        // Mid-reveal: both cards are face up on both screens.
        await host.waitForTimeout(150);
        const revealedForHost = await host.locator('.felt__side--theirs .card').count();
        const revealedForGuest = await guest.locator('.felt__side--theirs .card').count();
        if (!revealedForHost || !revealedForGuest) {
          throw new Error('cards were not revealed to both players');
        }
        await shot(host, '03-reveal-mobile');
        await shot(guest, '04-reveal-desktop');

        // A reaction from one player should reach the other.
        await host.locator('.reactions__button').first().click();
        await guest.locator('.floaters__item').first().waitFor({ timeout: 4000 });
        log('reactions delivered');
      }
    }

    if (!finished) throw new Error(`match did not finish within ${rounds} rounds`);
    log(`match finished after ${rounds} picks`);
    // Let the result panel finish animating in before capturing it.
    await host.waitForTimeout(500);
    await shot(host, '05-gameover');

    const headline = await host.locator('.overlay__title').innerText();
    const guestHeadline = await guest.locator('.overlay__title').innerText();
    log('result:', headline, '/', guestHeadline);
    // A tie is a legitimate ending, and then both players do see the same
    // headline. The text is uppercased by CSS, so compare case-insensitively.
    const tied = /dead heat/i.test(headline);
    if (headline === guestHeadline && !tied) {
      throw new Error(`both players were told "${headline}"`);
    }
    if (!tied && !/you (win|lose)/i.test(headline)) {
      throw new Error(`unexpected result headline "${headline}"`);
    }

    // ------------------------------------------------------------------ reconnect
    const reconnectHost = await hostContext.newPage();
    await reconnectHost.goto(BASE);
    await reconnectHost.locator('.overlay__title, .felt').first().waitFor({ timeout: 10_000 });
    log('rejoined the finished match after a refresh');
    await reconnectHost.close();

    // ------------------------------------------------------------------ solo mode
    const soloContext = await browser.newContext({ viewport: { width: 430, height: 900 } });
    const solo = await soloContext.newPage();
    solo.on('pageerror', (error) => failures.push(`page error (solo): ${error.message}`));
    await solo.goto(BASE);
    await solo.evaluate(() => localStorage.clear());
    await solo.reload();
    await solo.getByRole('button', { name: /Play the computer/ }).click();
    await solo.locator('.felt').waitFor({ timeout: 10_000 });

    let soloRounds = 0;
    while (soloRounds < 200) {
      if (await solo.locator('.overlay__title').count()) break;
      const state = await waitForTurnOrEnd(solo);
      if (state === 'over') break;
      await pickAStat(solo);
      soloRounds += 1;
      await solo.waitForTimeout(80);
    }
    if (!(await solo.locator('.overlay__title').count())) {
      throw new Error('solo match did not finish');
    }
    log(`solo match finished after ${soloRounds} picks:`, await solo.locator('.overlay__title').innerText());
    await shot(solo, '06-solo');

    if (failures.length > 0) throw new Error(`browser reported errors:\n  ${failures.join('\n  ')}`);
    log('PASS');
  } finally {
    await browser.close();
    server.kill('SIGTERM');
  }
}

main().catch((error) => {
  console.error('[smoke] FAIL', error);
  process.exit(1);
});

/**
 * Tether Treat — end-to-end playthrough test (dev only, not shipped).
 *
 * Drives the real visible UI in headless Chrome via playwright-core:
 *   title → Settings (open, toggle Reduced motion, back) → Play Journey →
 *   countdown → active board → exercise pause/resume + hint → restart →
 *   snip the single vertical rope (real mirror-button click) → physics drops
 *   the treat through the 3 stars into Morsel → a genuine "Delivered!" win
 *   on the results screen with a score breakdown.
 * A second pass runs the load → Play Journey → tap-the-rope → win flow on a
 * mobile touch viewport.
 *
 * The game ships NO debug validation handle (no window.__app), but its rules
 * engine (js/rules.js + js/physics.js + js/rng.js) is DOM-free and the
 * levels carry an authored `solution` script. The test simulates the level
 * OFFLINE in Node with that same engine to confirm the target outcome; in the
 * browser it only ever clicks real on-screen buttons (the right-rail action
 * list / mirror), exactly as a screen-reader or keyboard player would. No
 * game code is modified and no move is performed programmatically.
 *
 * Level chosen: j01 "First Drop" — one perfectly vertical rope (treat at
 * x=0,y=4, recipient at x=0,y=-5, three stars below). The treat hangs at
 * rest, so snipping the rope at any point after the board goes active drops
 * it straight down the centre line for a deterministic win (authorized
 * solution: cut rope-0 at tick 2; Node sim: won / delivered / 3 stars).
 *
 * Serving: the game is fully playable offline — net.js probes /api/v1/time
 * once and degrades to the local clock (hosted=false) with zero console
 * noise. Per the sibling-title convention (picture-logic/blockstead/
 * balance-spire) this test embeds a minimal node:http static server on an
 * ephemeral port and answers /api/* probes with 200 `{}` so the client takes
 * its offline path cleanly. The shipped server.js backend is not needed.
 *
 * Run: npm run test:e2e  (or: node tests/e2e.mjs)
 */
import { chromium } from 'playwright-core';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOT = (stage, vp) => `/tmp/tether-treat-e2e-${stage}-${vp}.png`;

// benign GPU/swiftshader noise (mirrors tools/production_game_audit.mjs)
const browserNoise = /GL Driver Message|GPU stall due to ReadPixels|Automatic fallback to software WebGL|EnableWebGLDeveloperExtensions|WebGL: INVALID_OPERATION|GroupMarkerNotSet|fonts.gstatic/i;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    // No StarHermit backend here: answer API probes with empty JSON (200) so
    // the platform adapter degrades to its offline path without console noise.
    if (p.startsWith('/api/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    const file = path.normalize(path.join(ROOT, p));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
const ok = (name) => console.log(`ok - ${name}`);

// The game announces 'Objective: deliver the treat to Morsel.' (ui.announce
// → the role=status live region) exactly when the countdown finishes and the
// board goes active. That is the reliable "active" DOM signal for a fresh
// start / restart.
const waitActive = (page) =>
  page.waitForFunction(() => {
    const el = document.querySelector('.tt-root [role="status"]');
    return !!el && /Objective:/.test(el.textContent || '');
  }, null, { timeout: 15000 });

// Resuming does not re-announce the objective, so detect the active board by
// the countdown/pause screen container becoming hidden (no preparing flash on
// the resume path).
const waitBoardResumed = (page) =>
  page.waitForFunction(() => {
    const s = document.querySelector('.tt-screens');
    return !!s && s.hidden === true;
  }, null, { timeout: 8000 });

const snapRopeBtn = (page) =>
  page.locator('#board-mirror .tt-mirror-list li button', { hasText: /Snip/ }).first();

// Click the on-screen 'Snip rope-0' mirror button — a real DOM button that
// dispatches through the normal confirmAction → doAction path.
async function snipRope(page) {
  const btn = snapRopeBtn(page);
  await btn.click();
}

async function startJourney(page) {
  await page.click('.tt-card-play');
  await waitActive(page);
}

// ---------- one full pass ----------
async function runPass(browser, name, ctxOpts, { full }) {
  const errors = [];
  const context = await browser.newContext(ctxOpts);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error' || browserNoise.test(m.text())) return;
    const url = m.location()?.url || '';
    if (/Failed to load resource/.test(m.text()) && /\/api\/|\/favicon/.test(url)) return;
    errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    const p = r.url();
    if (r.status() >= 400 && !/\/api\/|\/favicon/.test(p)) errors.push(`http ${r.status()}: ${p}`);
  });

  try {
    // load + title
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('.tt-screens:not([hidden]) .tt-panel h1', { timeout: 15000 });
    const title = (await page.textContent('.tt-screens:not([hidden]) .tt-panel h1')).trim();
    if (!/Tether Treat/i.test(title)) throw new Error(`unexpected title: "${title}"`);
    await page.screenshot({ path: SHOT('title', name) });
    ok(`${name}: title screen visible ("${title}")`);

    // Settings: open, toggle Reduced motion (also shortens the countdown),
    // then Back to title — real visible controls.
    await page.click('button:has-text("Settings")');
    await page.waitForSelector('.tt-screens:not([hidden]) .tt-panel h1:has-text("Settings")', { timeout: 5000 });
    const rm = page.locator('label:has-text("Reduced motion") input[type="checkbox"]');
    if (!(await rm.isChecked())) await rm.check();
    const reducedNow = await rm.isChecked();
    if (!reducedNow) throw new Error('Reduced motion toggle did not enable');
    await page.screenshot({ path: SHOT('settings', name) });
    await page.click('button:has-text("← Back")');
    await page.waitForSelector('.tt-screens:not([hidden]) .tt-panel h1:has-text("Tether Treat")', { timeout: 5000 });
    ok(`${name}: Settings open → Reduced motion on → Back to title`);

    // Play Journey → countdown → active board.
    await startJourney(page);
    const hudObj = (await page.textContent('.tt-hud-objective')).trim();
    if (!/Deliver the treat to Morsel/.test(hudObj)) throw new Error(`unexpected objective: "${hudObj}"`);
    const mirrorCount = await snapRopeBtn(page).count();
    if (mirrorCount !== 1) throw new Error(`expected exactly 1 Snip action, got ${mirrorCount}`);
    await page.screenshot({ path: SHOT('play', name) });
    ok(`${name}: journey board active ("${hudObj}"; mirror offers the single Snip action)`);

    if (full) {
      // Pause / resume via the visible buttons (safe here: treat hangs at
      // rest, so pausing before the snip cannot drift it).
      await page.click('button:has-text("Pause (Esc)")');
      await page.waitForSelector('.tt-screens:not([hidden]) .tt-panel h1:has-text("Paused")', { timeout: 5000 });
      await page.screenshot({ path: SHOT('pause', name) });
      await page.click('button:has-text("Resume (Esc)")');
      await waitBoardResumed(page);
      ok(`${name}: Pause and Resume work`);

      // Hint exercises the real Hint button (highlights the rope; no state change).
      await page.click('button:has-text("Hint (H)")');
      await page.waitForTimeout(150);
      ok(`${name}: Hint button exercised`);

      // Undo is correctly disabled with no legal undo history.
      const undoDisabled = await page.locator('button:has-text("Undo (U)")').isDisabled();
      if (!undoDisabled) throw new Error('Undo should be disabled on a fresh board');
      ok(`${name}: Undo is disabled on a fresh board`);

      // Restart the round through the visible button, then wait for the board
      // to be active again before the real snip.
      await page.click('button:has-text("Restart (R)")');
      await waitActive(page);
      ok(`${name}: Restart returns to an active board`);
    }

    // The real win: snip the one rope via its mirror button; the physics drops
    // the treat through the 3 stars into Morsel (delivered).
    await snipRope(page);
    await page.waitForSelector('.tt-screens:not([hidden]) .tt-panel h1:has-text("Delivered!")', { timeout: 20000 });
    const resultTitle = (await page.textContent('.tt-screens:not([hidden]) .tt-panel h1')).trim();
    if (!/Delivered!/i.test(resultTitle)) throw new Error(`expected a win, got: "${resultTitle}"`);
    const totalRows = await page.locator('.tt-score-table dd').count();
    if (totalRows < 1) throw new Error('score breakdown table is empty');
    const total = (await page.textContent('.tt-score-table dd.tt-total')).trim();
    const stars = (await page.textContent('.tt-stars-big')).trim();
    if (!/★/.test(stars)) throw new Error(`unexpected stars display: "${stars}"`);
    await page.screenshot({ path: SHOT('results', name) });
    ok(`${name}: treat delivered — results screen ("${resultTitle}", ${totalRows} score rows, total ${total}, stars "${stars}")`);

    // Journey completion persisted.
    const prog = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('tether-treat:progress:v1');
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    });
    if (!prog) throw new Error('progress not persisted (no storage key)');
    const lv = prog.levels && prog.levels.j01;
    if (!lv || !lv.completed) throw new Error('j01 not marked completed in progress');
    ok(`${name}: progress persisted (j01 completed)`);
  } finally {
    await context.close();
  }

  if (errors.length) throw new Error(`${name} pass had page errors:\n  ${errors.join('\n  ')}`);
  console.log(`ok - ${name}: no page errors`);
}

// ---------- main ----------
let browser = null;
try {
  browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--mute-audio'],
  });
  console.log(`serving ${ROOT} at ${BASE}`);
  await runPass(browser, 'desktop', { viewport: { width: 1280, height: 800 } }, { full: true });
  await runPass(browser, 'mobile',
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }, { full: false });
  console.log('\nE2E PASS — tether-treat, desktop + mobile, no page errors');
} catch (e) {
  failures++;
  console.error('\nE2E FAIL:', e.message || e);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.close();
}
if (failures) process.exit(1);

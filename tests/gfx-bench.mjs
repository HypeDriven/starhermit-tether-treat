// Graphics benchmark hook for tools/gfx-bench.mjs (dev-only, never shipped): picks a preset in Settings →
// Graphics, presses Play Journey and keeps playing through the real on-screen controls — it snips a rope
// with its mirror button every couple of seconds so the treat swings and drops (stars pop with bursts,
// Morsel chomps, sugar motes drift), then moves on with Next stage (or Retry) from the results screen.
export const presets = ['low', 'balanced', 'high', 'ultra'];
export const levels = { low: 0, balanced: 4, high: 10, ultra: 17 };

const panelH1 = '.tt-screens:not([hidden]) .tt-panel h1';

export async function setPreset(page, preset) {
  await page.waitForSelector(panelH1, { timeout: 20000 });
  await page.click('#btn-settings');
  await page.waitForSelector(`${panelH1}:has-text("Settings")`);
  await page.locator('#gfx-preset').scrollIntoViewIfNeeded();
  await page.selectOption('#gfx-preset', preset);
  await page.waitForFunction((p) => document.body.dataset.gfxPreset === p, preset);
  await page.locator('#btn-settings-back').scrollIntoViewIfNeeded();
  await page.click('#btn-settings-back');
  await page.waitForSelector(`${panelH1}:has-text("Tether Treat")`);
}

async function step(page) {
  const results = page.locator('.tt-screens:not([hidden]) .tt-score-table');
  if (await results.count()) {
    const next = page.locator('.tt-screens:not([hidden]) button', { hasText: /^Next stage$/ });
    if (await next.count()) await next.first().click({ timeout: 3000 });
    else await page.locator('.tt-screens:not([hidden]) button', { hasText: /^Retry/ }).first().click({ timeout: 3000 });
    return;
  }
  const snip = page.locator('#board-mirror .tt-mirror-list li button', { hasText: /Snip/ });
  if (await snip.count()) await snip.first().click({ timeout: 3000 });
}

export async function start(page) {
  await page.click('.tt-card-play');
  await page.waitForFunction(() => /Objective:/.test(document.querySelector('.tt-root [role="status"]')?.textContent || ''), null, { timeout: 20000 });
  let open = true;
  page.once('close', () => { open = false; });
  (async () => {
    await page.waitForTimeout(800).catch(() => {});
    while (open) {
      try { await step(page); } catch (e) { if (!open) return; if (process.env.BENCH_DEBUG) console.error(e.message); }
      await page.waitForTimeout(1800).catch(() => {});
    }
  })();
  await page.waitForTimeout(1500);
}

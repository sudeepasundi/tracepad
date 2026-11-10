// Filtering a 300,000-line log in the editor (PWA build only; it is slow to set up).
// Hidden-line ranges are the part editors get wrong on large documents, so this
// checks that the lines really disappear and that scrolling still works.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { openApp, useBasicFilePickers } from './helpers';

const FILE = 'tmp/big-300k.log';

test.beforeAll(() => {
  if (!existsSync(FILE)) execFileSync('node', ['scripts/gen-log.mjs', '--lines', '300000', '--seed', '11', '--out', FILE], { stdio: 'ignore' });
});

test('300k lines: parse, filter, scroll and clear stay quick', async ({ page }) => {
  test.setTimeout(180_000);
  const mb = statSync(FILE).size / 1048576;
  expect(mb).toBeGreaterThan(40);
  expect(mb).toBeLessThan(64);

  await useBasicFilePickers(page);
  await openApp(page);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).click();
  let t0 = Date.now();
  await (await chooser).setFiles(FILE);
  await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible({ timeout: 60_000 });
  const openMs = Date.now() - t0;

  const lines = await page.evaluate(() => (window as unknown as { __tracepad: { docText(): string } }).__tracepad.docText().length);
  expect(lines).toBeGreaterThan(40_000_000);
  const total = parseInt((await page.getByTestId('filter-count').textContent())!.replace(/,/g, ''), 10);
  expect(total).toBeGreaterThan(200_000);
  await expect(page.getByTestId('status-format')).toHaveText('Spring Boot');

  // Level filter: tens of thousands of separate hidden ranges.
  t0 = Date.now();
  await page.locator('.tp-chip', { hasText: 'WARN' }).click();
  await expect(page.getByTestId('filter-count')).toHaveText(/ of /, { timeout: 30_000 });
  const filterMs = Date.now() - t0;
  const hook = (fn: string) => page.evaluate(`window.__tracepad.${fn}`) as Promise<number>;
  const hiddenLines = await hook('hiddenLines()');
  expect(hiddenLines).toBeGreaterThan(200_000);
  const drawn = (await page.locator('.cm-content .cm-line').allTextContents()).filter((l) => /^\d{4}-/.test(l));
  expect(drawn.length).toBeGreaterThan(15);
  for (const l of drawn) expect(l).toContain(' WARN ');

  // Jump to the end and to the middle: still only matching lines, drawn promptly.
  t0 = Date.now();
  await page.locator('.cm-content').focus();
  await page.keyboard.press('Control+End');
  await page.waitForTimeout(150);
  const tail = (await page.locator('.cm-content .cm-line').allTextContents()).filter((l) => /^\d{4}-/.test(l));
  expect(tail.length).toBeGreaterThan(5);
  for (const l of tail) expect(l).toContain(' WARN ');
  await page.keyboard.press('Control+G');
  await page.getByRole('dialog').getByRole('textbox').fill('150000');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const middle = (await page.locator('.cm-content .cm-line').allTextContents()).filter((l) => /^\d{4}-/.test(l));
  for (const l of middle) expect(l).toContain(' WARN ');
  const scrollMs = Date.now() - t0;

  // Text + level together, then errors with F8.
  await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('Slow query');
  await expect(page.getByTestId('filter-count')).not.toHaveText(new RegExp(`^${(total - 0).toLocaleString()}`), { timeout: 30_000 });
  await expect.poll(async () => (await page.locator('.cm-content .cm-line').allTextContents()).filter((l) => /^\d{4}-/.test(l)).every((l) => l.includes('Slow query')), { timeout: 30_000 }).toBe(true);

  t0 = Date.now();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect.poll(() => hook('hiddenLines()'), { timeout: 30_000 }).toBe(0);
  const clearMs = Date.now() - t0;
  await page.keyboard.press('F8');
  expect(await page.evaluate(() => {
    const h = (window as unknown as { __tracepad: { lineText(n: number): string; cursorLine(): number } }).__tracepad;
    return h.lineText(h.cursorLine());
  })).toContain('ERROR');

  console.log(`300k lines (${mb.toFixed(0)} MB): open+parse ${openMs} ms, level filter ${filterMs} ms, jumps ${scrollMs} ms, clear ${clearMs} ms`);
  expect(openMs).toBeLessThan(30_000);
  expect(filterMs).toBeLessThan(8_000);
  expect(clearMs).toBeLessThan(8_000);
});

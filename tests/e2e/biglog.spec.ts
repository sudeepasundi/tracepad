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

  // Auto tables on the whole log.
  t0 = Date.now();
  await page.keyboard.press('Alt+T');
  await expect(page.locator('.tp-vt-row').first()).toBeVisible({ timeout: 60_000 });
  const tablesMs = Date.now() - t0;
  const mined = await page.evaluate(() => (window as unknown as { __tracepad: { table(): { ms: number; patterns: number; rows: number } } }).__tracepad.table());
  console.log(`auto tables: ${total.toLocaleString('en-US')} entries -> ${mined.patterns} patterns, mined in ${mined.ms} ms, first table (${mined.rows.toLocaleString('en-US')} rows) on screen after ${tablesMs} ms`);
  expect(mined.ms).toBeLessThan(4000);
  expect(mined.patterns).toBeLessThan(120);

  console.log(`300k lines (${mb.toFixed(0)} MB): open+parse ${openMs} ms, level filter ${filterMs} ms, jumps ${scrollMs} ms, clear ${clearMs} ms`);
  expect(openMs).toBeLessThan(30_000);
  expect(filterMs).toBeLessThan(8_000);
  expect(clearMs).toBeLessThan(8_000);
});

const HUGE = 'tmp/big-150mb.log';

test('150 MB log: indexed from disk in seconds, scrolled, filtered and searched without loading it', async ({ page }) => {
  test.setTimeout(240_000);
  if (!existsSync(HUGE)) execFileSync('node', ['scripts/gen-log.mjs', '--mb', '150', '--seed', '3', '--out', HUGE], { stdio: 'ignore' });
  const bytes = statSync(HUGE).size;
  await useBasicFilePickers(page);
  await openApp(page);
  const state = () => page.evaluate(() => (window as unknown as { __tracepad: { big(): { lines: number; rows: number; top: number; cursor: number; size: number } } }).__tracepad.big());
  const texts = async () => (await page.locator('.tp-big-row .tp-big-text').allTextContents()).filter((t) => t.length > 0);
  const numbers = () => page.locator('.tp-big-row').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.line)).sort((a, b) => a - b));

  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).click();
  let t0 = Date.now();
  await (await chooser).setFiles(HUGE);
  // Progress is shown while it reads.
  await expect(page.locator('.tp-big')).toBeVisible();
  await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible({ timeout: 120_000 });
  const openMs = Date.now() - t0;
  const s = await state();
  expect(s.size).toBe(bytes);
  expect(s.lines).toBeGreaterThan(600_000);
  await expect(page.locator('.tp-status')).toContainText('Read-only');
  await expect(page.getByTestId('status-format')).toHaveText('Spring Boot');
  // Nothing was loaded into the editor, and only a screenful of rows exists.
  expect(await page.evaluate(() => (window as unknown as { __tracepad: { docText(): string } }).__tracepad.docText().length)).toBe(0);
  expect(await page.locator('.tp-big-row').count()).toBeLessThan(90);
  await expect.poll(async () => (await texts()).length).toBeGreaterThan(20);

  // More rows than a browser can lay out: the scrollbar is scaled, the wheel is still exact.
  const scroll = await page.locator('.tp-big-scroll').evaluate((el) => ({ h: el.scrollHeight, rowH: (document.querySelector('.tp-big-row') as HTMLElement).offsetHeight }));
  expect(scroll.h).toBeLessThan(s.lines * scroll.rowH);
  const view = (await page.locator('.tp-big').boundingBox())!;
  await page.mouse.move(view.x + 300, view.y + 300);
  await page.mouse.wheel(0, scroll.rowH * 40);
  await expect.poll(async () => Math.round((await state()).top)).toBe(40);
  expect((await numbers())[0]).toBe(41);

  t0 = Date.now();
  await page.locator('.tp-big').focus();
  await page.keyboard.press('Control+End');
  await expect.poll(async () => (await numbers()).at(-1)).toBe(s.lines);
  await expect.poll(async () => (await texts()).length).toBeGreaterThan(20);
  const endMs = Date.now() - t0;
  await page.locator('.tp-big-scroll').evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
  await expect.poll(async () => Math.abs((await numbers())[0] - s.lines / 2)).toBeLessThan(s.lines * 0.01);
  await expect.poll(async () => (await texts()).length).toBeGreaterThan(20);

  t0 = Date.now();
  await page.locator('.tp-chip', { hasText: 'ERROR' }).click();
  await expect(page.getByTestId('filter-count')).toHaveText(/ of /, { timeout: 60_000 });
  const levelMs = Date.now() - t0;
  await expect.poll(async () => (await texts()).filter((l) => /^\d{4}-/.test(l)).every((l) => l.includes(' ERROR '))).toBe(true);

  t0 = Date.now();
  await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('reserve stock');
  await expect.poll(async () => (await texts()).filter((l) => /^\d{4}-/.test(l)).every((l) => l.includes('reserve stock')), { timeout: 90_000 }).toBe(true);
  await expect(page.locator('.tp-big-busy')).toHaveCount(0, { timeout: 90_000 });
  const textMs = Date.now() - t0;
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect.poll(async () => (await state()).rows, { timeout: 30_000 }).toBe(s.lines);

  t0 = Date.now();
  await page.locator('.tp-big').focus();
  await page.keyboard.press('Control+F');
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('Thread starvation');
  await expect(page.locator('.tp-find-count')).toHaveText(/^[\d,]+ lines/, { timeout: 90_000 });
  const findMs = Date.now() - t0;
  await page.keyboard.press('Enter');
  await expect(page.locator('.tp-big-row.is-cursor mark.tp-big-hit')).toHaveText('Thread starvation');

  console.log(`${(bytes / 1048576).toFixed(0)} MB, ${s.lines.toLocaleString()} lines: index ${openMs} ms, jump to end ${endMs} ms, level filter ${levelMs} ms, text filter ${textMs} ms, find ${findMs} ms`);
  expect(openMs).toBeLessThan(40_000);
  expect(levelMs).toBeLessThan(10_000);
  expect(textMs).toBeLessThan(40_000);
});

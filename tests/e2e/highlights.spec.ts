// Every highlight rule, one by one, in the editor and in the large-file viewer.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { contrastOf, openApp, openViaChooser, useBasicFilePickers } from './helpers';

const L = (sec: number, level: string, msg: string) => `2026-03-14 10:00:${String(sec).padStart(2, '0')}.000 ${level.padEnd(5)} [main] com.acme.orders.Job - ${msg}`;
/** Each line is there for one rule; the last ones must not be marked by any ready-made rule. */
const LOG = [
  L(1, 'ERROR', 'save failed: java.lang.IllegalStateException: order is closed'),
  L(2, 'WARN', 'payment call returned status=503 from billing'),
  L(3, 'INFO', 'GET /api/orders/42 took 1840ms'),
  L(4, 'WARN', 'Read timed out after 30000, retrying'),
  L(5, 'INFO', 'trace 4bf92f3577b34da6a3ce929d0e0e4736 handled'),
  L(6, 'INFO', 'connected to 10.0.4.17:5432'),
  L(7, 'DEBUG', 'SELECT id, total FROM orders WHERE id = ? took 900ms'),
  L(8, 'INFO', 'quiet line: took 84ms, status=200, exception count 0, ERROR level text'),
].join('\n') + '\n';

const EXPECT: { id: string; name: RegExp; color: number; text: string }[] = [
  { id: 'exceptions', name: /Exception and error classes/, color: 3, text: 'java.lang.IllegalStateException' },
  { id: 'http', name: /HTTP 4xx and 5xx/, color: 4, text: 'status=503' },
  { id: 'slow', name: /Slow: 500 ms/, color: 0, text: '1840ms' },
  { id: 'trouble', name: /Timeouts, refusals/, color: 5, text: 'timed out' },
  { id: 'trace', name: /Trace and span IDs/, color: 2, text: '4bf92f3577b34da6a3ce929d0e0e4736' },
  { id: 'ip', name: /IP addresses/, color: 1, text: '10.0.4.17:5432' },
  { id: 'sql', name: /SQL statements/, color: 2, text: 'SELECT' },
];

const lineOf = (scope: Locator, n: number) => scope.locator('.cm-line, .tp-big-row').nth(n);
const marksIn = (line: Locator) => line.locator('.tp-hl').evaluateAll((els) => els.map((e) => ({ text: e.textContent ?? '', cls: e.className })));

async function switchAllOn(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Highlight rules' }).click();
  while ((await page.locator('.tp-ready[aria-checked="false"]').count()) > 0) await page.locator('.tp-ready[aria-checked="false"]').first().click();
  await expect(page.locator('.tp-ready[aria-checked="true"]')).toHaveCount(7);
}

for (const where of ['editor', 'large-file viewer'] as const) {
  test.describe(`highlights in the ${where}`, () => {
    test.beforeEach(async ({ page }) => {
      await useBasicFilePickers(page);
      await openApp(page, where === 'editor' ? {} : { largeFileMB: 0.0001 });
      await openViaChooser(page, [{ name: 'rules.log', mimeType: 'text/plain', buffer: Buffer.from(LOG) }]);
      await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
      if (where === 'large-file viewer') await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible();
    });

    test('each ready-made rule marks its own example, in its own colour, and nothing else', async ({ page }) => {
      await switchAllOn(page);
      const scope = page.locator(where === 'editor' ? '.cm-content' : '.tp-big');
      for (const [i, e] of EXPECT.entries()) {
        const marks = await marksIn(lineOf(scope, i));
        expect(marks.map((m) => m.text), e.id).toContain(e.text);
        const mark = marks.find((m) => m.text === e.text)!;
        expect(mark.cls, e.id).toContain(`tp-hl-${e.color}`);
        // The mark stays readable.
        expect(await contrastOf(lineOf(scope, i).locator('.tp-hl', { hasText: e.text }).first()), e.id).toBeGreaterThanOrEqual(4.5);
      }
      // The quiet line: fast call, 200, the word "exception", the level word: no marks at all.
      expect(await marksIn(lineOf(scope, 7))).toEqual([]);
    });

    test('each switch turns its own rule off, and only that one', async ({ page }) => {
      await switchAllOn(page);
      const scope = page.locator(where === 'editor' ? '.cm-content' : '.tp-big');
      for (const [i, e] of EXPECT.entries()) {
        await page.getByRole('switch', { name: e.name }).click();
        await expect.poll(async () => (await marksIn(lineOf(scope, i))).some((m) => m.text === e.text), e.id).toBe(false);
        // The rules after it are still on.
        for (const later of EXPECT.slice(i + 1)) {
          const n = EXPECT.indexOf(later);
          expect((await marksIn(lineOf(scope, n))).some((m) => m.text === later.text), `${later.id} after ${e.id} off`).toBe(true);
        }
      }
      expect(await scope.locator('.tp-hl').count()).toBe(0);
    });

    test('your own rules (plain and regex) and the filter marks work alongside', async ({ page }) => {
      await page.getByRole('button', { name: 'Highlight rules' }).click();
      await page.getByRole('button', { name: 'Add rule' }).click();
      await page.getByRole('textbox', { name: 'Text or pattern to highlight' }).fill('billing');
      await page.getByRole('button', { name: 'Add rule' }).click();
      const second = page.getByRole('textbox', { name: 'Text or pattern to highlight' }).nth(1);
      await second.fill('id = \\?');
      await page.locator('.tp-rule').nth(1).getByRole('button', { name: 'Regular expression' }).click();
      const scope = page.locator(where === 'editor' ? '.cm-content' : '.tp-big');
      await expect(lineOf(scope, 1).locator('.tp-hl-0', { hasText: 'billing' })).toBeVisible();
      await expect(lineOf(scope, 6).locator('.tp-hl-1', { hasText: 'id = ?' })).toBeVisible();
      // Ready-made ones still mark next to them.
      await expect(lineOf(scope, 1).locator('.tp-hl-4', { hasText: 'status=503' })).toBeVisible();
      await page.getByRole('button', { name: 'Close sidebar' }).click();
      await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('orders');
      await expect(page.getByTestId('filter-count')).toHaveText(/^\d+ of 8 entries$/);
      await expect(scope.locator('.tp-filter-hit').first()).toBeVisible();
      for (const t of await scope.locator('.tp-filter-hit').allTextContents()) expect(t.toLowerCase()).toBe('orders');
    });
  });
}

// Compare (diff) view (0.8). Both builds.
import { expect, test, type Page } from '@playwright/test';
import { box, contrastOf, editor, openApp, openViaChooser, overlaps, useBasicFilePickers } from './helpers';

const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });
const BASE = Array.from({ length: 120 }, (_, i) => `server.setting.${i} = value ${i}`);
const OLD = BASE.join('\n') + '\n';
const NEW =
  BASE.map((l, i) => (i === 10 ? 'server.setting.10 = CHANGED value' : i === 60 ? `${l}\nserver.added.line = new` : l))
    .filter((_, i) => i !== 100)
    .join('\n') + '\n';
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const view = (page: Page) => page.locator('.tp-compare');
const status = (page: Page) => page.locator('.tp-compare-status');

async function openPair(page: Page, extra = true): Promise<void> {
  await openViaChooser(page, [file('old.properties', OLD), file('new.properties', NEW), ...(extra ? [file('notes.txt', 'unrelated\n')] : [])]);
  await expect(tab(page, 'new.properties')).toBeVisible();
}

async function comparePair(page: Page): Promise<void> {
  await openPair(page, false);
  await tab(page, 'old.properties').click();
  await page.keyboard.press('Alt+C');
  await expect(view(page)).toBeVisible();
  await expect(status(page)).toHaveText('3 changes');
}

test.beforeEach(async ({ page }) => {
  await useBasicFilePickers(page);
  await openApp(page);
});

test.describe('compare', () => {
  test('tab menu: "Compare with…" lists the other files; picking one opens the comparison', async ({ page }) => {
    await openPair(page);
    await tab(page, 'old.properties').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Compare with/ }).click();
    const pick = page.getByRole('dialog', { name: 'Compare old.properties with…' });
    await expect(pick).toBeVisible();
    await expect(pick.locator('.tp-pick-item')).toHaveCount(2);
    await expect(pick.locator('.tp-pick-item').first()).toBeFocused();
    for (const item of await pick.locator('.tp-pick-item').all()) expect((await box(item)).height).toBeGreaterThanOrEqual(44);
    await pick.getByRole('button', { name: /new\.properties/ }).click();
    await expect(pick).toHaveCount(0);
    await expect(view(page)).toBeVisible();
    await expect(page.locator('.tp-compare-name')).toHaveText(['old.properties', 'new.properties']);
    await expect(status(page)).toHaveText('3 changes');
    await expect(view(page).locator('.cm-merge-a .cm-content')).toContainText('server.setting.10 = value 10');
    await expect(view(page).locator('.cm-merge-b .cm-content')).toContainText('server.setting.10 = CHANGED value');
  });

  test('it is easy to find: shortcut, command palette and the Open files list', async ({ page }) => {
    await openPair(page, false);
    // Shortcut, with only two files open: straight to the comparison.
    await page.keyboard.press('Alt+C');
    await expect(view(page)).toBeVisible();
    await page.getByRole('button', { name: 'Close compare' }).click();
    await expect(view(page)).toHaveCount(0);
    // Palette.
    await page.keyboard.press('Control+Shift+P');
    await page.getByRole('combobox', { name: 'Search commands' }).fill('compare');
    await expect(page.getByRole('option', { name: /Compare with…/ })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(view(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view(page)).toHaveCount(0);
    // Open files list.
    await page.getByRole('button', { name: /Open files list/ }).click();
    await page.locator('.tp-file', { hasText: 'old.properties' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Compare with/ }).click();
    await expect(view(page)).toBeVisible();
    await expect(page.locator('.tp-compare-name')).toHaveText(['old.properties', 'new.properties']);
  });

  test('next and previous change step through and wrap, by key and by button', async ({ page }) => {
    await comparePair(page);
    await page.keyboard.press('F7');
    await expect(status(page)).toHaveText('1 of 3');
    await expect(view(page).locator('.cm-merge-b .cm-changedLine').first()).toBeInViewport();
    await page.getByRole('button', { name: 'Next change' }).click();
    await expect(status(page)).toHaveText('2 of 3');
    await expect(view(page).locator('.cm-merge-b .cm-content')).toContainText('server.added.line = new');
    await page.keyboard.press('F7');
    await expect(status(page)).toHaveText('3 of 3');
    await page.keyboard.press('F7');
    await expect(status(page)).toHaveText('1 of 3');
    await page.keyboard.press('Shift+F7');
    await expect(status(page)).toHaveText('3 of 3');
    await page.getByRole('button', { name: 'Previous change' }).click();
    await expect(status(page)).toHaveText('2 of 3');
  });

  test('unchanged lines can be hidden or shown; sides can be swapped', async ({ page }) => {
    await comparePair(page);
    await expect(view(page).locator('.cm-collapsedLines').first()).toBeVisible();
    await page.getByRole('button', { name: 'Hide unchanged' }).click();
    await expect(page.getByRole('button', { name: 'Hide unchanged' })).toHaveAttribute('aria-pressed', 'false');
    await expect(view(page).locator('.cm-collapsedLines')).toHaveCount(0);
    await expect(view(page).locator('.cm-merge-a .cm-content')).toContainText('server.setting.1 = value 1');
    await page.getByRole('button', { name: 'Swap sides' }).click();
    await expect(page.locator('.tp-compare-name')).toHaveText(['new.properties', 'old.properties']);
    await expect(status(page)).toHaveText('3 changes');
  });

  test('identical files say so; a tab closed underneath closes the view', async ({ page }) => {
    await openViaChooser(page, [file('a.txt', 'same\ntext\n'), file('b.txt', 'same\ntext\n')]);
    await expect(tab(page, 'b.txt')).toBeVisible();
    await page.keyboard.press('Alt+C');
    await expect(status(page)).toHaveText('No differences');
    await expect(page.locator('.tp-compare-same')).toHaveText('These two files are identical.');
    await expect(page.getByRole('button', { name: 'Next change' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(view(page)).toHaveCount(0);
    // F7 outside the view explains itself instead of doing nothing.
    await page.keyboard.press('F7');
    await expect(page.locator('.tp-toast')).toContainText('Compare with');
  });

  test('appearance: fills the editor area, two equal sides that meet with no strip between, scrollbar at the edge', async ({ page }) => {
    await comparePair(page);
    const main = await box(page.locator('.tp-main'));
    const c = await box(view(page));
    // Inside the main area's one-pixel border.
    expect(Math.abs(c.x - main.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(c.y - main.y)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(c.width - main.width)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(c.height - main.height)).toBeLessThanOrEqual(2.5);
    const a = await box(view(page).locator('.cm-mergeViewEditor').nth(0));
    const b = await box(view(page).locator('.cm-mergeViewEditor').nth(1));
    expect(Math.abs(a.width - b.width)).toBeLessThan(3);
    // No gutter strip: the right side starts where the left one ends.
    expect(Math.abs(a.x + a.width - b.x)).toBeLessThan(2);
    await expect(view(page).locator('.cm-merge-revert')).toHaveCount(0);
    await expect(view(page).locator('.cm-mergeViewEditor')).toHaveCount(2);
    // Together they use the full width, and the scroller reaches the right and bottom edges.
    expect(a.x).toBeCloseTo(c.x, 0);
    const sc = await box(view(page).locator('.cm-mergeView'));
    expect(sc.x + sc.width).toBeCloseTo(c.x + c.width, 0);
    expect(sc.y + sc.height).toBeCloseTo(c.y + c.height, 0);
    expect(b.x + b.width).toBeGreaterThan(c.x + c.width - 20);
    // File names sit above their own side.
    const names = await Promise.all((await page.locator('.tp-compare-name').all()).map(box));
    expect(names[0].x).toBeCloseTo(a.x, 0);
    expect(Math.abs(names[1].x - b.x)).toBeLessThan(2);
    // Header buttons: inside the header, in a row, not touching.
    const head = await box(page.locator('.tp-compare-head'));
    const buttons = await Promise.all((await page.locator('.tp-compare-actions button').all()).map(box));
    expect(buttons).toHaveLength(7);
    for (const [i, btn] of buttons.entries()) {
      expect(btn.x + btn.width).toBeLessThanOrEqual(head.x + head.width);
      expect(btn.y).toBeGreaterThanOrEqual(head.y);
      expect(btn.y + btn.height).toBeLessThanOrEqual(head.y + head.height + 0.5);
      if (i) expect(overlaps(buttons[i - 1], btn)).toBe(false);
    }
    expect(overlaps(await box(status(page)), buttons[0])).toBe(false);
    for (const sel of ['.tp-compare-status', '.tp-compare-name', '.tp-compare .cm-collapsedLines', '.tp-compare .cm-merge-b .cm-changedLine']) expect(await contrastOf(page.locator(sel).first()), sel).toBeGreaterThanOrEqual(4.5);
    // Changed lines are tinted differently on each side, and differently from plain lines.
    const tint = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const left = await tint('.tp-compare .cm-merge-a .cm-changedLine');
    const right = await tint('.tp-compare .cm-merge-b .cm-changedLine');
    expect(left).not.toBe(right);
    expect(left).not.toBe('rgba(0, 0, 0, 0)');
    // The page itself does not scroll.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  });

  test('full screen covers the window; Escape leaves full screen first and closes the view second', async ({ page }) => {
    await comparePair(page);
    await page.getByRole('button', { name: 'Compare full screen' }).click();
    await expect(view(page)).toHaveClass(/is-fullscreen/);
    const vw = page.viewportSize()!;
    expect(await box(view(page))).toEqual({ x: 0, y: 0, width: vw.width, height: vw.height });
    const a = await box(view(page).locator('.cm-mergeViewEditor').nth(0));
    const b = await box(view(page).locator('.cm-mergeViewEditor').nth(1));
    expect(Math.abs(a.width - b.width)).toBeLessThan(3);
    expect(a.width + b.width).toBeGreaterThan(vw.width - 20);
    await page.keyboard.press('F7');
    await expect(status(page)).toHaveText('1 of 3');
    await page.keyboard.press('Escape');
    await expect(view(page)).not.toHaveClass(/is-fullscreen/);
    await expect(view(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(view(page)).toHaveCount(0);
    await expect(editor(page).first()).toBeVisible();
  });

  test('a large file cannot be compared, and says why', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('tracepad.settings', JSON.stringify({ largeFileMB: 0.001 })));
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await openViaChooser(page, [file('small.txt', 'a\n'), file('huge.log', OLD.repeat(3))]);
    await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible();
    await page.keyboard.press('Alt+C');
    await expect(page.locator('.tp-toast-error')).toContainText('large file');
    await expect(view(page)).toHaveCount(0);
  });
});


test('large files: Shift+click on a line of text extends the selected range', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('tracepad.settings', JSON.stringify({ largeFileMB: 0.0001 })));
  await page.reload();
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  await openViaChooser(page, [file('steps.log', Array.from({ length: 40 }, (_, i) => `2026-03-14 10:00:${String(i).padStart(2, '0')} INFO c.a.Job - step ${i}`).join('\n') + '\n')]);
  await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible();
  await page.locator('.tp-big-row', { hasText: 'step 3' }).first().locator('.tp-big-text').click();
  await page.locator('.tp-big-row', { hasText: 'step 7' }).first().locator('.tp-big-text').click({ modifiers: ['Shift'] });
  await expect(page.locator('.tp-big-row.is-selected')).toHaveCount(5);
  // No stray text selection is left behind by the Shift+click.
  expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
});

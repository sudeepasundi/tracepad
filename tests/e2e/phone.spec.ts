// 390x844 touch viewport: no sideways scrolling and sensible stacking.
import { expect, test, type Page } from '@playwright/test';
import { box, docText, openApp, openSample } from './helpers';

const W = 390;

async function fits(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth, w: innerWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.w);
  expect(m.bw).toBeLessThanOrEqual(m.w);
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('welcome card fits and its actions are finger-sized', async ({ page }) => {
  const card = await box(page.locator('.tp-welcome-card'));
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(W);
  for (const b of await page.locator('.tp-welcome-action').all()) expect((await box(b)).height).toBeGreaterThanOrEqual(44);
  await fits(page);
});

test('top bar and status bar stay inside the screen with a long log open', async ({ page }) => {
  await openSample(page);
  for (const sel of ['.tp-topbar', '.tp-status', '.tp-topbar-actions', '.tp-status-right']) {
    const b = await box(page.locator(sel));
    expect(b.x, sel).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(W + 0.5);
  }
  // The minimap is dropped on narrow screens so the text gets the width.
  await expect(page.locator('.tp-minimap')).toBeHidden();
  await fits(page);
});

test('find box stacks: the field gets a full row', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Search commands', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Replace');
  await page.keyboard.press('Enter');
  const find = await box(page.locator('.tp-find'));
  expect(find.x).toBeGreaterThanOrEqual(0);
  expect(find.x + find.width).toBeLessThanOrEqual(W);
  expect((await box(page.getByRole('textbox', { name: 'Find', exact: true }))).width).toBeGreaterThan(180);
  expect((await box(page.getByRole('textbox', { name: 'Replace with' }))).width).toBeGreaterThan(180);
  for (const name of ['Previous match', 'Next match', 'Close find', 'Replace all']) {
    const b = await box(page.getByRole('button', { name }));
    expect(b.x + b.width, name).toBeLessThanOrEqual(find.x + find.width);
  }
  await fits(page);
});

test('sidebar opens over the editor and closes again', async ({ page }) => {
  await page.getByRole('button', { name: 'Appearance' }).click();
  const side = await box(page.locator('.tp-sidebar'));
  const rail = await box(page.locator('.tp-rail'));
  expect(Math.round(side.x)).toBe(Math.round(rail.x + rail.width));
  expect(Math.round(side.x + side.width)).toBe(W);
  await page.getByRole('radio', { name: 'Paper' }).tap();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await fits(page);
  await page.getByRole('button', { name: 'Close sidebar' }).tap();
  await expect(page.locator('.tp-sidebar')).toHaveCount(0);
});

test('typing works and the palette fits', async ({ page }) => {
  await page.locator('.cm-content').focus();
  await page.keyboard.type('hello phone');
  expect(await docText(page)).toBe('hello phone');
  await page.getByRole('button', { name: 'Search commands', exact: true }).tap();
  const p = await box(page.locator('.tp-palette'));
  expect(p.x).toBeGreaterThanOrEqual(0);
  expect(p.x + p.width).toBeLessThanOrEqual(W);
  await fits(page);
});

test('Open files list, tab menu and rename fit on a phone', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'New tab' }).tap();
  await page.getByRole('button', { name: /^Open files list/ }).tap();
  const side = await box(page.locator('.tp-sidebar'));
  for (const sel of ['.tp-files-filter', '.tp-files-sort', '.tp-file', '.tp-file-btn']) {
    for (const el of await page.locator(sel).all()) {
      const b = await box(el);
      expect(b.x, sel).toBeGreaterThanOrEqual(side.x);
      expect(b.x + b.width, sel).toBeLessThanOrEqual(W);
    }
  }
  await page.getByRole('button', { name: 'More actions for sample-spring-boot.log' }).tap();
  const m = await box(page.getByRole('menu'));
  expect(m.x).toBeGreaterThanOrEqual(0);
  expect(m.x + m.width).toBeLessThanOrEqual(W);
  await page.getByRole('menuitem', { name: /Rename/ }).tap();
  const input = page.getByRole('textbox', { name: /^New name for/ });
  const f = await box(input);
  expect(f.x + f.width).toBeLessThanOrEqual(W);
  await input.fill('renamed-on-phone.log');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tp-file-name', { hasText: 'renamed-on-phone.log' })).toBeVisible();
  await fits(page);
});

test('the log bar fits: timeline, chips and filters without sideways scrolling', async ({ page }) => {
  await openSample(page);
  await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
  for (const sel of ['.tp-logbar', '.tp-timeline-strip', '.tp-lf-text', '.tp-lf-more', '.tp-lf-count']) {
    const b = await box(page.locator(sel));
    expect(b.x, sel).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, sel).toBeLessThanOrEqual(W + 0.5);
  }
  await page.locator('.tp-chip', { hasText: 'ERROR' }).tap();
  await expect(page.getByTestId('filter-count')).toHaveText('3 of 370 entries');
  await page.getByRole('button', { name: /More filters/ }).tap();
  for (const el of await page.locator('.tp-lf-advanced .tp-input').all()) {
    const b = await box(el);
    expect(b.x + b.width).toBeLessThanOrEqual(W);
    expect(b.width).toBeGreaterThan(120);
  }
  // The editor keeps a usable share of the screen under the log bar.
  expect((await box(page.locator('.tp-editor-area'))).height).toBeGreaterThan(380);
  await fits(page);
});

test('the large-file viewer works on a phone: fits, scrolls by touch-sized steps, filters', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('tracepad.settings', JSON.stringify({ largeFileMB: 0.001 })));
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
  await page.reload();
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  const text = Array.from({ length: 3000 }, (_, i) => `2026-03-14 10:${String(Math.floor(i / 60) % 60).padStart(2, '0')}:${String(i % 60).padStart(2, '0')} ${i % 50 === 0 ? 'ERROR' : 'INFO'} com.acme.Job - step ${i}`).join('\n') + '\n';
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).tap();
  await (await chooser).setFiles([{ name: 'phone.log', mimeType: 'text/plain', buffer: Buffer.from(text) }]);
  await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible();
  const view = await box(page.locator('.tp-big'));
  expect(view.x + view.width).toBeLessThanOrEqual(W + 0.5);
  expect(view.height).toBeGreaterThan(380);
  await expect(page.locator('.tp-big-row').first().locator('.tp-big-text')).toContainText('step 0');
  await page.locator('.tp-chip', { hasText: 'ERROR' }).tap();
  await expect(page.getByTestId('filter-count')).toHaveText('60 of 3,000 entries');
  await expect(page.locator('.tp-big-row').nth(1).locator('.tp-big-text')).toContainText('step 50');
  await fits(page);
});

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

test('auto tables on a phone: patterns stack above the table and nothing is wider than the screen', async ({ page }) => {
  await openSample(page);
  await page.getByRole('button', { name: 'Search commands', exact: true }).tap();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Auto tables');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tp-vt-row').first()).toBeVisible();
  const pats = await box(page.locator('.tp-pats'));
  const table = await box(page.locator('.tp-table-area'));
  expect(pats.y + pats.height).toBeLessThanOrEqual(table.y + 1);
  for (const b of [pats, table, await box(page.locator('.tp-panel'))]) {
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(W + 0.5);
  }
  expect(table.height).toBeGreaterThan(90);
  await page.locator('.tp-pat', { hasText: 'Created order' }).tap();
  await expect(page.locator('.tp-vt-th .tp-vt-name', { hasText: 'orderId' })).toBeVisible();
  await page.getByRole('button', { name: 'Maximise results panel' }).tap();
  expect((await box(page.locator('.tp-table-area'))).height).toBeGreaterThan(300);
  await fits(page);
});

test('a table inserted by the keyboard in one go (no paste event) becomes a Markdown table', async ({ page }) => {
  await page.locator('.cm-content').focus();
  // Phone keyboards insert clipboard text as ordinary input.
  await page.keyboard.insertText('Service\tCalls\tp95 (ms)\norders\t1200\t340\nbilling\t87\t1210');
  await expect.poll(() => docText(page)).toContain('| Service |');
  expect(await docText(page)).toMatch(/\| billing \| +87 \| +1210 \|/);
  // Ordinary typing and ordinary sentences are left alone.
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText('We restarted it, twice, and then it worked.');
  await expect.poll(() => docText(page)).toBe('We restarted it, twice, and then it worked.');
  await fits(page);
});

test('the Markdown preview covers the editor and fits the screen, also in full screen', async ({ page }) => {
  await page.locator('.cm-content').focus();
  await page.keyboard.insertText('# Notes\n\nSome text that is long enough to wrap on a phone screen, so wrapping can be checked here.\n\n| Service name | Calls made | p95 (ms) | Owner team | Region |\n| --- | --- | --- | --- | --- |\n| orders | 1200 | 340 | Core platform | eu-west-1 |\n');
  await page.getByRole('button', { name: 'Search commands', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Markdown preview');
  await page.keyboard.press('Enter');
  const pv = page.locator('.tp-preview');
  await expect(pv).toBeVisible();
  await expect(page.locator('.tp-md h1')).toHaveText('Notes');
  const area = await box(page.locator('.tp-editor-area'));
  const b = await box(pv);
  // It takes the whole editor area (beside the rail).
  expect(b.x).toBeCloseTo(area.x, 0);
  expect(b.width).toBeCloseTo(area.width, 0);
  expect(b.height).toBeCloseTo(area.height, 0);
  // The wide table scrolls inside its own box; the page and the preview do not scroll sideways.
  const m = await page.locator('.tp-preview-scroll').evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
  expect(m.sw).toBeLessThanOrEqual(m.cw);
  const head = await box(page.locator('.tp-preview-head'));
  for (const btn of await page.locator('.tp-preview-actions button').all()) {
    const bb = await box(btn);
    expect(bb.x).toBeGreaterThanOrEqual(0);
    expect(bb.x + bb.width).toBeLessThanOrEqual(head.x + head.width);
  }
  const tools = await box(page.locator('.tp-md-tool').last());
  expect(tools.x + tools.width).toBeLessThanOrEqual(W);
  await fits(page);
  await page.getByRole('button', { name: 'Preview full screen' }).click();
  await expect(pv).toHaveClass(/is-fullscreen/);
  expect((await box(pv)).width).toBe(W);
  await fits(page);
  // The table editor stays on the screen; the grid scrolls inside it.
  await page.getByRole('button', { name: 'Edit as table' }).click();
  const dlg = await box(page.getByRole('dialog', { name: 'Edit table' }));
  expect(dlg.x).toBeGreaterThanOrEqual(0);
  expect(dlg.x + dlg.width).toBeLessThanOrEqual(W);
  for (const name of ['Cancel', 'Save table', 'Add row', 'Remove last column']) {
    const bb = await box(page.getByRole('dialog', { name: 'Edit table' }).getByRole('button', { name, exact: true }));
    expect(bb.x, name).toBeGreaterThanOrEqual(dlg.x);
    expect(bb.x + bb.width, name).toBeLessThanOrEqual(dlg.x + dlg.width);
    expect(bb.y + bb.height, name).toBeLessThanOrEqual(dlg.y + dlg.height);
  }
  await fits(page);
  await page.getByRole('dialog', { name: 'Edit table' }).getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Close preview' }).click();
  await expect(pv).toHaveCount(0);
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('split view on a phone: the panes stack, each with its header, and nothing scrolls sideways', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
  await page.reload();
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).tap();
  await (await chooser).setFiles(['one.txt', 'two.txt', 'three.txt'].map((name) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(`${name} line\n`.repeat(40)) })));
  await expect(page.getByRole('tab', { name: 'three.txt' })).toBeVisible();
  await page.getByRole('button', { name: 'Split layouts' }).tap();
  const pop = await box(page.getByRole('dialog', { name: 'Split layouts' }));
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width).toBeLessThanOrEqual(W);
  for (const t of await page.locator('.tp-split-pop .tp-thumb').all()) {
    const b = await box(t);
    expect(b.x).toBeGreaterThanOrEqual(pop.x);
    expect(b.x + b.width).toBeLessThanOrEqual(pop.x + pop.width);
  }
  await page.getByRole('button', { name: 'Three columns, place 1 of 3' }).tap();
  // Snap Assist in a short pane: its title is reachable (the list scrolls), not cut off above the pane.
  const assistBox = await box(page.locator('.tp-assist').first());
  const title = await box(page.locator('.tp-assist-title').first());
  expect(title.y).toBeGreaterThanOrEqual(assistBox.y);
  await page.locator('.tp-assist').first().locator('.tp-assist-card').first().tap();
  await page.locator('.tp-assist').first().locator('.tp-assist-card').first().tap();
  const area = await box(page.locator('.tp-editor-area'));
  const boxes = await Promise.all((await page.locator('.tp-pane').all()).map(box));
  expect(boxes).toHaveLength(3);
  for (const [i, b] of boxes.entries()) {
    // Stacked: full width, one under the other, about a third each.
    expect(b.x).toBeCloseTo(area.x, 0);
    expect(b.width).toBeCloseTo(area.width, 0);
    expect(b.height).toBeGreaterThan(area.height / 3 - 4);
    if (i) expect(b.y).toBeCloseTo(boxes[i - 1].y + boxes[i - 1].height, 0);
  }
  expect(boxes[2].y + boxes[2].height).toBeCloseTo(area.y + area.height, 0);
  await expect(page.getByRole('separator', { name: 'Resize panes' })).toHaveCount(0);
  for (const h of await page.locator('.tp-pane-head').all()) {
    for (const b of await h.locator('button').all()) {
      const bb = await box(b);
      expect(bb.x).toBeGreaterThanOrEqual(area.x);
      expect(bb.x + bb.width).toBeLessThanOrEqual(area.x + area.width);
    }
  }
  await fits(page);
  await page.getByRole('button', { name: 'Remove pane 3' }).tap();
  await page.getByRole('button', { name: 'Remove pane 2' }).tap();
  await expect(page.locator('.tp-pane')).toHaveCount(1);
  expect((await box(page.locator('.tp-pane'))).height).toBeCloseTo(area.height, 0);
});

test('the compare view fits a phone', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
  await page.reload();
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  const lines = Array.from({ length: 60 }, (_, i) => `setting.${i} = value ${i}`);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).tap();
  await (await chooser).setFiles([
    { name: 'old.properties', mimeType: 'text/plain', buffer: Buffer.from(lines.join('\n')) },
    { name: 'new.properties', mimeType: 'text/plain', buffer: Buffer.from(lines.map((l, i) => (i === 5 ? 'setting.5 = changed' : l)).join('\n')) },
  ]);
  await expect(page.getByRole('tab', { name: 'new.properties' })).toBeVisible();
  await page.getByRole('button', { name: 'Search commands', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search commands' }).fill('Compare with');
  await page.keyboard.press('Enter');
  const cmp = page.locator('.tp-compare');
  await expect(cmp).toBeVisible();
  await expect(page.locator('.tp-compare-status')).toHaveText('1 change');
  const c = await box(cmp);
  expect(c.x + c.width).toBeLessThanOrEqual(W + 0.5);
  const head = await box(page.locator('.tp-compare-head'));
  for (const b of await page.locator('.tp-compare-actions button:visible').all()) {
    const bb = await box(b);
    expect(bb.x).toBeGreaterThanOrEqual(head.x);
    expect(bb.x + bb.width).toBeLessThanOrEqual(head.x + head.width);
  }
  const sides = await Promise.all((await page.locator('.tp-compare .cm-mergeViewEditor').all()).map(box));
  expect(Math.abs(sides[0].width - sides[1].width)).toBeLessThan(3);
  await fits(page);
  await page.getByRole('button', { name: 'Close compare' }).tap();
  await expect(cmp).toHaveCount(0);
});

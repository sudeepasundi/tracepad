// Core behaviour. Runs against BOTH builds (projects "pwa" and "single").
import { expect, test } from '@playwright/test';
import { docText, editor, openApp, openSample, selectionCount } from './helpers';

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test('starts with a welcome card and a closed sidebar', async ({ page }) => {
  await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  for (const name of [/Open a file/, /Try the sample log/, /Search commands/]) {
    await expect(page.getByRole('region', { name: 'Welcome' }).getByRole('button', { name })).toBeVisible();
  }
  await expect(page.locator('.tp-sidebar')).toHaveCount(0);
});

test('the sample log opens as a log tab and the sidebar stays closed', async ({ page }) => {
  await openSample(page);
  await expect(page.getByTestId('status-lang')).toHaveText('Log');
  await expect(page.getByTestId('status-eol')).toHaveText('LF');
  await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8');
  await expect(page.locator('.tp-status')).toContainText('423 lines');
  await expect(page.locator('.tp-sidebar')).toHaveCount(0);
  const text = await docText(page);
  for (const needle of ['Caused by:', 'feign.RetryableException', 'topic=payments.events', 'NullPointerException', 'DiscoveryClient']) {
    expect(text).toContain(needle);
  }
  expect(text).toMatch(/\[[0-9a-f]{32}-[0-9a-f]{16}\]/);
});

test('typing dismisses the welcome card and marks the tab unsaved', async ({ page }) => {
  await editor(page).focus();
  await page.keyboard.type('hello');
  await expect(page.getByRole('region', { name: 'Welcome' })).toHaveCount(0);
  await expect(page.locator('.tp-tab.is-active')).toHaveClass(/is-dirty/);
  await expect(page.locator('.tp-status')).toContainText('Unsaved changes');
  // Undo back to the saved text clears the marker again.
  await page.keyboard.press('Control+Z');
  await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
});

test('multi-cursor: Ctrl+Alt+Down adds cursors and typing goes to all of them', async ({ page }) => {
  await editor(page).focus();
  await page.keyboard.type('one\ntwo\nthree');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+Alt+ArrowDown');
  await page.keyboard.press('Control+Alt+ArrowDown');
  expect(await selectionCount(page)).toBe(3);
  await expect(page.locator('.tp-status')).toContainText('3 cursors');
  await page.keyboard.type('> ');
  expect(await docText(page)).toBe('> one\n> two\n> three');
});

test('column selection: Alt+drag makes one selection per line', async ({ page }) => {
  await editor(page).focus();
  await page.keyboard.type('abcdef\nabcdef\nabcdef\nabcdef');
  const lines = page.locator('.cm-line');
  const first = (await lines.nth(0).boundingBox())!;
  const last = (await lines.nth(3).boundingBox())!;
  await page.keyboard.down('Alt');
  await page.mouse.move(first.x + 24, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(first.x + 60, last.y + last.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Alt');
  expect(await selectionCount(page)).toBe(4);
  await page.keyboard.type('X');
  const out = (await docText(page)).split('\n');
  expect(new Set(out).size).toBe(1);
  expect(out[0]).toContain('X');
  expect(out[0].length).toBeLessThan(6);
});

test('Ctrl+D selects the next occurrence', async ({ page }) => {
  await editor(page).focus();
  await page.keyboard.type('foo bar foo baz foo');
  await page.keyboard.press('Control+Home');
  await page.keyboard.press('Control+D');
  await page.keyboard.press('Control+D');
  await page.keyboard.press('Control+D');
  expect(await selectionCount(page)).toBe(3);
});

test('find and replace with a regular expression', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('Control+H');
  const find = page.getByRole('textbox', { name: 'Find', exact: true });
  await expect(find).toBeFocused();
  await find.fill('orderId=(\\d+)');
  await page.getByRole('button', { name: 'Regular expression' }).click();
  await expect(page.locator('.tp-find-count')).toContainText(/of \d+/);
  await page.getByRole('textbox', { name: 'Replace with' }).fill('order#$1');
  await page.getByRole('button', { name: 'Replace all' }).click();
  const text = await docText(page);
  expect(text).not.toMatch(/orderId=\d+/);
  expect(text).toMatch(/order#\d+/);
  await expect(page.locator('.tp-find-count')).toHaveText('No results');
  // An invalid pattern is reported, not thrown.
  await find.fill('([');
  await expect(page.locator('.tp-find-count')).toHaveText('Invalid pattern');
  await page.keyboard.press('Escape');
  await expect(page.locator('.tp-find')).toHaveCount(0);
  await expect(editor(page)).toBeFocused();
});

test('F3 steps through matches and the counter follows', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('Control+F');
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('ERROR');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tp-find-count')).toContainText(/^1 of \d+$/);
  await page.keyboard.press('F3');
  await expect(page.locator('.tp-find-count')).toContainText(/^2 of \d+$/);
  await page.keyboard.press('Shift+F3');
  await expect(page.locator('.tp-find-count')).toContainText(/^1 of \d+$/);
});

test('go to line', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('Control+G');
  const input = page.getByRole('dialog').getByRole('textbox');
  await input.fill('abc');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toContainText('Type a line number');
  await input.fill('120:5');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.tp-status')).toContainText('Ln 120, Col 5');
});

test('command palette lists every action with its shortcut and runs them', async ({ page }) => {
  await page.keyboard.press('Control+Shift+P');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  expect(await palette.getByRole('option').count()).toBeGreaterThan(30);
  await expect(palette.getByRole('option', { name: /Save As/ })).toContainText('Ctrl+Shift+S');
  await expect(palette.getByRole('option', { name: /Go to line/ })).toContainText('Ctrl+G');
  await page.keyboard.type('word wrap');
  await expect(palette.getByRole('option').first()).toContainText('Toggle word wrap');
  await page.keyboard.press('Enter');
  await expect(palette).toHaveCount(0);
  await expect(page.locator('.tp-status')).toContainText('Wrap on');
  await expect(page.locator('.cm-content')).toHaveClass(/cm-lineWrapping/);
});

test('Escape closes the top-most layer first', async ({ page }) => {
  await openSample(page);
  await page.keyboard.press('Control+F');
  await page.keyboard.press('Control+Shift+P');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
  await expect(page.locator('.tp-find')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tp-find')).toHaveCount(0);
});

test('tabs: new, switch, per-tab content, close with unsaved prompt', async ({ page }) => {
  await editor(page).focus();
  await page.keyboard.type('first tab');
  await page.keyboard.press('Alt+N');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.keyboard.type('second tab');
  await page.keyboard.press('Alt+PageUp');
  expect(await docText(page)).toBe('first tab');
  await page.keyboard.press('Alt+PageDown');
  expect(await docText(page)).toBe('second tab');

  await page.keyboard.press('Alt+W');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Save changes to untitled-2.txt?');
  await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.keyboard.press('Alt+W');
  await page.getByRole('dialog').getByRole('button', { name: "Don't save" }).click();
  await expect(page.getByRole('tab')).toHaveCount(1);
  expect(await docText(page)).toBe('first tab');
});

test('many tabs scroll sideways instead of being squeezed', async ({ page }) => {
  for (let i = 0; i < 24; i++) await page.getByRole('button', { name: 'New tab' }).click();
  const strip = page.locator('.tp-tabs');
  const m = await strip.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth, min: Math.min(...[...el.children].map((c) => (c as HTMLElement).offsetWidth)) }));
  expect(m.scroll).toBeGreaterThan(m.client);
  expect(m.min).toBeGreaterThan(90);
  await expect(page.locator('.tp-tab.is-active')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Search commands', exact: true })).toBeInViewport();
  // The rail badge counts open files.
  await expect(page.locator('.tp-rail-badge')).toHaveText('25');
});

test('the engine is running as Rust/WebAssembly', async ({ page }) => {
  await page.getByRole('button', { name: 'Help and shortcuts' }).click();
  await expect(page.getByTestId('engine-kind')).toHaveText('Rust (WebAssembly)');
});

test('settings survive a reload made immediately after the change', async ({ page }) => {
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Dawn' }).click();
  await page.getByRole('radio', { name: 'Rose' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  // No waiting: the debounced save has not fired yet; pagehide must flush it.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('tracepad.settings')!));
  expect(stored).toMatchObject({ theme: 'dawn', accent: 'rose', density: 'compact' });
});

test('makes no network request to any other origin', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const foreign: string[] = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) foreign.push(u);
  });
  await page.reload();
  await openSample(page);
  await page.keyboard.press('Control+Shift+P');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Help and shortcuts' }).click();
  await page.waitForTimeout(500);
  expect(foreign).toEqual([]);
});

test('no console errors during normal use', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.reload();
  await openSample(page);
  await page.keyboard.press('Control+F');
  await page.keyboard.type('WARN');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Paper' }).click();
  await page.waitForTimeout(300);
  expect(errors).toEqual([]);
});

// Firefox and WebKit: core editing must work even where newer APIs are missing.
import { expect, test } from '@playwright/test';
import { docText, editor, openApp, openSample, openViaChooser } from './helpers';

test('loads, edits, finds and opens the palette', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await editor(page).focus();
  await page.keyboard.type('alpha\nbeta\ngamma');
  expect(await docText(page)).toBe('alpha\nbeta\ngamma');
  await page.keyboard.press('ControlOrMeta+f');
  await page.getByRole('textbox', { name: 'Find', exact: true }).fill('beta');
  await expect(page.locator('.tp-find-count')).toContainText('of 1');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Search commands', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});

test('sample log, themes and the engine work', async ({ page }) => {
  await openApp(page);
  await openSample(page);
  await expect(page.locator('.tp-status')).toContainText('423 lines');
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Mist' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await page.getByRole('button', { name: 'Help and shortcuts' }).click();
  await expect(page.getByTestId('engine-kind')).toHaveText(/Rust \(WebAssembly\)|TypeScript fallback/);
});

test('files open through the basic picker and save as a download', async ({ page }) => {
  await openApp(page);
  await openViaChooser(page, [{ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('one\r\ntwo\r\n') }]);
  await expect(page.getByRole('tab', { name: 'notes.txt' })).toBeVisible();
  await expect(page.getByTestId('status-eol')).toHaveText('CRLF');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await download).suggestedFilename()).toBe('notes.txt');
});

const LOG_A = Array.from({ length: 200 }, (_, i) => `2026-03-14 10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000 ${i % 20 === 3 ? 'ERROR' : 'INFO '} [a] com.acme.A - step ${i}`).join('\n') + '\n';
const LOG_B = Array.from({ length: 100 }, (_, i) => `2026-03-14 10:${String(Math.floor((i * 2) / 60)).padStart(2, '0')}:${String((i * 2) % 60).padStart(2, '0')}.000 INFO  [b] com.acme.B - tick ${i}`).join('\n') + '\n';
const txt = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

test('logs: levels are counted, a filter hides lines, and auto tables builds a table', async ({ page }) => {
  await openApp(page);
  await openViaChooser(page, [txt('a.log', LOG_A)]);
  await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
  await expect(page.locator('.tp-chip', { hasText: 'ERROR' })).toContainText('10');
  await page.locator('.tp-chip', { hasText: 'ERROR' }).click();
  await expect(page.locator('.tp-lf-count')).toHaveText('10 of 200 entries');
  await expect(page.locator('.cm-line').first()).toContainText('ERROR');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByRole('button', { name: 'Auto tables', exact: true }).click();
  await expect(page.locator('.tp-vt-row').first()).toBeVisible();
  await expect(page.locator('.tp-pats-count')).toContainText('patterns from 200 entries');
});

test('split view, scroll together by time, and compare', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openApp(page);
  await openViaChooser(page, [txt('a.log', LOG_A), txt('b.log', LOG_B)]);
  await expect(page.getByRole('tab', { name: 'b.log' })).toBeVisible();
  await page.getByRole('button', { name: 'Split layouts' }).click();
  await page.getByRole('button', { name: 'Side by side, place 2 of 2' }).click();
  await page.locator('.tp-assist-card', { hasText: 'a.log' }).click();
  await expect(page.locator('.tp-pane')).toHaveCount(2);
  await expect(page.locator('.tp-pane[data-pane="0"] .cm-line').first()).toContainText('[a]');
  await expect(page.locator('.tp-pane[data-pane="1"] .cm-line').first()).toContainText('[b]');
  // Time sync: a.log has one entry a second, b.log one every two seconds.
  type Hook = { scrollTab(n: string, l: number): void; topLine(n: string): number | null };
  await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
  await expect
    .poll(async () => {
      await page.evaluate(() => (window as unknown as { __tracepad: Hook }).__tracepad.scrollTab('a.log', 120));
      return page.evaluate(() => (window as unknown as { __tracepad: Hook }).__tracepad.topLine('b.log'));
    })
    .toBe(60);
  // Compare the two panes.
  await page.getByRole('tab', { name: 'a.log' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: /Compare with/ }).click();
  await expect(page.locator('.tp-compare .cm-mergeViewEditor')).toHaveCount(2);
  await expect(page.locator('.tp-compare-status')).toContainText('change');
  await page.getByRole('button', { name: 'Close compare' }).click();
  expect(errors).toEqual([]);
});

test('Markdown preview renders, sorts a table, and a pasted table becomes Markdown', async ({ page, browserName }) => {
  await openApp(page);
  await openViaChooser(page, [txt('notes.md', '# Notes\n\n| Name | Count |\n| --- | ---: |\n| b | 20 |\n| a | 3 |\n')]);
  await expect(page.getByRole('tab', { name: 'notes.md' })).toBeVisible();
  await page.getByRole('button', { name: 'Toggle preview' }).click();
  await expect(page.locator('.tp-md h1')).toHaveText('Notes');
  await page.locator('.tp-md th', { hasText: 'Count' }).click();
  await expect(page.locator('.tp-md tbody tr').first()).toContainText('a');
  await page.getByRole('button', { name: 'Close preview' }).click();
  // Firefox does not let a script build a paste event that carries data, so the paste half runs elsewhere.
  if (browserName === 'firefox') return;
  // A paste event carrying tab-separated text (no clipboard permission needed).
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Service\tCalls\norders\t1200\nbilling\t87');
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => docText(page)).toContain('| Service | Calls |');
});

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

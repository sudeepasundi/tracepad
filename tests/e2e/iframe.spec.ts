// The single-file build inside a sandboxed, cross-origin iframe (how an artifact
// host embeds it). Storage and the File System Access picker are unavailable
// there; the app must degrade, not break.
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { FRAME_HOST } from '../../playwright.config';
import { docText, openSample } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto(FRAME_HOST);
  await expect(page.frameLocator('#embedded').locator('html[data-ready="true"]')).toBeAttached();
});

test('the frame really is cross-origin and sandboxed', async ({ page }) => {
  const frame = page.frames().find((f) => f.url().includes('tracepad.html'))!;
  expect(new URL(frame.url()).origin).not.toBe(new URL(page.url()).origin);
  const facts = await frame.evaluate(() => {
    let storage = true;
    try {
      localStorage.setItem('x', '1');
    } catch {
      storage = false;
    }
    let parentReadable = true;
    try {
      void window.top!.location.href;
    } catch {
      parentReadable = false;
    }
    return { origin: window.origin, storage, parentReadable };
  });
  expect(facts).toEqual({ origin: 'null', storage: false, parentReadable: false });
});

test('editing, the sample log, find and the palette work inside the frame', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  const frame = page.frames().find((f) => f.url().includes('tracepad.html'))!;
  await expect(app.getByRole('region', { name: 'Welcome' })).toBeVisible();
  await openSample(app);
  expect(await docText(frame)).toContain('Started OrderServiceApplication');
  await app.locator('.cm-content').click();
  await page.keyboard.press('Control+F');
  await app.getByRole('textbox', { name: 'Find', exact: true }).fill('ERROR');
  await expect(app.locator('.tp-find-count')).toContainText(/of \d+/);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+P');
  await expect(app.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('settings fall back to memory and the engine still runs', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  await app.getByRole('button', { name: 'Appearance' }).click();
  await app.getByRole('radio', { name: 'Paper' }).click();
  await expect(app.locator('html')).toHaveAttribute('data-mode', 'light');
  await app.getByRole('button', { name: 'Help and shortcuts' }).click();
  await expect(app.locator('.tp-sidebar')).toContainText('This page only');
  await expect(app.locator('.tp-sidebar')).toContainText('Single file');
  await expect(app.getByTestId('engine-kind')).toHaveText(/Rust \(WebAssembly\)|TypeScript fallback/);
});

test('Open uses the basic picker straight away, and Save downloads', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  const frame = page.frames().find((f) => f.url().includes('tracepad.html'))!;
  // The File System Access picker exists in Chromium but is blocked in a
  // cross-origin frame; the app must not even try it.
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await app.getByRole('button', { name: 'Open a file', exact: true }).click();
  await (await chooser).setFiles([{ name: 'framed.log', mimeType: 'text/plain', buffer: Buffer.from('10:15:02 INFO framed\r\n10:15:03 WARN two\r\n') }]);
  await expect(app.getByRole('tab', { name: 'framed.log' })).toBeVisible();
  await expect(app.getByTestId('status-eol')).toHaveText('CRLF');
  await expect(app.locator('.tp-toast-error')).toHaveCount(0);

  await app.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('added');
  expect(await docText(frame)).toContain('added');
  const download = page.waitForEvent('download');
  await page.keyboard.press('Control+S');
  const saved = await readFile(await (await download).path());
  expect(saved.toString('utf8')).toBe('10:15:02 INFO framed\r\n10:15:03 WARN two\r\nadded');
});

test('the framed app fills the frame without scrolling the host page', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  const vp = page.viewportSize()!;
  const status = (await app.locator('.tp-status').boundingBox())!;
  expect(Math.round(status.y + status.height)).toBe(vp.height);
  expect(Math.round(status.width)).toBe(vp.width);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

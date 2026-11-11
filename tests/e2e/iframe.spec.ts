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
  // Hosts may block downloads from a frame, so Save offers the clipboard as well.
  await page.keyboard.press('Control+S');
  const dialog = app.getByRole('dialog');
  await expect(dialog).toContainText('may block downloads');
  await expect(dialog.getByRole('button', { name: 'Copy all text' })).toBeVisible();
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download' }).click();
  const saved = await readFile(await (await download).path());
  expect(saved.toString('utf8')).toBe('10:15:02 INFO framed\r\n10:15:03 WARN two\r\nadded');
  await expect(app.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
});

test('rename, the tab menu and the Open files list work in the frame', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  await app.locator('.cm-content').focus();
  await page.keyboard.type('framed text');
  await page.keyboard.press('F2');
  await app.getByRole('textbox', { name: /^New name for/ }).fill('framed.md');
  await page.keyboard.press('Enter');
  await expect(app.getByRole('tab', { name: 'framed.md' })).toBeVisible();
  await expect(app.getByTestId('status-lang')).toHaveText('Markdown');
  await app.getByRole('tab', { name: 'framed.md' }).click({ button: 'right' });
  await expect(app.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await app.getByRole('button', { name: /^Open files list/ }).click();
  await expect(app.locator('.tp-file')).toContainText('framed.md');
  await expect(app.locator('.tp-toast-error')).toHaveCount(0);
});

test('the framed app fills the frame without scrolling the host page', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  const vp = page.viewportSize()!;
  const status = (await app.locator('.tp-status').boundingBox())!;
  expect(Math.round(status.y + status.height)).toBe(vp.height);
  expect(Math.round(status.width)).toBe(vp.width);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
});

test('auto tables, the results panel and its full screen work inside the frame', async ({ page }) => {
  const app = page.frameLocator('#embedded');
  await openSample(app);
  await app.getByRole('button', { name: 'Auto tables', exact: true }).click();
  await expect(app.locator('.tp-pats-count')).toHaveText('42 patterns from 370 entries');
  await app.locator('.tp-pat', { hasText: 'Created order' }).click();
  await expect(app.locator('.tp-vt-th .tp-vt-name', { hasText: 'customerId' })).toBeVisible();
  // Real full screen is not allowed in the frame: the panel fills the frame instead.
  await app.getByRole('button', { name: 'Results full screen' }).click();
  const vp = page.viewportSize()!;
  const b = (await app.locator('.tp-panel').boundingBox())!;
  expect([Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]).toEqual([0, 0, vp.width, vp.height]);
  await app.locator('.tp-vt').click();
  await page.keyboard.press('Escape');
  await expect(app.locator('.tp-panel')).not.toHaveClass(/is-fullscreen/);
  await expect(app.locator('.tp-toast-error')).toHaveCount(0);
});

test('pasted tables, the preview and its full screen work inside the frame', async ({ page }) => {
  const frame = page.frameLocator('#embedded');
  const inner = page.frames().find((f) => f.url().includes('tracepad.html'))!;
  await frame.locator('.cm-content').focus();
  // The clipboard API is not available in the frame; a real paste event still carries the data.
  await inner.evaluate(() => {
    const data = new DataTransfer();
    data.setData('text/plain', 'Service\tCalls\norders\t1200\nbilling\t87');
    data.setData('text/html', '<table><tr><th>Service</th><th>Calls</th></tr><tr><td>orders</td><td>1200</td></tr><tr><td>billing</td><td>87</td></tr></table>');
    document.querySelector('.cm-content')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect.poll(() => docText(inner)).toContain('| Service | Calls |');
  await frame.locator('.cm-content').click();
  await page.keyboard.press('Alt+P');
  await expect(frame.locator('.tp-preview')).toBeVisible();
  await expect(frame.locator('.tp-md table tbody tr')).toHaveCount(2);
  await frame.locator('.tp-md th', { hasText: 'Calls' }).click();
  await expect(frame.locator('.tp-md table tbody tr').first()).toContainText('billing');
  // Full screen is not allowed in the sandbox: the preview fills the frame instead.
  await frame.getByRole('button', { name: 'Preview full screen' }).click();
  await expect(frame.locator('.tp-preview')).toHaveClass(/is-fullscreen/);
  const size = await inner.evaluate(() => {
    const r = document.querySelector('.tp-preview')!.getBoundingClientRect();
    return { w: r.width, h: r.height, vw: innerWidth, vh: innerHeight };
  });
  expect(size.w).toBe(size.vw);
  expect(size.h).toBe(size.vh);
  await frame.locator('.tp-md-tablebox').getByRole('button', { name: 'Edit as table' }).click();
  await frame.getByRole('textbox', { name: 'Row 1, column 2' }).fill('1300');
  await frame.getByRole('button', { name: 'Save table' }).click();
  await expect.poll(() => docText(inner)).toContain('| orders  |  1300 |');
  await frame.getByRole('button', { name: 'Leave full screen' }).click();
  await expect(frame.locator('.tp-preview')).not.toHaveClass(/is-fullscreen/);
});

test('Copy as table, Copy CSV and the preview copies work inside the frame', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(FRAME_HOST).origin });
  const app = page.frameLocator('#embedded');
  const inner = page.frames().find((f) => f.url().includes('tracepad.html'))!;
  // The frame has no clipboard permission at all.
  expect(await inner.evaluate(() => navigator.clipboard.writeText('x').then(() => 'allowed', () => 'refused'))).toBe('refused');
  const read = async () => {
    await page.evaluate(() => window.focus());
    return page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      const get = async (t: string) => (item.types.includes(t) ? (await (await item.getType(t)).text()).replace(/\r/g, '') : '');
      return { html: await get('text/html'), text: await get('text/plain') };
    });
  };
  await openSample(app);
  await app.getByRole('button', { name: 'Auto tables', exact: true }).click();
  await app.locator('.tp-pat', { hasText: 'Created order' }).click();
  await expect(app.locator('.tp-vt-th .tp-vt-name', { hasText: 'customerId' })).toBeVisible();
  await app.locator('.tp-table-tools').getByRole('button', { name: 'Copy as table' }).click();
  await expect(app.locator('.tp-toast', { hasText: 'as a table' })).toBeVisible();
  let clip = await read();
  expect(clip.html).toContain('<table');
  expect(clip.html).toMatch(/<th[^>]*>orderId<\/th>/);
  expect(clip.text.split('\n')[0]).toBe('line\ttime\tthread\torderId\tcustomerId\titems\ttotal\ttrace');
  await app.locator('.tp-table-tools').getByRole('button', { name: 'Copy CSV' }).click();
  await expect(app.locator('.tp-toast', { hasText: 'as CSV' })).toBeVisible();
  clip = await read();
  expect(clip.text.split('\n')[0]).toBe('line,time,thread,orderId,customerId,items,total,trace');
  await expect(app.locator('.tp-toast-error')).toHaveCount(0);
});

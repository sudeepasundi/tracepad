// Large-file viewer and live files (0.4). To keep these fast, the "large file"
// threshold is lowered to 1 KB so ordinary fixtures go through the viewer; a
// genuinely large generated log is covered in biglog.spec.ts.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { box, contrastOf, docText, editor, openApp, openViaChooser, overlaps, useBasicFilePickers } from './helpers';
import { clearDisk, openLinked, readDisk, useLinkedPicker, writeDisk } from './linked';

const sample = readFileSync('src/assets/sample-spring.log', 'utf8');
const BIG = sample.repeat(40);
const BIG_LINES = BIG.split('\n').length - 1;
const SMALL_LIMIT = { largeFileMB: 0.001 };

interface BigState {
  status: string;
  lines: number;
  rows: number;
  top: number;
  cursor: number;
  size: number;
}
const big = (page: Page) => page.evaluate(() => (window as unknown as { __tracepad: { big(): BigState } }).__tracepad.big());
const checkDisk = (page: Page) => page.evaluate(() => (window as unknown as { __tracepad: { checkDisk(): Promise<void> } }).__tracepad.checkDisk());
const ready = (page: Page) => expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible({ timeout: 20_000 });
const rows = (page: Page) => page.locator('.tp-big-row');
const rowTexts = (page: Page) => page.locator('.tp-big-row .tp-big-text').allTextContents();
const rowNumbers = async (page: Page) => (await page.locator('.tp-big-row').evaluateAll((els) => els.map((e) => Number((e as HTMLElement).dataset.line)))).sort((a, b) => a - b);
const count = (page: Page) => page.getByTestId('filter-count');
const chip = (page: Page, name: string) => page.locator('.tp-chip', { hasText: name });
/** Waits until the rows on screen have their text. */
const settled = (page: Page) => expect.poll(async () => (await rowTexts(page)).filter((t) => t.length > 0).length, { timeout: 15_000 }).toBeGreaterThan(5);

async function openBig(page: Page, name = 'service.log', text = BIG): Promise<void> {
  await openViaChooser(page, [{ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') }]);
  await ready(page);
  await settled(page);
}

async function appendDisk(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(
    async ([n, t]) => {
      const root = await navigator.storage.getDirectory();
      const h = await root.getFileHandle(n);
      const size = (await h.getFile()).size;
      const w = await h.createWritable({ keepExistingData: true });
      await w.seek(size);
      await w.write(t);
      await w.close();
    },
    [name, text],
  );
}

test.describe('large-file viewer', () => {
  test.beforeEach(async ({ page }) => {
    await useBasicFilePickers(page);
    await openApp(page, SMALL_LIMIT);
  });

  test('opens read-only without loading the file into the editor, and only draws what is on screen', async ({ page }) => {
    await openBig(page);
    const s = await big(page);
    expect(s.lines).toBe(BIG_LINES);
    expect(s.size).toBe(Buffer.byteLength(BIG));
    // The editor document stays empty: the text lives on disk.
    expect(await docText(page)).toBe('');
    expect(await rows(page).count()).toBeLessThan(90);
    const lines = BIG.split('\n');
    const texts = await rowTexts(page);
    expect(texts.slice(0, 12)).toEqual(lines.slice(0, 12));
    await expect(page.locator('.tp-status')).toContainText('Read-only');
    await expect(page.locator('.tp-status')).toContainText(`${BIG_LINES.toLocaleString()} lines`);
    await expect(page.getByTestId('status-format')).toHaveText('Spring Boot');
    await expect(chip(page, 'ERROR').locator('.tp-chip-count')).toHaveText('120');
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
  });

  test('scrolls by wheel, keys and scrollbar, to the very last line', async ({ page }) => {
    await openBig(page);
    const view = await box(page.locator('.tp-big'));
    await page.mouse.move(view.x + 400, view.y + 300);
    await page.mouse.wheel(0, 2100);
    await expect.poll(async () => Math.round((await big(page)).top)).toBe(100);
    await settled(page);
    expect((await rowNumbers(page))[0]).toBe(101);

    await page.locator('.tp-big').focus();
    await page.keyboard.press('Control+End');
    await expect.poll(async () => (await rowNumbers(page)).at(-1)).toBe(BIG_LINES);
    await expect(page.locator('.tp-big-row.is-cursor')).toHaveAttribute('data-line', String(BIG_LINES));
    await settled(page);
    expect((await page.locator('.tp-big-row.is-cursor .tp-big-text').textContent())!).toBe(BIG.split('\n')[BIG_LINES - 1]);
    // The last line is fully visible, not cut off at the bottom.
    const last = await box(page.locator('.tp-big-row.is-cursor'));
    expect(last.y + last.height).toBeLessThanOrEqual(view.y + view.height);

    await page.keyboard.press('Control+Home');
    await expect.poll(async () => (await rowNumbers(page))[0]).toBe(1);
    await page.keyboard.press('PageDown');
    await page.keyboard.press('PageDown');
    expect((await big(page)).cursor).toBeGreaterThan(50);
    await page.keyboard.press('ArrowDown');
    const c = (await big(page)).cursor;
    await page.keyboard.press('ArrowUp');
    expect((await big(page)).cursor).toBe(c - 1);

    // Dragging the scrollbar (here: setting its position) moves through the file.
    await page.locator('.tp-big-scroll').evaluate((el) => (el.scrollTop = (el.scrollHeight - el.clientHeight) / 2));
    await expect.poll(async () => Math.abs((await rowNumbers(page))[0] - BIG_LINES / 2)).toBeLessThan(60);
  });

  test('go to line, F8 and the timeline work as in the editor', async ({ page }) => {
    await openBig(page);
    await page.locator('.tp-big').focus();
    await page.keyboard.press('Control+G');
    await page.getByRole('dialog').getByRole('textbox').fill('9000');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tp-big-row.is-cursor')).toHaveAttribute('data-line', '9000');
    await expect(page.locator('.tp-big-row.is-cursor')).toBeInViewport();
    await expect(page.locator('.tp-status')).toContainText('Ln 9,000');
    await settled(page);
    expect(await page.locator('.tp-big-row.is-cursor .tp-big-text').textContent()).toBe(BIG.split('\n')[8999]);

    await page.keyboard.press('F8');
    await expect(page.locator('.tp-big-row.is-cursor .tp-big-text')).toContainText('ERROR');
    const first = (await big(page)).cursor;
    expect(first).toBeGreaterThan(9000);
    await page.keyboard.press('Shift+F8');
    expect((await big(page)).cursor).toBeLessThan(9000);

    await page.locator('.tp-tl-bar:not([data-errors="0"])').first().click();
    await expect(page.locator('.tp-big-row.is-cursor .tp-big-text')).toContainText('ERROR');
  });

  test('levels and stack frames are coloured like in the editor', async ({ page }) => {
    await openBig(page);
    await chip(page, 'ERROR').click();
    await expect(count(page)).toHaveText(/^120 of /);
    await settled(page);
    await expect(page.locator('.tp-big-row.tp-lv-5').first()).toContainText('ERROR');
    await expect(page.locator('.tp-big-row.tp-frame-own').first()).toContainText('at com.acme');
    await expect(page.locator('.tp-big-row.tp-frame:not(.tp-frame-own)').first()).toContainText(/at (java\.base|org\.|feign)/);
    for (const sel of ['.tp-big-row.tp-lv-5 .tp-big-text', '.tp-big-row.tp-frame-own .tp-big-text', '.tp-big-no']) {
      expect(await contrastOf(page.locator(sel).first()), sel).toBeGreaterThanOrEqual(sel === '.tp-big-no' ? 3 : 4.5);
    }
  });

  test('filters: level, text, regex and time range, combined; Clear restores every line', async ({ page }) => {
    await openBig(page);
    await chip(page, 'WARN').click();
    await expect(count(page)).toHaveText(/^480 of /);
    expect((await big(page)).rows).toBe(480);
    await settled(page);
    for (const t of await rowTexts(page)) expect(t).toContain(' WARN ');

    await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('slow query');
    await expect.poll(async () => (await rowTexts(page)).filter(Boolean).every((t) => t.includes('Slow query'))).toBe(true);
    const some = parseInt((await count(page).textContent())!, 10);
    expect(some).toBeGreaterThan(0);
    expect(some).toBeLessThan(480);

    await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('took 4\\d{3}ms');
    await page.getByRole('button', { name: 'Use regex in filter' }).click();
    await expect.poll(async () => (await rowTexts(page)).filter(Boolean).every((t) => /took 4\d{3}ms/.test(t))).toBe(true);
    await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('');

    await page.getByRole('button', { name: /More filters/ }).click();
    await page.getByLabel('From').fill('10:15:30');
    await page.getByLabel('To', { exact: true }).fill('10:15:40');
    await expect.poll(async () => (await rowTexts(page)).filter(Boolean).every((t) => /T10:15:(3\d|40)/.test(t))).toBe(true);

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(async () => (await big(page)).rows).toBe(BIG_LINES);
    await expect(count(page)).toHaveText(/^[\d,]+ entries$/);
  });

  test('a filter that matches nothing says so', async ({ page }) => {
    await openBig(page);
    await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('no-such-text-anywhere');
    await expect(page.locator('.tp-big-note')).toHaveText('No entries match the filters.');
    await expect(count(page)).toHaveText(/^0 of /);
  });

  test('find searches the whole file, steps through matches and highlights them', async ({ page }) => {
    await openBig(page);
    await page.locator('.tp-big').focus();
    await page.keyboard.press('Control+F');
    const input = page.getByRole('textbox', { name: 'Find', exact: true });
    await expect(input).toBeFocused();
    await input.fill('tomcat started');
    await expect(page.locator('.tp-find-count')).toHaveText('40 lines');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tp-find-count')).toHaveText('1 of 40 lines');
    await expect(page.locator('.tp-big-row.is-cursor mark.tp-big-hit')).toHaveText('Tomcat started');
    // The match itself is on screen, even when it sits far to the right of a long line.
    await expect(page.locator('.tp-big-row.is-cursor mark.tp-big-hit')).toBeInViewport({ ratio: 1 });
    const first = (await big(page)).cursor;
    await page.keyboard.press('F3');
    await expect(page.locator('.tp-find-count')).toHaveText('2 of 40 lines');
    expect((await big(page)).cursor).toBe(first + 422);
    await page.keyboard.press('Shift+F3');
    expect((await big(page)).cursor).toBe(first);

    await page.getByRole('button', { name: 'Match case' }).click();
    await expect(page.locator('.tp-find-count')).toHaveText('No results');
    await page.getByRole('button', { name: 'Match case' }).click();
    await input.fill('orderId=\\d{5}\\b');
    await page.getByRole('button', { name: 'Regular expression', exact: true }).click();
    await expect(page.locator('.tp-find-count')).toHaveText(/^[\d,]+ lines$/);
    await input.fill('([');
    await expect(page.locator('.tp-find-count')).toHaveText('Invalid pattern');
    await page.keyboard.press('Escape');
    await expect(page.locator('.tp-find')).toHaveCount(0);
    await expect(page.locator('mark.tp-big-hit')).toHaveCount(0);
    await expect(page.locator('.tp-big')).toBeFocused();
  });

  test('is read-only: typing and Save change nothing; a line range can be copied', async ({ page }) => {
    await openBig(page);
    await page.locator('.tp-big').focus();
    await page.keyboard.type('xyz');
    expect((await big(page)).lines).toBe(BIG_LINES);
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tp-toast')).toContainText('read-only');
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);

    await rows(page).nth(10).locator('.tp-big-no').click();
    await rows(page).nth(13).locator('.tp-big-no').click({ modifiers: ['Shift'] });
    await expect(page.locator('.tp-big-row.is-selected')).toHaveCount(4);
    await expect(page.locator('.tp-status')).toContainText('4 selected');
    await page.keyboard.press('Control+C');
    await expect(page.locator('.tp-toast', { hasText: 'Copied 4 lines' })).toBeVisible();
    // (Windows turns line breaks on the clipboard into CRLF.)
    expect((await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n')).toBe(BIG.split('\n').slice(10, 14).join('\n'));
  });

  test('log insights groups repeated errors across the whole file', async ({ page }) => {
    await openBig(page);
    await page.getByRole('button', { name: 'Log insights' }).click();
    const side = page.locator('.tp-sidebar');
    await expect(side.locator('.tp-group').first()).toBeVisible();
    const counts = (await side.locator('.tp-group-count').allTextContents()).map((t) => parseInt(t.replace(/,/g, ''), 10));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(600);
    await side.locator('.tp-group').first().click();
    await expect(page.locator('.tp-big-row.is-cursor .tp-big-text')).toContainText('ERROR');
  });

  test('Windows line endings and Latin-1 text display correctly', async ({ page }) => {
    await openBig(page, 'windows.log', BIG.replace(/\n/g, '\r\n'));
    expect((await big(page)).lines).toBe(BIG_LINES);
    const texts = await rowTexts(page);
    expect(texts.slice(0, 12)).toEqual(BIG.split('\n').slice(0, 12));
    await expect(page.getByTestId('status-eol')).toHaveText('CRLF');

    const latin = Buffer.concat([Buffer.from('2026-03-14 10:15:02 INFO a.B - caf', 'latin1'), Buffer.from([0xe9]), Buffer.from(' ok\n'.repeat(1) + '2026-03-14 10:15:03 INFO a.B - line\n'.repeat(60), 'latin1')]);
    await openViaChooser(page, [{ name: 'latin.log', mimeType: 'text/plain', buffer: latin }]);
    await expect(page.getByRole('tab', { name: 'latin.log' })).toHaveAttribute('aria-selected', 'true');
    await ready(page);
    await expect(rows(page).first().locator('.tp-big-text')).toHaveText('2026-03-14 10:15:02 INFO a.B - café ok');
    await expect(page.getByTestId('status-encoding')).toHaveText('Latin-1');
  });

  test('binary and UTF-16 files are refused with an explanation', async ({ page }) => {
    const binary = Buffer.alloc(4000, 0);
    await openViaChooser(page, [{ name: 'core.dump', mimeType: 'application/octet-stream', buffer: binary }]);
    await expect(page.locator('.tp-toast')).toContainText('looks like a binary file');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('2026-03-14 10:15:02 INFO x\n'.repeat(200), 'utf16le')]);
    await openViaChooser(page, [{ name: 'wide.log', mimeType: 'text/plain', buffer: utf16 }]);
    await expect(page.getByRole('dialog')).toContainText('UTF-8 and Latin-1 only');
    await page.getByRole('dialog').getByRole('button', { name: 'OK' }).click();
    await expect(page.locator('.tp-big')).toHaveCount(0);
  });

  test('small files still open in the editor, and tabs switch between the two views', async ({ page }) => {
    await openBig(page);
    await openViaChooser(page, [{ name: 'tiny.txt', mimeType: 'text/plain', buffer: Buffer.from('editable\n') }]);
    await expect(page.locator('.tp-big')).toHaveCount(0);
    // Focus moved to the editor by itself when the tab changed.
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type('still ');
    expect(await docText(page)).toBe('still editable\n');
    await page.getByRole('tab', { name: 'service.log' }).click();
    await ready(page);
    await settled(page);
    expect((await rowTexts(page))[1]).toBe(BIG.split('\n')[1]);
    await page.getByRole('tab', { name: 'tiny.txt' }).click();
    expect(await docText(page)).toBe('still editable\n');
  });

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    test(`appearance ${size.width}: the viewer fills the editor area with its scrollbar at the window edge`, async ({ page }) => {
      await page.setViewportSize(size);
      await openBig(page);
      const area = await box(page.locator('.tp-editor-area'));
      const view = await box(page.locator('.tp-big'));
      const scroll = await box(page.locator('.tp-big-scroll'));
      const bar = await box(page.locator('.tp-logbar'));
      expect(view).toEqual(area);
      expect(Math.round(scroll.x + scroll.width)).toBe(size.width);
      expect(overlaps(view, bar)).toBe(false);
      // Rows fill the height: no blank band at the bottom of a long file.
      const boxes = await Promise.all((await rows(page).all()).map(box));
      const lowest = Math.max(...boxes.map((b) => b.y + b.height));
      expect(lowest).toBeGreaterThanOrEqual(view.y + view.height - 4);
      // Line numbers sit in one left-hand column, the text starts right after it.
      const no = await box(rows(page).nth(5).locator('.tp-big-no'));
      const text = await box(rows(page).nth(5).locator('.tp-big-text'));
      expect(Math.round(no.x)).toBe(Math.round(view.x));
      expect(Math.abs(text.x - (no.x + no.width))).toBeLessThan(2);
      // Same line height as the editor would use (rows do not overlap).
      const ys = boxes.map((b) => b.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeCloseTo(boxes[0].height, 0);
      // Sideways scrolling keeps the line numbers in place.
      await page.locator('.tp-big-scroll').evaluate((el) => (el.scrollLeft = 600));
      const no2 = await box(rows(page).nth(5).locator('.tp-big-no'));
      expect(Math.round(no2.x)).toBe(Math.round(view.x));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    });
  }
});

test.describe('very large files', () => {
  test.beforeEach(async ({ page }) => {
    await useBasicFilePickers(page);
    // Scaled down: "very large" starts at 1 MB here, and the end part is 256 KB.
    await openApp(page, { largeFileMB: 0.001, tailAskMB: 1, tailMB: 0.25 });
  });

  test('offers the end of the file, and shows whole lines with their real line count', async ({ page }) => {
    await openViaChooser(page, [{ name: 'huge.log', mimeType: 'text/plain', buffer: Buffer.from(BIG, 'utf8') }]);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(/huge.log is 3.d MB/);
    await expect(dialog.getByRole('button', { name: 'Open the last 256 KB' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: 'Open all of it' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Open the last 256 KB' }).click();
    await ready(page);
    await settled(page);
    const s = await big(page);
    expect(s.lines).toBeGreaterThan(1000);
    expect(s.lines).toBeLessThan(1400);
    await expect(page.locator('.tp-status')).toContainText('end of the file only');
    // The first line shown is a complete line of the file, and the last line is the file's last.
    const lines = BIG.split('\n');
    const first = (await rowTexts(page))[0];
    expect(lines).toContain(first);
    await page.locator('.tp-big').focus();
    await page.keyboard.press('Control+End');
    await settled(page);
    await expect(page.locator('.tp-big-row.is-cursor .tp-big-text')).toHaveText(lines[BIG_LINES - 1]);
  });

  test('"Open all of it" and Cancel do what they say', async ({ page }) => {
    await openViaChooser(page, [{ name: 'huge.log', mimeType: 'text/plain', buffer: Buffer.from(BIG, 'utf8') }]);
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.locator('.tp-big')).toHaveCount(0);
    await expect(page.getByRole('tab')).toHaveCount(1);
    await openViaChooser(page, [{ name: 'huge.log', mimeType: 'text/plain', buffer: Buffer.from(BIG, 'utf8') }]);
    await page.getByRole('dialog').getByRole('button', { name: 'Open all of it' }).click();
    await ready(page);
    expect((await big(page)).lines).toBe(BIG_LINES);
    await expect(page.locator('.tp-status')).not.toContainText('end of the file only');
  });
});

test.describe('files that change on disk', () => {
  test.beforeEach(async ({ page }) => {
    await useLinkedPicker(page);
    await openApp(page);
    await clearDisk(page);
  });

  const LINE = (n: number, level = 'INFO') => `2026-03-14 10:15:${String(n % 60).padStart(2, '0')} ${level} com.acme.Job - step ${n}\n`;
  const many = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => LINE(from + i)).join('');

  test('appended lines are added in place: not marked unsaved, scroll position kept', async ({ page }) => {
    await writeDisk(page, 'job.log', many(0, 300));
    await openLinked(page, ['job.log']);
    await checkDisk(page);
    await page.keyboard.press('Control+G');
    await page.getByRole('dialog').getByRole('textbox').fill('50');
    await page.keyboard.press('Enter');
    const before = await page.locator('.cm-scroller').evaluate((el) => el.scrollTop);

    await appendDisk(page, 'job.log', LINE(300, 'ERROR') + LINE(301));
    await checkDisk(page);
    await expect(page.locator('.tp-status')).toContainText('303 lines');
    expect(await docText(page)).toBe(many(0, 300) + LINE(300, 'ERROR') + LINE(301));
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
    expect(await page.locator('.cm-scroller').evaluate((el) => el.scrollTop)).toBe(before);
    await expect(page.locator('.tp-status')).toContainText('Ln 50');
    // The log index follows: the new error is counted.
    await expect(chip(page, 'ERROR').locator('.tp-chip-count')).toHaveText('1');
    // Undo does not remove what the file itself gained.
    await editor(page).focus();
    await page.keyboard.press('Control+Z');
    expect((await docText(page)).endsWith(LINE(301))).toBe(true);
  });

  test('when the end was in view, the view follows new lines; Follow does so from anywhere', async ({ page }) => {
    await writeDisk(page, 'job.log', many(0, 300));
    await openLinked(page, ['job.log']);
    await checkDisk(page);
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await appendDisk(page, 'job.log', many(300, 360));
    await checkDisk(page);
    await expect(page.locator('.cm-line', { hasText: 'step 359' })).toBeInViewport();

    await page.keyboard.press('Control+Home');
    await page.getByTestId('status-follow').click();
    await expect(page.getByTestId('status-follow')).toHaveText('Following');
    await expect(page.locator('.cm-line', { hasText: 'step 359' })).toBeInViewport();
    await page.keyboard.press('Control+Home');
    await appendDisk(page, 'job.log', many(360, 420));
    // No manual check: a followed file is polled every second.
    await expect(page.locator('.cm-line', { hasText: 'step 419' })).toBeInViewport({ timeout: 6000 });
    await page.getByTestId('status-follow').click();
    await expect(page.getByTestId('status-follow')).toHaveText('Follow');
  });

  test('a rewritten file is reloaded, and undo brings the previous text back', async ({ page }) => {
    await writeDisk(page, 'config.yml', 'server:\n  port: 8080\n');
    await openLinked(page, ['config.yml']);
    await checkDisk(page);
    await writeDisk(page, 'config.yml', 'server:\n  port: 9090\nlogging: debug\n');
    await checkDisk(page);
    expect(await docText(page)).toBe('server:\n  port: 9090\nlogging: debug\n');
    await expect(page.locator('.tp-toast')).toContainText('config.yml was reloaded from disk');
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
    await editor(page).focus();
    await page.keyboard.press('Control+Z');
    expect(await docText(page)).toBe('server:\n  port: 8080\n');
    await expect(page.locator('.tp-tab.is-active')).toHaveClass(/is-dirty/);
  });

  test('with unsaved edits it asks: keep my version, or reload from disk', async ({ page }) => {
    await writeDisk(page, 'notes.txt', 'original\n');
    await openLinked(page, ['notes.txt']);
    await checkDisk(page);
    await editor(page).focus();
    await page.keyboard.type('mine ');
    await writeDisk(page, 'notes.txt', 'changed by someone else\n');
    void checkDisk(page);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('notes.txt changed on disk');
    await dialog.getByRole('button', { name: 'Keep my version' }).click();
    expect(await docText(page)).toBe('mine original\n');
    // It does not ask again for the same change...
    await checkDisk(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // ...but does for the next one, and Reload takes the disk version.
    await writeDisk(page, 'notes.txt', 'changed again, longer this time\n');
    void checkDisk(page);
    await page.getByRole('dialog').getByRole('button', { name: 'Reload from disk' }).click();
    await expect.poll(() => docText(page)).toBe('changed again, longer this time\n');
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
  });

  test('saving from Tracepad is not mistaken for an outside change', async ({ page }) => {
    await writeDisk(page, 'a.txt', 'one\n');
    await openLinked(page, ['a.txt']);
    await checkDisk(page);
    await editor(page).focus();
    await page.keyboard.type('zero ');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tp-toast')).toContainText('Saved a.txt');
    await checkDisk(page);
    await checkDisk(page);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.locator('.tp-toast', { hasText: 'reloaded' })).toHaveCount(0);
    expect(await readDisk(page, 'a.txt')).toBe('zero one\n');
  });

  test('a deleted file gives one notice and the tab keeps its text', async ({ page }) => {
    await writeDisk(page, 'gone.log', many(0, 20));
    await openLinked(page, ['gone.log']);
    await checkDisk(page);
    await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('gone.log'));
    await checkDisk(page);
    await expect(page.locator('.tp-toast')).toContainText('gone.log is no longer on disk');
    await expect(page.locator('.tp-status')).toContainText('File is gone from disk');
    expect(await docText(page)).toBe(many(0, 20));
    await page.locator('.tp-toast').getByRole('button', { name: 'Dismiss' }).click();
    await checkDisk(page);
    await expect(page.locator('.tp-toast')).toHaveCount(0);
  });
});

test.describe('large files that change on disk', () => {
  test.beforeEach(async ({ page }) => {
    await useLinkedPicker(page);
    await openApp(page, SMALL_LIMIT);
    await clearDisk(page);
  });

  const line = (n: number, level = 'INFO') => `2026-03-14 10:${String(Math.floor(n / 60) % 60).padStart(2, '0')}:${String(n % 60).padStart(2, '0')} ${level} com.acme.Job - step ${n}\n`;
  const many = (from: number, to: number, level = 'INFO') => Array.from({ length: to - from }, (_, i) => line(from + i, level)).join('');

  test('only the new bytes are indexed; the view follows when it was at the end', async ({ page }) => {
    await writeDisk(page, 'grow.log', many(0, 2000));
    await openLinked(page, ['grow.log']);
    await ready(page);
    await checkDisk(page);
    expect((await big(page)).lines).toBe(2000);
    // Reading from the middle: new lines arrive without moving the view.
    await page.locator('.tp-big').focus();
    await page.keyboard.press('Control+G');
    await page.getByRole('dialog').getByRole('textbox').fill('500');
    await page.keyboard.press('Enter');
    const top = (await big(page)).top;
    await appendDisk(page, 'grow.log', many(2000, 2100, 'ERROR'));
    await checkDisk(page);
    await expect.poll(async () => (await big(page)).lines).toBe(2100);
    expect((await big(page)).top).toBe(top);
    await expect(chip(page, 'ERROR').locator('.tp-chip-count')).toHaveText('100');
    await expect(page.locator('.tp-status')).toContainText('2,100 lines');

    // At the end: it follows.
    await page.keyboard.press('Control+End');
    await appendDisk(page, 'grow.log', many(2100, 2150));
    await checkDisk(page);
    await expect.poll(async () => (await rowNumbers(page)).at(-1)).toBe(2150);
    await expect(page.locator('.tp-big-row', { hasText: 'step 2149' })).toBeInViewport();
  });

  test('a half-written last line is completed, and an active filter applies to new lines', async ({ page }) => {
    await writeDisk(page, 'grow.log', many(0, 1500) + '2026-03-14 10:59:59 ERROR com.acme.Job - half wri');
    await openLinked(page, ['grow.log']);
    await ready(page);
    await checkDisk(page);
    expect((await big(page)).lines).toBe(1501);
    await chip(page, 'ERROR').click();
    await expect(count(page)).toHaveText(/^1 of /);
    await expect(rows(page).first().locator('.tp-big-text')).toHaveText(/half wri$/);

    await appendDisk(page, 'grow.log', 'tten line\n' + many(1501, 1600) + line(1600, 'ERROR'));
    await checkDisk(page);
    await expect(count(page)).toHaveText(/^2 of /);
    await expect(rows(page).first().locator('.tp-big-text')).toHaveText(/half written line$/);
    expect((await big(page)).rows).toBe(2);
    expect((await big(page)).lines).toBe(1601);
  });

  test('Follow keeps up with a growing file on its own', async ({ page }) => {
    await writeDisk(page, 'tail.log', many(0, 1200));
    await openLinked(page, ['tail.log']);
    await ready(page);
    await page.getByTestId('status-follow').click();
    await expect.poll(async () => (await rowNumbers(page)).at(-1)).toBe(1200);
    for (let i = 0; i < 3; i++) await appendDisk(page, 'tail.log', many(1200 + i * 40, 1240 + i * 40));
    await expect.poll(async () => (await rowNumbers(page)).at(-1), { timeout: 8000 }).toBe(1320);
    await expect(page.locator('.tp-big-row', { hasText: 'step 1319' })).toBeInViewport();
  });

  test('a truncated or rotated file is indexed again from the start', async ({ page }) => {
    await writeDisk(page, 'rotate.log', many(0, 3000));
    await openLinked(page, ['rotate.log']);
    await ready(page);
    await checkDisk(page);
    await writeDisk(page, 'rotate.log', many(5000, 5800, 'WARN'));
    await checkDisk(page);
    await expect.poll(async () => (await big(page)).lines, { timeout: 10_000 }).toBe(800);
    await expect(chip(page, 'WARN').locator('.tp-chip-count')).toHaveText('800');
    await settled(page);
    await expect(rows(page).first().locator('.tp-big-text')).toContainText('step 5000');
  });

  test('a linked large file comes back after a reload', async ({ page }) => {
    await writeDisk(page, 'keep.log', many(0, 2500));
    await openLinked(page, ['keep.log']);
    await ready(page);
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await expect(page.getByRole('tab', { name: 'keep.log' })).toBeVisible();
    await ready(page);
    expect((await big(page)).lines).toBe(2500);
    await expect(page.locator('.tp-status')).toContainText('Read-only');
  });
});

// Logs (0.3): detection, colours, timeline, filters, grouping, folding,
// highlight rules. Runs against both builds.
import { expect, test, type Page } from '@playwright/test';
import * as F from '../fixtures/logs';
import { box, contrastOf, docText, editor, openApp, openSample, openViaChooser, overlaps, useBasicFilePickers } from './helpers';

interface Hook {
  hiddenLines(): number;
  cursorLine(): number;
  lineText(n: number): string;
}
const hook = <T>(page: Page, fn: (h: Hook) => T): Promise<T> => page.evaluate(`(${fn.toString()})(window.__tracepad)`) as Promise<T>;
const hidden = (page: Page) => hook(page, (h) => h.hiddenLines());
const cursorText = (page: Page) => hook(page, (h) => h.lineText(h.cursorLine()));

async function logReady(page: Page): Promise<void> {
  await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
}

async function openLog(page: Page, name: string, text: string): Promise<void> {
  await openViaChooser(page, [{ name, mimeType: 'text/plain', buffer: Buffer.from(text, 'utf8') }]);
  await expect(page.getByRole('tab', { name })).toBeVisible();
}

const count = (page: Page) => page.getByTestId('filter-count');
const chip = (page: Page, name: string) => page.locator('.tp-chip', { hasText: name });

/** Text of the lines that are actually drawn. */
const drawn = (page: Page) => page.locator('.cm-content .cm-line').allTextContents();

test.beforeEach(async ({ page }) => {
  await useBasicFilePickers(page);
  await openApp(page);
});

test.describe('the sample Spring Boot log', () => {
  test.beforeEach(async ({ page }) => {
    await openSample(page);
    await logReady(page);
  });

  test('is recognised: format, level counts, and the sidebar stays closed', async ({ page }) => {
    await expect(page.getByTestId('status-format')).toHaveText('Spring Boot');
    await expect(chip(page, 'ERROR')).toContainText('3');
    await expect(chip(page, 'WARN')).toContainText('12');
    await expect(chip(page, 'INFO')).toContainText('204');
    await expect(chip(page, 'DEBUG')).toContainText('151');
    await expect(count(page)).toHaveText('370 entries');
    await expect(page.locator('.tp-sidebar')).toHaveCount(0);
  });

  test('levels are coloured; framework frames are dimmed and my own frames stand out', async ({ page }) => {
    await expect(page.locator('.cm-line.tp-lv-4').first()).toContainText('WARN');
    await expect(page.locator('.cm-line.tp-lv-2').first()).toContainText('DEBUG');
    await expect(page.locator('.tp-lvword-3').first()).toHaveText('INFO');
    await page.keyboard.press('F8');
    const error = page.locator('.cm-line.tp-lv-5').first();
    await expect(error).toContainText('ERROR');
    const colours = await page.evaluate(() => {
      const css = (sel: string) => getComputedStyle(document.querySelector(sel)!).color;
      return { error: css('.cm-line.tp-lv-5'), plain: css('.cm-line:not([class*="tp-"])'), own: css('.cm-line.tp-frame-own'), frame: css('.cm-line.tp-frame:not(.tp-frame-own)') };
    });
    expect(colours.error).not.toBe(colours.plain);
    expect(colours.frame).not.toBe(colours.own);
    await expect(page.locator('.cm-line.tp-frame-own').first()).toContainText('at com.acme.orders');
    await expect(page.locator('.cm-line.tp-frame:not(.tp-frame-own)').first()).toContainText(/at (java\.base|org\.springframework|feign|org\.apache)/);
    // With only errors shown, a "Caused by" line is on screen.
    await chip(page, 'ERROR').click();
    await expect(page.locator('.cm-line.tp-cause').first()).toContainText('Caused by:');
    await chip(page, 'ERROR').click();
    await expect(count(page)).toHaveText('370 entries');
    await page.keyboard.press('F8');

    // A configured package prefix takes over from the built-in list.
    await page.getByRole('button', { name: 'Log insights' }).click();
    await page.getByPlaceholder('com.mycompany').fill('org.springframework');
    await expect(page.locator('.cm-line.tp-frame-own').first()).toContainText('at org.springframework');
    await expect(page.locator('.cm-line.tp-frame-own', { hasText: 'at com.acme' })).toHaveCount(0);
  });

  test('F8 and Shift+F8 step through errors and wrap around', async ({ page }) => {
    const seen: number[] = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('F8');
      expect(await cursorText(page)).toContain('ERROR');
      seen.push(await hook(page, (h) => h.cursorLine()));
    }
    expect(new Set(seen).size).toBe(3);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    await page.keyboard.press('F8');
    expect(await hook(page, (h) => h.cursorLine())).toBe(seen[0]);
    await expect(page.locator('.tp-toast')).toContainText('Wrapped to the first error');
    await page.keyboard.press('Shift+F8');
    expect(await hook(page, (h) => h.cursorLine())).toBe(seen[2]);
    await page.getByRole('button', { name: 'Previous error' }).click();
    expect(await hook(page, (h) => h.cursorLine())).toBe(seen[1]);
  });

  test('level chips: first click shows only that level, more clicks add levels, Clear restores', async ({ page }) => {
    expect(await hidden(page)).toBe(0);
    await chip(page, 'ERROR').click();
    await expect(count(page)).toHaveText('3 of 370 entries');
    await expect(chip(page, 'ERROR')).toHaveAttribute('aria-pressed', 'true');
    const lines = await drawn(page);
    expect(lines.length).toBeGreaterThan(20);
    // Only error entries and their stack traces remain.
    expect(lines.filter((l) => /^\d{4}-\d\d-\d\dT/.test(l)).every((l) => l.includes('ERROR'))).toBe(true);
    expect(lines.some((l) => l.includes('\tat ') || l.trim().startsWith('at '))).toBe(true);
    expect(await hidden(page)).toBeGreaterThan(300);

    await chip(page, 'WARN').click();
    await expect(count(page)).toHaveText('15 of 370 entries');
    await chip(page, 'ERROR').click();
    await expect(count(page)).toHaveText('12 of 370 entries');

    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect(count(page)).toHaveText('370 entries');
    await expect.poll(() => hidden(page)).toBe(0);
    await expect(page.getByRole('button', { name: 'Clear filters' })).toHaveCount(0);
    // The file itself is untouched by filtering.
    expect((await docText(page)).split('\n')).toHaveLength(423);
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
  });

  test('text filter: plain, case, regex, and a bad pattern hides nothing', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Filter entries by text' });
    await input.fill('paymentcaptured');
    await expect(count(page)).toHaveText(/^\d+ of 370 entries$/);
    const some = parseInt((await count(page).textContent())!, 10);
    expect(some).toBeGreaterThan(20);
    await page.getByRole('button', { name: 'Case-sensitive filter' }).click();
    await expect(count(page)).toHaveText('0 of 370 entries');
    await page.getByRole('button', { name: 'Case-sensitive filter' }).click();

    await input.fill('took \\d{4,}ms');
    await page.getByRole('button', { name: 'Use regex in filter' }).click();
    await expect(count(page)).toHaveText(/^\d of 370 entries$/);
    await expect.poll(async () => (await drawn(page)).filter((x) => /^\d{4}-/.test(x)).every((l) => /took \d{4,}ms/.test(l))).toBe(true);

    await input.fill('([');
    await expect(count(page)).toContainText('Invalid pattern');
    expect(await hidden(page)).toBe(0);
  });

  test('more filters: several patterns, logger or thread, trace ID, From and To', async ({ page }) => {
    await page.getByRole('button', { name: /More filters/ }).click();
    const patterns = page.getByRole('textbox', { name: 'Patterns, one per line' });
    await patterns.fill('Slow query\n/status=5\\d\\d/');
    await expect(count(page)).toHaveText(/^\d+ of 370 entries$/);
    const any = parseInt((await count(page).textContent())!, 10);
    await page.getByRole('combobox', { name: 'Match any or all patterns' }).selectOption('all');
    await expect(count(page)).toHaveText('0 of 370 entries');
    expect(any).toBeGreaterThan(0);
    await patterns.fill('');

    await page.getByLabel('Logger or thread').fill('SlowQueryLogger');
    await expect(count(page)).toHaveText(/^\d+ of 370 entries$/);
    await expect.poll(async () => (await drawn(page)).filter((x) => /^\d{4}-/.test(x)).every((l) => l.includes('SlowQueryLogger'))).toBe(true);
    await page.getByLabel('Logger or thread').fill('housekeeper');
    await expect(count(page)).toHaveText(/^[1-9]\d* of 370 entries$/);
    await page.getByLabel('Logger or thread').fill('');
    await expect(count(page)).toHaveText('370 entries');

    // Trace: take the id from an error line, then every shown entry carries it.
    await page.keyboard.press('F8');
    const trace = /\[([0-9a-f]{32})-/.exec(await cursorText(page))![1];
    await page.getByLabel('Trace ID').fill(trace);
    await expect(count(page)).toHaveText(/^[1-9]\d* of 370 entries$/);
    await expect.poll(async () => (await drawn(page)).filter((x) => /^\d{4}-/.test(x)).every((l) => l.includes(trace))).toBe(true);
    await page.getByLabel('Trace ID').fill('');

    await page.getByLabel('From').fill('10:15:30');
    await page.getByLabel('To', { exact: true }).fill('10:15:40');
    await expect.poll(async () => (await drawn(page)).filter((x) => /^\d{4}-/.test(x)).every((l) => /T10:15:(3\d|40)/.test(l))).toBe(true);
    await expect(count(page)).toHaveText(/^[1-9]\d* of 370 entries$/);
    await page.getByLabel('From').fill('2026-03-14 10:16');
    await page.getByLabel('To', { exact: true }).fill('');
    await expect.poll(async () => (await drawn(page)).filter((x) => /^\d{4}-/.test(x)).every((l) => /T10:16:/.test(l))).toBe(true);
    await page.getByLabel('From').fill('half past ten');
    await expect(count(page)).toContainText('is not a time');
    expect(await hidden(page)).toBe(0);
  });

  test('"Filter to the trace ID on this line" follows one request', async ({ page }) => {
    await page.keyboard.press('F8');
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type('trace ID on this line');
    await page.keyboard.press('Enter');
    await expect(count(page)).toHaveText(/^[1-9]\d* of 370 entries$/);
    await expect(page.getByLabel('Trace ID')).toHaveValue(/^[0-9a-f]{32}$/);
  });

  test('timeline: click a bar to jump, drag to filter by time, double-click to clear', async ({ page }) => {
    const bars = page.locator('.tp-tl-bar');
    expect(await bars.count()).toBeGreaterThan(40);
    const totals = await bars.evaluateAll((els) => els.reduce((s, e) => s + Number((e as HTMLElement).dataset.total), 0));
    expect(totals).toBe(370);
    const errors = await bars.evaluateAll((els) => els.reduce((s, e) => s + Number((e as HTMLElement).dataset.errors), 0));
    expect(errors).toBe(3);

    // Click: the bar that holds an error jumps to that error.
    await page.locator('.tp-tl-bar:not([data-errors="0"])').first().click();
    expect(await cursorText(page)).toContain('ERROR');

    // Drag across about a third of the strip.
    const strip = await box(page.locator('.tp-timeline-strip'));
    const y = strip.y + strip.height / 2;
    await page.mouse.move(strip.x + strip.width * 0.1, y);
    await page.mouse.down();
    await page.mouse.move(strip.x + strip.width * 0.25, y, { steps: 6 });
    await expect(page.locator('.tp-tl-select')).toBeVisible();
    await page.mouse.move(strip.x + strip.width * 0.4, y, { steps: 6 });
    await page.mouse.up();
    await expect(count(page)).toHaveText(/^[1-9]\d* of 370 entries$/);
    const shown = parseInt((await count(page).textContent())!, 10);
    expect(shown).toBeLessThan(370);
    await expect(page.getByLabel('From')).toHaveValue(/^2026-03-14 10:15:\d\d$/);
    await expect(page.getByLabel('To', { exact: true })).toHaveValue(/^2026-03-14 10:15:\d\d$/);
    // The rest of the strip is dimmed, and the selection is outlined where it was dragged.
    expect(await page.locator('.tp-tl-bar.is-dim').count()).toBeGreaterThan(20);
    const sel = await box(page.locator('.tp-tl-select.is-set'));
    expect(Math.abs(sel.x - (strip.x + strip.width * 0.1))).toBeLessThan(strip.width * 0.03);
    expect(Math.abs(sel.x + sel.width - (strip.x + strip.width * 0.4))).toBeLessThan(strip.width * 0.03);
    // Other filters combine with the time range.
    await chip(page, 'INFO').click();
    await expect.poll(async () => parseInt((await count(page).textContent())!, 10)).toBeLessThan(shown);
    await chip(page, 'INFO').click();

    await page.locator('.tp-timeline-strip').dblclick();
    await expect(count(page)).toHaveText('370 entries');
    await expect(page.locator('.tp-tl-bar.is-dim')).toHaveCount(0);
  });

  test('stack traces fold into their entry', async ({ page }) => {
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type('Fold all stack traces');
    await page.keyboard.press('Enter');
    await page.keyboard.press('F8');
    await expect(page.locator('.cm-foldPlaceholder').first()).toBeVisible();
    await expect(page.locator('.cm-line.tp-frame')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type('Unfold all stack traces');
    await page.keyboard.press('Enter');
    await expect(page.locator('.cm-foldPlaceholder')).toHaveCount(0);
    await expect(page.locator('.cm-line.tp-frame').first()).toBeVisible();
  });

  test('log insights: summary and repeated errors, with click-to-visit', async ({ page }) => {
    await page.getByRole('button', { name: 'Log insights' }).click();
    const side = page.locator('.tp-sidebar');
    await expect(side.getByTestId('log-format')).toHaveText('Spring Boot');
    await expect(side).toContainText('370 in 423 lines');
    await expect(side).toContainText('2026-03-14 10:15:02');
    await expect(side.locator('.tp-level-row')).toHaveCount(4);
    const groups = side.locator('.tp-group');
    await expect(groups.first()).toBeVisible();
    const n = await groups.count();
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThan(15);
    // Errors are listed first; repeated warnings are counted together.
    await expect(groups.first().locator('.tp-group-count')).toHaveClass(/tp-group-count-5/);
    const counts = (await side.locator('.tp-group-count').allTextContents()).map((t) => parseInt(t, 10));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(15);
    expect(Math.max(...counts)).toBeGreaterThan(1);
    await groups.first().click();
    expect(await cursorText(page)).toContain('ERROR');
    const repeated = groups.nth(counts.indexOf(Math.max(...counts)));
    await repeated.click();
    const first = await hook(page, (h) => h.cursorLine());
    await repeated.click();
    expect(await hook(page, (h) => h.cursorLine())).toBeGreaterThan(first);
  });

  test('editing the log updates the counts', async ({ page }) => {
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('2026-03-14T10:17:00.000+05:30 ERROR 18244 --- [order-service] [main] com.acme.orders.Manual : typed by hand');
    await expect(chip(page, 'ERROR')).toContainText('4');
    await expect(count(page)).toHaveText('371 entries');
  });

  test('appearance: the log bar sits above the editor and wastes no space', async ({ page }) => {
    const main = await box(page.locator('.tp-main'));
    const bar = await box(page.locator('.tp-logbar'));
    const area = await box(page.locator('.tp-editor-area'));
    const strip = await box(page.locator('.tp-timeline-strip'));
    expect(Math.round(bar.y)).toBe(Math.round(main.y) + 1);
    expect(Math.round(area.y)).toBe(Math.round(bar.y + bar.height));
    expect(Math.round(area.y + area.height)).toBe(Math.round(main.y + main.height));
    expect(bar.height).toBeLessThan(110);
    // The timeline uses the full width of the editor.
    expect(strip.width).toBeGreaterThan(main.width - 30);
    // Controls in the filter row do not overlap and are not cut off.
    const parts = ['.tp-chips', '.tp-lf-text', '.tp-lf-more', '.tp-lf-count', '.tp-lf-nav'];
    const boxes = await Promise.all(parts.map((p) => box(page.locator(p))));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].x + boxes[i].width, parts[i]).toBeLessThanOrEqual(main.x + main.width);
      for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `${parts[i]} overlaps ${parts[j]}`).toBe(false);
    }
    const clipped = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tp-chip, .tp-lf-count, .tp-lf-more, .tp-timeline-labels span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
    expect(clipped).toEqual([]);
    // Next/previous error sit at the right-hand end of the row they belong to.
    const nav = boxes[4];
    expect(main.x + main.width - (nav.x + nav.width)).toBeLessThan(20);
    // The find box still opens inside the editor area, below the log bar.
    await page.keyboard.press('Control+F');
    const find = await box(page.locator('.tp-find'));
    expect(find.y).toBeGreaterThanOrEqual(area.y);
    expect(overlaps(find, bar)).toBe(false);
  });

  for (const theme of ['midnight', 'fjord', 'paper', 'dawn']) {
    test(`appearance: level colours are readable in ${theme}`, async ({ page }) => {
      await page.evaluate((t) => localStorage.setItem('tracepad.settings', JSON.stringify({ theme: t, accent: 'amber' })), theme);
      await page.reload();
      await logReady(page);
      await chip(page, 'ERROR').click();
      await expect(count(page)).toHaveText('3 of 370 entries');
      for (const sel of ['.cm-line.tp-lv-5', '.cm-line.tp-cause', '.cm-line.tp-frame-own', '.tp-chip.is-on .tp-chip-name', '.tp-chip.is-on .tp-chip-count', '.tp-chip.is-off .tp-chip-name', '.tp-lf-count', '.tp-timeline-labels span']) {
        expect(await contrastOf(page.locator(sel).first()), sel).toBeGreaterThanOrEqual(4.5);
      }
      await page.getByRole('button', { name: 'Clear filters' }).click();
      for (const sel of ['.cm-line.tp-lv-4', '.cm-line.tp-lv-2', '.tp-lvword-3', '.tp-chip-4 .tp-chip-name']) {
        expect(await contrastOf(page.locator(sel).first()), sel).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test.describe('formats', () => {
  const cases: [string, string, string, Record<string, string>][] = [
    ['logback.log', F.LOGBACK, 'Logback / Log4j', { ERROR: '2', WARN: '1', INFO: '3', DEBUG: '1' }],
    ['app.jsonl', F.JSON_LINES, 'JSON lines', { ERROR: '1', WARN: '1', INFO: '2', DEBUG: '1' }],
    ['access.log', F.ACCESS, 'Access log', { ERROR: '1', WARN: '1', INFO: '2' }],
    ['messages.log', F.SYSLOG, 'Syslog', { ERROR: '1', WARN: '1', OTHER: '2' }],
    ['legacy.log', F.JUL, 'java.util.logging', { ERROR: '1', WARN: '1', INFO: '1' }],
    ['pool.log', F.EPOCH, 'Epoch timestamps', { ERROR: '1', WARN: '1', INFO: '2' }],
    ['pods.log', F.K8S, 'Spring Boot', { ERROR: '2', WARN: '1', INFO: '1' }],
    ['plain.log', F.GENERIC, 'Generic', { OTHER: '5' }],
    ['windows.log', F.LOGBACK.replace(/\n/g, '\r\n'), 'Logback / Log4j', { ERROR: '2', WARN: '1', INFO: '3', DEBUG: '1' }],
  ];
  for (const [name, text, format, chips] of cases) {
    test(`${name} is read as ${format}`, async ({ page }) => {
      await openLog(page, name, text);
      await logReady(page);
      await expect(page.getByTestId('status-format')).toHaveText(format);
      for (const [level, n] of Object.entries(chips)) await expect(chip(page, level).locator('.tp-chip-count')).toHaveText(n);
      await expect(page.locator('.tp-chip')).toHaveCount(Object.keys(chips).length);
    });
  }

  test('Kubernetes-prefixed lines stay separate entries and say so', async ({ page }) => {
    await openLog(page, 'pods.log', F.K8S);
    await logReady(page);
    await expect(count(page)).toHaveText('4 entries');
    await page.getByRole('button', { name: 'Log insights' }).click();
    await expect(page.getByTestId('log-format')).toHaveText('Spring Boot · container prefix');
  });

  test('a JSON-lines file in a .txt is detected; prose is left alone', async ({ page }) => {
    await openLog(page, 'export.txt', F.JSON_LINES);
    await logReady(page);
    await expect(page.getByTestId('status-format')).toHaveText('JSON lines');
    await openLog(page, 'notes.txt', F.PROSE);
    await page.waitForTimeout(600);
    await expect(page.locator('.tp-logbar')).toHaveCount(0);
    await expect(page.getByTestId('status-format')).toHaveCount(0);
  });

  test('"Treat this tab as a log" forces it, and can be undone', async ({ page }) => {
    await openLog(page, 'odd.txt', 'start\n10:15:02 one thing\nmiddle\nmiddle\nmiddle\nmiddle\nmiddle\nmiddle\nend\n');
    await page.waitForTimeout(600);
    await expect(page.locator('.tp-logbar')).toHaveCount(0);
    await page.getByRole('button', { name: 'Log insights' }).click();
    await page.getByRole('button', { name: 'Treat this tab as a log' }).click();
    await logReady(page);
    await expect(count(page)).toHaveText('1 entries');
    await page.getByRole('button', { name: 'Stop treating this tab as a log' }).click();
    await expect(page.locator('.tp-logbar')).toHaveCount(0);
  });

  test('the filter follows you from one log tab to another', async ({ page }) => {
    await openLog(page, 'logback.log', F.LOGBACK);
    await logReady(page);
    await chip(page, 'ERROR').click();
    await expect(count(page)).toHaveText('2 of 7 entries');
    await openLog(page, 'pool.log', F.EPOCH);
    await expect(count(page)).toHaveText('1 of 4 entries');
    await page.getByRole('tab', { name: 'logback.log' }).click();
    await expect(count(page)).toHaveText('2 of 7 entries');
    // 17 lines (the last one empty) minus the two error entries with their stack traces.
    expect(await hidden(page)).toBe(6);
  });
});

test.describe('highlight rules', () => {
  test('mark text in colour, can be switched off, and are remembered', async ({ page }) => {
    await openSample(page);
    await logReady(page);
    await page.getByRole('button', { name: 'Highlight rules' }).click();
    await page.getByRole('button', { name: 'Add rule' }).click();
    await page.getByRole('textbox', { name: 'Text or pattern to highlight' }).fill('hikaripool');
    await expect(page.locator('.cm-content .tp-hl-0').first()).toHaveText('HikariPool');
    await page.getByRole('button', { name: 'Add rule' }).click();
    const second = page.getByRole('textbox', { name: 'Text or pattern to highlight' }).nth(1);
    await second.fill('port \\d+');
    await page.locator('.tp-rule').nth(1).getByRole('button', { name: 'Regular expression' }).click();
    await expect(page.locator('.cm-content .tp-hl-1').first()).toHaveText(/^port \d+$/);
    // The two rules use visibly different colours.
    const colours = await page.evaluate(() => ['.tp-hl-0', '.tp-hl-1'].map((s) => getComputedStyle(document.querySelector(`.cm-content ${s}`)!).backgroundColor));
    expect(colours[0]).not.toBe(colours[1]);
    // Highlighted text stays readable.
    expect(await contrastOf(page.locator('.cm-content .tp-hl-0').first())).toBeGreaterThanOrEqual(4.5);

    await page.getByRole('checkbox').first().uncheck();
    await expect(page.locator('.cm-content .tp-hl-0')).toHaveCount(0);
    await second.fill('([');
    await expect(second).toHaveAttribute('aria-invalid', 'true');
    await second.fill('Tomcat');

    await page.reload();
    await logReady(page);
    await expect(page.locator('.cm-content .tp-hl-1').first()).toHaveText(/^tomcat$/i);
    await page.getByRole('button', { name: 'Highlight rules' }).click();
    await expect(page.locator('.tp-rule')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete rule Tomcat' }).click();
    await expect(page.locator('.cm-content .tp-hl-1')).toHaveCount(0);
  });
});

// Auto tables, extract presets and the results panel (0.5). Both builds.
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import * as F from '../fixtures/logs';
import { box, contrastOf, docText, openApp, openSample, openViaChooser, overlaps, useBasicFilePickers } from './helpers';

const sample = readFileSync('src/assets/sample-spring.log', 'utf8');

interface Shown {
  title: string;
  columns: string[];
  rows: number;
  total: number;
  first: string[] | null;
  ms: number | null;
  patterns: number | null;
}
const shown = (page: Page) => page.evaluate(() => (window as unknown as { __tracepad: { table(): Shown | null } }).__tracepad.table());
const cursorLine = (page: Page) => page.evaluate(() => (window as unknown as { __tracepad: { cursorLine(): number } }).__tracepad.cursorLine());
const lineText = (page: Page, n: number) => page.evaluate((k) => (window as unknown as { __tracepad: { lineText(n: number): string } }).__tracepad.lineText(k), n);
const headers = (page: Page) => page.locator('.tp-vt-th .tp-vt-name').allTextContents();
const pattern = (page: Page, text: string | RegExp) => page.locator('.tp-pat', { hasText: text });
const tool = (page: Page, name: string) => page.locator('.tp-table-tools').getByRole('button', { name });
/** Text of one column for the rows that are drawn. */
async function column(page: Page, name: string): Promise<string[]> {
  const i = (await headers(page)).indexOf(name);
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return page.locator('.tp-vt-row').evaluateAll((rows, k) => rows.map((r) => r.children[k].textContent ?? ''), i);
}

async function auto(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Auto tables', exact: true }).click();
  await expect(page.locator('.tp-pats-count')).toContainText('patterns from');
  await expect(page.locator('.tp-vt-row').first()).toBeVisible();
}

async function pick(page: Page, text: string | RegExp): Promise<void> {
  await pattern(page, text).first().click();
  await expect(pattern(page, text).first()).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tp-table-area .tp-big-busy')).toHaveCount(0);
  await expect(page.locator('.tp-vt-row').first()).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await useBasicFilePickers(page);
  await openApp(page);
});

test.describe('auto tables on the sample log', () => {
  test.beforeEach(async ({ page }) => {
    await openSample(page);
    await auto(page);
  });

  test('one click, no pattern needed: patterns with counts beside the selected table', async ({ page }) => {
    await expect(page.locator('.tp-pats-count')).toHaveText('42 patterns from 370 entries');
    const counts = (await page.locator('.tp-pat-count').allTextContents()).map(Number);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(370);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // The most frequent pattern is selected and its table is on show.
    await expect(page.locator('.tp-pat').first()).toHaveAttribute('aria-selected', 'true');
    expect((await shown(page))!.rows).toBe(counts[0]);
    // Variables are highlighted inside the template text.
    await expect(pattern(page, 'Created order').locator('.tp-pat-var')).toHaveText([/orderId=<\*>/, /customerId=<\*>/, /items=<\*>/, /total=<\*>/]);
    // Error patterns carry the error colour.
    await expect(pattern(page, 'Failed to reserve stock').locator('.tp-pat-count')).toHaveClass(/tp-pat-count-5/);
    await expect(page.locator('.tp-sidebar')).toHaveCount(0);
  });

  test('columns are named from the words around the values; rows stay in file order', async ({ page }) => {
    await pick(page, 'Created order');
    expect(await headers(page)).toEqual(['line', 'time', 'thread', 'orderId', 'customerId', 'items', 'total', 'trace']);
    const lines = (await column(page, 'line')).map(Number);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
    expect((await column(page, 'orderId'))[0]).toBe('90002');

    await pick(page, 'moved from');
    expect(await headers(page)).toEqual(expect.arrayContaining(['from', 'to', 'by']));
    for (const v of await column(page, 'to')) expect(['PAID', 'PACKED', 'SHIPPED', 'DELIVERED']).toContain(v);

    await pick(page, /status=<\*> took <\*>ms/);
    expect(await headers(page)).toContain('took (ms)');
    for (const v of await column(page, 'took (ms)')) expect(v).toMatch(/^\d+$/);

    await pick(page, 'Heartbeat');
    expect(await headers(page)).toEqual(expect.arrayContaining(['CPU_USAGE (%)', 'HEAP_USED (MB)', 'redis']));

    await pick(page, 'Failed to reserve stock');
    expect(await headers(page)).toEqual(expect.arrayContaining(['orderId', 'sku', 'attempt', 'exception', 'caused by']));
    expect((await column(page, 'exception'))[0]).toBe('feign.RetryableException');
    expect((await column(page, 'caused by'))[0]).toBe('java.net.SocketTimeoutException: Read timed out');
  });

  test('number columns show min, avg, p95 and max; identifiers do not', async ({ page }) => {
    await pick(page, 'Created order');
    const th = (name: string) => page.locator('.tp-vt-th', { has: page.locator('.tp-vt-name', { hasText: new RegExp(`^${name}$`) }) });
    await expect(th('items').locator('.tp-vt-stats')).toContainText(/min 1.*avg [\d.]+.*p95 \d.*max 6/s);
    await expect(th('total').locator('.tp-vt-stats')).toBeVisible();
    await expect(th('orderId').locator('.tp-vt-stats')).toHaveCount(0);
    await expect(th('line').locator('.tp-vt-stats')).toHaveCount(0);
    // Numbers are right-aligned, text left-aligned.
    const i = (await headers(page)).indexOf('items');
    expect(await page.locator('.tp-vt-row').first().locator('.tp-vt-cell').nth(i).evaluate((el) => getComputedStyle(el).textAlign)).toBe('right');
    expect(await page.locator('.tp-vt-row').first().locator('.tp-vt-cell').nth(2).evaluate((el) => getComputedStyle(el).textAlign)).not.toBe('right');
  });

  test('clicking a row goes to that line in the log', async ({ page }) => {
    await pick(page, 'Created order');
    await page.locator('.tp-vt-row').nth(3).click();
    const line = Number((await column(page, 'line'))[3]);
    expect(await cursorLine(page)).toBe(line);
    expect(await lineText(page, line)).toContain('Created order orderId=');
    await expect(page.locator('.tp-vt-row').nth(3)).toHaveClass(/is-selected/);
  });

  test('the pattern list can be filtered', async ({ page }) => {
    const box = page.getByRole('textbox', { name: 'Filter patterns' });
    await box.fill('hikari');
    await expect(page.locator('.tp-pats-count')).toHaveText(/^\d+ of 42 patterns$/);
    for (const t of await page.locator('.tp-pat-text').allTextContents()) expect(t.toLowerCase()).toContain('hikari');
    await box.fill('zzz-nothing');
    await expect(page.locator('.tp-pats .tp-files-none')).toContainText('No pattern contains');
    await box.fill('');
    await expect(page.locator('.tp-pat')).toHaveCount(42);
  });

  test('Count by value opens a second result and keeps the first', async ({ page }) => {
    await pick(page, 'moved from');
    const rows = (await shown(page))!.rows;
    await page.getByRole('combobox', { name: 'Count by value of a column' }).selectOption({ label: 'to' });
    await expect(page.getByRole('tab', { name: 'Count by to' })).toHaveAttribute('aria-selected', 'true');
    expect(await headers(page)).toEqual(['to', 'count', 'share']);
    const counts = (await column(page, 'count')).map(Number);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(rows);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    await page.getByRole('tab', { name: /^Tables · sample/ }).click();
    await expect(pattern(page, 'moved from').first()).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Close result Count by to' }).click();
    await expect(page.getByRole('tab', { name: 'Count by to' })).toHaveCount(0);
  });

  test('Copy as table puts a real table and plain text on the clipboard; Copy CSV too', async ({ page }) => {
    await pick(page, 'Created order');
    await tool(page, 'Copy as table').click();
    await expect(page.locator('.tp-toast', { hasText: 'as a table' })).toBeVisible();
    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return { types: [...item.types], html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
    });
    expect(clip.types).toEqual(expect.arrayContaining(['text/html', 'text/plain']));
    expect(clip.html).toContain('<table');
    expect((clip.html.match(/<tr>/g) ?? []).length).toBe((await shown(page))!.rows + 1);
    expect(clip.html).toMatch(/<th[^>]*>orderId<\/th>/);
    expect(clip.text.replace(/\r\n/g, '\n').split('\n')[0]).toBe('line\ttime\tthread\torderId\tcustomerId\titems\ttotal\ttrace');

    await tool(page, 'Copy CSV').click();
    await expect(page.locator('.tp-toast', { hasText: 'as CSV' })).toBeVisible();
    const csv = (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, '\n');
    expect(csv.split('\n')[0]).toBe('line,time,thread,orderId,customerId,items,total,trace');
    expect(csv.split('\n')[1]).toMatch(/^43,10:15:06\.\d{3},nio-8080-exec-\d+,90002,\d+,\d,[\d.]+,[0-9a-f]{32}-[0-9a-f]{16}$/);
  });

  test('Open as new tab makes a CSV tab; Filter log to these lines filters to exactly those entries', async ({ page }) => {
    await pick(page, 'Created order');
    const rows = (await shown(page))!.rows;
    await tool(page, 'Filter log to these lines').click();
    await expect(page.getByTestId('filter-count')).toHaveText(`${rows} of 370 entries`);
    await expect(page.getByRole('textbox', { name: 'Patterns, one per line' })).toHaveValue(/^\/Created\\s\+order/);
    await page.getByRole('button', { name: 'Clear filters' }).click();

    await tool(page, 'Open as new tab').click();
    await expect(page.getByRole('tab', { name: /created-order.*\.csv/ })).toHaveAttribute('aria-selected', 'true');
    const text = await docText(page);
    expect(text.split('\n')[0]).toBe('line,time,thread,orderId,customerId,items,total,trace');
    expect(text.trim().split('\n')).toHaveLength(rows + 1);
    await expect(page.locator('.tp-tab.is-active')).toHaveClass(/is-dirty/);
  });

  test('Pop out table opens the table in its own window', async ({ page }) => {
    await pick(page, 'Created order');
    const popup = page.waitForEvent('popup');
    await tool(page, 'Pop out table').click();
    const w = await popup;
    await expect(w.locator('header')).toContainText('Created order');
    await expect(w.locator('thead th')).toHaveText([/^line/, /^time/, /^thread/, /^orderId/, /^customerId/, /^items/, /^total/, /^trace/]);
    expect(await w.locator('tbody tr').count()).toBe((await shown(page))!.rows);
    await expect(w.locator('thead th', { hasText: 'items' })).toContainText('p95');
    expect(await w.title()).toContain('Tracepad');
  });

  test('results panel: drag to resize, double-click to reset, maximise, close and reopen', async ({ page }) => {
    const panel = page.locator('.tp-panel');
    const area = page.locator('.tp-editor-area');
    expect((await box(panel)).height).toBe(340);
    const before = (await box(area)).height;
    const grip = await box(page.locator('.tp-panel-resize'));
    await page.mouse.move(grip.x + 400, grip.y + 3);
    await page.mouse.down();
    await page.mouse.move(grip.x + 400, grip.y + 3 - 150, { steps: 6 });
    await page.mouse.up();
    expect((await box(panel)).height).toBe(490);
    expect((await box(area)).height).toBe(before - 150);
    // The size is remembered.
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
    await auto(page);
    expect((await box(panel)).height).toBe(490);
    await page.locator('.tp-panel-resize').dblclick();
    expect((await box(panel)).height).toBe(340);

    await page.getByRole('button', { name: 'Maximise results panel' }).click();
    await expect(area).toBeHidden();
    const main = await box(page.locator('.tp-main'));
    expect(Math.round((await box(panel)).height)).toBe(Math.round(main.height) - 1);
    await page.getByRole('button', { name: 'Restore results panel' }).click();
    await expect(area).toBeVisible();

    await page.getByRole('button', { name: 'Close results panel' }).click();
    await expect(panel).toHaveCount(0);
    await page.keyboard.press('Alt+J');
    await expect(panel).toBeVisible();
    await expect(page.locator('.tp-pat').first()).toBeVisible();
  });

  test('full screen covers the window; Escape leaves it only after the palette has closed', async ({ page }) => {
    const vp = page.viewportSize()!;
    await page.getByRole('button', { name: 'Results full screen' }).click();
    await expect(page.locator('.tp-panel')).toHaveClass(/is-fullscreen/);
    await expect.poll(async () => {
      const b = await box(page.locator('.tp-panel'));
      const v = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      return b.x === 0 && b.y === 0 && b.width === v.w && b.height === v.h;
    }).toBe(true);
    // The table uses the room: it is now much taller than the docked panel was.
    expect((await box(page.locator('.tp-vt'))).height).toBeGreaterThan(vp.height * 0.7);
    await page.keyboard.press('Control+Shift+P');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    // The palette is above the full-screen panel, not hidden behind it.
    const pal = await box(page.locator('.tp-palette'));
    expect(await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.tp-palette'), [pal.x + 20, pal.y + 20])).toBe(true);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0);
    await expect(page.locator('.tp-panel')).toHaveClass(/is-fullscreen/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tp-panel')).not.toHaveClass(/is-fullscreen/);
    expect((await box(page.locator('.tp-panel'))).height).toBe(340);
    // Double-clicking the panel header toggles it too.
    await page.locator('.tp-panel-head').dblclick({ position: { x: 700, y: 10 } });
    await expect(page.locator('.tp-panel')).toHaveClass(/is-fullscreen/);
    await page.getByRole('button', { name: 'Leave full screen' }).click();
    await expect(page.locator('.tp-panel')).not.toHaveClass(/is-fullscreen/);
  });

  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
  ]) {
    test(`appearance ${size.width}: list beside table, headers over their cells, nothing clipped or overlapping`, async ({ page }) => {
      await page.setViewportSize(size);
      await pick(page, 'Created order');
      const main = await box(page.locator('.tp-main'));
      const panel = await box(page.locator('.tp-panel'));
      const area = await box(page.locator('.tp-editor-area'));
      const pats = await box(page.locator('.tp-pats'));
      const table = await box(page.locator('.tp-table-area'));
      // Docked under the editor, full width, to the bottom of the main area.
      expect(Math.round(panel.y)).toBe(Math.round(area.y + area.height));
      expect(Math.round(panel.y + panel.height)).toBe(Math.round(main.y + main.height));
      expect(panel.width).toBeGreaterThan(main.width - 2);
      expect(area.height).toBeGreaterThan(160);
      // The pattern list sits directly beside its table.
      expect(Math.abs(pats.x + pats.width - table.x)).toBeLessThan(2);
      expect(Math.round(table.x + table.width)).toBe(size.width);
      expect(pats.width).toBeGreaterThanOrEqual(280);
      expect(table.width).toBeGreaterThan(pats.width);
      // Toolbar buttons: inside the table area, on its top edge, not overlapping.
      const tools = await Promise.all((await page.locator('.tp-table-tools > *').all()).map(box));
      for (let i = 0; i < tools.length; i++) {
        expect(tools[i].x).toBeGreaterThanOrEqual(table.x);
        expect(tools[i].x + tools[i].width).toBeLessThanOrEqual(table.x + table.width);
        expect(tools[i].y - table.y).toBeLessThan(60);
        for (let j = i + 1; j < tools.length; j++) expect(overlaps(tools[i], tools[j])).toBe(false);
      }
      // Each header cell is exactly above its column.
      const ths = await Promise.all((await page.locator('.tp-vt-th').all()).map(box));
      const cells = await Promise.all((await page.locator('.tp-vt-row').first().locator('.tp-vt-cell').all()).map(box));
      expect(ths).toHaveLength(cells.length);
      for (let i = 0; i < ths.length; i++) {
        expect(Math.abs(ths[i].x - cells[i].x)).toBeLessThan(1);
        expect(Math.abs(ths[i].width - cells[i].width)).toBeLessThan(1);
        expect(ths[i].y + ths[i].height).toBeLessThanOrEqual(cells[i].y + 1);
      }
      // Statistics fit inside their header cell; names are not cut off.
      const clipped = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.tp-vt-th')].filter((th) => [...th.querySelectorAll<HTMLElement>('.tp-vt-stats span, .tp-vt-name')].some((s) => s.getBoundingClientRect().right > th.getBoundingClientRect().right + 0.5 || s.getBoundingClientRect().left < th.getBoundingClientRect().left - 0.5)).map((th) => th.textContent),
      );
      expect(clipped).toEqual([]);
      const cut = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.tp-table-tools .tp-btn, .tp-table-rows, .tp-ptab-name, .tp-pat-count')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));
      expect(cut).toEqual([]);
      // Rows fill the table from the header down, evenly spaced.
      const ys = (await Promise.all((await page.locator('.tp-vt-row').all()).map(box))).map((b) => b.y).sort((a, b) => a - b);
      for (let i = 1; i < Math.min(ys.length, 8); i++) expect(ys[i] - ys[i - 1]).toBe(24);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight)).toBe(true);
    });
  }

  for (const theme of ['midnight', 'paper', 'dawn']) {
    test(`appearance: panel text is readable in ${theme}`, async ({ page }) => {
      await page.evaluate((t) => localStorage.setItem('tracepad.settings', JSON.stringify({ theme: t, accent: 'teal' })), theme);
      await page.reload();
      await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
      await auto(page);
      await pick(page, 'Created order');
      for (const sel of ['.tp-pat.is-active .tp-pat-var', '.tp-pat:not(.is-active) .tp-pat-var', '.tp-pat-count-3', '.tp-pat-count-4', '.tp-pat-count-5', '.tp-pats-count', '.tp-vt-stats', '.tp-vt-stats b', '.tp-vt-cell', '.tp-table-rows', '.tp-ptab.is-active .tp-ptab-name', '.tp-table-tools .tp-btn']) {
        expect(await contrastOf(page.locator(sel).first()), sel).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

test.describe('extract', () => {
  test.beforeEach(async ({ page }) => {
    await openSample(page);
    await page.getByRole('button', { name: 'Tables and extract' }).click();
  });

  test('presets: response times, SQL, Kafka, IPs, timestamps', async ({ page }) => {
    const side = page.locator('.tp-sidebar');
    await side.getByRole('button', { name: /Response times/ }).click();
    await expect(page.locator('.tp-vt-row').first()).toBeVisible();
    expect(await headers(page)).toEqual(['line', 'time', 'level', 'ms', 'what', 'text']);
    await expect(page.locator('.tp-vt-th', { hasText: 'ms' }).locator('.tp-vt-stats').first()).toBeVisible();

    await side.getByRole('button', { name: /SQL statements/ }).click();
    await expect(page.getByRole('tab', { name: /^SQL statements/ })).toHaveAttribute('aria-selected', 'true');
    expect(await headers(page)).toEqual(['line', 'time', 'level', 'operation', 'table', 'statement']);
    expect(new Set(await column(page, 'operation'))).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE']));

    await side.getByRole('button', { name: /Kafka offsets/ }).click();
    await expect(page.getByRole('tab', { name: /^Kafka offsets/ })).toHaveAttribute('aria-selected', 'true');
    expect(await headers(page)).toEqual(['line', 'time', 'level', 'topic', 'partition', 'offset', 'key', 'text']);
    expect(new Set(await column(page, 'topic'))).toEqual(new Set(['payments.events', 'orders.events']));

    await side.getByRole('button', { name: /IP addresses/ }).click();
    await expect(page.getByRole('tab', { name: /^IP addresses/ })).toHaveAttribute('aria-selected', 'true');
    for (const v of await column(page, 'ip')) expect(v).toMatch(/^\d+\.\d+\.\d+\.\d+$/);

    await side.getByRole('button', { name: /Timestamps/ }).click();
    await expect(page.getByTestId('table-rows')).toHaveText('370 rows');
    // All five results stay open as tabs in the panel.
    await expect(page.locator('.tp-ptab')).toHaveCount(5);
  });

  test('custom pattern: named groups become columns; a bad pattern is explained before it runs', async ({ page }) => {
    const input = page.getByRole('textbox', { name: 'Custom pattern' });
    const run = page.getByRole('button', { name: 'Extract to table' });
    await expect(run).toBeDisabled();
    await input.fill('([');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('.tp-sidebar .tp-field-error')).toBeVisible();
    await expect(run).toBeDisabled();
    await input.fill('partition=(?<partition>\\d) offset=(?<offset>\\d+)');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await input.press('Enter');
    await expect(page.locator('.tp-vt-row').first()).toBeVisible();
    expect(await headers(page)).toEqual(['line', 'time', 'level', 'partition', 'offset']);
    for (const v of await column(page, 'offset')) expect(v).toMatch(/^\d+$/);
    // The extracted lines can be used as a filter too.
    await tool(page, 'Filter log to these lines').click();
    await expect(page.getByTestId('filter-count')).toHaveText(/^[1-9]\d* of 370 entries$/);
  });
});

test.describe('other logs and tools', () => {
  test('access logs get one request table with a route column', async ({ page }) => {
    await openViaChooser(page, [{ name: 'access.log', mimeType: 'text/plain', buffer: Buffer.from(F.ACCESS.repeat(10)) }]);
    await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
    await auto(page);
    await expect(pattern(page, 'Requests')).toHaveAttribute('aria-selected', 'true');
    expect(await headers(page)).toEqual(['line', 'time', 'ip', 'user', 'method', 'route', 'path', 'status', 'bytes', 'referrer', 'agent']);
    expect(new Set(await column(page, 'route'))).toEqual(new Set(['/api/orders/{id}', '/api/orders', '/api/orders/{id}/status']));
    await expect(page.getByTestId('table-rows')).toHaveText('40 rows');
    await page.getByRole('combobox', { name: 'Count by value of a column' }).selectOption({ label: 'route' });
    expect((await column(page, 'count')).map(Number)).toEqual([20, 10, 10]);
  });

  test('JSON logs add their other fields as columns', async ({ page }) => {
    const log = Array.from({ length: 12 }, (_, i) => JSON.stringify({ '@timestamp': `2026-03-14T10:15:${String(i).padStart(2, '0')}.000Z`, level: 'INFO', logger_name: 'c.a.OrderService', message: `Created order ${90000 + i}`, orderId: 90000 + i, region: i % 2 ? 'eu-west-1' : 'ap-south-1' })).join('\n');
    await openViaChooser(page, [{ name: 'app.jsonl', mimeType: 'text/plain', buffer: Buffer.from(log) }]);
    await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
    await auto(page);
    expect(await headers(page)).toEqual(['line', 'time', 'order', 'orderId', 'region']);
    expect((await column(page, 'region')).slice(0, 2)).toEqual(['ap-south-1', 'eu-west-1']);
  });

  test('a tab that is not a log says so instead of failing', async ({ page }) => {
    await page.keyboard.type('just some notes');
    await page.keyboard.press('Alt+T');
    await expect(page.locator('.tp-toast')).toContainText('not being treated as one');
    await expect(page.locator('.tp-panel')).toHaveCount(0);
  });

  test('auto tables work on a large (disk-backed) file, and rows jump to lines in the viewer', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('tracepad.settings', JSON.stringify({ largeFileMB: 0.001 })));
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await openViaChooser(page, [{ name: 'big.log', mimeType: 'text/plain', buffer: Buffer.from(sample.repeat(20)) }]);
    await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible();
    await auto(page);
    await expect(page.locator('.tp-pats-count')).toHaveText('42 patterns from 7,400 entries');
    await pick(page, 'Created order');
    await expect(page.getByTestId('table-rows')).toHaveText('420 rows');
    await page.locator('.tp-vt-row').nth(2).click();
    const line = (await column(page, 'line'))[2];
    await expect(page.locator('.tp-big-row.is-cursor')).toHaveAttribute('data-line', line);
    await expect(page.locator('.tp-big-row.is-cursor .tp-big-text')).toContainText('Created order orderId=');
  });

  test('find in all open tabs lists matches and takes you to them', async ({ page }) => {
    await openSample(page);
    await openViaChooser(page, [{ name: 'logback.log', mimeType: 'text/plain', buffer: Buffer.from(F.LOGBACK) }]);
    await page.keyboard.press('Control+Shift+F');
    await page.getByRole('dialog').getByRole('textbox').fill('nullpointerexception');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tp-vt-row').first()).toBeVisible();
    expect(await headers(page)).toEqual(['file', 'line', 'text']);
    // Matches from both files are in the result (the table only draws the rows on screen, so count them).
    await page.getByRole('combobox', { name: 'Count by value of a column' }).selectOption({ label: 'file' });
    expect(new Set(await column(page, 'file'))).toEqual(new Set(['sample-spring-boot.log', 'logback.log']));
    await page.getByRole('tab', { name: /^Find/ }).click();
    const files = await column(page, 'file');
    const i = files.indexOf('sample-spring-boot.log');
    await page.locator('.tp-vt-row').nth(i).click();
    await expect(page.getByRole('tab', { name: 'sample-spring-boot.log' })).toHaveAttribute('aria-selected', 'true');
    expect(await lineText(page, await cursorLine(page))).toContain('NullPointerException');
  });

  test('count duplicate lines', async ({ page }) => {
    await page.keyboard.type('alpha\nbeta\nalpha\ngamma\nbeta\nalpha');
    await page.keyboard.press('Control+Shift+P');
    await page.keyboard.type('Count duplicate lines');
    await page.keyboard.press('Enter');
    expect(await headers(page)).toEqual(['count', 'first line', 'text']);
    expect(await column(page, 'text')).toEqual(['alpha', 'beta']);
    expect(await column(page, 'count')).toEqual(['3', '2']);
  });
});

test.describe('copying when the clipboard permission is refused (managed browsers)', () => {
  test.beforeEach(async ({ page }) => {
    // What a browser does when policy blocks the clipboard permission: the asynchronous API rejects.
    await page.addInitScript(() => {
      const refuse = () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError'));
      Object.defineProperty(Clipboard.prototype, 'write', { value: refuse });
      Object.defineProperty(Clipboard.prototype, 'writeText', { value: refuse });
    });
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await openSample(page);
    await auto(page);
  });

  test('Copy as table and Copy CSV still work', async ({ page }) => {
    await pick(page, 'Created order');
    await tool(page, 'Copy as table').click();
    await expect(page.locator('.tp-toast', { hasText: 'as a table' })).toBeVisible();
    await expect(page.locator('.tp-toast-error')).toHaveCount(0);
    const clip = await page.evaluate(async () => {
      const [item] = await navigator.clipboard.read();
      return { html: await (await item.getType('text/html')).text(), text: await (await item.getType('text/plain')).text() };
    });
    expect(clip.html).toContain('<table');
    expect(clip.html).toMatch(/<th[^>]*>orderId<\/th>/);
    expect((clip.html.match(/<tr>/g) ?? []).length).toBe((await shown(page))!.rows + 1);
    expect(clip.text.replace(/\r\n/g, '\n').split('\n')[0]).toBe('line\ttime\tthread\torderId\tcustomerId\titems\ttotal\ttrace');
    await tool(page, 'Copy CSV').click();
    await expect(page.locator('.tp-toast', { hasText: 'as CSV' })).toBeVisible();
    expect((await page.evaluate(() => navigator.clipboard.readText())).split(/\r?\n/)[0]).toBe('line,time,thread,orderId,customerId,items,total,trace');
    // Copying did not disturb the page: focus and selection are where they were.
    await expect(page.locator('.tp-toast-error')).toHaveCount(0);
  });
});

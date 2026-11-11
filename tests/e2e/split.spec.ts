// Split view with snap layouts (0.7). Both builds.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { box, contrastOf, openApp, openViaChooser, overlaps, useBasicFilePickers, type Box } from './helpers';

const pad = (n: number) => String(n).padStart(2, '0');
const stamp = (sec: number) => `2026-03-14 10:${pad(Math.floor(sec / 60))}:${pad(sec % 60)}.000`;
/** orders: one entry a second for 15 minutes. billing: one every 3 seconds, starting a second later. */
const ORDERS = Array.from({ length: 900 }, (_, i) => `${stamp(i)} ${i % 40 === 7 ? 'ERROR' : 'INFO '} [orders] com.acme.orders.OrderService - order step ${i} needle`).join('\n') + '\n';
const BILLING = Array.from({ length: 300 }, (_, i) => `${stamp(1 + i * 3)} ${i % 25 === 3 ? 'ERROR' : 'INFO '} [billing] com.acme.billing.Invoice - invoice step ${i} needle`).join('\n') + '\n';
const NOTES = '# Notes\n\nplain text with a needle\n';
const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

interface Panes {
  layout: string;
  tabs: (string | null)[];
  focused: number;
}
interface Hook {
  panes(): Panes;
  topLine(name: string): number | null;
  scrollTab(name: string, line: number): void;
  textOf(name: string): string;
  hiddenIn(name: string): number;
}
const hook = <T>(page: Page, fn: (h: Hook, arg: string) => T, arg = '') => page.evaluate(([f, a]) => new Function('h', 'arg', `return (${f})(h, arg)`)((window as unknown as { __tracepad: Hook }).__tracepad, a) as T, [fn.toString(), arg] as const);
const panes = (page: Page) => page.evaluate(() => (window as unknown as { __tracepad: Hook }).__tracepad.panes());
const topLine = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { __tracepad: Hook }).__tracepad.topLine(n), name);
const scrollTab = (page: Page, name: string, line: number) => page.evaluate(([n, l]) => (window as unknown as { __tracepad: Hook }).__tracepad.scrollTab(n as string, l as number), [name, line] as const);
const textOf = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { __tracepad: Hook }).__tracepad.textOf(n), name);
const hiddenIn = (page: Page, name: string) => page.evaluate((n) => (window as unknown as { __tracepad: Hook }).__tracepad.hiddenIn(n), name);
void hook;

const pane = (page: Page, i: number) => page.locator(`.tp-pane[data-pane="${i}"]`);
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const seconds = (line: string) => Number(line.slice(14, 16)) * 60 + Number(line.slice(17, 19));

async function openThree(page: Page): Promise<void> {
  await openViaChooser(page, [file('orders.log', ORDERS), file('billing.log', BILLING), file('notes.md', NOTES)]);
  await expect(tab(page, 'notes.md')).toBeVisible();
  await tab(page, 'orders.log').click();
  await expect(page.locator('.tp-logbar[data-log-status="ready"]')).toBeVisible();
}

async function pickLayout(page: Page, name: string, place: number, of: number): Promise<void> {
  await page.getByRole('button', { name: 'Split layouts' }).click();
  await page.getByRole('button', { name: `${name}, place ${place} of ${of}` }).click();
}

/** orders.log on the left, billing.log on the right. */
async function sideBySide(page: Page): Promise<void> {
  await openThree(page);
  await tab(page, 'billing.log').click();
  await tab(page, 'orders.log').click();
  await page.keyboard.press('Control+\\');
  await expect.poll(() => panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'billing.log'], focused: 0 });
  await expect(pane(page, 1).locator('.cm-line').first()).toBeVisible();
}

async function dragTo(page: Page, from: Locator, x: number, y: number, drop = true): Promise<void> {
  const b = await box(from);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2 + 4, { steps: 2 });
  await page.mouse.move(x, y, { steps: 8 });
  await page.mouse.move(x + 1, y + 1);
  if (drop) await page.mouse.up();
}

function tiles(area: Box, boxes: Box[]): void {
  let sum = 0;
  for (const [i, b] of boxes.entries()) {
    expect(b.x).toBeGreaterThanOrEqual(area.x - 0.5);
    expect(b.y).toBeGreaterThanOrEqual(area.y - 0.5);
    expect(b.x + b.width).toBeLessThanOrEqual(area.x + area.width + 0.5);
    expect(b.y + b.height).toBeLessThanOrEqual(area.y + area.height + 0.5);
    for (const other of boxes.slice(i + 1)) expect(overlaps(b, other)).toBe(false);
    sum += b.width * b.height;
  }
  // Together the panes use the whole editor area: no dead space.
  expect(sum / (area.width * area.height)).toBeGreaterThan(0.995);
}

test.beforeEach(async ({ page }) => {
  await useBasicFilePickers(page);
  await openApp(page);
});

test.describe('layouts', () => {
  test('the picker shows five layouts; the clicked zone gets the current file and empty zones offer the others', async ({ page }) => {
    await openThree(page);
    await page.getByRole('button', { name: 'Split layouts' }).click();
    const pop = page.getByRole('dialog', { name: 'Split layouts' });
    await expect(pop.locator('.tp-thumb')).toHaveCount(5);
    for (const name of ['Side by side', 'Top and bottom', 'Three columns', 'One large and two stacked', 'Two by two']) await expect(pop.getByRole('group', { name, exact: true })).toBeVisible();
    // Zones are comfortable targets, not slivers.
    for (const z of await pop.locator('.tp-thumb-zone').all()) {
      const b = await box(z);
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(30);
    }
    await page.getByRole('button', { name: 'Side by side, place 2 of 2' }).click();
    await expect(pop).toHaveCount(0);
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: [null, 'orders.log'], focused: 1 });
    // Snap Assist in the empty zone: big cards for the files that are not on screen.
    const assist = page.getByRole('region', { name: 'Choose a file for pane 1' });
    await expect(assist.locator('.tp-assist-card')).toHaveText([/notes\.md/, /billing\.log/, /Open a file/]);
    for (const c of await assist.locator('.tp-assist-card').all()) {
      const b = await box(c);
      expect(b.height).toBeGreaterThanOrEqual(60);
      expect(b.width).toBeGreaterThanOrEqual(160);
    }
    await assist.getByRole('button', { name: /billing\.log/ }).click();
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['billing.log', 'orders.log'], focused: 0 });
    await expect(pane(page, 0).locator('.cm-line').first()).toContainText('[billing]');
    await expect(pane(page, 1).locator('.cm-line').first()).toContainText('[orders]');
  });

  test('"Leave this space out" drops the empty zone', async ({ page }) => {
    await openThree(page);
    await pickLayout(page, 'Three columns', 2, 3);
    expect(await panes(page)).toEqual({ layout: 'cols3', tabs: [null, 'orders.log', null], focused: 1 });
    await page.getByRole('region', { name: 'Choose a file for pane 3' }).getByRole('button', { name: 'Leave this space out' }).click();
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: [null, 'orders.log'], focused: 1 });
    await page.getByRole('region', { name: 'Choose a file for pane 1' }).getByRole('button', { name: 'Leave this space out' }).click();
    expect(await panes(page)).toEqual({ layout: 'single', tabs: ['orders.log'], focused: 0 });
    await expect(page.locator('.tp-pane-head')).toHaveCount(0);
  });

  test('Ctrl+\\ toggles a two-file split', async ({ page }) => {
    await sideBySide(page);
    await page.keyboard.press('Control+\\');
    expect(await panes(page)).toEqual({ layout: 'single', tabs: ['orders.log'], focused: 0 });
    await expect(page.locator('.tp-pane')).toHaveCount(1);
  });

  for (const [name, id, count, bars] of [
    ['Side by side', 'cols2', 2, 1],
    ['Top and bottom', 'rows2', 2, 1],
    ['Three columns', 'cols3', 3, 2],
    ['One large and two stacked', 'main2', 3, 2],
    ['Two by two', 'grid4', 4, 2],
  ] as const) {
    test(`${name}: panes tile the editor area and every divider resizes`, async ({ page }) => {
      await openViaChooser(page, [file('a.log', ORDERS), file('b.log', BILLING), file('c.md', NOTES), file('d.txt', 'four\n')]);
      await expect(tab(page, 'd.txt')).toBeVisible();
      await pickLayout(page, name, 1, count);
      for (let i = 1; i < count; i++) await page.locator('.tp-assist').first().locator('.tp-assist-card').first().click();
      const state = await panes(page);
      expect(state.layout).toBe(id);
      expect(state.tabs.filter(Boolean)).toHaveLength(count);
      expect(new Set(state.tabs).size).toBe(count);
      const area = await box(page.locator('.tp-editor-area'));
      const boxes = async () => Promise.all((await page.locator('.tp-pane').all()).map(box));
      tiles(area, await boxes());
      const dividers = page.getByRole('separator', { name: 'Resize panes' });
      await expect(dividers).toHaveCount(bars);
      for (let i = 0; i < bars; i++) {
        const before = await boxes();
        const d = await box(dividers.nth(i));
        const vertical = (await dividers.nth(i).getAttribute('aria-orientation')) === 'vertical';
        // Away from the middle, where two dividers may cross.
        const gx = d.x + d.width * (vertical ? 0.5 : 0.8);
        const gy = d.y + d.height * (vertical ? 0.2 : 0.5);
        await page.mouse.move(gx, gy);
        await page.mouse.down();
        await page.mouse.move(gx + (vertical ? 90 : 0), gy + (vertical ? 0 : 70), { steps: 5 });
        await page.mouse.up();
        const after = await boxes();
        expect(after.some((b, k) => Math.abs((vertical ? b.width - before[k].width : b.height - before[k].height) - (vertical ? 90 : 70)) < 3)).toBe(true);
        tiles(area, after);
      }
      // No pane can be squeezed away.
      const d = await box(dividers.first());
      await page.mouse.move(d.x + d.width / 2, d.y + d.height * 0.2);
      await page.mouse.down();
      await page.mouse.move(area.x + 2, area.y + 2, { steps: 5 });
      await page.mouse.up();
      for (const b of await boxes()) {
        expect(b.width).toBeGreaterThan(area.width * 0.14);
        expect(b.height).toBeGreaterThan(area.height * 0.14);
      }
      // Double-click: equal sizes.
      await dividers.first().dblclick();
      const even = await boxes();
      if (id === 'cols2' || id === 'cols3') for (const b of even) expect(b.width).toBeCloseTo(area.width / count, -1);
      if (id === 'rows2') for (const b of even) expect(b.height).toBeCloseTo(area.height / 2, -1);
      if (id === 'grid4' || id === 'main2') expect(even[0].width).toBeCloseTo(area.width / 2, -1);
      tiles(area, even);
    });
  }

  test('the split and its sizes come back after a reload', async ({ page }) => {
    await sideBySide(page);
    const d = await box(page.getByRole('separator', { name: 'Resize panes' }));
    await page.mouse.move(d.x + 3, d.y + 200);
    await page.mouse.down();
    await page.mouse.move(d.x + 203, d.y + 200, { steps: 4 });
    await page.mouse.up();
    const width = (await box(pane(page, 0))).width;
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await expect.poll(async () => (await panes(page)).layout).toBe('cols2');
    expect((await panes(page)).tabs).toEqual(['orders.log', 'billing.log']);
    expect((await box(pane(page, 0))).width).toBeCloseTo(width, 0);
    await expect(pane(page, 1).locator('.cm-line').first()).toContainText('[billing]');
  });
});

test.describe('panes', () => {
  test('focus follows the click: tabs, status bar, typing and Save act on that pane', async ({ page }) => {
    await openViaChooser(page, [file('left.txt', 'left file\n'), file('right.txt', 'right file\n')]);
    await tab(page, 'left.txt').click();
    await page.keyboard.press('Control+\\');
    await expect.poll(() => panes(page)).toEqual({ layout: 'cols2', tabs: ['left.txt', 'right.txt'], focused: 0 });
    await expect(pane(page, 0)).toHaveClass(/is-focused/);
    await pane(page, 1).locator('.cm-content').click();
    await expect(pane(page, 1)).toHaveClass(/is-focused/);
    await expect(pane(page, 0)).not.toHaveClass(/is-focused/);
    await expect(tab(page, 'right.txt')).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Control+End');
    await page.keyboard.type('typed on the right');
    expect(await textOf(page, 'right.txt')).toBe('right file\ntyped on the right');
    expect(await textOf(page, 'left.txt')).toBe('left file\n');
    await expect(page.locator('.tp-status-state')).toHaveText('Unsaved changes');
    // Ctrl+S saves the pane that has focus.
    const download = page.waitForEvent('download');
    await page.keyboard.press('Control+S');
    expect((await download).suggestedFilename()).toBe('right.txt');
    // F6 moves to the next pane; typing lands there.
    await page.keyboard.press('F6');
    await expect(pane(page, 0)).toHaveClass(/is-focused/);
    await page.keyboard.type('L');
    expect(await textOf(page, 'left.txt')).toContain('L');
    expect(await textOf(page, 'right.txt')).toBe('right file\ntyped on the right');
    // Undo is per file.
    await page.keyboard.press('Control+Z');
    expect(await textOf(page, 'left.txt')).toBe('left file\n');
  });

  test('each pane has its own file picker, swap-with-main and close, inside its own header', async ({ page }) => {
    await sideBySide(page);
    for (const i of [0, 1]) {
      const p = await box(pane(page, i));
      const head = await box(pane(page, i).locator('.tp-pane-head'));
      expect(head.y).toBeCloseTo(p.y, 0);
      expect(head.width).toBeGreaterThan(p.width - 3);
      const buttons = await Promise.all((await pane(page, i).locator('.tp-pane-head button').all()).map(box));
      for (const [k, b] of buttons.entries()) {
        expect(b.x).toBeGreaterThanOrEqual(p.x);
        expect(b.x + b.width).toBeLessThanOrEqual(p.x + p.width);
        expect(b.y).toBeGreaterThanOrEqual(head.y);
        expect(b.y + b.height).toBeLessThanOrEqual(head.y + head.height);
        if (k) expect(overlaps(buttons[k - 1], b)).toBe(false);
      }
      expect(await contrastOf(pane(page, i).locator('.tp-pane-name'))).toBeGreaterThanOrEqual(4.5);
    }
    // File picker: a file not on screen replaces; a file from another pane swaps.
    await page.getByRole('button', { name: 'Pane 2 file: billing.log' }).click();
    await expect(page.getByRole('menu').getByRole('menuitem')).toHaveText([/orders\.log.*swap with pane 1/, /billing\.log.*shown here/, /notes\.md/]);
    const m = await box(page.getByRole('menu'));
    const btn = await box(page.getByRole('button', { name: 'Pane 2 file: billing.log' }));
    expect(m.y).toBeGreaterThanOrEqual(btn.y + btn.height);
    expect(m.y - (btn.y + btn.height)).toBeLessThan(12);
    await page.getByRole('menuitem', { name: /notes\.md/ }).click();
    expect((await panes(page)).tabs).toEqual(['orders.log', 'notes.md']);
    await page.getByRole('button', { name: 'Pane 2 file: notes.md' }).click();
    await page.getByRole('menuitem', { name: /orders\.log/ }).click();
    expect((await panes(page)).tabs).toEqual(['notes.md', 'orders.log']);
    await page.getByRole('button', { name: 'Swap pane 2 with the main pane' }).click();
    expect((await panes(page)).tabs).toEqual(['orders.log', 'notes.md']);
    await expect(pane(page, 0).locator('.cm-line').first()).toContainText('[orders]');
    // Close the pane: the file stays open as a tab.
    await page.getByRole('button', { name: 'Remove pane 2' }).click();
    expect(await panes(page)).toEqual({ layout: 'single', tabs: ['orders.log'], focused: 0 });
    await expect(tab(page, 'notes.md')).toBeVisible();
  });

  test('clicking a tab focuses its pane, or replaces the focused pane; closing a tab removes its pane', async ({ page }) => {
    await sideBySide(page);
    await tab(page, 'billing.log').click();
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'billing.log'], focused: 1 });
    await tab(page, 'notes.md').click();
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'notes.md'], focused: 1 });
    await tab(page, 'notes.md').locator('.tp-tab-close').click();
    expect(await panes(page)).toEqual({ layout: 'single', tabs: ['orders.log'], focused: 0 });
    await expect(tab(page, 'notes.md')).toHaveCount(0);
  });

  test('"Show beside" in the tab menu', async ({ page }) => {
    await openThree(page);
    await tab(page, 'notes.md').click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Show beside/ }).click();
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'notes.md'], focused: 1 });
  });
});

test.describe('dragging', () => {
  test('dragging a tab over the editor shows the snap bar and a big outline; the right half opens side by side', async ({ page }) => {
    await openThree(page);
    const area = await box(page.locator('.tp-editor-area'));
    await dragTo(page, tab(page, 'billing.log'), area.x + area.width * 0.8, area.y + area.height * 0.6, false);
    const bar = page.locator('.tp-snapbar');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.tp-thumb')).toHaveCount(5);
    // Big targets only.
    for (const z of await bar.locator('.tp-thumb-zone').all()) {
      const b = await box(z);
      expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(38);
    }
    const barBox = await box(bar);
    expect(barBox.y).toBeGreaterThanOrEqual(area.y);
    expect(Math.abs(barBox.x + barBox.width / 2 - (area.x + area.width / 2))).toBeLessThan(2);
    const outline = await box(page.locator('.tp-snap-outline'));
    expect(outline.x).toBeCloseTo(area.x + area.width / 2, 0);
    expect(outline.width).toBeCloseTo(area.width / 2, 0);
    expect(outline.height).toBeCloseTo(area.height, 0);
    await expect(page.locator('.tp-snap-label')).toHaveText('Open billing.log side by side');
    expect(await contrastOf(page.locator('.tp-snap-label'))).toBeGreaterThanOrEqual(4.5);
    // Left half: replace what is there (the outline covers the whole editor).
    await page.mouse.move(area.x + area.width * 0.2, area.y + area.height * 0.6, { steps: 4 });
    await expect(page.locator('.tp-snap-label')).toHaveText('Show billing.log here instead of orders.log');
    expect((await box(page.locator('.tp-snap-outline'))).width).toBeCloseTo(area.width, 0);
    await page.mouse.move(area.x + area.width * 0.8, area.y + area.height * 0.6, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.tp-snap')).toHaveCount(0);
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'billing.log'], focused: 1 });
  });

  test('dropping on an existing pane replaces it; dropping on a layout in the snap bar applies it', async ({ page }) => {
    await sideBySide(page);
    const left = await box(pane(page, 0));
    await dragTo(page, tab(page, 'notes.md'), left.x + left.width / 2, left.y + left.height * 0.7);
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['notes.md', 'billing.log'], focused: 0 });
    // Snap bar: third zone of "One large and two stacked".
    const area = await box(page.locator('.tp-editor-area'));
    await dragTo(page, tab(page, 'orders.log'), area.x + area.width / 2, area.y + 200, false);
    const zone = await box(page.locator('.tp-snapbar [data-snap-layout="main2"][data-snap-zone="2"]'));
    await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 5 });
    await expect(page.locator('.tp-snapbar [data-snap-layout="main2"][data-snap-zone="2"]')).toHaveClass(/is-hot/);
    // The outline shows where it will land: bottom right.
    const outline = await box(page.locator('.tp-snap-outline'));
    expect(outline.x + outline.width).toBeCloseTo(area.x + area.width, 0);
    expect(outline.y + outline.height).toBeCloseTo(area.y + area.height, 0);
    await page.mouse.up();
    expect(await panes(page)).toEqual({ layout: 'main2', tabs: ['notes.md', 'billing.log', 'orders.log'], focused: 2 });
    tiles(area, await Promise.all((await page.locator('.tp-pane').all()).map(box)));
  });

  test('a file dragged from the Open files list snaps too, and a drag inside the tab strip still reorders', async ({ page }) => {
    await openThree(page);
    await page.getByRole('button', { name: /Open files list/ }).click();
    const row = page.locator('.tp-file', { hasText: 'notes.md' });
    await expect(row).toBeVisible();
    const area = await box(page.locator('.tp-editor-area'));
    await dragTo(page, row, area.x + area.width * 0.85, area.y + area.height * 0.5);
    expect(await panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'notes.md'], focused: 1 });
    // Reorder within the strip: nothing snaps.
    const first = await box(tab(page, 'orders.log'));
    await dragTo(page, tab(page, 'notes.md'), first.x + 4, first.y + first.height / 2);
    await expect(page.getByRole('tab')).toHaveText([/notes\.md/, /orders\.log/, /billing\.log/]);
    expect((await panes(page)).tabs).toEqual(['orders.log', 'notes.md']);
  });
});

test.describe('together', () => {
  const lineOf = async (page: Page, name: string, n: number) => (await textOf(page, name)).split('\n')[n];

  test('by time: scrolling either log brings the other to the same moment', async ({ page }) => {
    await sideBySide(page);
    // Lead with orders (1 entry a second): line 400 is 10:06:40.
    await scrollTab(page, 'orders.log', 400);
    await expect.poll(() => topLine(page, 'billing.log')).toBeGreaterThan(100);
    let a = seconds(await lineOf(page, 'orders.log', (await topLine(page, 'orders.log'))!));
    let b = seconds(await lineOf(page, 'billing.log', (await topLine(page, 'billing.log'))!));
    expect(b).toBeGreaterThanOrEqual(a);
    expect(b - a).toBeLessThanOrEqual(3);
    // The other direction: lead with billing (1 entry every 3 seconds).
    await page.waitForTimeout(400);
    await scrollTab(page, 'billing.log', 40);
    await expect.poll(() => topLine(page, 'orders.log')).toBeLessThan(200);
    b = seconds(await lineOf(page, 'billing.log', (await topLine(page, 'billing.log'))!));
    a = seconds(await lineOf(page, 'orders.log', (await topLine(page, 'orders.log'))!));
    expect(a).toBeGreaterThanOrEqual(b);
    expect(a - b).toBeLessThanOrEqual(1);
    // A real wheel scroll leads as well.
    await page.waitForTimeout(400);
    const p = await box(pane(page, 0));
    await page.mouse.move(p.x + p.width / 2, p.y + p.height / 2);
    await page.mouse.wheel(0, 3000);
    await expect.poll(async () => seconds(await lineOf(page, 'billing.log', (await topLine(page, 'billing.log'))!)) - seconds(await lineOf(page, 'orders.log', (await topLine(page, 'orders.log'))!))).toBeLessThanOrEqual(3);
    expect((await topLine(page, 'orders.log'))!).toBeGreaterThan(200);
  });

  test('by line and off', async ({ page }) => {
    await sideBySide(page);
    await page.getByRole('button', { name: 'Split layouts' }).click();
    await page.getByRole('button', { name: 'By line' }).click();
    await expect(page.getByRole('button', { name: 'By line' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Escape');
    await scrollTab(page, 'orders.log', 150);
    await expect.poll(() => topLine(page, 'billing.log')).toBe(150);
    await page.getByRole('button', { name: 'Split layouts' }).click();
    await page.getByRole('button', { name: 'Off', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    await scrollTab(page, 'orders.log', 500);
    await page.waitForTimeout(400);
    expect(await topLine(page, 'billing.log')).toBe(150);
  });

  test('filters, including a time range, apply to every pane', async ({ page }) => {
    await sideBySide(page);
    await page.locator('.tp-chip', { hasText: 'ERROR' }).click();
    await expect.poll(() => hiddenIn(page, 'orders.log')).toBe(900 - 23 + 1);
    await expect.poll(() => hiddenIn(page, 'billing.log')).toBe(300 - 12 + 1);
    await expect(pane(page, 0).locator('.cm-line').first()).toContainText('ERROR');
    await expect(pane(page, 1).locator('.cm-line').first()).toContainText('ERROR');
    await page.getByRole('button', { name: 'Clear filters' }).click();
    await expect.poll(() => hiddenIn(page, 'billing.log')).toBe(0);
    // Time range typed into the filter.
    await page.getByRole('button', { name: 'More filters' }).click();
    await page.getByLabel('From').fill('10:05:00');
    await page.getByLabel('To', { exact: true }).fill('10:05:59');
    await expect.poll(() => hiddenIn(page, 'orders.log')).toBe(900 - 60 + 1);
    await expect.poll(() => hiddenIn(page, 'billing.log')).toBe(300 - 20 + 1);
    await expect(pane(page, 1).locator('.cm-line').first()).toContainText('10:05:');
  });

  test('Ctrl+F marks matches in every pane and steps through the focused one', async ({ page }) => {
    await sideBySide(page);
    await pane(page, 0).locator('.cm-content').click();
    await page.keyboard.press('Control+F');
    await page.getByRole('textbox', { name: 'Find' }).fill('needle');
    await expect(pane(page, 0).locator('.cm-searchMatch').first()).toBeVisible();
    await expect(pane(page, 1).locator('.cm-searchMatch').first()).toBeVisible();
    await expect(page.locator('.tp-find-count')).toContainText('of 900');
    // The find box belongs to the focused pane and moves with the focus.
    expect(overlaps(await box(page.locator('.tp-find')), await box(pane(page, 1)))).toBe(false);
    await pane(page, 1).locator('.cm-content').click();
    await expect(page.locator('.tp-find-count')).toContainText('of 300');
    expect(overlaps(await box(page.locator('.tp-find')), await box(pane(page, 0)))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(page.locator('.tp-find')).toHaveCount(0);
    await expect(page.locator('.cm-searchMatch')).toHaveCount(0);
  });

  test('a preview belongs to its pane', async ({ page }) => {
    await openThree(page);
    await tab(page, 'notes.md').click();
    await page.keyboard.press('Alt+P');
    await page.keyboard.press('Control+\\');
    await expect.poll(async () => (await panes(page)).layout).toBe('cols2');
    const p0 = await box(pane(page, 0));
    const pv = await box(page.locator('.tp-preview'));
    expect(pv.x).toBeGreaterThanOrEqual(p0.x);
    expect(pv.x + pv.width).toBeLessThanOrEqual(p0.x + p0.width + 0.5);
    await expect(page.locator('.tp-md h1')).toHaveText('Notes');
    await page.getByRole('button', { name: 'Swap pane 2 with the main pane' }).click();
    const p1 = await box(pane(page, 1));
    const moved = await box(page.locator('.tp-preview'));
    expect(moved.x).toBeGreaterThanOrEqual(p1.x);
    await expect(page.locator('.tp-md h1')).toHaveText('Notes');
  });
});

test.describe('a large file in a pane', () => {
  test('the read-only viewer and an editor sit side by side: time sync both ways, one filter, one search', async ({ page }) => {
    // orders.log (about 76 KB) goes to the large-file viewer; billing.log stays in the editor.
    await page.evaluate(() => localStorage.setItem('tracepad.settings', JSON.stringify({ largeFileMB: 0.05 })));
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await openViaChooser(page, [file('orders.log', ORDERS), file('billing.log', BILLING)]);
    await expect(tab(page, 'billing.log')).toBeVisible();
    await tab(page, 'orders.log').click();
    await expect(page.locator('.tp-big[data-status="ready"]')).toBeVisible();
    await page.keyboard.press('Control+\\');
    await expect.poll(() => panes(page)).toEqual({ layout: 'cols2', tabs: ['orders.log', 'billing.log'], focused: 0 });
    await expect(pane(page, 0).locator('.tp-big')).toBeVisible();
    await expect(pane(page, 1).locator('.tp-big')).toHaveCount(0);
    await expect(pane(page, 1).locator('.cm-line').first()).toContainText('[billing]');
    // The viewer fills its pane under the header.
    const p = await box(pane(page, 0));
    const v = await box(pane(page, 0).locator('.tp-big'));
    const head = await box(pane(page, 0).locator('.tp-pane-head'));
    expect(v.x).toBeCloseTo(p.x, 0);
    expect(v.y).toBeCloseTo(head.y + head.height, 0);
    // Down to the pane border.
    expect(Math.abs(v.y + v.height - (p.y + p.height))).toBeLessThanOrEqual(1.5);
    const billing = (await textOf(page, 'billing.log')).split('\n');
    // The viewer leads (wheel): the editor follows to the same moment.
    await page.mouse.move(v.x + v.width / 2, v.y + v.height / 2);
    // (billing.log may still be parsing when the first wheel step arrives: keep scrolling.)
    await expect
      .poll(async () => {
        await page.mouse.wheel(0, 1500);
        return topLine(page, 'billing.log');
      })
      .toBeGreaterThan(40);
    await page.waitForTimeout(300);
    const lead = (await topLine(page, 'orders.log'))!;
    expect(lead).toBeGreaterThan(100);
    const follow = seconds(billing[(await topLine(page, 'billing.log'))!]);
    expect(follow).toBeGreaterThanOrEqual(lead);
    expect(follow - lead).toBeLessThanOrEqual(3);
    // The editor leads: the viewer follows.
    await page.waitForTimeout(400);
    await scrollTab(page, 'billing.log', 200);
    await expect.poll(() => topLine(page, 'orders.log')).toBe(601);
    // One filter for both.
    await page.locator('.tp-chip', { hasText: 'ERROR' }).click();
    await expect(pane(page, 0).locator('.tp-big')).toHaveAttribute('data-rows', '23');
    await expect.poll(() => hiddenIn(page, 'billing.log')).toBe(300 - 12 + 1);
    await page.locator('.tp-chip', { hasText: 'ERROR' }).click();
    await expect(pane(page, 0).locator('.tp-big')).toHaveAttribute('data-rows', '900');
    // One search for both.
    await pane(page, 1).locator('.cm-content').click();
    await page.keyboard.press('Control+F');
    await page.getByRole('textbox', { name: 'Find' }).fill('step 2');
    await expect(pane(page, 1).locator('.cm-searchMatch').first()).toBeVisible();
    await expect(pane(page, 0).locator('.tp-big-hit').first()).toBeVisible();
  });
});

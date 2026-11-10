// Assertions about how the app LOOKS, not just whether things exist: space used,
// scrollbars at the edges, controls next to what they control, no overlaps, no
// clipped text, and measured contrast in every theme x accent combination.
import { expect, test, type Page } from '@playwright/test';
import { box, clippedText, contrastOf, openApp, openSample, overlaps } from './helpers';

const SIZES = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
];
const THEMES = ['midnight', 'graphite', 'fjord', 'paper', 'dawn', 'mist'];
const ACCENTS = ['blue', 'teal', 'violet', 'amber', 'rose', 'green'];

async function noPageScroll(page: Page): Promise<void> {
  const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, w: innerWidth, h: innerHeight }));
  expect(m.sw, 'no sideways page scroll').toBeLessThanOrEqual(m.w);
  expect(m.sh, 'no vertical page scroll').toBeLessThanOrEqual(m.h);
}

for (const size of SIZES) {
  test.describe(`${size.width}x${size.height}`, () => {
    test.use({ viewport: size });

    test('the shell fills the window and the editor gets the space', async ({ page }) => {
      await openApp(page);
      await openSample(page);
      const top = await box(page.locator('.tp-topbar'));
      const status = await box(page.locator('.tp-status'));
      const main = await box(page.locator('.tp-main'));
      const rail = await box(page.locator('.tp-rail'));
      expect(top.y).toBe(0);
      expect(top.width).toBe(size.width);
      expect(Math.round(status.y + status.height)).toBe(size.height);
      expect(status.width).toBe(size.width);
      // With the sidebar closed the editor takes everything except the rail.
      expect(main.width).toBeGreaterThan(size.width - rail.width - 2);
      expect(main.height).toBeGreaterThan(size.height - top.height - status.height - 2);
      expect(Math.round(main.x + main.width)).toBe(size.width);
      // Bars are slim: together under 9% of the height.
      expect((top.height + status.height) / size.height).toBeLessThan(0.09);
      await noPageScroll(page);
    });

    test('the editor scrollbar is at the window edge and the minimap sits just inside it', async ({ page }) => {
      await openApp(page);
      await openSample(page);
      const scroller = await box(page.locator('.cm-scroller'));
      const minimap = await box(page.locator('.tp-minimap'));
      expect(Math.round(scroller.x + scroller.width)).toBe(size.width);
      const scrollbar = await page.locator('.cm-scroller').evaluate((el) => (el as HTMLElement).offsetWidth - el.clientWidth);
      expect(Math.round(minimap.x + minimap.width)).toBe(size.width - scrollbar);
      expect(minimap.height).toBeGreaterThan(scroller.height - 24);
      // Text never runs underneath the minimap.
      const line = await box(page.locator('.cm-line').nth(12));
      const content = await box(page.locator('.cm-content'));
      expect(content.x + content.width - 90).toBeGreaterThanOrEqual(line.x);
      const painted = await page.locator('.tp-minimap canvas').evaluate((c) => {
        const cv = c as HTMLCanvasElement;
        const d = cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
        let n = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
        return n;
      });
      expect(painted, 'minimap actually draws the document').toBeGreaterThan(2000);
    });

    test('top bar: nothing overlaps, nothing is clipped, tabs keep their close button', async ({ page }) => {
      await openApp(page);
      await openSample(page);
      await page.getByRole('button', { name: 'New tab' }).click();
      const parts = [page.locator('.tp-brand'), page.locator('.tp-tabs'), page.locator('.tp-newtab'), page.locator('.tp-topbar-actions')];
      const boxes = await Promise.all(parts.map(box));
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j]), `top bar part ${i} overlaps ${j}`).toBe(false);
      for (const tab of await page.getByRole('tab').all()) {
        const t = await box(tab);
        const close = await box(tab.locator('.tp-tab-close'));
        expect(close.x).toBeGreaterThanOrEqual(t.x);
        expect(close.x + close.width).toBeLessThanOrEqual(t.x + t.width + 0.5);
        expect(close.y).toBeGreaterThanOrEqual(t.y);
      }
      expect(await clippedText(page, '.tp-tab-name, .tp-cmd-pill-text, .tp-status-item, .tp-kbd')).toEqual([]);
      const actions = await box(page.locator('.tp-topbar-actions'));
      expect(actions.x + actions.width).toBeLessThanOrEqual(size.width);
    });

    test('find box: inside the editor, clear of the minimap, controls beside their fields', async ({ page }) => {
      await openApp(page);
      await openSample(page);
      await page.keyboard.press('Control+H');
      const find = await box(page.locator('.tp-find'));
      const main = await box(page.locator('.tp-main'));
      const minimap = await box(page.locator('.tp-minimap'));
      expect(find.x).toBeGreaterThanOrEqual(main.x);
      expect(find.y).toBeGreaterThanOrEqual(main.y);
      expect(overlaps(find, minimap)).toBe(false);
      expect(find.width).toBeGreaterThanOrEqual(420);
      const input = await box(page.getByRole('textbox', { name: 'Find', exact: true }));
      expect(input.width).toBeGreaterThan(180);
      const replaceInput = await box(page.getByRole('textbox', { name: 'Replace with' }));
      const replaceBtn = await box(page.getByRole('button', { name: 'Replace', exact: true }));
      // "Replace" sits on the same row as, and right after, the field it uses.
      expect(Math.abs(replaceBtn.y + replaceBtn.height / 2 - (replaceInput.y + replaceInput.height / 2))).toBeLessThan(3);
      expect(replaceBtn.x).toBeGreaterThan(replaceInput.x + replaceInput.width - 1);
      expect(replaceBtn.x - (replaceInput.x + replaceInput.width)).toBeLessThan(24);
      for (const name of ['Match case', 'Whole word', 'Regular expression']) {
        const b = await box(page.getByRole('button', { name }));
        const field = await box(page.locator('.tp-find .tp-find-field').first());
        expect(b.x).toBeGreaterThanOrEqual(field.x);
        expect(b.x + b.width).toBeLessThanOrEqual(field.x + field.width);
      }
      expect(await clippedText(page, '.tp-find .tp-btn, .tp-find-count')).toEqual([]);
      // A found match is scrolled clear of both the find box and the minimap.
      await page.getByRole('textbox', { name: 'Find', exact: true }).fill('offset=48230');
      await page.keyboard.press('Enter');
      const hit = await box(page.locator('.cm-searchMatch-selected'));
      expect(hit.x + hit.width).toBeLessThanOrEqual(minimap.x);
      expect(overlaps(hit, find)).toBe(false);
    });

    test('sidebar: opens only on request, resizes, resets, and its close button is in its header', async ({ page }) => {
      await openApp(page);
      await openSample(page);
      await expect(page.locator('.tp-sidebar')).toHaveCount(0);
      await page.getByRole('button', { name: 'Appearance' }).click();
      const side = await box(page.locator('.tp-sidebar'));
      const main = await box(page.locator('.tp-main'));
      const rail = await box(page.locator('.tp-rail'));
      expect(side.width).toBe(300);
      expect(Math.round(side.x)).toBe(Math.round(rail.x + rail.width));
      expect(Math.round(main.x)).toBe(Math.round(side.x + side.width));
      expect(Math.round(main.x + main.width)).toBe(size.width);
      const head = await box(page.locator('.tp-sidebar-head'));
      const close = await box(page.getByRole('button', { name: 'Close sidebar' }));
      expect(close.y).toBeGreaterThanOrEqual(head.y);
      expect(close.y + close.height).toBeLessThanOrEqual(head.y + head.height);
      expect(close.x + close.width).toBeLessThanOrEqual(side.x + side.width);
      expect(side.x + side.width - (close.x + close.width)).toBeLessThan(16);
      expect(await clippedText(page, '.tp-theme-name, .tp-segment-btn, .tp-section-title, .tp-switch-row span')).toEqual([]);

      // Drag the edge 120px to the right, then double-click to reset.
      const grip = await box(page.locator('.tp-sidebar-resize'));
      await page.mouse.move(grip.x + grip.width / 2, grip.y + 200);
      await page.mouse.down();
      await page.mouse.move(grip.x + grip.width / 2 + 120, grip.y + 200, { steps: 5 });
      await page.mouse.up();
      expect((await box(page.locator('.tp-sidebar'))).width).toBe(420);
      await page.locator('.tp-sidebar-resize').dblclick();
      expect((await box(page.locator('.tp-sidebar'))).width).toBe(300);
      await noPageScroll(page);
    });

    test('palette and dialogs are centred and fully on screen', async ({ page }) => {
      await openApp(page);
      await page.keyboard.press('Control+Shift+P');
      const p = await box(page.locator('.tp-palette'));
      expect(Math.abs(p.x + p.width / 2 - size.width / 2)).toBeLessThan(2);
      expect(p.width).toBe(640);
      expect(p.y + p.height).toBeLessThanOrEqual(size.height);
      expect(await clippedText(page, '.tp-palette-title, .tp-palette-cat')).toEqual([]);
      await page.keyboard.press('Escape');
      await page.keyboard.press('Control+G');
      const d = await box(page.locator('.tp-dialog'));
      expect(Math.abs(d.x + d.width / 2 - size.width / 2)).toBeLessThan(2);
      expect(Math.abs(d.y + d.height / 2 - size.height / 2)).toBeLessThan(2);
    });
  });
}

test('compact density shrinks the bars, tabs, rail, status bar and line spacing', async ({ page }) => {
  await openApp(page);
  await openSample(page);
  const measure = async () => ({
    top: (await box(page.locator('.tp-topbar'))).height,
    tab: (await box(page.locator('.tp-tab').first())).height,
    rail: (await box(page.locator('.tp-rail'))).width,
    status: (await box(page.locator('.tp-status'))).height,
    line: (await box(page.locator('.cm-line').nth(10))).height,
  });
  const comfy = await measure();
  await page.getByRole('button', { name: 'Appearance' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  await page.getByRole('button', { name: 'Close sidebar' }).click();
  await page.waitForTimeout(150);
  const compact = await measure();
  for (const key of Object.keys(comfy) as (keyof typeof comfy)[]) expect(compact[key], key).toBeLessThan(comfy[key]);
});

test('measured contrast is at least 4.5:1 in all 36 theme x accent combinations', async ({ page }) => {
  test.setTimeout(120_000);
  await openApp(page);
  const failures: string[] = [];
  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      await page.evaluate((s) => localStorage.setItem('tracepad.settings', JSON.stringify(s)), { theme, accent });
      await page.reload();
      await expect(page.locator('html[data-ready="true"]')).toBeAttached();
      // Two tabs (badge on accent), a dirty tab (accent text), a dialog (primary button).
      await page.getByRole('button', { name: 'New tab' }).click();
      await page.keyboard.type('x');
      await page.keyboard.press('Alt+W');
      const checks: [string, string][] = [
        ['primary button text on accent', '.tp-dialog .tp-btn-primary'],
        ['danger button text', '.tp-dialog .tp-btn-danger'],
        ['dialog body text', '.tp-dialog-text'],
        ['badge text on accent', '.tp-rail-badge'],
        ['accent text in status bar', '.tp-status-state.is-dirty'],
        ['muted status text', '.tp-status-right .tp-status-item >> nth=0'],
        ['inactive tab name', '.tp-tab:not(.is-active) .tp-tab-name'],
        ['active tab name', '.tp-tab.is-active .tp-tab-name'],
        ['shortcut hint', '.tp-cmd-pill .tp-kbd'],
        ['editor text', '.cm-line >> nth=0'],
      ];
      for (const [what, selector] of checks) {
        const ratio = await contrastOf(page.locator(selector).first());
        if (ratio < 4.5) failures.push(`${theme}/${accent}: ${what} = ${ratio.toFixed(2)}`);
      }
      await page.getByRole('dialog').getByRole('button', { name: "Don't save" }).click();
    }
  }
  expect(failures).toEqual([]);
});

test('keyboard focus is visible and controls have accessible names', async ({ page }) => {
  await openApp(page);
  // Every button has a name.
  const unnamed = await page.evaluate(() =>
    [...document.querySelectorAll('button')].filter((b) => !(b.getAttribute('aria-label') || b.textContent || '').trim()).map((b) => b.outerHTML.slice(0, 80)),
  );
  expect(unnamed).toEqual([]);
  // Tabbing from the welcome card shows a focus ring.
  await page.getByRole('region', { name: 'Welcome' }).getByRole('button', { name: /Open a file/ }).focus();
  await page.keyboard.press('Tab');
  const ring = await page.evaluate(() => {
    const s = getComputedStyle(document.activeElement!);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) };
  });
  expect(ring.style).not.toBe('none');
  expect(ring.width).toBeGreaterThanOrEqual(2);
  // Scrollbars are thin.
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.cm-scroller')!).scrollbarWidth)).toBe('thin');
});

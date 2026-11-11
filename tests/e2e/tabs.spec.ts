// Tabs and files (0.2): rename, reorder, tab menu, Open files list, session
// restore, linked files, file handlers. Runs against both builds.
import { expect, test, type Page } from '@playwright/test';
import { box, docText, editor, openApp, openSample, overlaps } from './helpers';
import { clearDisk, openLinked, readDisk, useLinkedPicker, writeDisk } from './linked';

async function names(page: Page): Promise<string[]> {
  return page.getByRole('tab').evaluateAll((els) => els.map((e) => e.querySelector('.tp-tab-name')?.textContent ?? ''));
}

async function makeTabs(page: Page, list: string[]): Promise<void> {
  for (const [i, name] of list.entries()) {
    if (i > 0) await page.keyboard.press('Alt+N');
    await editor(page).focus();
    await page.keyboard.type(`content of ${name}`);
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: /^New name for/ }).fill(name);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name })).toBeVisible();
  }
}

test.beforeEach(async ({ page }) => {
  await useLinkedPicker(page);
  await openApp(page);
  await clearDisk(page);
});

test.describe('rename', () => {
  test('double-click renames an unsaved tab; the extension sets the syntax; Save suggests the name', async ({ page }) => {
    await editor(page).focus();
    await page.keyboard.type('# Notes');
    await page.getByRole('tab', { name: 'untitled-1.txt' }).dblclick();
    const input = page.getByRole('textbox', { name: 'New name for untitled-1.txt' });
    await expect(input).toBeFocused();
    // The name is selected without its extension, as in a file manager.
    expect(await input.evaluate((el) => (el as HTMLInputElement).value.slice((el as HTMLInputElement).selectionStart!, (el as HTMLInputElement).selectionEnd!))).toBe('untitled-1');
    await input.fill('release-notes.md');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'release-notes.md' })).toBeVisible();
    await expect(page.getByTestId('status-lang')).toHaveText('Markdown');
    await expect(editor(page)).toBeFocused();
    const download = page.waitForEvent('download');
    await page.keyboard.press('Control+S');
    expect((await download).suggestedFilename()).toBe('release-notes.md');
  });

  test('Escape cancels, an illegal name is refused, the box stays inside its tab', async ({ page }) => {
    await page.keyboard.press('F2');
    const input = page.getByRole('textbox', { name: /^New name for/ });
    const tab = await box(page.locator('.tp-tab.is-active'));
    const field = await box(input);
    expect(field.x).toBeGreaterThanOrEqual(tab.x);
    expect(field.x + field.width).toBeLessThanOrEqual(tab.x + tab.width);
    expect(field.y).toBeGreaterThanOrEqual(tab.y);
    expect(field.y + field.height).toBeLessThanOrEqual(tab.y + tab.height);
    await input.fill('bad:name?.txt');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await page.keyboard.press('Enter');
    await expect(input).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    expect(await names(page)).toEqual(['untitled-1.txt']);
  });

  test('a linked file is renamed on disk', async ({ page }) => {
    await writeDisk(page, 'app.log', '10:15:02 INFO started\n');
    await openLinked(page, ['app.log']);
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
    await page.getByRole('tab', { name: 'app.log' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Rename/ }).click();
    await page.getByRole('textbox', { name: 'New name for app.log' }).fill('app-2026-03-14.log');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'app-2026-03-14.log' })).toBeVisible();
    await expect(page.locator('.tp-toast')).toContainText('Renamed on disk');
    expect(await readDisk(page, 'app-2026-03-14.log')).toBe('10:15:02 INFO started\n');
    expect(await readDisk(page, 'app.log')).toBeNull();
    // Still linked: an edit saves straight back to the renamed file.
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('more');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
    expect(await readDisk(page, 'app-2026-03-14.log')).toBe('10:15:02 INFO started\nmore');
  });

  test('where the browser cannot rename on disk, it says so and offers to rename the tab only', async ({ page }) => {
    await writeDisk(page, 'a.txt', 'hello\n');
    await openLinked(page, ['a.txt']);
    await page.evaluate(() => delete (FileSystemFileHandle.prototype as unknown as { move?: unknown }).move);
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'New name for a.txt' }).fill('b.txt');
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('This browser cannot rename files on disk');
    await dialog.getByRole('button', { name: 'Rename tab only' }).click();
    await expect(page.getByRole('tab', { name: 'b.txt' })).toBeVisible();
    await expect(page.locator('.tp-status')).toContainText('Not linked to disk');
    expect(await readDisk(page, 'a.txt')).toBe('hello\n');
  });
});

test.describe('reorder and tab menu', () => {
  test('dragging a tab reorders it; a plain click still just selects', async ({ page }) => {
    await makeTabs(page, ['a.txt', 'b.txt', 'c.txt', 'd.txt']);
    const a = await box(page.getByRole('tab', { name: 'a.txt' }));
    const c = await box(page.getByRole('tab', { name: 'c.txt' }));
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(c.x + c.width - 6, c.y + c.height / 2, { steps: 12 });
    await expect(page.locator('.tp-tab.is-dragging')).toHaveCount(1);
    await page.mouse.up();
    expect(await names(page)).toEqual(['b.txt', 'c.txt', 'a.txt', 'd.txt']);
    // The drag did not switch tabs.
    await expect(page.getByRole('tab', { name: 'd.txt' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('tab', { name: 'b.txt' }).click();
    await expect(page.getByRole('tab', { name: 'b.txt' })).toHaveAttribute('aria-selected', 'true');
    expect(await docText(page)).toBe('content of b.txt');
    expect(await names(page)).toEqual(['b.txt', 'c.txt', 'a.txt', 'd.txt']);
  });

  test('right-click menu: every action works and the menu stays on screen', async ({ page }) => {
    await makeTabs(page, ['a.txt', 'b.txt', 'c.txt']);
    await page.getByRole('tab', { name: 'a.txt' }).click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText([/Rename/, 'Copy name', /Compare with/, /Show beside/, 'Back to one editor', 'Move to start', 'Move to end', /Close/, 'Close other tabs']);
    await expect(menu.getByRole('menuitem', { name: 'Move to start' })).toHaveAttribute('aria-disabled', 'true');
    // The menu opens at the pointer, over the tab it belongs to.
    const m = await box(menu);
    const tab = await box(page.getByRole('tab', { name: 'a.txt' }));
    expect(m.x).toBeGreaterThanOrEqual(tab.x);
    expect(m.x).toBeLessThanOrEqual(tab.x + tab.width);
    expect(m.y).toBeLessThanOrEqual(tab.y + tab.height);
    await menu.getByRole('menuitem', { name: 'Move to end' }).click();
    expect(await names(page)).toEqual(['b.txt', 'c.txt', 'a.txt']);

    await page.getByRole('tab', { name: 'c.txt' }).click({ button: 'right' });
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('.tp-toast')).toContainText('Copied "c.txt"');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('c.txt');

    await page.getByRole('tab', { name: 'c.txt' }).click({ button: 'right' });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.getByRole('tab', { name: 'c.txt' }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Close other tabs' }).click();
    // Both other tabs have unsaved text, so each one asks.
    for (let i = 0; i < 2; i++) await page.getByRole('dialog').getByRole('button', { name: "Don't save" }).click();
    expect(await names(page)).toEqual(['c.txt']);
  });

  test('a menu opened at the screen edge is moved fully into view', async ({ page }) => {
    for (let i = 0; i < 14; i++) await page.getByRole('button', { name: 'New tab' }).click();
    await page.getByRole('button', { name: /^Open files list/ }).click();
    const row = page.locator('.tp-file').last();
    await row.getByRole('button', { name: /^More actions/ }).click();
    const m = await box(page.getByRole('menu'));
    const vp = page.viewportSize()!;
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(vp.width);
    expect(m.y + m.height).toBeLessThanOrEqual(vp.height);
  });
});

test.describe('Open files list', () => {
  test.beforeEach(async ({ page }) => {
    await makeTabs(page, ['zeta.log', 'alpha.md', 'beta.json']);
  });

  test('Ctrl+Shift+E opens it with the filter focused; Enter opens the first match', async ({ page }) => {
    await page.keyboard.press('Control+Shift+E');
    const filter = page.getByRole('textbox', { name: 'Filter open files' });
    await expect(filter).toBeFocused();
    await expect(page.locator('.tp-rail-badge')).toHaveAttribute('data-count', '3');
    await expect(page.locator('.tp-files-count')).toContainText('3 files');
    await page.keyboard.type('alp');
    await expect(page.locator('.tp-file')).toHaveCount(1);
    await expect(page.locator('.tp-files-count')).toContainText('1 of 3 files');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'alpha.md' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.tp-file')).toHaveCount(3);
    await filter.fill('nothing-like-this');
    await expect(page.locator('.tp-files-none')).toContainText('No open file matches');
  });

  test('markers show unsaved, log and current', async ({ page }) => {
    await page.getByRole('button', { name: /^Open files list/ }).click();
    const row = (name: string) => page.locator('.tp-file', { hasText: name });
    await expect(row('zeta.log')).toContainText('unsaved');
    await expect(row('zeta.log')).toContainText('log');
    // The current file is marked by a highlight, a bold name and aria-current.
    await expect(row('beta.json')).toHaveClass(/is-active/);
    await expect(row('beta.json').locator('.tp-file-main')).toHaveAttribute('aria-current', 'true');
    expect(await row('beta.json').locator('.tp-file-name').evaluate((el) => getComputedStyle(el).fontWeight)).toBe('600');
    await expect(row('alpha.md')).not.toHaveClass(/is-active/);
    await expect(row('alpha.md')).not.toContainText('log');
  });

  test('sorting by name, type and recently used; the choice is remembered', async ({ page }) => {
    await page.getByRole('button', { name: /^Open files list/ }).click();
    const listed = () => page.locator('.tp-file-name').allTextContents();
    expect(await listed()).toEqual(['zeta.log', 'alpha.md', 'beta.json']);
    const sort = page.getByRole('combobox', { name: 'Sort open files' });
    await sort.selectOption('name');
    expect(await listed()).toEqual(['alpha.md', 'beta.json', 'zeta.log']);
    await sort.selectOption('type');
    expect(await listed()).toEqual(['beta.json', 'zeta.log', 'alpha.md']);
    await page.getByRole('tab', { name: 'zeta.log' }).click();
    await sort.selectOption('recent');
    expect((await listed())[0]).toBe('zeta.log');
    // Sorting the list never changes the tab order.
    expect(await names(page)).toEqual(['zeta.log', 'alpha.md', 'beta.json']);
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await page.getByRole('button', { name: /^Open files list/ }).click();
    await expect(page.getByRole('combobox', { name: 'Sort open files' })).toHaveValue('recent');
  });

  test('keyboard: arrows move, Enter opens, F2 renames, Delete closes', async ({ page }) => {
    await page.keyboard.press('Control+Shift+E');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.tp-file-main').nth(0)).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.tp-file-main').nth(1)).toBeFocused();
    await page.keyboard.press('F2');
    await page.getByRole('textbox', { name: 'New name for alpha.md' }).fill('gamma.md');
    await page.keyboard.press('Enter');
    expect(await names(page)).toEqual(['zeta.log', 'gamma.md', 'beta.json']);

    await page.locator('.tp-file-main').nth(1).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: 'gamma.md' })).toHaveAttribute('aria-selected', 'true');
    await page.locator('.tp-file-main').nth(0).focus();
    await page.keyboard.press('Delete');
    await page.getByRole('dialog').getByRole('button', { name: "Don't save" }).click();
    expect(await names(page)).toEqual(['gamma.md', 'beta.json']);
  });

  test('rows: close, more-actions menu, drag to reorder', async ({ page }) => {
    await page.getByRole('button', { name: /^Open files list/ }).click();
    const first = await box(page.locator('.tp-file').nth(0));
    const third = await box(page.locator('.tp-file').nth(2));
    await page.mouse.move(first.x + 60, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(third.x + 60, third.y + third.height - 3, { steps: 10 });
    await page.mouse.up();
    expect(await names(page)).toEqual(['alpha.md', 'beta.json', 'zeta.log']);

    await page.getByRole('button', { name: 'More actions for alpha.md' }).click();
    await page.getByRole('menuitem', { name: 'Move to end' }).click();
    expect(await names(page)).toEqual(['beta.json', 'zeta.log', 'alpha.md']);

    await page.getByRole('button', { name: 'Close beta.json', exact: true }).last().click();
    await page.getByRole('dialog').getByRole('button', { name: "Don't save" }).click();
    expect(await names(page)).toEqual(['zeta.log', 'alpha.md']);
    await expect(page.locator('.tp-rail-badge')).toHaveAttribute('data-count', '2');
  });

  test('appearance: tools, rows and their buttons stay inside the sidebar and do not overlap', async ({ page }) => {
    await page.getByRole('button', { name: /^Open files list/ }).click();
    const side = await box(page.locator('.tp-sidebar'));
    const inside = async (sel: string) => {
      for (const el of await page.locator(sel).all()) {
        const b = await box(el);
        expect(b.x, sel).toBeGreaterThanOrEqual(side.x);
        expect(b.x + b.width, sel).toBeLessThanOrEqual(side.x + side.width);
      }
    };
    await inside('.tp-files-filter');
    await inside('.tp-files-sort');
    await inside('.tp-file');
    await inside('.tp-file-btn');
    expect(overlaps(await box(page.locator('.tp-files-filter')), await box(page.locator('.tp-files-sort')))).toBe(false);
    for (const row of await page.locator('.tp-file').all()) {
      const r = await box(row);
      const main = await box(row.locator('.tp-file-main'));
      for (const btn of await row.locator('.tp-file-btn').all()) {
        const b = await box(btn);
        expect(overlaps(main, b)).toBe(false);
        expect(b.y).toBeGreaterThanOrEqual(r.y);
        expect(b.y + b.height).toBeLessThanOrEqual(r.y + r.height + 0.5);
      }
      // Tags are never cut off; a long name gives way instead.
      for (const tag of await row.locator('.tp-tag').all()) {
        expect(await tag.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
    }
  });
});

test.describe('session restore', () => {
  test('unsaved tabs come back with their text, names, order and the active tab', async ({ page }) => {
    await makeTabs(page, ['one.txt', 'two.md', 'three.log']);
    await page.getByRole('tab', { name: 'two.md' }).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('\nmore text');
    // Reload at once: the page-hide save must capture this.
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    expect(await names(page)).toEqual(['one.txt', 'two.md', 'three.log']);
    await expect(page.getByRole('tab', { name: 'two.md' })).toHaveAttribute('aria-selected', 'true');
    expect(await docText(page)).toBe('content of two.md\nmore text');
    await expect(page.locator('.tp-tab.is-active')).toHaveClass(/is-dirty/);
    await expect(page.getByTestId('status-lang')).toHaveText('Markdown');
    await page.getByRole('tab', { name: 'three.log' }).click();
    expect(await docText(page)).toBe('content of three.log');
    // No "leave site?" prompt was needed because nothing would have been lost.
  });

  test('a linked file is re-read from disk and stays linked', async ({ page }) => {
    await writeDisk(page, 'service.log', 'line 1\n');
    await openLinked(page, ['service.log']);
    await writeDisk(page, 'service.log', 'line 1\nline 2 written while closed\n');
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await expect(page.getByRole('tab', { name: 'service.log' })).toBeVisible();
    expect(await docText(page)).toBe('line 1\nline 2 written while closed\n');
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
    await editor(page).focus();
    await page.keyboard.type('edited ');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tp-toast')).toContainText('Saved service.log');
    expect(await readDisk(page, 'service.log')).toBe('edited line 1\nline 2 written while closed\n');
  });

  test('unsaved edits to a linked file are kept, and Save still goes to the file', async ({ page }) => {
    await writeDisk(page, 'notes.txt', 'on disk\n');
    await openLinked(page, ['notes.txt']);
    await editor(page).focus();
    await page.keyboard.type('draft ');
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    expect(await docText(page)).toBe('draft on disk\n');
    await expect(page.locator('.tp-status')).toContainText('Unsaved changes');
    expect(await readDisk(page, 'notes.txt')).toBe('on disk\n');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
    expect(await readDisk(page, 'notes.txt')).toBe('draft on disk\n');
  });

  test('when permission has lapsed the tab asks for access again, in one click', async ({ page }) => {
    await writeDisk(page, 'secure.log', 'needs permission\n');
    await openLinked(page, ['secure.log']);
    await page.keyboard.press('Alt+N');
    await page.keyboard.type('other');
    await page.getByRole('tab', { name: 'secure.log' }).click();
    // After a browser restart, handles report "prompt" until the user agrees.
    await page.addInitScript(() => {
      let granted = false;
      FileSystemFileHandle.prototype.queryPermission = async () => (granted ? 'granted' : 'prompt');
      FileSystemFileHandle.prototype.requestPermission = async () => {
        granted = true;
        return 'granted';
      };
    });
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    const card = page.getByRole('region', { name: 'File needs access' });
    await expect(card).toContainText('Reopen secure.log?');
    expect(await docText(page)).toBe('');
    await expect(page.locator('.tp-status')).toContainText('Waiting for access');
    // The card is centred over the editor and covers it, so nothing can be typed into the placeholder.
    const c = await box(card);
    const main = await box(page.locator('.tp-main'));
    expect(Math.abs(c.x + c.width / 2 - (main.x + main.width / 2))).toBeLessThan(3);
    await page.keyboard.type('zzz');
    expect(await docText(page)).toBe('');
    await card.getByRole('button', { name: 'Allow access' }).click();
    await expect(card).toHaveCount(0);
    expect(await docText(page)).toBe('needs permission\n');
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
    // The other tab was restored normally alongside it.
    await page.getByRole('tab', { name: /untitled/ }).click();
    expect(await docText(page)).toBe('other');
  });

  test('a linked file that was deleted is reported, and the rest still restores', async ({ page }) => {
    await writeDisk(page, 'gone.log', 'x\n');
    await writeDisk(page, 'stays.log', 'y\n');
    await openLinked(page, ['gone.log', 'stays.log']);
    await page.evaluate(async () => (await navigator.storage.getDirectory()).removeEntry('gone.log'));
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await expect(page.locator('.tp-toast')).toContainText('gone.log could not be reopened');
    expect(await names(page)).toEqual(['stays.log']);
  });

  test('an untouched start leaves a single welcome tab after reload', async ({ page }) => {
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    expect(await names(page)).toEqual(['untitled-1.txt']);
    await expect(page.getByRole('region', { name: 'Welcome' })).toBeVisible();
  });
});

test.describe('linked files', () => {
  test('Save writes back to the linked file; opening it twice focuses the same tab', async ({ page }) => {
    await writeDisk(page, 'config.json', '{"a":1}\r\n');
    await openLinked(page, ['config.json']);
    await expect(page.getByTestId('status-eol')).toHaveText('CRLF');
    await openLinked(page, ['config.json']);
    await expect(page.getByRole('tab')).toHaveCount(1);
    await editor(page).focus();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('// end');
    await page.keyboard.press('Control+S');
    await expect(page.locator('.tp-toast')).toContainText('Saved config.json');
    expect(await readDisk(page, 'config.json')).toBe('{"a":1}\r\n// end');
    await expect(page.locator('.tp-tab.is-active')).not.toHaveClass(/is-dirty/);
  });

  test('files handed over by the operating system (installed app) open in tabs', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __launch?: (p: unknown) => void };
      Object.defineProperty(window, 'launchQueue', { configurable: true, value: { setConsumer: (fn: (p: unknown) => void) => (w.__launch = fn) } });
    });
    await page.reload();
    await expect(page.locator('html[data-ready="true"]')).toBeAttached();
    await writeDisk(page, 'from-explorer.log', '2026-03-14 10:15:02 INFO opened from the file manager\n');
    await page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      (window as unknown as { __launch: (p: unknown) => void }).__launch({ files: [await root.getFileHandle('from-explorer.log')] });
    });
    await expect(page.getByRole('tab', { name: 'from-explorer.log' })).toBeVisible();
    expect(await docText(page)).toContain('opened from the file manager');
    await expect(page.locator('.tp-status')).toContainText('Saved to disk');
  });
});

test('the sample log is restored too, and nothing opens the sidebar by itself', async ({ page }) => {
  await openSample(page);
  await page.reload();
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  await expect(page.getByRole('tab', { name: 'sample-spring-boot.log' })).toBeVisible();
  await expect(page.locator('.tp-status')).toContainText('423 lines');
  await expect(page.locator('.tp-sidebar')).toHaveCount(0);
});

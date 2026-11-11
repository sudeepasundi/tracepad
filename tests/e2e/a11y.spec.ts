// Accessibility: every main screen is checked with axe (WCAG 2.1 A and AA),
// in a dark and a light theme. Contrast across all 36 theme and accent
// combinations is measured separately in appearance.spec.ts.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { editor, openApp, openSample, openViaChooser, useBasicFilePickers } from './helpers';

const NOTES = '# Notes\n\nSome text with a [link](https://example.com/).\n\n| Service | Calls |\n| --- | ---: |\n| orders | 1200 |\n| billing | 87 |\n\n- [x] done\n- [ ] to do\n';
const file = (name: string, text: string) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(text) });

/** Runs axe on what is on screen and returns one line per problem. */
async function problems(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  return result.violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')} | ${(n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 160)} | ${n.html.replace(/\s+/g, ' ').slice(0, 200)}`));
}

async function check(page: Page, what: string): Promise<void> {
  // Soft: one run reports every screen, not only the first with a problem.
  expect.soft(await problems(page), what).toEqual([]);
}

for (const theme of [
  { name: 'dark', settings: { theme: 'midnight', accent: 'blue' } },
  { name: 'light', settings: { theme: 'paper', accent: 'violet' } },
]) {
  test.describe(`accessibility, ${theme.name}`, () => {
    // Each test audits several screens; the audit itself takes a few seconds per screen.
    test.setTimeout(120_000);

    test.beforeEach(async ({ page }) => {
      await useBasicFilePickers(page);
      await openApp(page, theme.settings);
    });

    test('welcome, command palette, and each sidebar panel', async ({ page }) => {
      await check(page, 'welcome');
      await page.getByRole('button', { name: 'Search commands', exact: true }).click();
      await page.getByRole('combobox', { name: 'Search commands' }).fill('split');
      await check(page, 'palette');
      await page.keyboard.press('Escape');
      await openSample(page);
      for (const name of [/Open files list/, 'Log insights', 'Tables and extract', 'Highlight rules', 'Appearance', 'Help and shortcuts']) {
        await page.locator('.tp-rail').getByRole('button', { name }).click();
        await expect(page.locator('.tp-sidebar')).toBeVisible();
        await check(page, `sidebar ${String(name)}`);
      }
    });

    test('a log with filters, the find box, and the results panel', async ({ page }) => {
      await openSample(page);
      await check(page, 'log');
      await page.getByRole('button', { name: /More filters/ }).click();
      await page.getByLabel('Logger or thread').fill('orders');
      await check(page, 'more filters');
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await editor(page).first().click();
      await page.keyboard.press('Control+H');
      await page.getByRole('textbox', { name: 'Find', exact: true }).fill('order');
      await check(page, 'find and replace');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Auto tables', exact: true }).click();
      await expect(page.locator('.tp-vt-row').first()).toBeVisible();
      await check(page, 'auto tables');
      await page.getByRole('combobox', { name: 'Count by value of a column' }).selectOption({ index: 1 });
      await expect(page.getByRole('tab', { name: /Count by/ })).toBeVisible();
      await check(page, 'count by value result');
    });

    test('the Markdown preview and the table editor', async ({ page }) => {
      await openViaChooser(page, [file('notes.md', NOTES)]);
      await expect(page.getByRole('tab', { name: 'notes.md' })).toBeVisible();
      await page.getByRole('button', { name: 'Toggle preview' }).click();
      await expect(page.locator('.tp-md table')).toBeVisible();
      await check(page, 'preview');
      await page.getByRole('button', { name: 'Edit as table' }).click();
      await check(page, 'table editor');
    });

    test('split view, the layout picker, a tab menu and a dialog', async ({ page }) => {
      await openViaChooser(page, [file('a.txt', 'alpha\n'), file('b.txt', 'beta\n'), file('c.txt', 'gamma\n')]);
      await expect(page.getByRole('tab', { name: 'c.txt' })).toBeVisible();
      await page.getByRole('button', { name: 'Split layouts' }).click();
      await check(page, 'layout picker');
      await page.getByRole('button', { name: 'Three columns, place 1 of 3' }).click();
      await check(page, 'snap assist');
      await page.locator('.tp-assist').first().locator('.tp-assist-card').first().click();
      await page.locator('.tp-assist').first().locator('.tp-assist-card').first().click();
      await check(page, 'three panes');
      await page.getByRole('tab', { name: 'a.txt' }).click({ button: 'right' });
      await check(page, 'tab menu');
      await page.keyboard.press('Escape');
      await page.locator('.tp-pane.is-focused .cm-content').click();
      await page.keyboard.type('changed');
      await page.locator('.tp-tab.is-active .tp-tab-close').click();
      await expect(page.getByRole('dialog')).toBeVisible();
      await check(page, 'save changes dialog');
    });

    test('the compare view and its file list', async ({ page }) => {
      await openViaChooser(page, [file('a.txt', 'one\ntwo\nthree\n'), file('b.txt', 'one\n2\nthree\nfour\n'), file('c.txt', 'x\n')]);
      await expect(page.getByRole('tab', { name: 'c.txt' })).toBeVisible();
      await page.getByRole('tab', { name: 'a.txt' }).click();
      await page.keyboard.press('Alt+C');
      await check(page, 'compare picker');
      await page.locator('.tp-pick-item', { hasText: 'b.txt' }).click();
      await expect(page.locator('.tp-compare')).toBeVisible();
      await check(page, 'compare');
    });
  });
}

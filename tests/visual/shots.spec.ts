// Screenshot run for human review: `npm run shots` writes PNGs to shots/.
// These are looked at before every release; the automated appearance checks
// live in tests/e2e/appearance.spec.ts.
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openApp, openSample } from '../e2e/helpers';

const VIEWPORTS = [
  { name: '1920', width: 1920, height: 1080 },
  { name: '1366', width: 1366, height: 768 },
  { name: 'phone', width: 390, height: 844 },
];
const THEMES = [
  { name: 'dark', settings: { theme: 'midnight', accent: 'blue' } },
  { name: 'light', settings: { theme: 'paper', accent: 'violet' } },
];

mkdirSync('shots', { recursive: true });

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await openApp(page, th.settings);
      await shot('1-welcome');

      await openSample(page);
      await page.waitForTimeout(250);
      await shot('2-log');

      await page.keyboard.press('Control+H');
      await page.getByRole('textbox', { name: 'Find', exact: true }).fill('orderId=\\d+');
      await page.getByRole('button', { name: 'Regular expression' }).click();
      await page.getByRole('textbox', { name: 'Replace with' }).fill('orderId=#');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(250);
      await shot('3-find');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Search commands', exact: true }).click();
      await page.getByRole('combobox', { name: 'Search commands' }).fill('the');
      await shot('4-palette');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Appearance' }).click();
      await page.waitForTimeout(150);
      await shot('5-appearance');

      await page.getByRole('radio', { name: 'Compact' }).click();
      await page.getByRole('button', { name: 'Help and shortcuts' }).click();
      await page.waitForTimeout(150);
      await shot('6-help-compact');

      await page.getByRole('button', { name: /^Open files/ }).first().click();
      await page.getByRole('button', { name: 'New tab' }).click();
      await page.keyboard.type('unsaved');
      await page.keyboard.press('Alt+W');
      await page.waitForTimeout(150);
      await shot('7-dialog');
    });
  }
}

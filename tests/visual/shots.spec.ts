// Screenshot run for human review: `npm run shots` writes PNGs to shots/.
// These are looked at before every release; the automated appearance checks
// live in tests/e2e/appearance.spec.ts.
import { test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { openApp, openSample } from '../e2e/helpers';
import { clearDisk, openLinked, useLinkedPicker, writeDisk } from '../e2e/linked';

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
      await page.locator('.tp-logbar[data-log-status="ready"]').waitFor();
      await page.waitForTimeout(150);
      await shot('2-log');

      await page.keyboard.press('F8');
      await page.locator('.tp-chip', { hasText: 'ERROR' }).click();
      await page.locator('.tp-chip', { hasText: 'WARN' }).click();
      await page.getByRole('button', { name: /More filters/ }).click();
      await page.getByLabel('From').fill('10:15:20');
      await page.waitForTimeout(400);
      await shot('2b-log-filtered');
      await page.getByRole('button', { name: 'Log insights' }).click();
      await page.waitForTimeout(400);
      await shot('2c-log-insights');
      await page.getByRole('button', { name: 'Close sidebar' }).click();
      await page.getByRole('button', { name: 'Clear filters' }).click();
      await page.getByRole('button', { name: /More filters/ }).click();
      await page.keyboard.press('Control+Home');

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

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots tabs and files ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await useLinkedPicker(page);
      await openApp(page, th.settings);
      await clearDisk(page);
      await writeDisk(page, 'order-service.log', '2026-03-14 10:15:02 INFO started\n');
      await writeDisk(page, 'application-prod.yml', 'server:\n  port: 8080\n');
      await openSample(page);
      await openLinked(page, ['order-service.log', 'application-prod.yml']);
      await page.keyboard.press('Alt+N');
      await page.keyboard.type('select * from orders where status = ?');
      await page.keyboard.press('F2');
      await page.getByRole('textbox', { name: /^New name for/ }).fill('slow-query-notes.sql');
      await shot('8-rename');
      await page.keyboard.press('Enter');

      await page.getByRole('button', { name: /^Open files list/ }).click();
      await page.waitForTimeout(150);
      await shot('9-files');
      await page.getByRole('button', { name: 'More actions for application-prod.yml' }).click();
      await shot('10-menu');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Close sidebar' }).click();

      await page.addInitScript(() => {
        FileSystemFileHandle.prototype.queryPermission = async () => 'prompt';
      });
      await page.getByRole('tab', { name: 'order-service.log' }).click();
      await page.reload();
      await page.waitForTimeout(500);
      await shot('11-locked');
    });
  }
}

const BIG_TEXT = readFileSync('src/assets/sample-spring.log', 'utf8').repeat(30);

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots large file ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await page.addInitScript(() => Object.defineProperty(window, 'showOpenFilePicker', { value: undefined }));
      await openApp(page, { ...th.settings, largeFileMB: 0.001 });
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'Open a file', exact: true }).click();
      await (await chooser).setFiles([{ name: 'order-service-2026-03-14.log', mimeType: 'text/plain', buffer: Buffer.from(BIG_TEXT) }]);
      await page.locator('.tp-big[data-status="ready"]').waitFor();
      await page.locator('.tp-big').focus();
      await page.keyboard.press('F8');
      await page.waitForTimeout(500);
      await shot('12-big');
      await page.keyboard.press('Control+F');
      await page.getByRole('textbox', { name: 'Find', exact: true }).fill('timed out');
      await page.locator('.tp-find-count', { hasText: 'lines' }).waitFor();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
      await shot('13-big-find');
    });
  }
}

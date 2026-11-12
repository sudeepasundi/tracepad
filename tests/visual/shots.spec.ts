// Screenshot run for human review: `npm run shots` writes PNGs to shots/.
// These are looked at before every release; the automated appearance checks
// live in tests/e2e/appearance.spec.ts.
import { test } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { openApp, openSample, openViaChooser, useBasicFilePickers } from '../e2e/helpers';
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

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots tables ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await openApp(page, th.settings);
      await openSample(page);
      await page.keyboard.press('Alt+T');
      await page.locator('.tp-vt-row').first().waitFor();
      await page.locator('.tp-pat', { hasText: 'Created order' }).click();
      await page.waitForTimeout(400);
      await shot('14-auto-tables');
      await page.getByRole('button', { name: 'Results full screen' }).click();
      await page.locator('.tp-pat', { hasText: 'status=<*> took' }).first().click();
      await page.waitForTimeout(400);
      await shot('15-tables-fullscreen');
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Tables and extract' }).click();
      await page.locator('.tp-sidebar').getByRole('button', { name: /Response times/ }).click();
      await page.locator('.tp-vt-row').first().waitFor();
      await page.waitForTimeout(300);
      await shot('16-extract');
    });
  }
}

const NOTES = `# Checkout latency incident

Orders slowed down after the **14:05 deploy**. The cause was a missing index on \`order_items\`; see the [runbook](https://example.com/runbook).

## Slowest endpoints

| Endpoint | Calls | p95 (ms) | Errors | Owner team |
| --- | ---: | ---: | ---: | --- |
| /api/orders | 12400 | 2340 | 118 | Core platform |
| /api/orders/{id}/items | 8800 | 1980 | 64 | Core platform |
| /api/billing/run | 87 | 1210 | 3 | Payments |
| /api/search | 45000 | 95 | 0 | Discovery |

## What we did

1. Rolled back the deploy at 14:31.
2. Added the index and deployed again.

- [x] restart the workers
- [x] confirm p95 is back under 300 ms
- [ ] write the customer note

> Lesson: run the slow-query report before every schema change.

\`\`\`sql
CREATE INDEX idx_order_items_order ON order_items (order_id);
\`\`\`

## Environment

| Key | Value |
| --- | --- |
| region | eu-west-1 |
| pods | 12 |

${Array.from({ length: 12 }, (_, i) => `### Follow-up ${i + 1}\n\nA short paragraph about follow-up ${i + 1}, long enough to show how ordinary text wraps in the preview column.\n`).join('\n')}`;

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots markdown ${vp.name} ${th.name}`, async ({ page, context }) => {
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await useBasicFilePickers(page);
      await openApp(page, th.settings);
      await page.locator('.cm-content').focus();
      await page.evaluate(async () => {
        const html = '<table><tr><th>Endpoint</th><th>Calls</th><th>p95 (ms)</th></tr><tr><td>/api/orders</td><td>12400</td><td>2340</td></tr><tr><td>/api/search</td><td>45000</td><td>95</td></tr></table>';
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob(['x'], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
      });
      await page.keyboard.press('Control+V');
      await page.locator('.tp-toast').waitFor();
      await shot('17-pasted-table');
      await openViaChooser(page, [{ name: 'incident-notes.md', mimeType: 'text/plain', buffer: Buffer.from(NOTES) }]);
      await page.getByRole('tab', { name: /incident-notes/ }).waitFor();
      await page.getByRole('button', { name: 'Toggle preview' }).click();
      await page.locator('.tp-md table').first().waitFor();
      await page.locator('.tp-md th', { hasText: 'p95' }).click();
      await page.waitForTimeout(700);
      await shot('18-preview');
      await page.getByRole('button', { name: 'Preview full screen' }).click();
      await page.waitForTimeout(400);
      await shot('19-preview-fullscreen');
      await page.locator('.tp-md-tablebox').first().getByRole('button', { name: 'Edit as table' }).click();
      await page.waitForTimeout(300);
      await shot('20-table-editor');
    });
  }
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const at = (sec: number) => `2026-03-14 10:${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}.000`;
const ORDERS_LOG = Array.from({ length: 900 }, (_, i) => `${at(i)} ${i % 40 === 7 ? 'ERROR' : i % 9 === 2 ? 'WARN ' : 'INFO '} [orders,${(0x9f3a1c00 + i).toString(16)}] com.acme.orders.OrderService - order ${90000 + i} step ${i}`).join('\n') + '\n';
const BILLING_LOG = Array.from({ length: 300 }, (_, i) => `${at(1 + i * 3)} ${i % 25 === 3 ? 'ERROR' : 'INFO '} [billing,${(0x77aa0000 + i).toString(16)}] com.acme.billing.InvoiceJob - invoice ${4000 + i} took ${20 + ((i * 37) % 400)}ms`).join('\n') + '\n';

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots split ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await useBasicFilePickers(page);
      await openApp(page, th.settings);
      const files = [
        { name: 'orders.log', text: ORDERS_LOG },
        { name: 'billing.log', text: BILLING_LOG },
        { name: 'incident-notes.md', text: NOTES },
        { name: 'application.yml', text: 'server:\n  port: 8080\nspring:\n  datasource:\n    url: jdbc:postgresql://db:5432/orders\n' },
      ];
      await openViaChooser(page, files.map((x) => ({ name: x.name, mimeType: 'text/plain', buffer: Buffer.from(x.text) })));
      await page.getByRole('tab', { name: 'application.yml' }).waitFor();
      await page.getByRole('tab', { name: 'billing.log' }).click();
      await page.getByRole('tab', { name: 'orders.log' }).click();
      await page.locator('.tp-logbar[data-log-status="ready"]').waitFor();
      await page.getByRole('button', { name: 'Split layouts' }).click();
      await page.waitForTimeout(200);
      await shot('21-split-picker');
      await page.getByRole('button', { name: 'Side by side, place 1 of 2' }).click();
      await page.waitForTimeout(300);
      await shot('22-snap-assist');
      await page.locator('.tp-assist-card', { hasText: 'billing.log' }).click();
      await page.locator('.tp-pane[data-pane="1"] .cm-line').first().waitFor();
      await page.waitForTimeout(600);
      await page.evaluate(() => (window as unknown as { __tracepad: { scrollTab(n: string, l: number): void } }).__tracepad.scrollTab('orders.log', 400));
      await page.waitForTimeout(500);
      await shot('23-split-two-logs');
      if (vp.width > 720) {
        // Dragging a tab: the snap bar and the outline.
        const tabBox = (await page.getByRole('tab', { name: 'incident-notes.md' }).boundingBox())!;
        const area = (await page.locator('.tp-editor-area').boundingBox())!;
        await page.mouse.move(tabBox.x + 40, tabBox.y + 10);
        await page.mouse.down();
        await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2, { steps: 6 });
        await page.locator('.tp-snapbar').waitFor();
        const zone = (await page.locator('.tp-snapbar [data-snap-layout="grid4"][data-snap-zone="3"]').boundingBox()) ?? { x: area.x + 600, y: area.y + 60, width: 10, height: 10 };
        await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 6 });
        await page.waitForTimeout(200);
        await shot('24-snap-drag');
        await page.mouse.up();
        await page.locator('.tp-assist-card', { hasText: 'application.yml' }).first().click();
      } else {
        await page.getByRole('button', { name: 'Split layouts' }).click();
        await page.getByRole('button', { name: 'Three columns, place 3 of 3' }).click();
      }
      await page.waitForTimeout(500);
      await shot('25-split-many');
    });
  }
}

const PROPS = Array.from({ length: 140 }, (_, i) => `server.setting.${i} = value ${i}`);
const PROPS_NEW = PROPS.map((l, i) => (i === 10 ? 'server.setting.10 = 250' : i === 11 ? 'server.setting.11 = value eleven, now longer' : i === 60 ? `${l}\nserver.pool.size = 32\nserver.pool.timeout = 30s` : l)).filter((_, i) => i !== 100 && i !== 101);
for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots compare ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await useBasicFilePickers(page);
      await openApp(page, th.settings);
      await openViaChooser(page, [
        { name: 'application-old.properties', mimeType: 'text/plain', buffer: Buffer.from(PROPS.join('\n') + '\n') },
        { name: 'application-new.properties', mimeType: 'text/plain', buffer: Buffer.from(PROPS_NEW.join('\n') + '\n') },
        { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes\n') },
      ]);
      await page.getByRole('tab', { name: 'notes.txt' }).waitFor();
      await page.getByRole('tab', { name: 'application-old.properties' }).click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Compare with/ }).click();
      await page.waitForTimeout(250);
      await shot('26-compare-picker');
      await page.locator('.tp-pick-item', { hasText: 'application-new' }).click();
      await page.locator('.tp-compare').waitFor();
      await page.keyboard.press('F7');
      await page.waitForTimeout(400);
      await shot('27-compare');
      await page.getByRole('button', { name: 'Compare full screen' }).click();
      await page.getByRole('button', { name: 'Next change' }).click();
      await page.waitForTimeout(400);
      await shot('28-compare-fullscreen');
      await page.keyboard.press('Escape');
      await page.keyboard.press('Escape');
    });
  }
}

for (const vp of VIEWPORTS) {
  for (const th of THEMES) {
    test(`shots highlights ${vp.name} ${th.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      const shot = (name: string) => page.screenshot({ path: `shots/${name}-${vp.name}-${th.name}.png` });
      await openApp(page, th.settings);
      await openSample(page);
      await page.locator('.cm-content').click();
      await page.keyboard.press('F8');
      await page.waitForTimeout(300);
      // A selection across the error entry, ending on the line with the cursor.
      const own = page.locator('.cm-line.tp-frame-own').last();
      const err = await page.locator('.cm-line.tp-lv-5').first().boundingBox();
      const end = await own.boundingBox();
      if (err && end) {
        await page.mouse.move(err.x + 30, err.y + err.height / 2);
        await page.mouse.down();
        await page.mouse.move(end.x + Math.min(320, end.width - 10), end.y + end.height / 2, { steps: 6 });
        await page.mouse.up();
      }
      await page.waitForTimeout(250);
      await shot('32-selection');
      await page.getByRole('button', { name: 'Highlight rules' }).click();
      await page.waitForTimeout(250);
      await shot('33-highlight-rules');
      await page.getByRole('button', { name: 'Close sidebar' }).click();
      await page.getByRole('textbox', { name: 'Filter entries by text' }).fill('pool');
      await page.waitForTimeout(500);
      await shot('34-filter-marks');
    });
  }
}

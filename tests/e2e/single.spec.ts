// Single-file build only: it must be exactly one self-contained HTML document.
import { expect, test } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { openApp, openSample } from './helpers';

test('the build output is one HTML file with nothing external', () => {
  expect(readdirSync('dist-single')).toEqual(['tracepad.html']);
  const html = readFileSync('dist-single/tracepad.html', 'utf8');
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).not.toMatch(/<link[^>]+rel="(stylesheet|manifest|modulepreload)"/);
  // No CDN: the only absolute URLs are text inside the app (docs links, sample log).
  expect(html).not.toMatch(/(src|href)="https?:\/\//);
  expect(html.length).toBeLessThan(4 * 1024 * 1024);
});

test('loading it makes exactly one request', async ({ page }) => {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (!r.url().startsWith('data:') && !r.url().startsWith('blob:')) urls.push(r.url());
  });
  await openApp(page);
  await openSample(page);
  await page.getByRole('button', { name: 'Help and shortcuts' }).click();
  await expect(page.getByTestId('engine-kind')).toHaveText('Rust (WebAssembly)');
  expect(urls.filter((u) => !u.endsWith('favicon.ico'))).toHaveLength(1);
});

test('no service worker is registered by the single file', async ({ page }) => {
  await openApp(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r.length))).toBe(0);
});

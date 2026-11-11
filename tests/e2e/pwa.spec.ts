// PWA build only: sub-path hosting, installability, offline, strict CSP.
import { expect, test } from '@playwright/test';
import { openApp, openSample } from './helpers';

test('every asset is requested from inside the sub-path', async ({ page, baseURL }) => {
  const urls: string[] = [];
  page.on('request', (r) => urls.push(r.url()));
  await openApp(page);
  const outside = urls.filter((u) => !u.startsWith(baseURL!) && !u.startsWith('data:') && !u.startsWith('blob:'));
  expect(outside).toEqual([]);
  expect(urls.some((u) => u.endsWith('.wasm'))).toBe(true);
});

test('manifest, icons and favicon are served and consistent', async ({ page, request, baseURL }) => {
  await openApp(page);
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const manifestUrl = new URL(href!, baseURL).toString();
  const manifest = await (await request.get(manifestUrl)).json();
  expect(manifest.name).toBe('Tracepad');
  expect(manifest.start_url).toBe('./');
  expect(manifest.display).toBe('standalone');
  const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  // Installed app: registered to open log, text, Markdown, JSON and CSV files.
  const exts = manifest.file_handlers.flatMap((h: { accept: Record<string, string[]> }) => Object.values(h.accept).flat());
  expect(exts).toEqual(expect.arrayContaining(['.log', '.txt', '.md', '.json', '.csv']));
  expect(manifest.file_handlers[0].action).toBe('./');
  for (const icon of manifest.icons) {
    const res = await request.get(new URL(icon.src, manifestUrl).toString());
    expect(res.status(), icon.src).toBe(200);
    expect(res.headers()['content-type']).toBe('image/png');
  }
  for (const sel of ['link[rel="icon"]', 'link[rel="apple-touch-icon"]']) {
    const h = await page.locator(sel).first().getAttribute('href');
    expect((await request.get(new URL(h!, baseURL).toString())).status(), sel).toBe(200);
  }
});

test('a strict Content-Security-Policy is in place', async ({ page }) => {
  await openApp(page);
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("default-src 'self'");
  expect(csp).toContain("connect-src 'self'");
  expect(csp).not.toMatch(/https?:\/\//);
  // The page cannot reach another origin even if code tried.
  const blocked = await page.evaluate(() =>
    fetch('https://example.com/ping', { mode: 'no-cors' }).then(
      () => false,
      () => true,
    ),
  );
  expect(blocked).toBe(true);
});

test('works offline after the first visit', async ({ page, context }) => {
  await openApp(page);
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  // Wait until the worker controls the page and has finished precaching.
  await expect.poll(() => page.evaluate(() => caches.keys().then((k) => k.filter((x) => x.startsWith('tracepad-')).length))).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const [name] = (await caches.keys()).filter((x) => x.startsWith('tracepad-'));
        return (await (await caches.open(name)).keys()).length;
      }),
    )
    .toBeGreaterThanOrEqual(10);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  await openSample(page);
  await page.getByRole('button', { name: 'Help and shortcuts' }).click();
  await expect(page.getByTestId('engine-kind')).toHaveText('Rust (WebAssembly)');
  await context.setOffline(false);
});

test('the cache name carries the version so releases never mix', async ({ request, baseURL }) => {
  const sw = await (await request.get(new URL('sw.js', baseURL).toString())).text();
  expect(sw).toMatch(/const CACHE = 'tracepad-\d+\.\d+\.\d+-[0-9a-f]{8}'/);
  expect(sw).toContain('skip-waiting');
  expect(sw).not.toContain('__FILES__');
});

test('the Markdown renderer and the compare view load on first use, and are still there offline', async ({ page, context }) => {
  const scripts: string[] = [];
  page.on('request', (r) => r.resourceType() === 'script' && scripts.push(r.url().split('/').pop()!));
  await page.goto('');
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
  // Not part of the first load.
  expect(scripts.some((s) => /^(markdown|Compare)-/.test(s))).toBe(false);
  expect(scripts.filter((s) => s.endsWith('.js'))).toHaveLength(1);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).length)).toBeGreaterThan(0);
  // Offline: both pieces come from the cache the first time they are needed.
  await context.setOffline(true);
  await page.locator('.cm-content').focus();
  await page.keyboard.type('# Title');
  await page.keyboard.press('Alt+P');
  await expect(page.locator('.tp-md h1')).toHaveText('Title');
  await page.keyboard.press('Alt+P');
  await page.getByRole('button', { name: 'New tab' }).click();
  await page.locator('.cm-content').focus();
  await page.keyboard.type('other');
  await page.keyboard.press('Alt+C');
  await expect(page.locator('.tp-compare .cm-mergeViewEditor')).toHaveCount(2);
  await context.setOffline(false);
});

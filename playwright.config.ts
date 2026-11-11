import { defineConfig, devices } from '@playwright/test';

// The PWA build is served under a sub-path, like GitHub Pages does.
const PWA = 'http://127.0.0.1:4173/tracepad/';
const SINGLE = 'http://127.0.0.1:4174/tracepad.html';
export const FRAME_HOST = 'http://127.0.0.1:4175/';

const CI = !!process.env.CI;
const desktop = { viewport: { width: 1920, height: 1080 } };

export default defineConfig({
  testDir: 'tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: [['list']],
  use: { trace: 'retain-on-failure' },
  webServer: [
    { command: 'node scripts/serve.mjs --dir dist --port 4173 --prefix /tracepad/', url: PWA, reuseExistingServer: !CI },
    { command: 'node scripts/serve.mjs --dir dist-single --port 4174', url: SINGLE, reuseExistingServer: !CI },
    { command: `node scripts/serve.mjs --port 4175 --frame ${SINGLE}`, url: FRAME_HOST, reuseExistingServer: !CI },
  ],
  projects: [
    { name: 'pwa', testMatch: /e2e[\\/](app|files|tabs|logs|big|biglog|tables|markdown|split|compare|appearance|pwa)\.spec\.ts/, use: { ...desktop, baseURL: PWA, permissions: ['clipboard-read', 'clipboard-write'] } },
    { name: 'single', testMatch: /e2e[\\/](app|files|tabs|logs|big|tables|markdown|split|compare|appearance|single|iframe)\.spec\.ts/, use: { ...desktop, baseURL: SINGLE, permissions: ['clipboard-read', 'clipboard-write'] } },
    { name: 'phone', testMatch: /e2e[\\/]phone\.spec\.ts/, use: { baseURL: PWA, viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 } },
    { name: 'firefox', testMatch: /e2e[\\/]smoke\.spec\.ts/, use: { ...devices['Desktop Firefox'], baseURL: PWA } },
    { name: 'webkit', testMatch: /e2e[\\/]smoke\.spec\.ts/, use: { ...devices['Desktop Safari'], baseURL: PWA } },
    { name: 'shots', testMatch: /visual[\\/]shots\.spec\.ts/, use: { baseURL: PWA } },
  ],
});

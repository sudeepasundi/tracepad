// Renders the PNG icons from scripts/icon.svg (large) and public/favicon.svg
// (simplified 16px design) using the Chromium that Playwright already installs.
//   npm run icons
import { chromium } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';

const big = readFileSync('scripts/icon.svg', 'utf8');
const small = readFileSync('public/favicon.svg', 'utf8');
// Maskable icons need the artwork inside the central 80% safe zone.
const maskable = big.replace('rx="112"', 'rx="0"').replace('<rect x="112" y="136"', '<g transform="translate(64 64) scale(.75)"><rect x="112" y="136"').replace('</svg>', '</g></svg>');

const jobs = [
  { svg: big, size: 192, out: 'public/icons/icon-192.png' },
  { svg: big, size: 512, out: 'public/icons/icon-512.png' },
  { svg: maskable, size: 512, out: 'public/icons/icon-maskable-512.png' },
  { svg: big.replace('rx="112"', 'rx="0"'), size: 180, out: 'public/icons/apple-touch-icon.png' },
  { svg: small, size: 32, out: 'public/favicon-32.png' },
];

mkdirSync('public/icons', { recursive: true });
const browser = await chromium.launch();
for (const job of jobs) {
  const page = await browser.newPage({ viewport: { width: job.size, height: job.size }, deviceScaleFactor: 1 });
  await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block;width:${job.size}px;height:${job.size}px}</style>${job.svg}`);
  await page.screenshot({ path: job.out, omitBackground: true });
  await page.close();
  console.log(job.out);
}
await browser.close();

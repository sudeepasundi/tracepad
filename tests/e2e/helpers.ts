import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

export type Root = Page | FrameLocator;

/** Loads the app, optionally with settings already stored (theme, density…). */
export async function openApp(page: Page, settings: Record<string, unknown> = {}): Promise<void> {
  await page.addInitScript((s) => {
    try {
      if (!localStorage.getItem('tracepad.settings')) localStorage.setItem('tracepad.settings', JSON.stringify(s));
    } catch {
      /* storage blocked: the app falls back to memory */
    }
  }, settings);
  await page.goto('');
  await expect(page.locator('html[data-ready="true"]')).toBeAttached();
}

export const editor = (root: Root): Locator => root.locator('.cm-content');

export async function openSample(root: Root): Promise<void> {
  await root.getByRole('button', { name: /Try the sample log/ }).click();
  await expect(root.getByRole('tab', { name: /sample-spring-boot\.log/ })).toBeVisible();
  await expect(root.locator('.cm-line').first()).toBeVisible();
}

interface Hook {
  docText(): string;
  selections(): number;
}
type Evaluator = Pick<Page, 'evaluate'>;

/** Text of the whole document, read from the editor state (the DOM is virtualised). */
export function docText(target: Evaluator): Promise<string> {
  return target.evaluate(() => (window as unknown as { __tracepad: Hook }).__tracepad.docText());
}

export function selectionCount(target: Evaluator): Promise<number> {
  return target.evaluate(() => (window as unknown as { __tracepad: Hook }).__tracepad.selections());
}

/** Forces the <input type=file> / download fallbacks, which Playwright can drive. */
export async function useBasicFilePickers(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showOpenFilePicker', { value: undefined });
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
}

export async function openViaChooser(page: Page, files: { name: string; mimeType: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Open a file', exact: true }).click();
  await (await chooser).setFiles(files);
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function box(loc: Locator): Promise<Box> {
  const b = await loc.boundingBox();
  if (!b) throw new Error(`no box for ${loc}`);
  return b;
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width - 0.5 && b.x < a.x + a.width - 0.5 && a.y < b.y + b.height - 0.5 && b.y < a.y + a.height - 0.5;
}

/** Elements whose text is cut off (ellipsis candidates are allowed via `allow`). */
export async function clippedText(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (!el.offsetParent) continue;
      if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className}: "${el.textContent?.slice(0, 40)}"`);
    }
    return out;
  }, selector);
}

/** WCAG contrast of an element's text against the nearest opaque background behind it. */
export async function contrastOf(loc: Locator): Promise<number> {
  return loc.evaluate((el) => {
    const parse = (c: string) => {
      const m = c.match(/[\d.]+/g)!.map(Number);
      return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 };
    };
    const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const f = (v: number) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const fg = parse(getComputedStyle(el).color);
    let node: Element | null = el;
    let bg = { r: 255, g: 255, b: 255, a: 1 };
    while (node) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c.a >= 0.99) {
        bg = c;
        break;
      }
      node = node.parentElement;
    }
    const a = lum(fg);
    const b = lum(bg);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

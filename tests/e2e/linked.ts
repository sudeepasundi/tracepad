// Real, linked file handles for tests. Playwright cannot drive the native file
// picker, so showOpenFilePicker is replaced with one that returns handles from
// the origin private file system: genuine FileSystemFileHandle objects that can
// be written, renamed (move) and stored in IndexedDB, exactly like disk files.
import type { Page } from '@playwright/test';

export async function useLinkedPicker(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __pick: string[]; showOpenFilePicker: unknown; showSaveFilePicker: unknown };
    w.__pick = [];
    w.showOpenFilePicker = async () => {
      const root = await navigator.storage.getDirectory();
      return Promise.all(w.__pick.map((name) => root.getFileHandle(name)));
    };
    Object.defineProperty(window, 'showSaveFilePicker', { value: undefined });
  });
}

export async function writeDisk(page: Page, name: string, text: string): Promise<void> {
  await page.evaluate(
    async ([n, t]) => {
      const root = await navigator.storage.getDirectory();
      const h = await root.getFileHandle(n, { create: true });
      const w = await h.createWritable();
      await w.write(t);
      await w.close();
    },
    [name, text],
  );
}

export async function readDisk(page: Page, name: string): Promise<string | null> {
  return page.evaluate(async (n) => {
    try {
      const root = await navigator.storage.getDirectory();
      return await (await (await root.getFileHandle(n)).getFile()).text();
    } catch {
      return null;
    }
  }, name);
}

export async function clearDisk(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const name of (root as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    for (const n of names) await root.removeEntry(n).catch(() => undefined);
  });
}

/** Opens linked files through the (replaced) picker. */
export async function openLinked(page: Page, names: string[]): Promise<void> {
  await page.evaluate((n) => ((window as unknown as { __pick: string[] }).__pick = n), names);
  await page.getByRole('button', { name: 'Open a file', exact: true }).click();
  await page.getByRole('tab', { name: names[names.length - 1] }).waitFor();
}

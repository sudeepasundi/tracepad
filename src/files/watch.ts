// Linked files that change on disk. The file handle is polled (there is no
// reliable change event), and only when the page is visible.
//   - bytes appended  -> added in place; the view follows if it was at the end
//   - file rewritten  -> reloaded (undo brings the old text back)
//   - unsaved edits   -> ask: reload from disk, or keep my version
//   - file gone       -> one notice; the tab keeps what was last read
import { bigDiskChanged, getBig, startBig } from '../app/big';
import { ask, toast } from '../app/feedback';
import { patchTab, tabs, type Tab } from '../app/state';
import { appendFromDisk, replaceFromDisk } from '../editor/editor';
import { decodeBytes } from './encoding';
import { largeLimitBytes, openBigFile } from './bigopen';
import { openFile, readForTab } from './fileio';
import { closeTab } from '../app/tabs';

interface Baseline {
  size: number;
  mtime: number;
  /** The last bytes of the file as we know it: proof that new bytes were appended, not a rewrite. */
  tail: Uint8Array;
}

const TAIL = 64;
const known = new Map<number, Baseline>();
const declined = new Map<number, number>();
const checking = new Set<number>();
let asking = false;

async function snapshot(file: File): Promise<Baseline> {
  const from = Math.max(0, file.size - TAIL);
  return { size: file.size, mtime: file.lastModified, tail: new Uint8Array(await file.slice(from, file.size).arrayBuffer()) };
}

/** Forget what we know about a tab's file (after Save, Save As or a rename). */
export function rebase(id: number): void {
  known.delete(id);
  declined.delete(id);
}

async function appended(file: File, base: Baseline): Promise<boolean> {
  if (file.size <= base.size) return false;
  if (base.size === 0) return true;
  const from = base.size - base.tail.length;
  const now = new Uint8Array(await file.slice(from, base.size).arrayBuffer());
  return now.length === base.tail.length && now.every((b, i) => b === base.tail[i]);
}

async function checkTab(tab: Tab): Promise<void> {
  if (!tab.handle || tab.locked || checking.has(tab.id)) return;
  checking.add(tab.id);
  try {
    let file: File;
    try {
      if (tab.handle.queryPermission && (await tab.handle.queryPermission({ mode: 'read' })) !== 'granted') return;
      file = await tab.handle.getFile();
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      if (name === 'NotFoundError' && !tab.missing) {
        patchTab(tab.id, { missing: true });
        toast(`${tab.name} is no longer on disk. This tab keeps what was last read.`, { kind: 'info', ms: 7000 });
      }
      return;
    }
    if (tab.missing) patchTab(tab.id, { missing: false });
    const base = known.get(tab.id);
    if (!base) {
      known.set(tab.id, await snapshot(file));
      return;
    }
    if (file.size === base.size && file.lastModified === base.mtime) return;

    if (tab.big) {
      const b = getBig(tab.id);
      if (!b || b.status !== 'ready') return;
      const ok = await bigDiskChanged(tab.id, file, !!tab.follow);
      if (!ok) {
        // Rewritten: index it again from the start (or reopen it in the editor if it is small now).
        if (file.size > largeLimitBytes()) void startBig(tab.id, tab.uid, file, b.tailOnly ? 0 : b.start, b.encoding, false);
        else {
          await closeTab(tab.id);
          await openFile(file, tab.handle);
          return;
        }
      }
      known.set(tab.id, await snapshot(file));
      return;
    }

    if (tab.dirty) {
      if (declined.get(tab.id) === file.lastModified || asking) return;
      asking = true;
      const r = await ask({
        title: `${tab.name} changed on disk`,
        message: 'You have unsaved changes in this tab. Reloading replaces them with the version on disk (undo brings yours back).',
        buttons: [
          { id: 'keep', label: 'Keep my version' },
          { id: 'reload', label: 'Reload from disk', primary: true },
        ],
      }).finally(() => (asking = false));
      if (!r || r.button !== 'reload') {
        declined.set(tab.id, file.lastModified);
        return;
      }
    }

    if (file.size > largeLimitBytes()) {
      // It outgrew the editor: move it to the large-file viewer.
      await closeTab(tab.id);
      await openBigFile(file, tab.handle);
      return;
    }
    if (!tab.dirty && (await appended(file, base))) {
      const bytes = new Uint8Array(await file.slice(base.size, file.size).arrayBuffer());
      const text = decodeBytes(bytes, tab.encoding === 'UTF-8 BOM' ? 'UTF-8' : tab.encoding).replace(/\r\n/g, '\n');
      appendFromDisk(tab.id, text, !!tab.follow);
    } else {
      const loaded = await readForTab(file, true);
      if (!loaded) return;
      replaceFromDisk(tab.id, loaded.text);
      patchTab(tab.id, { encoding: loaded.encoding, eol: loaded.eol });
      if (!tab.follow) toast(`${tab.name} was reloaded from disk`, { ms: 2200 });
    }
    known.set(tab.id, await snapshot(file));
  } finally {
    checking.delete(tab.id);
  }
}

/** Checks every linked tab now. */
export async function checkDisk(): Promise<void> {
  await Promise.all(tabs.value.map((t) => checkTab(t).catch((e) => console.error(e))));
}

export function initWatcher(): void {
  let tick = 0;
  setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    tick++;
    // Followed files every second, the rest every other second.
    for (const t of tabs.value) if (t.handle && (t.follow || tick % 2 === 0)) void checkTab(t).catch(() => undefined);
    for (const id of [...known.keys()]) if (!tabs.value.some((t) => t.id === id)) rebase(id);
  }, 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkDisk();
  });
}

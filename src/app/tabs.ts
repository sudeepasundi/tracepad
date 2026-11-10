import { createDoc, docLength, focusEditor, removeDoc, replaceDoc, setNavigator, setTabLanguage, showTab } from '../editor/editor';
import { languageName } from '../editor/languages';
import type { Encoding } from '../files/encoding';
import { largeLimitBytes, openBigFile } from '../files/bigopen';
import { readForTab, saveTab } from '../files/fileio';
import { ask, toast } from './feedback';
import { activeId, menu, newTabId, nextUntitledName, patchTab, renaming, tabs, type MenuItem, type Tab } from './state';

export interface NewTab {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
  encoding?: Encoding;
  eol?: 'LF' | 'CRLF';
  untitled?: boolean;
  /** false while restoring a session, so only the final tab is shown. */
  activate?: boolean;
  /** Restored with edits that were never saved. */
  restoredDirty?: boolean;
  /** Restored linked file that still needs permission; shown read-only and empty. */
  locked?: boolean;
  lastUsed?: number;
  uid?: string;
  /** Large file: the editor holds an empty placeholder; the viewer shows the file. */
  big?: boolean;
  tailOnly?: boolean;
}

export function addTab(spec: NewTab): number {
  const id = newTabId();
  const lang = languageName(spec.name);
  createDoc(id, spec.text, lang, { dirty: spec.restoredDirty, readOnly: spec.locked || spec.big });
  const tab: Tab = {
    id,
    uid: spec.uid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    name: spec.name,
    handle: spec.handle,
    untitled: spec.untitled ?? false,
    encoding: spec.encoding ?? 'UTF-8',
    eol: spec.eol ?? (navigator.platform.startsWith('Win') ? 'CRLF' : 'LF'),
    lang,
    dirty: spec.restoredDirty ?? false,
    locked: spec.locked,
    big: spec.big,
    tailOnly: spec.tailOnly,
    lastUsed: spec.lastUsed ?? Date.now(),
  };
  // A pristine, empty "untitled" tab is replaced rather than left behind.
  const current = tabs.value.find((t) => t.id === activeId.value);
  const replace = !spec.untitled && current && current.untitled && !current.dirty && docLength(current.id) === 0 ? current.id : null;
  tabs.value = [...tabs.value.filter((t) => t.id !== replace), tab];
  if (spec.activate !== false) activateTab(id);
  if (replace != null) removeDoc(replace);
  return id;
}

export function newTab(): number {
  return addTab({ name: nextUntitledName(), text: '', untitled: true });
}

export function activateTab(id: number): void {
  if (!tabs.value.some((t) => t.id === id)) return;
  activeId.value = id;
  patchTab(id, { lastUsed: Date.now() });
  showTab(id);
  // Leaving a large-file tab: keyboard focus goes back to the editor, not to the viewer that is about to go.
  if (!tabs.value.find((t) => t.id === id)?.big) setNavigator(null);
  focusEditor();
}

export async function closeTab(id: number): Promise<boolean> {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return true;
  if (tab.dirty) {
    activateTab(id);
    const r = await ask({
      title: `Save changes to ${tab.name}?`,
      message: 'Your changes will be lost if you close this tab without saving.',
      buttons: [
        { id: 'cancel', label: 'Cancel' },
        { id: 'discard', label: "Don't save", danger: true },
        { id: 'save', label: 'Save', primary: true },
      ],
    });
    if (!r || r.button === 'cancel') return false;
    if (r.button === 'save' && !(await saveTab(id))) return false;
  }
  const list = tabs.value;
  const index = list.findIndex((t) => t.id === id);
  const rest = list.filter((t) => t.id !== id);
  tabs.value = rest;
  if (activeId.value === id) {
    if (rest.length) activateTab(rest[Math.min(index, rest.length - 1)].id);
    else {
      activeId.value = null;
      newTab();
    }
  }
  removeDoc(id);
  return true;
}

/** Closes every other tab, asking about each one that has unsaved changes. */
export async function closeOthers(keep: number): Promise<void> {
  for (const t of [...tabs.value]) {
    if (t.id === keep) continue;
    if (!(await closeTab(t.id))) break;
  }
  activateTab(keep);
}

export function cycleTab(step: 1 | -1): void {
  const list = tabs.value;
  if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === activeId.value);
  activateTab(list[(i + step + list.length) % list.length].id);
}

export function moveTab(id: number, toIndex: number): void {
  const list = [...tabs.value];
  const from = list.findIndex((t) => t.id === id);
  if (from < 0) return;
  const to = Math.max(0, Math.min(list.length - 1, toIndex));
  if (from === to) return;
  const [tab] = list.splice(from, 1);
  list.splice(to, 0, tab);
  tabs.value = list;
}

// ------------------------------------------------------------------ rename

export function startRename(id: number, where: 'tab' | 'list'): void {
  if (!tabs.value.some((t) => t.id === id)) return;
  renaming.value = { id, where };
}

/** Why a name cannot be used, or null when it is fine. */
export function nameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'A name is needed.';
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(n)) return 'A name cannot contain \\ / : * ? " < > |';
  if (n === '.' || n === '..' || n.length > 200) return 'That name cannot be used.';
  return null;
}

export async function renameTabTo(id: number, rawName: string): Promise<boolean> {
  const tab = tabs.value.find((t) => t.id === id);
  const name = rawName.trim();
  if (!tab || name === tab.name) return true;
  const problem = nameProblem(name);
  if (problem) {
    toast(problem, { kind: 'error' });
    return false;
  }
  const applyName = (extra: Partial<Tab> = {}) => {
    const lang = languageName(name);
    patchTab(id, { name, untitled: false, lang, ...extra });
    if (lang !== tab.lang) setTabLanguage(id, lang);
  };

  if (!tab.handle) {
    // Not on disk yet: the tab keeps the name and Save suggests it.
    applyName();
    return true;
  }
  if (typeof tab.handle.move === 'function') {
    try {
      if (tab.handle.queryPermission && (await tab.handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        const p = await tab.handle.requestPermission?.({ mode: 'readwrite' });
        if (p !== 'granted') throw new DOMException('Permission was not granted', 'NotAllowedError');
      }
      await tab.handle.move(name);
      applyName();
      toast(`Renamed on disk to ${name}`, { kind: 'ok', ms: 2200 });
      return true;
    } catch (e) {
      const why = e instanceof Error ? e.name : 'error';
      toast(
        why === 'NotAllowedError'
          ? 'The file was not renamed because permission to change it was not given.'
          : `The file could not be renamed on disk (${why}). A file with that name may already exist.`,
        { kind: 'error' },
      );
      return false;
    }
  }
  const r = await ask({
    title: 'This browser cannot rename files on disk',
    message: `You can rename just the tab. It will no longer be linked to ${tab.name}, and Save will ask where to put ${name}.`,
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'unlink', label: 'Rename tab only', primary: true },
    ],
  });
  if (!r || r.button !== 'unlink') return false;
  applyName({ handle: undefined });
  return true;
}

// ------------------------------------------------------------ context menu

export async function copyTabName(id: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return;
  try {
    await navigator.clipboard.writeText(tab.name);
    toast(`Copied "${tab.name}"`, { kind: 'ok', ms: 1600 });
  } catch {
    toast('The clipboard is not available here.', { kind: 'error' });
  }
}

export function tabMenuItems(id: number, where: 'tab' | 'list'): MenuItem[] {
  const list = tabs.value;
  const index = list.findIndex((t) => t.id === id);
  return [
    { label: 'Rename…', hint: 'F2', run: () => startRename(id, where) },
    { label: 'Copy name', run: () => void copyTabName(id) },
    { separator: true, label: '' },
    { label: 'Move to start', disabled: index <= 0, run: () => moveTab(id, 0) },
    { label: 'Move to end', disabled: index === list.length - 1, run: () => moveTab(id, list.length - 1) },
    { separator: true, label: '' },
    { label: 'Close', hint: 'Alt+W', run: () => void closeTab(id) },
    { label: 'Close other tabs', disabled: list.length < 2, run: () => void closeOthers(id) },
  ];
}

export function openTabMenu(x: number, y: number, id: number, where: 'tab' | 'list'): void {
  menu.value = { x, y, items: tabMenuItems(id, where) };
}

// ------------------------------------------------------- locked (restored) tabs

/** Asks for permission again and loads a restored linked file. Needs a user gesture. */
export async function unlockTab(id: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab?.handle || !tab.locked) return;
  try {
    const p = (await tab.handle.requestPermission?.({ mode: 'read' })) ?? 'granted';
    if (p !== 'granted') {
      toast(`Access to ${tab.name} was not allowed, so it stays closed.`, { kind: 'info' });
      return;
    }
    const file = await tab.handle.getFile();
    if (file.size > largeLimitBytes()) {
      // Too large for the editor: reopen it in the large-file viewer.
      const handle = tab.handle;
      await closeTab(id);
      await openBigFile(file, handle);
      return;
    }
    const loaded = await readForTab(file);
    if (!loaded) return;
    replaceDoc(id, loaded.text, tab.lang);
    patchTab(id, { locked: false, encoding: loaded.encoding, eol: loaded.eol, dirty: false });
    if (activeId.value === id) focusEditor();
  } catch {
    toast(`${tab.name} could not be reopened. It may have been moved or deleted.`, { kind: 'error' });
  }
}

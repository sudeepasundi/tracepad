import { createDoc, docLength, focusEditor, removeDoc, showTab } from '../editor/editor';
import { languageName } from '../editor/languages';
import type { Encoding } from '../files/encoding';
import { saveTab } from '../files/fileio';
import { ask } from './feedback';
import { activeId, newTabId, nextUntitledName, patchTab, tabs, type Tab } from './state';

export interface NewTab {
  name: string;
  text: string;
  handle?: FileSystemFileHandle;
  encoding?: Encoding;
  eol?: 'LF' | 'CRLF';
  untitled?: boolean;
}

export function addTab(spec: NewTab): number {
  const id = newTabId();
  const lang = languageName(spec.name);
  createDoc(id, spec.text, lang);
  const tab: Tab = {
    id,
    name: spec.name,
    handle: spec.handle,
    untitled: spec.untitled ?? false,
    encoding: spec.encoding ?? 'UTF-8',
    eol: spec.eol ?? (navigator.platform.startsWith('Win') ? 'CRLF' : 'LF'),
    lang,
    dirty: false,
    lastUsed: Date.now(),
  };
  // A pristine, empty "untitled" tab is replaced rather than left behind.
  const current = tabs.value.find((t) => t.id === activeId.value);
  const replace = !spec.untitled && current && current.untitled && !current.dirty && docLength(current.id) === 0 ? current.id : null;
  tabs.value = [...tabs.value.filter((t) => t.id !== replace), tab];
  activateTab(id);
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

export function cycleTab(step: 1 | -1): void {
  const list = tabs.value;
  if (list.length < 2) return;
  const i = list.findIndex((t) => t.id === activeId.value);
  activateTab(list[(i + step + list.length) % list.length].id);
}

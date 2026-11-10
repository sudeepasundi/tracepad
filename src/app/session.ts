// Session restore: tabs come back after a reload or restart.
//   - linked file, no unsaved edits  -> the handle is stored and the file is re-read
//   - anything with content to keep  -> the text is stored too, if it is small enough
// Browsers forget file permissions on restart; such tabs come back "locked" and
// ask for access again with one click.
//
// Two stores are used on purpose:
//   - IndexedDB holds the full session (it can store file handles and big text),
//     written at most every half second while you work.
//   - localStorage holds a small "journal" written synchronously as the page
//     goes away, because an IndexedDB write started at that moment is not
//     guaranteed to finish. On start-up the newer of the two wins, and handles
//     are taken from IndexedDB by tab id.
import { effect } from '@preact/signals';
import type { Text } from '@codemirror/state';
import { docOf, docTick } from '../editor/editor';
import type { Encoding } from '../files/encoding';
import { readForTab } from '../files/fileio';
import { toast } from './feedback';
import { idbGet, idbSet } from './idb';
import { activeId, tabs } from './state';
import { loadJSON, saveJSON } from './storage';
import { activateTab, addTab } from './tabs';

/** Unsaved text above this size is not kept (per tab). */
export const MAX_STORED_CHARS = 2_000_000;
/** The journal lives in localStorage, which is small; text beyond this stays out of it. */
const JOURNAL_BUDGET = 1_500_000;
const KEY = 'session';
const JOURNAL_KEY = 'tracepad.journal';

interface StoredTab {
  uid: string;
  name: string;
  untitled: boolean;
  encoding: Encoding;
  eol: 'LF' | 'CRLF';
  handle?: FileSystemFileHandle;
  /** Journal only: the tab had a handle (the handle itself is in IndexedDB). */
  linked?: boolean;
  text?: string;
  dirty: boolean;
  lastUsed: number;
}

interface StoredSession {
  v: 1;
  at: number;
  tabs: StoredTab[];
  active: number;
}

let ready = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let notStored = false;
let handleSignature = '';
const textCache = new Map<number, { doc: Text; text: string }>();

/** True when some unsaved work could not be kept, so closing the page would lose it. */
export function hasUnstoredChanges(): boolean {
  return notStored;
}

function textOf(id: number, doc: Text): string {
  // Text is immutable, so an unchanged document reuses its cached string.
  let hit = textCache.get(id);
  if (!hit || hit.doc !== doc) {
    hit = { doc, text: doc.toString() };
    textCache.set(id, hit);
  }
  return hit.text;
}

function snapshot(forJournal: boolean): StoredSession {
  const list = tabs.value;
  let unstored = false;
  let budget = JOURNAL_BUDGET;
  const out: StoredTab[] = [];
  for (const t of list) {
    const base: StoredTab = { uid: t.uid, name: t.name, untitled: t.untitled, encoding: t.encoding, eol: t.eol, lastUsed: t.lastUsed, dirty: false };
    if (forJournal) base.linked = !!t.handle;
    else base.handle = t.handle;
    if (t.locked || (t.handle && !t.dirty)) {
      out.push(base);
      continue;
    }
    const doc = docOf(t.id);
    if (!doc || doc.length > MAX_STORED_CHARS) {
      if (t.dirty) unstored = true;
      // A linked file can at least come back from disk; an unlinked big one cannot.
      if (t.handle) out.push(base);
      continue;
    }
    if (forJournal && doc.length > budget) {
      // Too big for the journal: the IndexedDB copy (at most half a second old) is used.
      out.push({ ...base, dirty: t.dirty });
      continue;
    }
    if (forJournal) budget -= doc.length;
    out.push({ ...base, text: textOf(t.id, doc), dirty: t.dirty });
  }
  for (const id of textCache.keys()) if (!list.some((t) => t.id === id)) textCache.delete(id);
  if (!forJournal) notStored = unstored;
  return { v: 1, at: Date.now(), tabs: out, active: Math.max(0, list.findIndex((t) => t.id === activeId.value)) };
}

export async function saveSessionNow(): Promise<void> {
  if (!ready) return;
  if (timer) clearTimeout(timer);
  timer = undefined;
  const ok = await idbSet(KEY, snapshot(false));
  if (!ok) notStored = tabs.value.some((t) => t.dirty);
}

/** Synchronous save for the moment the page goes away. */
function saveJournal(): void {
  if (!ready) return;
  saveJSON(JOURNAL_KEY, snapshot(true));
  void saveSessionNow();
}

function schedule(): void {
  if (!ready) return;
  // A newly linked file must be durable at once: its handle exists only in IndexedDB.
  const sig = tabs.value.map((t) => (t.handle ? t.uid : '')).join('|');
  if (sig !== handleSignature) {
    handleSignature = sig;
    void saveSessionNow();
    return;
  }
  // Throttle, not debounce: continuous typing still saves twice a second.
  timer ??= setTimeout(() => void saveSessionNow(), 500);
}

async function restoreOne(s: StoredTab): Promise<number | null> {
  const meta = { uid: s.uid, name: s.name, untitled: s.untitled, encoding: s.encoding, eol: s.eol, handle: s.handle, activate: false, lastUsed: s.lastUsed };
  if (typeof s.text === 'string') return addTab({ ...meta, text: s.text, restoredDirty: s.dirty });
  if (!s.handle) return null;
  try {
    const permission = (await s.handle.queryPermission?.({ mode: 'read' })) ?? 'granted';
    if (permission !== 'granted') return addTab({ ...meta, text: '', locked: true });
    const loaded = await readForTab(await s.handle.getFile(), true);
    return loaded ? addTab({ ...meta, ...loaded }) : null;
  } catch {
    toast(`${s.name} could not be reopened. It may have been moved or deleted.`, { kind: 'error' });
    return null;
  }
}

const valid = (s: StoredSession | undefined | null): s is StoredSession => !!s && s.v === 1 && Array.isArray(s.tabs);

/** The newer of the two stores, with handles (and any missing text) taken from IndexedDB. */
function merge(full: StoredSession | undefined, journal: StoredSession | null): StoredSession | null {
  if (!valid(journal)) return valid(full) ? full : null;
  if (!valid(full)) return { ...journal, tabs: journal.tabs.filter((t) => typeof t.text === 'string') };
  if (full.at >= journal.at) return full;
  const byUid = new Map(full.tabs.map((t) => [t.uid, t]));
  const merged = journal.tabs.map((j) => {
    const f = byUid.get(j.uid);
    // Text left out of the journal (over budget) comes from the IndexedDB copy.
    const text = typeof j.text === 'string' ? j.text : f?.text;
    return { ...j, handle: j.linked ? f?.handle : undefined, text, dirty: j.dirty && typeof text === 'string' };
  });
  return { ...journal, tabs: merged };
}

/** Reopens the previous session. Returns false when there was nothing to restore. */
export async function restoreSession(): Promise<boolean> {
  const stored = merge(await idbGet<StoredSession>(KEY), loadJSON<StoredSession | null>(JOURNAL_KEY, null));
  const ids: (number | null)[] = [];
  if (stored) for (const s of stored.tabs) ids.push(await restoreOne(s));
  const opened = ids.filter((x): x is number => x != null);
  if (opened.length) activateTab(ids[stored!.active] ?? opened[0]);
  return opened.length > 0;
}

export function initSessionPersistence(): void {
  ready = true;
  handleSignature = tabs.value.map((t) => (t.handle ? t.uid : '')).join('|');
  effect(() => {
    void tabs.value;
    void activeId.value;
    void docTick.value;
    schedule();
  });
  window.addEventListener('pagehide', saveJournal);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveJournal();
  });
}

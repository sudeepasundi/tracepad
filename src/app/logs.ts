// Log controller: decides which tabs are logs, keeps their parsed index, and
// applies the (single, shared) filter to the tab on screen.
import { effect, signal } from '@preact/signals';
import type { Text } from '@codemirror/state';
import { foldAll, unfoldAll } from '@codemirror/language';
import { currentLine, dispatchToTab, docOf, docTick, getView, goToLine } from '../editor/editor';
import { refreshLog, setFilterMark, setHidden, setLogIndex } from '../editor/log';
import { filterRule } from '../engine/highlights';
import { dropLog, filterBig, filterLog, groupBig, groupLog, parseLog, type PageIndex } from '../engine/client';
import { bigTick, dropBig, setBigBusy, setBigMask } from './big';

const bumpBig = () => void (bigTick.value = bigTick.peek() + 1);
import { EMPTY_FILTER, isEmptyFilter, type ErrorGroup, type FilterSpec } from '../engine/logfilter';
import { FLAG_ENTRY, FORMAT_NAMES, LV } from '../engine/logparse';
import { toast } from './feedback';
import { visibleTabs } from './panes';
import { activeId, patchTab, tabs, type Tab } from './state';

export interface LogInfo {
  status: 'parsing' | 'ready';
  format: string;
  lines: number;
  entries: number;
  /** Entries per level, index 0-6 (0 = no level). */
  counts: number[];
  firstTs: number;
  lastTs: number;
  stamped: number;
  prefixed: number;
  /** Entries shown by the current filter, or null when nothing is filtered. */
  shown: number | null;
  error?: string;
  /** Bumped whenever the index changes. */
  version: number;
}

export const logInfo = signal<Record<number, LogInfo>>({});
export const logFilter = signal<FilterSpec>(EMPTY_FILTER);
export const logGroups = signal<{ tabId: number; version: number; groups: ErrorGroup[] } | null>(null);
/** Bumped to move keyboard focus into the log filter box. */
export const filterFocus = signal(0);

const indexes = new Map<number, PageIndex>();
const masks = new Map<number, Uint8Array>();
const analysed = new Map<number, Text>();
const keys = new Map<number, string>();
let version = 1;

export function indexFor(tabId: number | null): PageIndex | null {
  return tabId == null ? null : (indexes.get(tabId) ?? null);
}

export function maskFor(tabId: number | null): Uint8Array | null {
  return tabId == null ? null : (masks.get(tabId) ?? null);
}

const CANDIDATE_LANGS = new Set(['Log', 'Plain text', 'JSON']);

/** A file is treated as a log when enough of it looks like timestamped entries. */
function looksLikeLog(ix: PageIndex): boolean {
  const lines = ix.summary[0];
  const entries = ix.summary[1];
  const stamped = ix.summary[14];
  if (entries < 2 || stamped < 2) return false;
  return entries >= lines * 0.25 || entries >= 20;
}

function setInfo(id: number, info: LogInfo | null): void {
  const next = { ...logInfo.value };
  if (info) next[id] = info;
  else delete next[id];
  logInfo.value = next;
}

function detach(tab: Tab): void {
  if (!indexes.has(tab.id) && !tab.isLog) return;
  indexes.delete(tab.id);
  masks.delete(tab.id);
  dropLog(tab.uid);
  dispatchToTab(tab.id, { effects: [setLogIndex.of(null), setHidden.of(null)] });
  setInfo(tab.id, null);
  if (tab.isLog) patchTab(tab.id, { isLog: false });
}

async function analyse(id: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === id);
  const doc = docOf(id);
  if (!tab || !doc || tab.locked || tab.big) return;
  if (analysed.get(id) === doc) return;
  analysed.set(id, doc);
  if (tab.forceLog === false || !(tab.forceLog || CANDIDATE_LANGS.has(tab.lang))) {
    detach(tab);
    return;
  }
  keys.set(id, tab.uid);
  const previous = logInfo.value[id];
  if (previous) setInfo(id, { ...previous, status: 'parsing' });
  let ix: PageIndex;
  try {
    ix = await parseLog(tab.uid, new TextEncoder().encode(doc.toString()));
  } catch (e) {
    console.error(e);
    return;
  }
  // The document moved on while we were parsing: the newer run wins.
  if (docOf(id) !== doc) return;
  const now = tabs.value.find((t) => t.id === id);
  if (!now) {
    dropLog(tab.uid);
    return;
  }
  if (!(now.forceLog || now.lang === 'Log' || looksLikeLog(ix))) {
    detach(now);
    return;
  }
  indexes.set(id, ix);
  masks.delete(id);
  const s = ix.summary;
  version++;
  setInfo(id, {
    status: 'ready',
    format: FORMAT_NAMES[s[2]] || 'No timestamps found',
    lines: s[0],
    entries: s[1],
    counts: Array.from(s.subarray(6, 13)),
    firstTs: s[4],
    lastTs: s[5],
    stamped: s[14],
    prefixed: s[3],
    shown: null,
    version,
  });
  if (!now.isLog) patchTab(id, { isLog: true });
  dispatchToTab(id, { effects: [setLogIndex.of(ix), setHidden.of(null)] });
  await applyFilterTo(id);
  if (logGroups.value?.tabId === id) void loadGroups(id);
}

/** A large-file tab finished (re)indexing: use its index like any other log's. */
export function attachBigLog(id: number, ix: PageIndex): void {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return;
  keys.set(id, tab.uid);
  const isLog = tab.forceLog !== false && (tab.forceLog || tab.lang === 'Log' || looksLikeLog(ix));
  if (!isLog) {
    indexes.delete(id);
    masks.delete(id);
    setInfo(id, null);
    if (tab.isLog) patchTab(id, { isLog: false });
    return;
  }
  const previous = logInfo.value[id];
  indexes.set(id, ix);
  const s = ix.summary;
  version++;
  setInfo(id, {
    status: 'ready',
    format: FORMAT_NAMES[s[2]] || 'No timestamps found',
    lines: s[0],
    entries: s[1],
    counts: Array.from(s.subarray(6, 13)),
    firstTs: s[4],
    lastTs: s[5],
    stamped: s[14],
    prefixed: s[3],
    shown: previous?.shown ?? null,
    version,
  });
  if (!tab.isLog) patchTab(id, { isLog: true });
  if (!previous) void applyFilterTo(id);
  if (logGroups.value?.tabId === id) void loadGroups(id);
}

/** Applies the current filter again (the file grew). */
export function refilter(id: number): Promise<void> {
  return applyFilterTo(id);
}

/** Latest filter run per tab: an older run that finishes late is dropped. */
const filterRuns = new Map<number, number>();

async function applyFilterTo(id: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === id);
  const info = logInfo.value[id];
  if (!tab || !info || info.status !== 'ready') return;
  const spec = logFilter.value;
  const run = (filterRuns.get(id) ?? 0) + 1;
  filterRuns.set(id, run);
  const latest = () => filterRuns.get(id) === run;
  if (isEmptyFilter(spec)) {
    if (masks.delete(id) || info.shown !== null || info.error) {
      if (tab.big) setBigMask(id, null);
      else dispatchToTab(id, { effects: setHidden.of(null) });
      setInfo(id, { ...info, shown: null, error: undefined });
    }
    return;
  }
  if (tab.big) setBigBusy(id, 0);
  const result = tab.big ? await filterBig(tab.uid, spec, (done, total) => latest() && setBigBusy(id, total ? done / total : 1)) : await filterLog(tab.uid, spec);
  const current = logInfo.value[id];
  if (!result || !latest() || !current || current.version !== info.version) {
    if (tab.big && latest()) setBigBusy(id, null);
    return;
  }
  if (result.error) {
    masks.delete(id);
    if (tab.big) setBigMask(id, null);
    else dispatchToTab(id, { effects: setHidden.of(null) });
    setInfo(id, { ...current, shown: null, error: result.error });
    return;
  }
  masks.set(id, result.mask);
  if (tab.big) setBigMask(id, result.mask);
  else dispatchToTab(id, { effects: setHidden.of(result.mask) });
  setInfo(id, { ...current, shown: result.shownEntries, error: undefined });
}

export function patchFilter(patch: Partial<FilterSpec>): void {
  logFilter.value = { ...logFilter.value, ...patch };
}

export function clearFilters(): void {
  logFilter.value = EMPTY_FILTER;
}

/** Click a level chip: the first click shows only that level, later clicks add or remove levels. */
export function toggleLevel(level: number): void {
  const info = activeId.value != null ? logInfo.value[activeId.value] : undefined;
  const present = info ? info.counts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0) : [0, 1, 2, 3, 4, 5, 6];
  const current = logFilter.value.levels;
  let next: number[];
  if (current === null) next = [level];
  else if (current.includes(level)) next = current.filter((l) => l !== level);
  else next = [...current, level];
  patchFilter({ levels: next.length === 0 || present.every((l) => next.includes(l)) ? null : next });
}

export function forceLog(on: boolean): void {
  const id = activeId.value;
  if (id == null) return;
  patchTab(id, { forceLog: on });
  analysed.delete(id);
  void analyse(id);
}

export async function loadGroups(tabId: number): Promise<void> {
  const tab = tabs.value.find((t) => t.id === tabId);
  const info = logInfo.value[tabId];
  if (!tab || !info) {
    logGroups.value = null;
    return;
  }
  const groups = tab.big ? await groupBig(tab.uid) : await groupLog(tab.uid);
  logGroups.value = { tabId, version: info.version, groups };
}

// ------------------------------------------------------------------ navigation

const cursorLine = currentLine;

/** F8 / Shift+F8: next or previous ERROR/FATAL entry that is not filtered out. */
export function jumpToError(dir: 1 | -1): void {
  const id = activeId.value;
  const ix = indexFor(id);
  if (!ix) {
    toast('This tab is not a log. Use "Treat this tab as a log" from the command palette if it should be.', { ms: 4500 });
    return;
  }
  const mask = maskFor(id);
  const n = ix.level.length;
  const start = cursorLine() - 1;
  for (let step = 1; step <= n; step++) {
    const i = (((start + dir * step) % n) + n) % n;
    if (ix.flags[i] & FLAG_ENTRY && ix.level[i] >= LV.ERROR && (!mask || mask[i])) {
      goToLine(i + 1);
      if ((dir === 1 && i <= start) || (dir === -1 && i >= start)) toast(dir === 1 ? 'Wrapped to the first error' : 'Wrapped to the last error', { ms: 1500 });
      return;
    }
  }
  toast(mask ? 'No errors in the filtered lines' : 'No errors in this log', { ms: 2500 });
}

/** First visible entry at or after `ms`. */
export function jumpToTime(ms: number, preferError = false, until = Infinity): void {
  const id = activeId.value;
  const ix = indexFor(id);
  if (!ix) return;
  const mask = maskFor(id);
  let first = -1;
  for (const i of ix.entryLines) {
    const t = ix.ts[i];
    if (!(t >= ms) || (mask && !mask[i])) continue;
    if (t > until) break;
    if (first < 0) first = i;
    if (!preferError) break;
    if (ix.level[i] >= LV.ERROR) {
      first = i;
      break;
    }
  }
  if (first >= 0) goToLine(first + 1);
}

export function foldTraces(fold: boolean): void {
  const v = getView();
  (fold ? foldAll : unfoldAll)(v);
  v.focus();
}

/** The trace id under the cursor (16+ hex digits, optionally trace-span), if any. */
export function filterToTraceAtCursor(): void {
  const s = getView().state;
  const line = s.doc.lineAt(s.selection.main.head);
  const col = s.selection.main.head - line.from;
  const re = /[0-9a-f]{16,32}/g;
  let m: RegExpExecArray | null;
  let found: string | null = null;
  while ((m = re.exec(line.text))) {
    if (found === null) found = m[0];
    if (col >= m.index && col <= m.index + m[0].length) {
      found = m[0];
      break;
    }
  }
  if (!found) {
    toast('No trace id on this line. Put the cursor on a line that has one.', { ms: 3500 });
    return;
  }
  patchFilter({ trace: found });
  toast(`Showing trace ${found.slice(0, 12)}…`, { ms: 2200 });
}

export function refreshLogDecorations(): void {
  for (const t of tabs.value) dispatchToTab(t.id, { effects: refreshLog.of(null) });
}

export function initLogs(): void {
  // Analyse the tab on screen when it appears or (shortly after) it changes.
  // Every pane counts: with a split, each file on screen is analysed.
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  let lastShown = new Set<number>();
  effect(() => {
    const ids = visibleTabs.value;
    void docTick.value;
    for (const id of ids) void tabs.value.find((t) => t.id === id)?.lang;
    for (const id of ids) {
      const old = timers.get(id);
      if (old) clearTimeout(old);
      timers.set(
        id,
        setTimeout(() => void analyse(id), lastShown.has(id) ? 450 : 0),
      );
    }
    lastShown = new Set(ids);
  });
  // Re-filter when the filter changes or another tab comes to the front.
  let filterTimer: ReturnType<typeof setTimeout> | undefined;
  effect(() => {
    const spec = logFilter.value;
    const ids = visibleTabs.value;
    setFilterMark(filterRule(spec));
    for (const t of tabs.peek()) dispatchToTab(t.id, { effects: refreshLog.of(null) });
    bumpBig();
    if (!ids.length) return;
    if (filterTimer) clearTimeout(filterTimer);
    // One filter for every pane.
    filterTimer = setTimeout(() => ids.forEach((id) => void applyFilterTo(id)), 140);
  });
  // Forget closed tabs.
  effect(() => {
    const open = new Set(tabs.value.map((t) => t.id));
    for (const id of [...keys.keys()]) {
      if (open.has(id)) continue;
      dropLog(keys.get(id)!);
      keys.delete(id);
      indexes.delete(id);
      masks.delete(id);
      analysed.delete(id);
      dropBig(id);
      if (logInfo.peek()[id]) setInfo(id, null);
    }
  });
}

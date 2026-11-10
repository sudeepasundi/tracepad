// Large-file tabs: the file stays on disk, a worker holds the index, and the
// page keeps only what it draws from (levels, flags, times) plus a small cache
// of the lines on screen. Read-only by design.
import { signal } from '@preact/signals';
import { appendBig, findBig, openBig, textBig, type PageIndex } from '../engine/client';
import { toast } from './feedback';
import { attachBigLog, maskFor, refilter } from './logs';
import { activeId, cursor, patchTab, tabs } from './state';

export interface BigFindState {
  query: string;
  re: RegExp | null;
  lines: Uint32Array;
  total: number;
  /** 0..1 while the file is being searched, null when done. */
  progress: number | null;
  error?: string;
}

export interface BigTab {
  id: number;
  key: string;
  file: Blob;
  encoding: string;
  /** First byte shown (non-zero for "last N MB" views and files with a BOM). */
  start: number;
  /** True when only the end of the file is shown. */
  tailOnly: boolean;
  status: 'indexing' | 'ready' | 'failed';
  progress: number;
  error?: string;
  size: number;
  lines: number;
  index: PageIndex | null;
  /** Lines shown when a filter is active (0-based, ascending); null = all. */
  rows: Uint32Array | null;
  /** First row on screen (fractional). */
  top: number;
  /** Current line (0-based) and the other end of a shift-selection. */
  cursor: number;
  anchor: number;
  cache: Map<number, string>;
  loading: Set<number>;
  find: BigFindState | null;
  /** Shown while a slow filter runs. */
  busy: number | null;
  /** Set by find: bring the match on the current line into view sideways too. */
  wantHit: boolean;
}

/** Bumped whenever a viewer must redraw. */
export const bigTick = signal(0);
const bigs = new Map<number, BigTab>();
const redraw = () => void bigTick.value++;

export function getBig(id: number | null): BigTab | null {
  return id == null ? null : (bigs.get(id) ?? null);
}

export function rowCount(b: BigTab): number {
  return b.rows ? b.rows.length : b.lines;
}

export function lineOfRow(b: BigTab, row: number): number {
  return b.rows ? b.rows[row] : row;
}

/** Row showing `line`, or the next shown row after it (filtered views). */
export function rowOfLine(b: BigTab, line: number): number {
  if (!b.rows) return Math.max(0, Math.min(b.lines - 1, line));
  let lo = 0;
  let hi = b.rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (b.rows[mid] < line) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, b.rows.length - 1));
}

export async function startBig(id: number, key: string, file: Blob, start: number, encoding: string, tailOnly: boolean, chunk?: number): Promise<void> {
  const previous = bigs.get(id);
  const b: BigTab = {
    id, key, file, encoding, start, tailOnly,
    status: 'indexing', progress: 0, size: file.size, lines: 0, index: null, rows: null,
    top: previous?.top ?? 0, cursor: previous?.cursor ?? 0, anchor: previous?.cursor ?? 0,
    cache: new Map(), loading: new Set(), find: null, busy: null, wantHit: false,
  };
  bigs.set(id, b);
  redraw();
  try {
    const r = await openBig(key, file, start, encoding, (done, total) => {
      b.progress = total ? done / total : 1;
      redraw();
    }, chunk);
    if (bigs.get(id) !== b) return;
    b.index = { level: r.level, flags: r.flags, ts: r.ts, entryLines: r.entryLines, summary: r.summary };
    b.lines = r.level.length;
    b.size = r.size;
    b.status = 'ready';
    b.cursor = Math.min(b.cursor, Math.max(0, b.lines - 1));
    b.anchor = b.cursor;
    attachBigLog(id, b.index);
    publishCursor(b);
    redraw();
  } catch (e) {
    if (bigs.get(id) !== b) return;
    b.status = 'failed';
    b.error = e instanceof Error && e.name === 'NotReadableError' ? 'The file changed or moved since it was picked. Pick it again.' : 'The file could not be read.';
    console.error(e);
    redraw();
  }
}

export function dropBig(id: number): void {
  bigs.delete(id);
}

/** Called by the log controller when the filter result changes. */
export function setBigMask(id: number, mask: Uint8Array | null): void {
  const b = bigs.get(id);
  if (!b) return;
  const line = lineOfRow(b, Math.round(b.top));
  if (!mask) b.rows = null;
  else {
    let n = 0;
    for (let i = 0; i < mask.length; i++) n += mask[i];
    const rows = new Uint32Array(n);
    let k = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) rows[k++] = i;
    b.rows = rows;
  }
  // Stay near the same place in the file.
  b.top = rowOfLine(b, line);
  b.busy = null;
  redraw();
}

export function setBigBusy(id: number, progress: number | null): void {
  const b = bigs.get(id);
  if (!b) return;
  b.busy = progress;
  redraw();
}

/** Makes sure rows [from, to) have their text; missing stretches are fetched. */
export function ensureRows(b: BigTab, from: number, to: number): void {
  const total = rowCount(b);
  to = Math.min(total, to);
  let run: [number, number] | null = null;
  const flush = () => {
    if (!run) return;
    const [a, z] = run;
    run = null;
    for (let l = a; l < z; l++) b.loading.add(l);
    void textBig(b.key, a, z)
      .then((texts) => {
        if (bigs.get(b.id) !== b) return;
        if (b.cache.size > 6000) b.cache.clear();
        texts.forEach((t, i) => b.cache.set(a + i, t));
        for (let l = a; l < z; l++) b.loading.delete(l);
        redraw();
      })
      .catch(() => {
        for (let l = a; l < z; l++) b.loading.delete(l);
      });
  };
  for (let r = Math.max(0, from); r < to; r++) {
    const line = lineOfRow(b, r);
    if (b.cache.has(line) || b.loading.has(line)) {
      flush();
      continue;
    }
    if (run && run[1] === line && line - run[0] < 400) run[1] = line + 1;
    else {
      flush();
      run = [line, line + 1];
    }
  }
  flush();
}

/** Scroll request handled by the viewer (it knows how many rows fit). */
export const bigReveal = signal<{ id: number; row: number; tick: number } | null>(null);
let revealTick = 0;

export function revealLine(id: number, line: number): void {
  const b = bigs.get(id);
  if (!b || !b.lines) return;
  const row = rowOfLine(b, Math.max(0, Math.min(b.lines - 1, line)));
  b.cursor = lineOfRow(b, row);
  b.anchor = b.cursor;
  bigReveal.value = { id, row, tick: ++revealTick };
  publishCursor(b);
  redraw();
}

export function publishCursor(b: BigTab): void {
  if (activeId.value !== b.id) return;
  const from = Math.min(b.cursor, b.anchor);
  const to = Math.max(b.cursor, b.anchor);
  cursor.value = { line: b.cursor + 1, col: 1, lines: b.lines, chars: b.size, selections: 1, selectedChars: to > from ? to - from + 1 : 0 };
}

/** Text of the selected lines (or the current line), for copying. */
export async function selectedText(b: BigTab): Promise<string | null> {
  const from = Math.min(b.cursor, b.anchor);
  const to = Math.max(b.cursor, b.anchor);
  const mask = maskFor(b.id);
  if (to - from > 200_000) {
    toast('That is more than 200,000 lines. Select a smaller range to copy.', { kind: 'info' });
    return null;
  }
  const out: string[] = [];
  for (let a = from; a <= to; a += 2000) {
    const z = Math.min(to + 1, a + 2000);
    const texts = await textBig(b.key, a, z);
    texts.forEach((t, i) => {
      if (!mask || mask[a + i]) out.push(t);
    });
  }
  return out.join('\n');
}

// ----------------------------------------------------------------------- find

let findRun = 0;

export function bigSearch(id: number, query: string, opts: { regex: boolean; caseSensitive: boolean; wholeWord: boolean }): void {
  const b = bigs.get(id);
  if (!b) return;
  const run = ++findRun;
  if (!query) {
    b.find = null;
    redraw();
    return;
  }
  let source = opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) source = `\\b(?:${source})\\b`;
  const flags = opts.caseSensitive ? '' : 'i';
  let re: RegExp;
  try {
    re = new RegExp(source, flags);
    if (re.test('')) throw new Error('matches nothing');
  } catch {
    b.find = { query, re: null, lines: new Uint32Array(0), total: 0, progress: null, error: 'Invalid pattern' };
    redraw();
    return;
  }
  b.find = { query, re, lines: new Uint32Array(0), total: 0, progress: 0 };
  redraw();
  void findBig(b.key, source, flags, 50_000, (done, total) => {
    if (run !== findRun || !b.find) return;
    b.find.progress = total ? done / total : 1;
    redraw();
  }).then((r) => {
    if (run !== findRun || bigs.get(id) !== b) return;
    b.find = { query, re, lines: r.lines, total: r.total, progress: null };
    redraw();
  });
}

export function clearBigSearch(id: number): void {
  findRun++;
  const b = bigs.get(id);
  if (b?.find) {
    b.find = null;
    redraw();
  }
}

/** Index (1-based) of the match the cursor is on, or 0. */
export function findPosition(b: BigTab): number {
  if (!b.find) return 0;
  const i = lowerBound(b.find.lines, b.cursor);
  return b.find.lines[i] === b.cursor ? i + 1 : 0;
}

function lowerBound(a: Uint32Array, v: number): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function bigFindStep(id: number, dir: 1 | -1): void {
  const b = bigs.get(id);
  const f = b?.find;
  if (!b || !f || !f.lines.length) return;
  const mask = maskFor(id);
  const n = f.lines.length;
  let i = dir === 1 ? lowerBound(f.lines, b.cursor + 1) : lowerBound(f.lines, b.cursor) - 1;
  for (let step = 0; step < n; step++) {
    const k = (((i % n) + n) % n) | 0;
    const line = f.lines[k];
    if (!mask || mask[line]) {
      b.wantHit = true;
      revealLine(id, line);
      return;
    }
    i += dir;
  }
  toast('No matches in the filtered lines', { ms: 2000 });
}

// ------------------------------------------------------------ growing files

/** The file on disk changed. Returns false when it has to be opened afresh. */
export async function bigDiskChanged(id: number, file: Blob, follow: boolean): Promise<boolean> {
  const b = bigs.get(id);
  if (!b || b.status !== 'ready' || !b.index) return true;
  const delta = await appendBig(b.key, file);
  if (bigs.get(id) !== b) return true;
  if (!delta) return false;
  const old = b.index;
  const join = <T extends Uint8Array | Float64Array | Uint32Array>(head: T, keep: number, tail: T, make: (n: number) => T): T => {
    const out = make(keep + tail.length);
    out.set(head.subarray(0, keep) as never);
    out.set(tail as never, keep);
    return out;
  };
  const atEnd = b.top >= rowCount(b) - 60;
  b.index = {
    level: join(old.level, delta.fromLine, delta.level, (n) => new Uint8Array(n)),
    flags: join(old.flags, delta.fromLine, delta.flags, (n) => new Uint8Array(n)),
    ts: join(old.ts, delta.fromLine, delta.ts, (n) => new Float64Array(n)),
    entryLines: join(old.entryLines, delta.keepEntries, delta.entryLines, (n) => new Uint32Array(n)),
    summary: delta.summary,
  };
  b.file = file;
  b.size = delta.size;
  b.lines = b.index.level.length;
  for (const l of [...b.cache.keys()]) if (l >= delta.fromLine) b.cache.delete(l);
  attachBigLog(id, b.index);
  // A filter in force has to be applied to the new lines too.
  if (b.rows) await refilter(id);
  if (follow || atEnd) {
    bigReveal.value = { id, row: rowCount(b) - 1, tick: ++revealTick };
    b.cursor = b.lines - 1;
    b.anchor = b.cursor;
  }
  publishCursor(b);
  redraw();
  return true;
}

/** Keeps the tab list tidy when a big tab's file is re-indexed from scratch. */
export function markTail(id: number, tailOnly: boolean): void {
  if (tabs.value.some((t) => t.id === id)) patchTab(id, { tailOnly });
}

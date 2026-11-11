// The bottom results panel: auto tables, extracted tables, counts, duplicates
// and find-in-tabs. Several results stay open as tabs in the panel.
import { signal } from '@preact/signals';
import { docOf, goToLine } from '../editor/editor';
import { extractTab, mineTab, tableTab } from '../engine/client';
import { countBy, toCsv, toHtml, toTsv, type Column, type ExtractSpec, type Table, type TemplateInfo, PRESET_TITLES } from '../engine/tables';
import { copyToClipboard } from './clipboard';
import { ask, toast } from './feedback';
import { patchFilter } from './logs';
import { activeId, tabs } from './state';
import { activateTab, addTab } from './tabs';

export interface AutoState {
  templates: TemplateInfo[];
  accessEntries: number;
  entries: number;
  ms: number;
  selected: number | 'access' | null;
  /** 0..1 while the selected table is being built. */
  loading: number | null;
}

export interface ResultTab {
  id: number;
  title: string;
  kind: 'auto' | 'table';
  /** The editor tab the result came from (rows jump to its lines). */
  source: number | null;
  /** Per-row editor tab, for results that span several files. */
  rowTabs?: number[];
  table: Table | null;
  auto?: AutoState;
  /** 0..1 while the result is being computed. */
  busy: number | null;
  error?: string;
}

export const results = signal<ResultTab[]>([]);
export const activeResult = signal<number | null>(null);
export const panelOpen = signal(false);
export const panelMaximised = signal(false);
let nextId = 1;

const patch = (id: number, p: Partial<ResultTab>) => (results.value = results.value.map((r) => (r.id === id ? { ...r, ...p } : r)));
const get = (id: number) => results.value.find((r) => r.id === id);

function open(tab: Omit<ResultTab, 'id'>): number {
  const id = nextId++;
  results.value = [...results.value, { ...tab, id }];
  activeResult.value = id;
  panelOpen.value = true;
  return id;
}

export function closeResult(id: number): void {
  const list = results.value;
  const i = list.findIndex((r) => r.id === id);
  results.value = list.filter((r) => r.id !== id);
  if (activeResult.value === id) activeResult.value = results.value[Math.min(i, results.value.length - 1)]?.id ?? null;
  if (!results.value.length) {
    panelOpen.value = false;
    panelMaximised.value = false;
  }
}

function logTab() {
  const tab = tabs.value.find((t) => t.id === activeId.value);
  if (!tab) return null;
  if (!tab.isLog) {
    toast('Tables are built from logs, and this tab is not being treated as one. Use "Treat this tab as a log" if it should be.', { ms: 5500 });
    return null;
  }
  return tab;
}

/** Learns the message patterns of the current log and opens them beside their tables. */
export async function runAutoTables(): Promise<void> {
  const tab = logTab();
  if (!tab) return;
  const existing = results.value.find((r) => r.kind === 'auto' && r.source === tab.id);
  const id = existing?.id ?? open({ title: `Tables · ${tab.name}`, kind: 'auto', source: tab.id, table: null, busy: 0 });
  if (existing) {
    activeResult.value = id;
    panelOpen.value = true;
    patch(id, { busy: 0, error: undefined });
  }
  try {
    const mined = await mineTab(tab.uid, (done, total) => patch(id, { busy: total ? done / total : 1 }));
    if (!mined) throw new Error('The log is still being read. Try again in a moment.');
    const first: number | 'access' | null = mined.accessEntries ? 'access' : (mined.templates[0]?.id ?? null);
    patch(id, { busy: null, table: null, auto: { templates: mined.templates, accessEntries: mined.accessEntries, entries: mined.entries, ms: mined.ms, selected: null, loading: null } });
    if (first !== null) await selectTemplate(id, first);
  } catch (e) {
    patch(id, { busy: null, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function selectTemplate(id: number, which: number | 'access'): Promise<void> {
  const r = get(id);
  const tab = tabs.value.find((t) => t.id === r?.source);
  if (!r?.auto || !tab) return;
  patch(id, { auto: { ...r.auto, selected: which, loading: 0 } });
  const table = await tableTab(tab.uid, which, (done, total) => {
    const now = get(id);
    if (now?.auto && now.auto.selected === which) patch(id, { auto: { ...now.auto, loading: total ? done / total : 1 } });
  });
  const now = get(id);
  if (!now?.auto || now.auto.selected !== which) return;
  if (!table) {
    // The log changed since the patterns were learned.
    void runAutoTables();
    return;
  }
  patch(id, { table, auto: { ...now.auto, loading: null } });
}

export async function runExtract(spec: ExtractSpec): Promise<void> {
  const tab = logTab();
  if (!tab) return;
  const title = spec.preset === 'custom' ? `/${spec.regex}/` : PRESET_TITLES[spec.preset];
  const id = open({ title: `${title} · ${tab.name}`, kind: 'table', source: tab.id, table: null, busy: 0 });
  try {
    const table = await extractTab(tab.uid, spec, (done, total) => patch(id, { busy: total ? done / total : 1 }));
    if (!table) throw new Error('The log is still being read. Try again in a moment.');
    patch(id, { busy: null, table });
  } catch (e) {
    patch(id, { busy: null, error: e instanceof Error ? e.message.replace(/^Invalid regular expression: /, 'Invalid pattern: ') : String(e) });
  }
}

export function openTable(table: Table, source: number | null, rowTabs?: number[]): void {
  open({ title: table.title, kind: 'table', source, table, busy: null, rowTabs });
}

export function countByColumn(id: number, column: number): void {
  const r = get(id);
  if (r?.table) openTable(countBy(r.table, column), null);
}

/** Row clicked: go to its line in the file it came from. */
export function jumpToRow(id: number, row: number): void {
  const r = get(id);
  const line = r?.table?.lines[row];
  const target = r?.rowTabs?.[row] ?? r?.source;
  if (!line || target == null || !tabs.value.some((t) => t.id === target)) return;
  if (activeId.value !== target) activateTab(target);
  goToLine(line);
}

// ------------------------------------------------------------------- export

const COPY_ROWS = 50_000;

function capped(table: Table): Table {
  return table.rows.length > COPY_ROWS ? { ...table, rows: table.rows.slice(0, COPY_ROWS) } : table;
}

/** Copies as a real table (HTML) with plain text alongside, so it pastes well into Excel, Outlook, Teams and Word. */
export async function copyRich(table: Table): Promise<void> {
  const t = capped(table);
  const note = table.rows.length > COPY_ROWS ? ` (the first ${COPY_ROWS.toLocaleString()} rows)` : '';
  if (await copyToClipboard({ html: toHtml(t, COPY_ROWS), text: toTsv(t) })) toast(`Copied ${t.rows.length.toLocaleString()} rows as a table${note}`, { kind: 'ok', ms: 2600 });
  else toast('The browser did not allow copying. Use "Open as new tab" and copy from there.', { kind: 'error' });
}

export async function copyCsv(table: Table): Promise<void> {
  const t = capped(table);
  if (await copyToClipboard({ text: toCsv(t) })) toast(`Copied ${t.rows.length.toLocaleString()} rows as CSV`, { kind: 'ok', ms: 2200 });
  else toast('The browser did not allow copying. Use "Open as new tab" and copy from there.', { kind: 'error' });
}

export function openAsTab(table: Table): void {
  const base = table.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).toLowerCase() || 'table';
  addTab({ name: `${base}.csv`, text: toCsv(table).replace(/\r\n/g, '\n'), untitled: false, restoredDirty: true });
  toast('Opened as a new CSV tab. Save it to keep it.', { ms: 2600 });
}

export function filterLogTo(id: number): void {
  const r = get(id);
  if (!r?.table?.pattern || r.source == null) return;
  if (activeId.value !== r.source) activateTab(r.source);
  patchFilter({ patterns: [`/${r.table.pattern}/`], patternsMode: 'any' });
  toast('The log is filtered to the lines of this table. "Clear filters" shows everything again.', { ms: 4200 });
}

/** Opens the table in its own browser window. */
export function popOut(table: Table): void {
  const w = window.open('', `tracepad-table-${Date.now()}`, 'popup,width=1180,height=760');
  if (!w) {
    toast('The browser blocked the new window. Allow pop-ups for this site, or use "Open as new tab".', { kind: 'error', ms: 7000 });
    return;
  }
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const shown = table.rows.slice(0, 20_000);
  const head = table.columns.map((c) => `<th class="${c.numeric ? 'n' : ''}">${esc(c.name)}${c.stats ? `<small>min ${fmt(c.stats.min)} · avg ${fmt(c.stats.avg)} · p95 ${fmt(c.stats.p95)} · max ${fmt(c.stats.max)}</small>` : ''}</th>`).join('');
  const body = shown.map((r) => `<tr>${r.map((cell, c) => `<td class="${table.columns[c].numeric ? 'n' : ''}">${esc(cell)}</td>`).join('')}</tr>`).join('');
  w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(table.title)} · Tracepad</title><style>
    html{color-scheme:${v('--tp-bg') && document.documentElement.dataset.mode === 'light' ? 'light' : 'dark'}}
    body{margin:0;font:13px/1.45 "Segoe UI",system-ui,sans-serif;background:${v('--tp-bg')};color:${v('--tp-text')}}
    header{position:sticky;top:0;padding:10px 16px;background:${v('--tp-surface')};border-bottom:1px solid ${v('--tp-border')};font-weight:600}
    header small{font-weight:400;color:${v('--tp-muted')};margin-left:10px}
    table{border-collapse:collapse;font:12px/1.5 ${v('--tp-mono') || 'monospace'};margin:0 0 24px}
    th,td{padding:3px 12px;border-bottom:1px solid ${v('--tp-border')};text-align:left;white-space:pre;vertical-align:top}
    th{position:sticky;top:41px;background:${v('--tp-surface')};font-family:"Segoe UI",system-ui,sans-serif}
    th small{display:block;font-weight:400;color:${v('--tp-muted')}}
    .n{text-align:right}
    tr:hover td{background:${v('--tp-surface-2')}}
  </style></head><body><header>${esc(table.title)}<small>${table.total.toLocaleString()} rows${table.rows.length > shown.length ? `, showing the first ${shown.length.toLocaleString()}` : ''}</small></header><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`);
  w.document.close();
}

export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '';
  if (Number.isInteger(n)) return n.toLocaleString();
  return Math.abs(n) >= 100 ? n.toLocaleString(undefined, { maximumFractionDigits: 1 }) : n.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

// ------------------------------------------------- find in tabs, duplicates

const plain = (name: string, numeric = false): Column => ({ name, numeric });

export async function findInTabs(): Promise<void> {
  const r = await ask({
    title: 'Find in all open tabs',
    input: { label: 'Text to find (ignores case). Wrap in /slashes/ for a regular expression.', value: '', validate: (v) => (v.trim() ? null : 'Type something to find') },
    buttons: [
      { id: 'cancel', label: 'Cancel' },
      { id: 'find', label: 'Find', primary: true },
    ],
  });
  if (!r || r.button !== 'find') return;
  const query = r.value.trim();
  let test: (s: string) => boolean;
  const m = /^\/(.+)\/([a-z]*)$/.exec(query);
  try {
    if (m) {
      const re = new RegExp(m[1], m[2].replace(/[gy]/g, ''));
      test = (s) => re.test(s);
    } else {
      const needle = query.toLowerCase();
      test = (s) => s.toLowerCase().includes(needle);
    }
  } catch (e) {
    toast(`Invalid pattern: ${e instanceof Error ? e.message : e}`, { kind: 'error' });
    return;
  }
  const rows: string[][] = [];
  const lines: number[] = [];
  const rowTabs: number[] = [];
  let skipped = 0;
  for (const t of tabs.value) {
    if (t.big || t.locked) {
      skipped += t.big ? 1 : 0;
      continue;
    }
    const doc = docOf(t.id);
    if (!doc) continue;
    let n = 0;
    for (const text of doc.iterLines()) {
      n++;
      if (rows.length >= 50_000) break;
      if (!test(text)) continue;
      rows.push([t.name, String(n), text.length > 400 ? `${text.slice(0, 400)}…` : text]);
      lines.push(n);
      rowTabs.push(t.id);
    }
  }
  openTable({ title: `Find "${query}"`, columns: [plain('file'), plain('line'), plain('text')], rows, lines, total: rows.length }, null, rowTabs);
  if (skipped) toast(`${skipped} large file${skipped === 1 ? ' was' : 's were'} not searched. Use Find inside a large file instead.`, { ms: 5000 });
}

export function countDuplicates(): void {
  const tab = tabs.value.find((t) => t.id === activeId.value);
  const doc = tab && !tab.big ? docOf(tab.id) : undefined;
  if (!tab || !doc) {
    toast('Duplicate lines can be counted in editor tabs, not in large files.', { ms: 4000 });
    return;
  }
  const seen = new Map<string, { count: number; first: number }>();
  let n = 0;
  for (const text of doc.iterLines()) {
    n++;
    if (!text.trim()) continue;
    const hit = seen.get(text);
    if (hit) hit.count++;
    else seen.set(text, { count: 1, first: n });
  }
  const dups = [...seen.entries()].filter(([, v]) => v.count > 1).sort((a, b) => b[1].count - a[1].count || a[1].first - b[1].first);
  const rows = dups.slice(0, 50_000).map(([text, v]) => [String(v.count), String(v.first), text.length > 400 ? `${text.slice(0, 400)}…` : text]);
  openTable({ title: `Duplicate lines · ${tab.name}`, columns: [plain('count', true), plain('first line'), plain('text')], rows, lines: dups.slice(0, 50_000).map(([, v]) => v.first), total: dups.length }, tab.id);
}

// Tables from logs: one table per mined template ("auto tables"), a request
// table for access logs, and pattern-based extraction. Pure (no DOM); runs in
// the worker over stretches of the log, so it works for large files too.
import { FIELD_STRIDE, FLAG_CAUSE, FLAG_ENTRY, FLAG_FRAME, LEVEL_NAMES, type LogIndex } from './logparse';
import { KIND_LITERAL, KIND_MERGED, KIND_PATH, Miner, SKIP, coreSpan, keyLen, messageSpans, mineSpans, oP, oS, tokenize, type Mined, type Tok } from './mine';
import type { WasmEngine } from './wasm';

/** One contiguous part of a log: its bytes, an index relative to them, and where it sits in the file. */
export interface Stretch {
  bytes: Uint8Array;
  ix: LogIndex;
  lineBase: number;
  entryBase: number;
}

export type Walk = (fn: (s: Stretch) => void, progress?: (done: number, total: number) => void) => Promise<void>;

export interface TemplateInfo {
  id: number;
  count: number;
  level: number;
  /** 1-based line of the first entry. */
  firstLine: number;
  tokens: Tok[];
}

export interface Stats {
  min: number;
  avg: number;
  p95: number;
  max: number;
}

export interface Column {
  name: string;
  numeric: boolean;
  stats?: Stats;
}

export interface Table {
  title: string;
  columns: Column[];
  rows: string[][];
  /** 1-based line in the log for each row. */
  lines: number[];
  /** Rows that exist; `rows` is capped at MAX_ROWS. */
  total: number;
  /** A regular expression that matches the lines of this table, for "Filter log to these lines". */
  pattern?: string;
}

export const MAX_ROWS = 200_000;
const dec = new TextDecoder();
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function formatTs(ms: number, withDate: boolean): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const t = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
  return withDate ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${t}` : t;
}

const lineEndOf = (s: Stretch, line: number) => {
  let e = line + 1 < s.ix.level.length ? s.ix.lineStart[line + 1] : s.bytes.length;
  if (e > 0 && s.bytes[e - 1] === 10) e--;
  if (e > 0 && s.bytes[e - 1] === 13) e--;
  return e;
};

// ------------------------------------------------------------------- mining

export interface MineResult {
  mined: Mined;
  templates: TemplateInfo[];
  /** Entries of an access log (they get one request table instead of templates). */
  accessEntries: number;
}

/** Mines the whole log. Uses the Rust engine when there is one. */
export async function mineLog(walk: Walk, wasm: WasmEngine | null, progress?: (done: number, total: number) => void): Promise<MineResult> {
  let rust = wasm;
  if (rust) {
    try {
      rust.mineBegin();
    } catch {
      rust = null;
    }
  }
  const fallback = rust ? null : new Miner();
  const levels: number[] = [];
  const lines: number[] = [];
  let access = 0;
  await walk((s) => {
    const spans = messageSpans(s.bytes, s.ix);
    if (rust) rust.mineChunk(s.bytes, spans);
    else mineSpans(fallback!, s.bytes, spans);
    const n = s.ix.fields.length / FIELD_STRIDE;
    for (let e = 0; e < n; e++) {
      const line = s.ix.fields[e * FIELD_STRIDE];
      levels.push(s.ix.level[line]);
      lines.push(s.lineBase + line + 1);
      if (spans[e * 2] === SKIP) access++;
    }
  }, progress);
  const mined = rust ? rust.mineFinish() : fallback!.finish();
  const templates: TemplateInfo[] = mined.templates.map((t, id) => ({ id, count: t.count, level: levels[t.first] ?? 0, firstLine: lines[t.first] ?? 1, tokens: t.tokens }));
  // Most frequent first; ties in file order.
  templates.sort((a, b) => b.count - a.count || a.firstLine - b.firstLine);
  return { mined, templates, accessEntries: access };
}

// ------------------------------------------------------------ column naming

const clean = (word: string) => word.replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, '');

interface VarColumn {
  pos: number;
  name: string;
}

/** Names the variable positions of a template from the words around them. */
export function nameColumns(tokens: Tok[], sample: string[] = []): VarColumn[] {
  const out: VarColumn[] = [];
  const used = new Map<string, number>();
  const wordBefore = (i: number): string => {
    for (let k = i - 1; k >= 0 && k >= i - 3; k--) {
      if (tokens[k].kind !== KIND_LITERAL) return '';
      const w = clean(tokens[k].text);
      if (w) return w;
    }
    return '';
  };
  const wordAfter = (i: number): string => {
    const t = tokens[i + 1];
    return t && t.kind === KIND_LITERAL ? clean(t.text) : '';
  };
  tokens.forEach((t, i) => {
    if (t.kind === KIND_LITERAL) return;
    let name = '';
    const kv = /^[[({<]?([A-Za-z_][\w.-]*)=<\*>([A-Za-z%]{0,3})/.exec(t.text);
    const unit = /<\*>([A-Za-z%]{1,3})/.exec(t.text);
    if (t.kind === KIND_PATH) name = 'path';
    else if (kv) name = kv[2] ? `${kv[1]} (${kv[2]})` : kv[1];
    else {
      const value = sample[out.length] ?? '';
      const before = wordBefore(i);
      if (/^[A-Za-z0-9_.-]+:\d{2,5}$/.test(value) && !/^\d+$/.test(value.split(':')[0])) name = 'host';
      else name = before || wordAfter(i) || 'value';
      if (unit) name = `${name} (${unit[1]})`;
    }
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    out.push({ pos: i, name: seen ? `${name} ${seen + 1}` : name });
  });
  return out;
}

/** The value of one raw token at a variable position: no brackets, no key, no unit, no quotes. */
function tokenValue(bytes: Uint8Array, a: number, n: number, kind: number): string {
  coreSpan(bytes, a, n);
  let p = oP;
  let s = oS;
  if (kind !== KIND_PATH) {
    const k = keyLen(bytes, p, s);
    if (k > 0) p += k + 1;
  }
  let v = dec.decode(bytes.subarray(p, s));
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) v = v.slice(1, -1);
  else {
    const m = /^([-+]?\d+(?:[.,]\d+)*)([A-Za-z]{1,3}|%)$/.exec(v);
    if (m) v = m[1];
  }
  return v;
}

function numberOf(v: string): number {
  if (!v || !/^[-+]?\d[\d,]*(?:\.\d+)?$/.test(v)) return NaN;
  return Number(v.replace(/,/g, ''));
}

/** Marks numeric columns and adds min / avg / p95 / max. `skip` columns are never numeric (line numbers, ids). */
export function finishColumns(names: string[], rows: string[][], skip: Set<number> = new Set()): Column[] {
  return names.map((name, c) => {
    if (skip.has(c)) return { name, numeric: false };
    const nums: number[] = [];
    let filled = 0;
    for (const r of rows) {
      const v = r[c];
      if (v === '' || v === undefined) continue;
      filled++;
      const x = numberOf(v);
      if (Number.isNaN(x)) return { name, numeric: false };
      nums.push(x);
    }
    if (!filled) return { name, numeric: false };
    // Identifiers and positions are numbers, but their average means nothing.
    if (/(^|[^a-z])(id|offset|partition|port|status|code|key|pid|line|version|seq|number|no)$/i.test(name.replace(/ \d+$/, '')) || /Id$/.test(name)) return { name, numeric: true };
    nums.sort((a, b) => a - b);
    const sum = nums.reduce((a, b) => a + b, 0);
    return { name, numeric: true, stats: { min: nums[0], max: nums[nums.length - 1], avg: sum / nums.length, p95: nums[Math.min(nums.length - 1, Math.ceil(nums.length * 0.95) - 1)] } };
  });
}

/** Drops columns whose value never changes (used for time-less logs, single threads and so on). */
function varying(rows: string[][], c: number): boolean {
  if (!rows.length) return false;
  const first = rows[0][c];
  for (const r of rows) if (r[c] !== first) return true;
  return false;
}

const JSON_KNOWN = new Set(['@timestamp', 'timestamp', 'time', 'ts', 'date', 'datetime', 't', 'level', 'severity', 'log.level', 'lvl', 'loglevel', 'levelname', 'logger', 'logger_name', 'loggerName', 'log.logger', 'thread', 'thread_name', 'threadName', 'process.thread.name', 'traceId', 'trace_id', 'trace.id', 'traceid', 'dd.trace_id', 'message', 'msg', 'log', 'stack_trace', '@version']);

function templateRegex(tokens: Tok[]): string {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return tokens
    .map((t) => {
      if (t.kind === KIND_LITERAL) return esc(t.text);
      if (t.kind === KIND_MERGED) return '\\S+';
      if (t.kind === KIND_PATH) return esc(t.text).replace(/\\\{id\\\}/g, '[^/\\s?]+') + '\\S*';
      return esc(t.text).replace(/<\\\*>/g, '.+?');
    })
    .join('\\s+');
}

export const templateTitle = (tokens: Tok[]) => tokens.map((t) => t.text).join(' ');

/** Builds the table of one template: a row per entry, in file order. */
export async function templateTable(walk: Walk, result: MineResult, id: number, progress?: (done: number, total: number) => void): Promise<Table> {
  const tpl = result.mined.templates[id];
  const ids = result.mined.ids;
  const tokens = tpl.tokens;
  const varPos = tokens.map((t, i) => (t.kind === KIND_LITERAL ? -1 : i)).filter((i) => i >= 0);
  // Fixed leading columns, then the variables, then trailing context columns.
  const HEAD = ['line', 'time', 'level', 'thread', 'logger'];
  const TAIL = ['trace', 'exception', 'caused by'];
  const rows: string[][] = [];
  const lines: number[] = [];
  const jsonKeys: string[] = [];
  const jsonRows: Record<string, string>[] = [];
  let total = 0;
  let firstTs = NaN;
  let lastTs = NaN;
  const stamps: number[] = [];

  await walk((s) => {
    const { bytes, ix } = s;
    const n = ix.fields.length / FIELD_STRIDE;
    const isJson = ix.summary[2] === 3;
    let spans: Uint32Array | null = null;
    for (let e = 0; e < n; e++) {
      if (ids[s.entryBase + e] !== id) continue;
      total++;
      if (rows.length >= MAX_ROWS) continue;
      spans ??= messageSpans(bytes, ix);
      const o = e * FIELD_STRIDE;
      const line = ix.fields[o];
      const field = (k: number) => (ix.fields[o + k + 1] ? dec.decode(bytes.subarray(ix.fields[o + k], ix.fields[o + k] + ix.fields[o + k + 1])) : '');
      const ts = ix.ts[line];
      if (Number.isFinite(ts)) {
        if (Number.isNaN(firstTs)) firstTs = ts;
        lastTs = ts;
      }
      stamps.push(ts);
      const row: string[] = [String(s.lineBase + line + 1), '', LEVEL_NAMES[ix.level[line]], field(1), field(3)];
      const a = spans[e * 2];
      const z = Math.min(spans[e * 2 + 1], a + 800);
      const tk = tokenize(bytes, a, z);
      for (const p of varPos) row.push(p * 2 + 1 < tk.length ? tokenValue(bytes, tk[p * 2], tk[p * 2 + 1], tokens[p].kind) : '');
      // Context from the lines that follow the entry.
      let exception = '';
      let cause = '';
      for (let l = line + 1; l < ix.level.length && !(ix.flags[l] & FLAG_ENTRY) && l < line + 400; l++) {
        if (ix.flags[l] & FLAG_FRAME) continue;
        const text = dec.decode(bytes.subarray(ix.lineStart[l], Math.min(lineEndOf(s, l), ix.lineStart[l] + 240))).trim();
        if (ix.flags[l] & FLAG_CAUSE) {
          if (!cause) cause = text.replace(/^(Caused by|Suppressed):\s*/, '');
        } else if (!exception) {
          const m = /^(?:\[[^\]]*\]\s*)?([A-Za-z_$][\w$.]*(?:Exception|Error|Throwable|Failure)\b[\w$]*)/.exec(text);
          if (m) exception = m[1];
        }
      }
      row.push(field(5), exception, cause);
      if (isJson) {
        const obj: Record<string, string> = {};
        try {
          const parsed = JSON.parse(dec.decode(bytes.subarray(ix.lineStart[line], lineEndOf(s, line)))) as Record<string, unknown>;
          for (const [k, v] of Object.entries(parsed)) {
            if (JSON_KNOWN.has(k) || v === null || typeof v === 'object') continue;
            obj[k] = String(v);
            if (!jsonKeys.includes(k) && jsonKeys.length < 24) jsonKeys.push(k);
          }
        } catch {
          /* not valid JSON: no extra fields for this row */
        }
        jsonRows.push(obj);
      }
      rows.push(row);
      lines.push(s.lineBase + line + 1);
    }
  }, progress);

  const withDate = Number.isFinite(firstTs) && Math.floor(firstTs / 86_400_000) !== Math.floor(lastTs / 86_400_000);
  rows.forEach((r, i) => (r[1] = formatTs(stamps[i], withDate)));
  const sample = rows[0] ? rows[0].slice(HEAD.length, HEAD.length + varPos.length) : [];
  const names = [...HEAD, ...nameColumns(tokens, sample).map((c) => c.name), ...TAIL, ...jsonKeys];
  if (jsonKeys.length) rows.forEach((r, i) => jsonKeys.forEach((k) => r.push(jsonRows[i]?.[k] ?? '')));

  // Keep: line always; time/level/thread/logger only when they vary; trailing context only when present.
  const fixedEnd = HEAD.length + varPos.length;
  const keep = names.map((_, c) => {
    if (c === 0) return true;
    if (c < HEAD.length) return c === 1 ? rows.some((r) => r[1] !== '') && varying(rows, 1) : varying(rows, c);
    if (c >= fixedEnd && c < fixedEnd + TAIL.length) return rows.some((r) => r[c] !== '');
    return true;
  });
  const cols = names.filter((_, c) => keep[c]);
  const data = rows.map((r) => r.filter((_, c) => keep[c]));
  return { title: templateTitle(tokens), columns: finishColumns(cols, data, new Set([0])), rows: data, lines, total, pattern: templateRegex(tokens) };
}

// ------------------------------------------------------------- access logs

const ACCESS = /^(\S+) \S+ (\S+) \[[^\]]+\] "(\S+) (\S+)(?: (\S+))?" (\d{3}) (\S+)(?: "([^"]*)" "([^"]*)")?/;

/** /api/orders/90001?x=1 -> /api/orders/{id} */
export function routeOf(path: string): string {
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (/\d/.test(seg) ? '{id}' : seg))
    .join('/');
}

export async function accessTable(walk: Walk, progress?: (done: number, total: number) => void): Promise<Table> {
  const names = ['line', 'time', 'ip', 'user', 'method', 'route', 'path', 'status', 'bytes', 'referrer', 'agent'];
  const rows: string[][] = [];
  const lines: number[] = [];
  let total = 0;
  await walk((s) => {
    const n = s.ix.fields.length / FIELD_STRIDE;
    for (let e = 0; e < n; e++) {
      const line = s.ix.fields[e * FIELD_STRIDE];
      const m = ACCESS.exec(dec.decode(s.bytes.subarray(s.ix.lineStart[line], lineEndOf(s, line))));
      if (!m) continue;
      total++;
      if (rows.length >= MAX_ROWS) continue;
      rows.push([String(s.lineBase + line + 1), formatTs(s.ix.ts[line], false), m[1], m[2] === '-' ? '' : m[2], m[3], routeOf(m[4]), m[4], m[6], m[7] === '-' ? '' : m[7], m[8] && m[8] !== '-' ? m[8] : '', m[9] ?? '']);
      lines.push(s.lineBase + line + 1);
    }
  }, progress);
  const keep = names.map((_, c) => c < 9 || rows.some((r) => r[c] !== ''));
  return { title: 'Requests', columns: finishColumns(names.filter((_, c) => keep[c]), rows.map((r) => r.filter((_, c) => keep[c])), new Set([0, 7])), rows: rows.map((r) => r.filter((_, c) => keep[c])), lines, total };
}

// --------------------------------------------------------------- extraction

export interface ExtractSpec {
  preset: 'times' | 'sql' | 'kafka' | 'ips' | 'timestamps' | 'custom';
  /** For 'custom': a regular expression; named groups become columns. */
  regex?: string;
  flags?: string;
}

export const PRESET_TITLES: Record<ExtractSpec['preset'], string> = {
  times: 'Response times',
  sql: 'SQL statements',
  kafka: 'Kafka offsets',
  ips: 'IP addresses',
  timestamps: 'Timestamps',
  custom: 'Custom pattern',
};

interface Extractor {
  names: string[];
  /** Zero or more rows for one line. */
  run: (text: string) => string[][];
}

const UNIT_MS: Record<string, number> = { ms: 1, s: 1000, sec: 1000, seconds: 1000, us: 0.001, µs: 0.001, ns: 0.000001, m: 60000, min: 60000 };

function extractor(spec: ExtractSpec): Extractor {
  switch (spec.preset) {
    case 'times': {
      const re = /(?:\b(took|in|elapsed|duration|time|latency|after|delta)[=: ]\s*|\()(\d+(?:\.\d+)?)\s?(ms|µs|us|ns|sec|seconds|s|min|m)\b/i;
      return {
        names: ['ms', 'what', 'text'],
        run: (t) => {
          const m = re.exec(t);
          if (!m) return [];
          const ms = Number(m[2]) * (UNIT_MS[m[3].toLowerCase()] ?? 1);
          return [[String(Math.round(ms * 1000) / 1000), (m[1] ?? '').toLowerCase(), t.slice(Math.max(0, m.index - 90), m.index + m[0].length + 30).trim()]];
        },
      };
    }
    case 'sql': {
      const re = /\b(select|insert\s+into|update|delete\s+from|merge\s+into)\b.*$/i;
      return {
        names: ['operation', 'table', 'statement'],
        run: (t) => {
          const m = re.exec(t);
          if (!m) return [];
          const sql = m[0].trim();
          const op = m[1].split(/\s+/)[0].toUpperCase();
          const table = /\b(?:from|into|update|join)\s+([A-Za-z_][\w.$]*)/i.exec(sql)?.[1] ?? '';
          // "select" alone in prose is not SQL: require a table or a typical keyword after it.
          if (!table && !/\b(where|values|set)\b/i.test(sql)) return [];
          return [[op, table, sql.slice(0, 600)]];
        },
      };
    }
    case 'kafka': {
      return {
        names: ['topic', 'partition', 'offset', 'key', 'text'],
        run: (t) => {
          const topic = /\btopic[=: ]+"?([\w.-]+)/i.exec(t);
          const offset = /\boffset[=: ]+(\d+)/i.exec(t);
          const tp = /\b([\w.]+)-(\d+)@(\d+)\b/.exec(t);
          if (!((topic && offset) || tp)) return [];
          const partition = /\bpartition[=: ]+(\d+)/i.exec(t);
          const key = /\bkey[=: ]+"?([^\s",]+)/i.exec(t);
          return [[topic?.[1] ?? tp?.[1] ?? '', partition?.[1] ?? tp?.[2] ?? '', offset?.[1] ?? tp?.[3] ?? '', key?.[1] ?? '', t.slice(0, 200)]];
        },
      };
    }
    case 'ips': {
      const re = /(?<![\d.])((?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3})(?::(\d{2,5}))?(?![\d.])/g;
      return {
        names: ['ip', 'port', 'text'],
        run: (t) => {
          const out: string[][] = [];
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(t)) && out.length < 8) out.push([m[1], m[2] ?? '', t.slice(0, 200)]);
          return out;
        },
      };
    }
    case 'timestamps':
      return { names: ['text'], run: (t) => [[t.slice(0, 300)]] };
    case 'custom': {
      const re = new RegExp(spec.regex ?? '', (spec.flags ?? '').replace(/[gy]/g, ''));
      if (re.test('')) throw new Error('The pattern matches empty text, so it would match every line.');
      const groups = [...(spec.regex ?? '').matchAll(/\(\?<([A-Za-z_]\w*)>/g)].map((m) => m[1]);
      const count = new RegExp(`${re.source}|`).exec('')!.length - 1;
      const names = groups.length ? groups : count ? Array.from({ length: count }, (_, i) => `group ${i + 1}`) : ['match'];
      return {
        names,
        run: (t) => {
          const m = re.exec(t);
          if (!m) return [];
          if (groups.length) return [groups.map((g) => m.groups?.[g] ?? '')];
          return [count ? m.slice(1).map((v) => v ?? '') : [m[0]]];
        },
      };
    }
  }
}

/** Runs a preset or custom pattern over every line. Throws an Error with a plain message for a bad pattern. */
export async function extractTable(walk: Walk, spec: ExtractSpec, progress?: (done: number, total: number) => void): Promise<Table> {
  const ex = extractor(spec);
  const entriesOnly = spec.preset === 'timestamps';
  const rows: string[][] = [];
  const lines: number[] = [];
  let total = 0;
  let anyTime = false;
  await walk((s) => {
    const { bytes, ix } = s;
    const n = ix.level.length;
    // Single-byte text can be decoded once and sliced; otherwise decode line by line.
    const whole = dec.decode(bytes);
    const fast = whole.length === bytes.length;
    for (let l = 0; l < n; l++) {
      if (entriesOnly && !(ix.flags[l] & FLAG_ENTRY)) continue;
      const a = ix.lineStart[l];
      const z = lineEndOf(s, l);
      if (z <= a) continue;
      const text = fast ? whole.slice(a, z) : dec.decode(bytes.subarray(a, z));
      const found = ex.run(text);
      if (!found.length) continue;
      const time = formatTs(ix.ts[l], false);
      if (time) anyTime = true;
      for (const f of found) {
        total++;
        if (rows.length >= MAX_ROWS) continue;
        rows.push([String(s.lineBase + l + 1), time, LEVEL_NAMES[ix.level[l]], ...f]);
        lines.push(s.lineBase + l + 1);
      }
    }
  }, progress);
  const names = ['line', 'time', 'level', ...ex.names];
  const keep = names.map((_, c) => c === 0 || c > 2 || (c === 1 ? anyTime : rows.some((r) => r[2] !== '')));
  const data = rows.map((r) => r.filter((_, c) => keep[c]));
  return { title: spec.preset === 'custom' ? `/${spec.regex}/` : PRESET_TITLES[spec.preset], columns: finishColumns(names.filter((_, c) => keep[c]), data, new Set([0])), rows: data, lines, total, pattern: spec.preset === 'custom' ? spec.regex : undefined };
}

// ----------------------------------------------------------------- page side

/** Counts how often each value of a column occurs, most frequent first. */
export function countBy(table: Table, column: number): Table {
  const counts = new Map<string, number>();
  for (const r of table.rows) counts.set(r[column], (counts.get(r[column]) ?? 0) + 1);
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([v, n]) => [v, String(n), `${((n / table.rows.length) * 100).toFixed(1)}%`]);
  const name = table.columns[column].name;
  return { title: `Count by ${name}`, columns: [{ name, numeric: false }, { name: 'count', numeric: true }, { name: 'share', numeric: false }], rows, lines: [], total: rows.length };
}

export function toCsv(table: Table): string {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [table.columns.map((c) => cell(c.name)).join(','), ...table.rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n';
}

export function toTsv(table: Table): string {
  const cell = (v: string) => v.replace(/[\t\r\n]+/g, ' ');
  return [table.columns.map((c) => cell(c.name)).join('\t'), ...table.rows.map((r) => r.map(cell).join('\t'))].join('\n');
}

export function toHtml(table: Table, maxRows = 5000): string {
  const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const th = 'style="border:1px solid #999;padding:4px 8px;background:#eee;text-align:left;font-weight:600"';
  const td = (num: boolean) => `style="border:1px solid #999;padding:4px 8px${num ? ';text-align:right' : ''}"`;
  const head = `<tr>${table.columns.map((c) => `<th ${th}>${esc(c.name)}</th>`).join('')}</tr>`;
  const body = table.rows
    .slice(0, maxRows)
    .map((r) => `<tr>${r.map((v, c) => `<td ${td(table.columns[c].numeric)}>${esc(v)}</td>`).join('')}</tr>`)
    .join('');
  return `<table style="border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:10pt"><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

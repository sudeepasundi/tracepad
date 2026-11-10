// Filtering and error grouping over a parsed log. Pure (no DOM); runs in the
// worker. Regular expressions use JavaScript syntax on purpose, so a pattern
// behaves the same here as in the find box.
import { FIELD_STRIDE, FLAG_ENTRY, FLAG_FRAME, LV, type LogIndex } from './logparse';

export interface FilterSpec {
  /** Levels to show (0 = lines without a level); null = all. */
  levels: number[] | null;
  text: string;
  regex: boolean;
  caseSensitive: boolean;
  /** "Lines matching": plain text, or /regex/flags. */
  patterns: string[];
  patternsMode: 'any' | 'all';
  /** Matches the logger or the thread name. */
  logger: string;
  trace: string;
  from: string;
  to: string;
}

export const EMPTY_FILTER: FilterSpec = { levels: null, text: '', regex: false, caseSensitive: false, patterns: [], patternsMode: 'any', logger: '', trace: '', from: '', to: '' };

export function isEmptyFilter(f: FilterSpec): boolean {
  return f.levels === null && !f.text && f.patterns.every((p) => !p.trim()) && !f.logger.trim() && !f.trace.trim() && !f.from.trim() && !f.to.trim();
}

/** True when the filter has to look at the text of the log, not just at the index. */
export function needsBytes(f: FilterSpec): boolean {
  return !!f.text || f.patterns.some((p) => p.trim()) || !!f.logger.trim() || !!f.trace.trim();
}

export interface FilterResult {
  /** 1 = line is shown. */
  mask: Uint8Array;
  shownEntries: number;
  totalEntries: number;
  /** Set when a pattern or a time could not be understood; nothing is hidden then. */
  error?: string;
}

const DAY = 86_400_000;

/**
 * "10:15", "10:15:30", "10:15:30.250", "2026-03-14", "2026-03-14 10:15[:30[.250]]".
 * A time without a date is taken on `baseDay` (the day the log starts).
 * `end` rounds up to the end of the stated precision, so To "10:15" includes 10:15:59.
 */
export function parseTime(input: string, baseDay: number, end = false): number | null {
  const s = input.trim().replace('T', ' ').replace(/\//g, '-');
  if (!s) return null;
  const m = /^(?:(\d{4})-(\d{1,2})-(\d{1,2}))?\s*(?:(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,3}))?)?)?$/.exec(s);
  if (!m || (m[1] === undefined && m[4] === undefined)) return null;
  let day = Number.isFinite(baseDay) ? Math.floor(baseDay / DAY) * DAY : 0;
  if (m[1] !== undefined) {
    const y = +m[1];
    const mo = +m[2];
    const d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    day = Date.UTC(y, mo - 1, d);
  }
  if (m[4] === undefined) return end ? day + DAY - 1 : day;
  const h = +m[4];
  const mi = +m[5];
  const sec = m[6] === undefined ? 0 : +m[6];
  if (h > 23 || mi > 59 || sec > 59) return null;
  const ms = m[7] === undefined ? 0 : +m[7].padEnd(3, '0');
  let t = day + ((h * 60 + mi) * 60 + sec) * 1000 + ms;
  if (end) t += m[6] === undefined ? 59_999 : m[7] === undefined ? 999 : 0;
  return t;
}

type Test = (text: string) => boolean;

/** Plain text (case-insensitive) or /regex/flags. Throws on a bad regex. */
export function compilePattern(p: string): Test {
  const m = /^\/(.+)\/([a-z]*)$/.exec(p.trim());
  if (m) {
    const re = new RegExp(m[1], m[2].replace(/[gy]/g, ''));
    return (t) => re.test(t);
  }
  const needle = p.trim().toLowerCase();
  return (t) => t.toLowerCase().includes(needle);
}

function includesCi(bytes: Uint8Array, off: number, len: number, needle: Uint8Array): boolean {
  const n = needle.length;
  if (n === 0) return true;
  outer: for (let i = off; i + n <= off + len; i++) {
    for (let k = 0; k < n; k++) {
      let b = bytes[i + k];
      if (b >= 65 && b <= 90) b += 32;
      if (b !== needle[k]) continue outer;
    }
    return true;
  }
  return false;
}

const lowerBytes = (s: string) => new TextEncoder().encode(s.trim().toLowerCase());

export function applyFilter(bytes: Uint8Array, ix: LogIndex, f: FilterSpec): FilterResult {
  const lines = ix.level.length;
  const entryCount = ix.fields.length / FIELD_STRIDE;
  const all = (error?: string): FilterResult => ({ mask: new Uint8Array(lines).fill(1), shownEntries: entryCount, totalEntries: entryCount, error });
  if (isEmptyFilter(f)) return all();

  const baseDay = ix.summary[4];
  const from = f.from.trim() ? parseTime(f.from, baseDay) : null;
  const to = f.to.trim() ? parseTime(f.to, baseDay, true) : null;
  if (f.from.trim() && from === null) return all(`"${f.from.trim()}" is not a time. Use 10:15, 10:15:30 or 2026-03-14 10:15.`);
  if (f.to.trim() && to === null) return all(`"${f.to.trim()}" is not a time. Use 10:15, 10:15:30 or 2026-03-14 10:15.`);

  let textTest: Test | null = null;
  const patternTests: Test[] = [];
  try {
    if (f.text) {
      if (f.regex) {
        const re = new RegExp(f.text, f.caseSensitive ? '' : 'i');
        textTest = (t) => re.test(t);
      } else if (f.caseSensitive) textTest = (t) => t.includes(f.text);
      else {
        const needle = f.text.toLowerCase();
        textTest = (t) => t.toLowerCase().includes(needle);
      }
    }
    for (const p of f.patterns) if (p.trim()) patternTests.push(compilePattern(p));
  } catch (e) {
    return all(`Invalid pattern: ${e instanceof Error ? e.message : String(e)}`);
  }

  const levelOk = f.levels ? new Uint8Array(7) : null;
  if (levelOk) for (const l of f.levels!) levelOk[l] = 1;
  const logger = f.logger.trim() ? lowerBytes(f.logger) : null;
  const trace = f.trace.trim() ? lowerBytes(f.trace) : null;
  // Plain, case-insensitive ASCII text is searched in the bytes directly: no decoding.
  const textBytes = f.text && !f.regex && !f.caseSensitive && /^[\x20-\x7e]+$/.test(f.text) ? new TextEncoder().encode(f.text.toLowerCase()) : null;
  if (textBytes) textTest = null;
  const needText = textTest !== null || patternTests.length > 0;
  const decoder = new TextDecoder();
  const mask = new Uint8Array(lines);
  let shown = 0;

  const lineEnd = (line: number) => (line + 1 < lines ? ix.lineStart[line + 1] : bytes.length);

  const check = (firstLine: number, lastLine: number, e: number): boolean => {
    const level = ix.level[firstLine];
    if (levelOk && !levelOk[level]) return false;
    const ts = ix.ts[firstLine];
    if (from !== null && !(ts >= from)) return false;
    if (to !== null && !(ts <= to)) return false;
    if (logger) {
      if (e < 0) return false;
      const o = e * FIELD_STRIDE;
      if (!includesCi(bytes, ix.fields[o + 1], ix.fields[o + 2], logger) && !includesCi(bytes, ix.fields[o + 3], ix.fields[o + 4], logger)) return false;
    }
    if (trace) {
      if (e < 0) return false;
      const o = e * FIELD_STRIDE;
      const hasField = ix.fields[o + 6] > 0;
      const start = ix.lineStart[firstLine];
      if (hasField ? !includesCi(bytes, ix.fields[o + 5], ix.fields[o + 6], trace) : !includesCi(bytes, start, lineEnd(firstLine) - start, trace)) return false;
    }
    if (textBytes) {
      const s = ix.lineStart[firstLine];
      if (!includesCi(bytes, s, lineEnd(lastLine) - s, textBytes)) return false;
    }
    if (needText) {
      const text = decoder.decode(bytes.subarray(ix.lineStart[firstLine], lineEnd(lastLine)));
      if (textTest && !textTest(text)) return false;
      if (patternTests.length) {
        const ok = f.patternsMode === 'all' ? patternTests.every((t) => t(text)) : patternTests.some((t) => t(text));
        if (!ok) return false;
      }
    }
    return true;
  };

  // Lines before the first entry (a banner, a header) behave as one entry without a level or time.
  const firstEntryLine = entryCount ? ix.fields[0] : lines;
  if (firstEntryLine > 0 && check(0, firstEntryLine - 1, -1)) mask.fill(1, 0, firstEntryLine);
  for (let e = 0; e < entryCount; e++) {
    const first = ix.fields[e * FIELD_STRIDE];
    const last = (e + 1 < entryCount ? ix.fields[(e + 1) * FIELD_STRIDE] : lines) - 1;
    if (check(first, last, e)) {
      mask.fill(1, first, last + 1);
      shown++;
    }
  }
  return { mask, shownEntries: shown, totalEntries: entryCount };
}

// ----------------------------------------------------------- repeated errors

export interface ErrorGroup {
  level: number;
  count: number;
  /** 1-based line of the first and the most recent occurrence. */
  firstLine: number;
  lastLine: number;
  /** One real message from the group. */
  sample: string;
  /** Exception class from the stack trace, if there is one. */
  exception: string;
  /** All first lines (1-based), capped; for stepping through occurrences. */
  lines: number[];
}

/** Replaces the variable parts of a message so repeats compare equal. */
export function normaliseMessage(s: string): string {
  return s
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<id>')
    .replace(/"[^"]*"|'[^']*'/g, '<str>')
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, '<hex>')
    .replace(/\d+(?:[.,]\d+)*/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
}

export function groupErrors(bytes: Uint8Array, ix: LogIndex, minLevel: number = LV.WARN, maxGroups = 300): ErrorGroup[] {
  const groups = new Map<string, ErrorGroup>();
  collectGroups(groups, bytes, ix, 0, minLevel);
  return finishGroups(groups, maxGroups);
}

export function finishGroups(groups: Map<string, ErrorGroup>, maxGroups = 300): ErrorGroup[] {
  return [...groups.values()].sort((a, b) => b.level - a.level || b.count - a.count || a.firstLine - b.firstLine).slice(0, maxGroups);
}

/** Adds the errors of one stretch of a log to `groups`; `lineBase` is the stretch's first line (0-based) in the file. */
export function collectGroups(groups: Map<string, ErrorGroup>, bytes: Uint8Array, ix: LogIndex, lineBase: number, minLevel: number = LV.WARN): void {
  const lines = ix.level.length;
  const entryCount = ix.fields.length / FIELD_STRIDE;
  const decoder = new TextDecoder();
  const lineEnd = (line: number) => {
    let e = line + 1 < lines ? ix.lineStart[line + 1] - 1 : bytes.length;
    if (e > 0 && bytes[e - 1] === 13) e--;
    return e;
  };
  for (let e = 0; e < entryCount; e++) {
    const o = e * FIELD_STRIDE;
    const first = ix.fields[o];
    const level = ix.level[first];
    if (level < minLevel) continue;
    const msgEnd = lineEnd(first);
    const message = decoder.decode(bytes.subarray(Math.min(ix.fields[o + 7], msgEnd), Math.min(msgEnd, ix.fields[o + 7] + 400)));
    // Exception class: the first continuation line that is not a stack frame.
    let exception = '';
    const next = first + 1;
    if (next < lines && !(ix.flags[next] & FLAG_ENTRY) && !(ix.flags[next] & FLAG_FRAME)) {
      const head = decoder.decode(bytes.subarray(ix.lineStart[next], Math.min(lineEnd(next), ix.lineStart[next] + 200))).trim();
      const m = /^(?:\[[^\]]*\]\s*)?([A-Za-z_$][\w$.]*(?:Exception|Error|Throwable|Failure)\b[\w$]*)/.exec(head);
      if (m) exception = m[1];
    }
    const key = `${level}|${exception}|${normaliseMessage(message)}`;
    const g = groups.get(key);
    if (g) {
      g.count++;
      g.lastLine = lineBase + first + 1;
      if (g.lines.length < 500) g.lines.push(lineBase + first + 1);
    } else if (groups.size < 5000) groups.set(key, { level, count: 1, firstLine: lineBase + first + 1, lastLine: lineBase + first + 1, sample: message.trim(), exception, lines: [lineBase + first + 1] });
  }
}

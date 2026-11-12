// Highlight rules: the ready-made ones and the user's own, compiled into
// regular expressions, plus a function that finds what to mark in one line.
// Pure (no DOM): shared by the editor and the large-file viewer, unit-tested.

export interface UserRule {
  id: number;
  pattern: string;
  regex: boolean;
  /** 0-5: one of six highlight colours. */
  color: number;
  on: boolean;
}

export interface PresetRule {
  id: string;
  name: string;
  /** What it marks, shown under the name. */
  example: string;
  pattern: string;
  flags: string;
  color: number;
  /** On until the user switches it off. */
  defaultOn: boolean;
}

/** Ready-made rules for Java and Spring Boot logs. */
export const PRESET_RULES: PresetRule[] = [
  {
    id: 'exceptions',
    name: 'Exception and error classes',
    example: 'NullPointerException, java.sql.SQLException',
    pattern: String.raw`\b(?:[a-z_$][\w$]*\.)*[A-Z][\w$]*(?:Exception|Error)\b`,
    flags: 'g',
    color: 3,
    defaultOn: true,
  },
  {
    id: 'http',
    name: 'HTTP 4xx and 5xx statuses',
    example: 'status=503, "GET /api HTTP/1.1" 404, 500 INTERNAL_SERVER_ERROR',
    pattern: String.raw`\b(?:status(?:[_ -]?code)?|http[_.-]?status|response[_.-]?code)"?\s*[=:]\s*"?[45]\d\d\b|(?<=HTTP\/\d(?:\.\d)?"\s)[45]\d\d\b|\b[45]\d\d\s(?:BAD_REQUEST|UNAUTHORIZED|FORBIDDEN|NOT_FOUND|METHOD_NOT_ALLOWED|CONFLICT|TOO_MANY_REQUESTS|INTERNAL_SERVER_ERROR|BAD_GATEWAY|SERVICE_UNAVAILABLE|GATEWAY_TIMEOUT|Bad Request|Unauthorized|Forbidden|Not Found|Conflict|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b`,
    flags: 'gi',
    color: 4,
    defaultOn: true,
  },
  {
    id: 'slow',
    name: 'Slow: 500 ms or more',
    example: 'took 1840ms, in 2.3 s, (612 ms)',
    // (?<![\d.]): "0.4 s" is not "4 s".
    pattern: String.raw`(?<![\d.])\b(?:[5-9]\d\d|[1-9]\d{3,})(?:\.\d+)?\s?ms\b|(?<![\d.])\b(?:[1-9]\d*)(?:\.\d+)?\s?(?:s|sec|secs|seconds)\b(?![\w-])`,
    flags: 'gi',
    color: 0,
    defaultOn: true,
  },
  {
    id: 'trouble',
    name: 'Timeouts, refusals and retries',
    example: 'timed out, Connection refused, retrying, deadlock',
    pattern: String.raw`\b(?:timeout|timed out|time-out|connection refused|refused|unavailable|unreachable|deadlock(?:ed)?|out of memory|retry(?:ing)?|retries|circuit(?:breaker)? (?:is )?open|rejected|rolled back|rollback)\b`,
    flags: 'gi',
    color: 5,
    defaultOn: true,
  },
  {
    id: 'trace',
    name: 'Trace and span IDs',
    example: '4bf92f3577b34da6a3ce929d0e0e4736',
    pattern: String.raw`\b[0-9a-f]{32}\b|\b[0-9a-f]{16}\b`,
    flags: 'g',
    color: 2,
    defaultOn: false,
  },
  {
    id: 'ip',
    name: 'IP addresses',
    example: '10.0.4.17:8080',
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)(?::\d{2,5})?\b`,
    flags: 'g',
    color: 1,
    defaultOn: false,
  },
  {
    id: 'sql',
    name: 'SQL statements',
    example: 'SELECT, INSERT INTO, UPDATE, DELETE FROM',
    pattern: String.raw`\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM|MERGE INTO)\b`,
    flags: 'g',
    color: 2,
    defaultOn: false,
  },
];

export interface CompiledRule {
  re: RegExp;
  color: number;
}

export function presetOn(rule: PresetRule, choices: Record<string, boolean>): boolean {
  return choices[rule.id] ?? rule.defaultOn;
}

/** User rules first (they win where rules overlap), then the ready-made ones that are on. */
export function compileRules(user: readonly UserRule[], choices: Record<string, boolean>): CompiledRule[] {
  const out: CompiledRule[] = [];
  const add = (source: string, flags: string, color: number) => {
    try {
      const re = new RegExp(source, flags.includes('g') ? flags : `${flags}g`);
      if (re.test('')) return; // matches the empty string: would loop forever
      re.lastIndex = 0;
      out.push({ re, color: ((color % 6) + 6) % 6 });
    } catch {
      /* an invalid pattern is simply not applied; the panel marks it */
    }
  };
  for (const r of user) if (r.on && r.pattern) add(r.regex ? r.pattern : r.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi', r.color);
  for (const p of PRESET_RULES) if (presetOn(p, choices)) add(p.pattern, p.flags, p.color);
  return out;
}

export interface Mark {
  from: number;
  to: number;
  color: number;
}

/**
 * Where the rules match in `text` (one or a few lines), without overlaps:
 * a match that starts inside an earlier one is dropped, and on equal starts
 * the earlier rule wins. Sorted by position.
 */
export function findMarks(text: string, rules: readonly CompiledRule[], limit = 2000): Mark[] {
  const found: (Mark & { rank: number })[] = [];
  rules.forEach((rule, rank) => {
    rule.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = rule.re.exec(text)) && guard++ < limit) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      if (!m[0].includes('\n')) found.push({ from: m.index, to: m.index + m[0].length, color: rule.color, rank });
    }
  });
  found.sort((a, b) => a.from - b.from || a.rank - b.rank || b.to - a.to);
  const out: Mark[] = [];
  let end = -1;
  for (const f of found) {
    if (f.from < end) continue;
    out.push({ from: f.from, to: f.to, color: f.color });
    end = f.to;
  }
  return out;
}

/** Colour number of the filter's own marks (drawn like find matches, not with a highlighter ink). */
export const FILTER_MARK = 6;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The text filter and "lines matching" patterns as one rule, so the shown
 * lines can mark why they were kept. Null when the filter has no text.
 */
export function filterRule(f: { text: string; regex: boolean; caseSensitive: boolean; patterns: readonly string[] }): CompiledRule | null {
  const parts: string[] = [];
  let ignoreCase = !f.caseSensitive;
  if (f.text) parts.push(f.regex ? `(?:${f.text})` : escape(f.text));
  for (const p of f.patterns) {
    const t = p.trim();
    if (!t) continue;
    const m = /^\/(.+)\/([a-z]*)$/.exec(t);
    if (m) {
      parts.push(`(?:${m[1]})`);
      if (m[2].includes('i')) ignoreCase = true;
    } else {
      parts.push(escape(t));
      ignoreCase = true;
    }
  }
  if (!parts.length) return null;
  try {
    const re = new RegExp(parts.join('|'), ignoreCase ? 'gi' : 'g');
    return re.test('') ? null : ((re.lastIndex = 0), { re, color: FILTER_MARK });
  } catch {
    return null;
  }
}

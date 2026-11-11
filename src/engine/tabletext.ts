// Recognises tables in pasted plain text and writes Markdown pipe tables.
// Pure (no DOM). The rule that matters most: ordinary prose must come back as
// null, untouched.

/** Display width, close enough for alignment: wide (CJK, emoji) characters count as two. */
function width(s: string): number {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    w += c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0x1f300 && c <= 0x1faff)) ? 2 : 1;
  }
  return w;
}

const isNumber = (v: string) => /^[-+]?[$€£₹]?\d[\d,]*(?:\.\d+)?\s?(?:%|[a-zA-Zµ]{1,3})?$/.test(v.trim());

export type Align = 'left' | 'right' | 'center' | '';

/**
 * Writes rows as an aligned Markdown pipe table; the first row is the header.
 * Columns whose body cells are all numbers are right-aligned unless `aligns` says otherwise.
 */
export function toMarkdownTable(rows: string[][], aligns: Align[] = []): string {
  const cols = Math.max(...rows.map((r) => r.length));
  const cell = (v: string | undefined) => (v ?? '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|').trim();
  const data = rows.map((r) => Array.from({ length: cols }, (_, c) => cell(r[c])));
  const align: Align[] = Array.from({ length: cols }, (_, c) => {
    if (aligns[c]) return aligns[c];
    const body = data.slice(1).map((r) => r[c]).filter((v) => v !== '');
    return body.length > 0 && body.every(isNumber) ? 'right' : '';
  });
  const w = Array.from({ length: cols }, (_, c) => Math.max(3, ...data.map((r) => width(r[c]))));
  const pad = (v: string, c: number) => {
    const gap = ' '.repeat(w[c] - width(v));
    return align[c] === 'right' ? gap + v : align[c] === 'center' ? gap.slice(0, gap.length >> 1) + v + gap.slice(gap.length >> 1) : v + gap;
  };
  const rule = (c: number) => {
    const d = '-'.repeat(w[c]);
    return align[c] === 'right' ? `${d.slice(1)}:` : align[c] === 'center' ? `:${d.slice(2)}:` : align[c] === 'left' ? `:${d.slice(1)}` : d;
  };
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`;
  return [line(data[0].map(pad)), line(w.map((_, c) => rule(c))), ...data.slice(1).map((r) => line(r.map(pad)))].join('\n');
}

/** Splits one CSV line; returns null when quotes are unbalanced. */
function csvLine(line: string, sep: string): string[] | null {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (quoted) return null;
  out.push(cur);
  return out;
}

const sameLength = (rows: string[][]) => rows.every((r) => r.length === rows[0].length);

function tsv(lines: string[]): string[][] | null {
  if (!lines.every((l) => l.includes('\t'))) return null;
  const rows = lines.map((l) => l.split('\t').map((c) => c.trim()));
  const cols = Math.max(...rows.map((r) => r.length));
  if (cols < 2) return null;
  // Spreadsheets drop trailing empty cells: allow short rows, not long ones.
  if (rows.filter((r) => r.length === cols).length < rows.length * 0.6) return null;
  return rows.map((r) => [...r, ...Array<string>(cols - r.length).fill('')]);
}

function csv(lines: string[], sep: string): string[][] | null {
  if (lines.length < 2) return null;
  const rows: string[][] = [];
  for (const l of lines) {
    const r = csvLine(l, sep);
    if (!r) return null;
    rows.push(r.map((c) => c.trim()));
  }
  if (rows[0].length < 2 || !sameLength(rows)) return null;
  const cells = rows.flat();
  // Sentences have commas too. Tables have short cells, and with only two lines we want more evidence.
  if (cells.some((c) => c.length > 60 || c.split(/\s+/).length > 6)) return null;
  if (cells.filter((c) => c === '').length > cells.length * 0.5) return null;
  if (rows.length === 2 && rows[0].length < 3) return null;
  const sentence = lines.filter((l) => /[.!?]$/.test(l.trim()) && l.trim().split(/\s+/).length > 6).length;
  if (sentence > 0) return null;
  // Prose puts a space after each comma and has no numbers; require one or the other to be absent.
  const spaced = lines.every((l) => !l.includes(`${sep}`) || new RegExp(`\\${sep} `).test(l));
  const numeric = rows.slice(1).some((r) => r.some(isNumber));
  if (sep === ',' && spaced && !numeric && rows.length < 4) return null;
  return rows;
}

/** "+----+-----+" / "| id | name |" (MySQL), or "id | name" with a "----+-----" rule (psql), or a Markdown table. */
function bordered(lines: string[]): { rows: string[][]; markdown: boolean } | null {
  const rule = (l: string) => /^[\s|+:-]+$/.test(l) && /-{2,}/.test(l);
  const body = lines.filter((l) => !rule(l));
  if (body.length < 2 || body.length === lines.length) return null;
  if (!body.every((l) => l.includes('|'))) return null;
  const rows = body.map((l) => {
    const t = l.trim().replace(/^\|/, '').replace(/\|$/, '');
    return t.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
  });
  if (rows[0].length < 2 || !sameLength(rows)) return null;
  const markdown = lines.length > 1 && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[1]) && lines[0].trim().startsWith('|');
  return { rows, markdown };
}

/** Columns separated by two or more spaces, the same number on every line. */
function aligned(lines: string[]): string[][] | null {
  if (lines.length < 2) return null;
  const rule = (l: string) => /^[\s=-]+$/.test(l) && /[-=]{2,}/.test(l);
  const body = lines.filter((l) => !rule(l));
  if (body.length < 2) return null;
  const rows = body.map((l) => l.trim().split(/\s{2,}/));
  if (rows[0].length >= 2 && sameLength(rows)) {
    const cells = rows.flat();
    if (cells.some((c) => c.length > 60)) return null;
    // Two lines of text that happen to contain a double space are not a table: want numbers, or three lines.
    if (rows.length < 3 && !rows.slice(1).some((r) => r.some(isNumber))) return null;
    return rows;
  }
  // Single spaces between columns: only when every row has the same number of words and the data is mostly numbers.
  const words = body.map((l) => l.trim().split(/\s+/));
  if (words[0].length >= 3 && sameLength(words) && words.length >= 3) {
    const data = words.slice(1).flat();
    if (data.filter(isNumber).length >= data.length * 0.6) return words;
  }
  return null;
}

export interface Inferred {
  rows: string[][];
  kind: 'tsv' | 'csv' | 'bordered' | 'aligned';
}

/** The table in `text`, or null when the text is not (entirely) a table. */
export function inferTable(text: string): Inferred | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length < 2 || lines.length > 5000 || lines.some((l) => !l.trim())) return null;
  const t = tsv(lines);
  if (t) return { rows: t, kind: 'tsv' };
  const b = bordered(lines);
  if (b) return b.markdown ? null : { rows: b.rows, kind: 'bordered' };
  for (const sep of [',', ';']) {
    if (lines.every((l) => l.includes(sep))) {
      const c = csv(lines, sep);
      if (c) return { rows: c, kind: 'csv' };
    }
  }
  const a = aligned(lines);
  return a ? { rows: a, kind: 'aligned' } : null;
}

/** Pasted text as a Markdown table, or null to leave it exactly as it is. */
export function textToMarkdownTable(text: string): string | null {
  const t = inferTable(text);
  return t ? toMarkdownTable(t.rows) : null;
}

/** Reads a Markdown pipe table (as written above) back into rows; the first row is the header. */
export function parseMarkdownTable(lines: string[]): { rows: string[][]; aligns: Align[] } | null {
  if (lines.length < 2) return null;
  const split = (l: string) =>
    l
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.trim().replace(/\\\|/g, '|'));
  const rule = split(lines[1]);
  if (!rule.every((c) => /^:?-{1,}:?$/.test(c))) return null;
  const aligns: Align[] = rule.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  const rows = [split(lines[0]), ...lines.slice(2).map(split)];
  return { rows, aligns };
}

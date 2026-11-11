// Disk-backed index for large files. The file itself is never loaded: it is
// read in chunks, each chunk is parsed (Rust/WASM or the TypeScript twin), and
// only small per-line arrays are kept. Text is fetched from disk on demand.
//
// Memory: about 18 bytes per line plus 18 bytes per entry here in the worker,
// and about 10 bytes per line in the page.
import { applyFilter, collectGroups, finishGroups, isEmptyFilter, needsBytes, type ErrorGroup, type FilterResult, type FilterSpec } from './logfilter';
import { FIELD_STRIDE, FLAG_ENTRY, SUMMARY_LEN, type LogIndex } from './logparse';

export const CHUNK_BYTES = 16 * 1024 * 1024;
const FIELDS = 7; // thread off/len, logger off/len, trace off/len, message off: relative to the line start
const SIG = 48;

export type Parser = (bytes: Uint8Array) => LogIndex;
export type Reader = (from: number, to: number) => Promise<Uint8Array>;
export type Progress = (done: number, total: number) => void;

class Grow<T extends Uint8Array | Uint16Array | Uint32Array | Float64Array> {
  len = 0;
  constructor(
    public buf: T,
    private readonly make: (n: number) => T,
  ) {}
  reserve(extra: number): void {
    if (this.len + extra <= this.buf.length) return;
    const next = this.make(Math.max(this.buf.length * 2, this.len + extra));
    next.set(this.buf.subarray(0, this.len) as never);
    this.buf = next;
  }
  view(): T {
    return this.buf.subarray(0, this.len) as T;
  }
}

interface Checkpoint {
  offset: number;
  lines: number;
  entries: number;
  counts: number[];
  votes: number[];
  stamped: number;
  prefixed: number;
  firstTs: number;
  lastTs: number;
  curLevel: number;
  curTs: number;
}

export interface BigDelta {
  /** Line (0-based) from which the page's copy must be replaced. */
  fromLine: number;
  level: Uint8Array;
  flags: Uint8Array;
  ts: Float64Array;
  /** Entry first lines at or after fromLine. */
  entryLines: Uint32Array;
  /** Entries before fromLine (how many of the page's entry lines to keep). */
  keepEntries: number;
  summary: Float64Array;
  size: number;
}

export class BigIndex {
  readonly lineStart = new Grow(new Float64Array(1 << 16), (n) => new Float64Array(n));
  readonly level = new Grow(new Uint8Array(1 << 16), (n) => new Uint8Array(n));
  readonly flags = new Grow(new Uint8Array(1 << 16), (n) => new Uint8Array(n));
  readonly ts = new Grow(new Float64Array(1 << 16), (n) => new Float64Array(n));
  readonly entryLine = new Grow(new Uint32Array(1 << 15), (n) => new Uint32Array(n));
  readonly entryFields = new Grow(new Uint16Array((1 << 15) * FIELDS), (n) => new Uint16Array(n));
  private counts = new Array<number>(7).fill(0);
  private votes = new Array<number>(9).fill(0);
  private stamped = 0;
  private prefixed = 0;
  private firstTs = NaN;
  private lastTs = NaN;
  private zone = NaN;
  private curLevel = 0;
  private curTs = NaN;
  /** State before a final line that had no line break yet; re-read on append. */
  private checkpoint: Checkpoint | null = null;
  /** End of the indexed bytes. */
  size = 0;
  private signature: Uint8Array = new Uint8Array(0);
  private signatureAt = 0;

  constructor(
    private read: Reader,
    private readonly parse: Parser,
    /** First byte to index (after a BOM, or where a "last N MB" view starts). */
    readonly start: number,
    private chunkBytes = CHUNK_BYTES,
  ) {}

  get lines(): number {
    return this.level.len;
  }

  get entries(): number {
    return this.entryLine.len;
  }

  setReader(read: Reader): void {
    this.read = read;
  }

  summary(): Float64Array {
    const s = new Float64Array(SUMMARY_LEN);
    s[0] = this.lines;
    s[1] = this.entries;
    let fmt = 0;
    let best = 0;
    for (let i = 0; i < this.votes.length; i++) {
      if (this.votes[i] > best) {
        best = this.votes[i];
        fmt = i;
      }
    }
    s[2] = fmt;
    s[3] = this.prefixed;
    s[4] = this.firstTs;
    s[5] = this.lastTs;
    for (let i = 0; i < 7; i++) s[6 + i] = this.counts[i];
    s[13] = this.zone;
    s[14] = this.stamped;
    return s;
  }

  private save(offset: number): Checkpoint {
    return { offset, lines: this.lines, entries: this.entries, counts: [...this.counts], votes: [...this.votes], stamped: this.stamped, prefixed: this.prefixed, firstTs: this.firstTs, lastTs: this.lastTs, curLevel: this.curLevel, curTs: this.curTs };
  }

  private restore(c: Checkpoint): void {
    this.lineStart.len = this.level.len = this.flags.len = this.ts.len = c.lines;
    this.entryLine.len = c.entries;
    this.entryFields.len = c.entries * FIELDS;
    this.counts = [...c.counts];
    this.votes = [...c.votes];
    this.stamped = c.stamped;
    this.prefixed = c.prefixed;
    this.firstTs = c.firstTs;
    this.lastTs = c.lastTs;
    this.curLevel = c.curLevel;
    this.curTs = c.curTs;
  }

  /** Merges one parsed stretch that starts at byte `base`. `lineCount` drops a trailing empty line. */
  private merge(ix: LogIndex, base: number, lineCount: number): void {
    const l0 = this.lines;
    this.lineStart.reserve(lineCount);
    this.level.reserve(lineCount);
    this.flags.reserve(lineCount);
    this.ts.reserve(lineCount);
    const ls = this.lineStart.buf;
    const lv = this.level.buf;
    const fl = this.flags.buf;
    const ts = this.ts.buf;
    // Lines before the stretch's first entry continue the previous stretch's entry.
    let carried = true;
    for (let i = 0; i < lineCount; i++) {
      const f = ix.flags[i];
      if (f & FLAG_ENTRY) carried = false;
      ls[l0 + i] = base + ix.lineStart[i];
      fl[l0 + i] = f;
      lv[l0 + i] = carried ? this.curLevel : ix.level[i];
      ts[l0 + i] = carried ? this.curTs : ix.ts[i];
    }
    this.lineStart.len = this.level.len = this.flags.len = this.ts.len = l0 + lineCount;

    const n = ix.fields.length / FIELD_STRIDE;
    this.entryLine.reserve(n);
    this.entryFields.reserve(n * FIELDS);
    const el = this.entryLine.buf;
    const ef = this.entryFields.buf;
    let e0 = this.entries;
    for (let e = 0; e < n; e++) {
      const o = e * FIELD_STRIDE;
      const line = ix.fields[o];
      if (line >= lineCount) break;
      const start = ix.lineStart[line];
      el[e0] = l0 + line;
      const rel = (abs: number, len: number) => (len ? Math.min(65535, abs - start) : 0);
      const p = e0 * FIELDS;
      ef[p] = rel(ix.fields[o + 1], ix.fields[o + 2]);
      ef[p + 1] = Math.min(65535, ix.fields[o + 2]);
      ef[p + 2] = rel(ix.fields[o + 3], ix.fields[o + 4]);
      ef[p + 3] = Math.min(65535, ix.fields[o + 4]);
      ef[p + 4] = rel(ix.fields[o + 5], ix.fields[o + 6]);
      ef[p + 5] = Math.min(65535, ix.fields[o + 6]);
      ef[p + 6] = Math.min(65535, ix.fields[o + 7] - start);
      e0++;
    }
    this.entryLine.len = e0;
    this.entryFields.len = e0 * FIELDS;

    const s = ix.summary;
    for (let i = 0; i < 7; i++) this.counts[i] += s[6 + i];
    this.votes[s[2]] += s[1];
    this.stamped += s[14];
    this.prefixed += s[3];
    if (Number.isNaN(this.firstTs)) this.firstTs = s[4];
    if (!Number.isNaN(s[5])) this.lastTs = s[5];
    if (Number.isNaN(this.zone)) this.zone = s[13];
    if (lineCount > 0) {
      this.curLevel = lv[l0 + lineCount - 1];
      this.curTs = ts[l0 + lineCount - 1];
    }
  }

  /** Indexes from `from` to `total`. Whole lines only, except a last line that has no line break yet. */
  private async run(from: number, total: number, progress?: Progress): Promise<void> {
    let pos = from;
    let want = this.chunkBytes;
    while (pos < total) {
      const end = Math.min(total, pos + want);
      const buf = await this.read(pos, end);
      let usable = buf.length;
      if (end < total) {
        const cut = buf.lastIndexOf(10);
        if (cut < 0) {
          // One line longer than the chunk: read more of it.
          want *= 2;
          continue;
        }
        usable = cut + 1;
      }
      want = this.chunkBytes;
      const bytes = usable === buf.length ? buf : buf.subarray(0, usable);
      const endsWithBreak = usable > 0 && bytes[usable - 1] === 10;
      if (!endsWithBreak) {
        // The file's last line is still being written: index it provisionally.
        const cut = bytes.lastIndexOf(10);
        if (cut >= 0) {
          const head = this.parse(bytes.subarray(0, cut + 1));
          this.merge(head, pos, head.level.length - 1);
        }
        this.checkpoint = this.save(pos + cut + 1);
        const tail = this.parse(bytes.subarray(cut + 1));
        this.merge(tail, pos + cut + 1, tail.level.length);
      } else {
        const ix = this.parse(bytes);
        // parse() reports an empty line after the final line break; it is not a line of the file.
        this.merge(ix, pos, ix.level.length - 1);
        this.checkpoint = null;
      }
      pos += usable;
      progress?.(pos - this.start, total - this.start);
    }
    this.size = total;
    this.signatureAt = Math.max(this.start, total - SIG);
    this.signature = total > this.signatureAt ? (await this.read(this.signatureAt, total)).slice() : new Uint8Array(0);
  }

  async build(total: number, progress?: Progress): Promise<void> {
    await this.run(this.start, total, progress);
  }

  /**
   * The file grew: index only the new bytes. Returns null when the file was
   * rewritten (shorter, or its earlier bytes changed) and must be re-indexed.
   */
  async append(total: number): Promise<BigDelta | null> {
    if (total < this.size) return null;
    if (this.signature.length) {
      const now = await this.read(this.signatureAt, this.signatureAt + this.signature.length);
      if (now.length !== this.signature.length || now.some((b, i) => b !== this.signature[i])) return null;
    }
    let fromLine = this.lines;
    let keepEntries = this.entries;
    let from = this.size;
    if (this.checkpoint) {
      from = this.checkpoint.offset;
      this.restore(this.checkpoint);
      fromLine = this.lines;
      keepEntries = this.entries;
      this.checkpoint = null;
    }
    if (total > from) await this.run(from, total);
    return {
      fromLine,
      level: this.level.view().slice(fromLine),
      flags: this.flags.view().slice(fromLine),
      ts: this.ts.view().slice(fromLine),
      entryLines: this.entryLine.view().slice(keepEntries),
      keepEntries,
      summary: this.summary(),
      size: this.size,
    };
  }

  /** Byte range [from, to) of a line, without its line break. */
  private lineEnd(line: number): number {
    return line + 1 < this.lines ? this.lineStart.buf[line + 1] : this.size;
  }

  /** Text of the lines [from, to), decoded with `encoding`. */
  async text(from: number, to: number, encoding: string): Promise<string[]> {
    to = Math.min(to, this.lines);
    if (from >= to) return [];
    const a = this.lineStart.buf[from];
    const bytes = await this.read(a, this.lineEnd(to - 1));
    const dec = new TextDecoder(encoding);
    const out: string[] = [];
    for (let i = from; i < to; i++) {
      const s = this.lineStart.buf[i] - a;
      let e = this.lineEnd(i) - a;
      if (e > s && bytes[e - 1] === 10) e--;
      if (e > s && bytes[e - 1] === 13) e--;
      out.push(dec.decode(bytes.subarray(s, Math.min(e, s + 20000))));
    }
    return out;
  }

  /**
   * Stretches of whole entries, each small enough to read at once.
   * Yields [firstLine, lastLine + 1, firstEntry, lastEntry + 1].
   */
  private *stretches(maxBytes: number, maxEntries: number): Generator<[number, number, number, number]> {
    const total = this.lines;
    const n = this.entries;
    const el = this.entryLine.buf;
    let line = 0;
    let e = 0;
    while (line < total) {
      const startByte = this.lineStart.buf[line];
      let e1 = e;
      // The first stretch also carries the lines before the first entry.
      let endLine = e1 < n ? el[e1] : total;
      if (endLine <= line) {
        e1++;
        endLine = e1 < n ? el[e1] : total;
      }
      while (e1 < n && e1 - e < maxEntries) {
        const next = e1 + 1 < n ? el[e1 + 1] : total;
        const nextByte = next < total ? this.lineStart.buf[next] : this.size;
        if (nextByte - startByte > maxBytes && endLine > line) break;
        e1++;
        endLine = next;
      }
      yield [line, endLine, e, e1];
      line = endLine;
      e = e1;
    }
  }

  /** A self-contained LogIndex for one stretch, with offsets relative to its first byte. */
  private slice(l0: number, l1: number, e0: number, e1: number, summary: Float64Array): LogIndex {
    const base = this.lineStart.buf[l0];
    const lineStart = new Uint32Array(l1 - l0);
    for (let i = l0; i < l1; i++) lineStart[i - l0] = this.lineStart.buf[i] - base;
    const fields = new Uint32Array((e1 - e0) * FIELD_STRIDE);
    const ef = this.entryFields.buf;
    for (let e = e0; e < e1; e++) {
      const line = this.entryLine.buf[e];
      const start = lineStart[line - l0];
      const p = e * FIELDS;
      const o = (e - e0) * FIELD_STRIDE;
      fields[o] = line - l0;
      fields[o + 1] = start + ef[p];
      fields[o + 2] = ef[p + 1];
      fields[o + 3] = start + ef[p + 2];
      fields[o + 4] = ef[p + 3];
      fields[o + 5] = start + ef[p + 4];
      fields[o + 6] = ef[p + 5];
      fields[o + 7] = start + ef[p + 6];
    }
    return { lineStart, level: this.level.buf.subarray(l0, l1), flags: this.flags.buf.subarray(l0, l1), ts: this.ts.buf.subarray(l0, l1), fields, summary };
  }

  /** Visits the whole file as stretches of whole entries, each with its own bytes and index. */
  async walk(fn: (s: { bytes: Uint8Array; ix: LogIndex; lineBase: number; entryBase: number }) => void, progress?: Progress): Promise<void> {
    const summary = this.summary();
    const lines = this.lines;
    for (const [l0, l1, e0, e1] of this.stretches(this.chunkBytes, 1 << 30)) {
      const bytes = await this.read(this.lineStart.buf[l0], l1 < lines ? this.lineStart.buf[l1] : this.size);
      fn({ bytes, ix: this.slice(l0, l1, e0, e1, summary), lineBase: l0, entryBase: e0 });
      progress?.(l1, lines);
    }
  }

  async filter(spec: FilterSpec, progress?: Progress): Promise<FilterResult> {
    const lines = this.lines;
    const mask = new Uint8Array(lines);
    if (isEmptyFilter(spec)) return { mask: mask.fill(1), shownEntries: this.entries, totalEntries: this.entries };
    const summary = this.summary();
    const bytesNeeded = needsBytes(spec);
    const empty = new Uint8Array(0);
    let shown = 0;
    for (const [l0, l1, e0, e1] of this.stretches(bytesNeeded ? this.chunkBytes : Infinity, bytesNeeded ? 1 << 30 : 250_000)) {
      const bytes = bytesNeeded ? await this.read(this.lineStart.buf[l0], l1 < lines ? this.lineStart.buf[l1] : this.size) : empty;
      const r = applyFilter(bytes, this.slice(l0, l1, e0, e1, summary), spec);
      if (r.error) return { mask: new Uint8Array(lines).fill(1), shownEntries: this.entries, totalEntries: this.entries, error: r.error };
      mask.set(r.mask, l0);
      shown += r.shownEntries;
      progress?.(l1, lines);
    }
    return { mask, shownEntries: shown, totalEntries: this.entries };
  }

  async groups(progress?: Progress): Promise<ErrorGroup[]> {
    const map = new Map<string, ErrorGroup>();
    const summary = this.summary();
    const lines = this.lines;
    for (const [l0, l1, e0, e1] of this.stretches(this.chunkBytes, 1 << 30)) {
      // Skip stretches without warnings or errors: nothing to read.
      let any = false;
      for (let e = e0; e < e1 && !any; e++) any = this.level.buf[this.entryLine.buf[e]] >= 4;
      if (any) {
        const bytes = await this.read(this.lineStart.buf[l0], l1 < lines ? this.lineStart.buf[l1] : this.size);
        collectGroups(map, bytes, this.slice(l0, l1, e0, e1, summary), l0);
      }
      progress?.(l1, lines);
    }
    return finishGroups(map);
  }

  /** Lines (0-based) containing a match, in order, up to `limit`; plus the total number of matching lines. */
  async find(re: RegExp, limit: number, progress?: Progress): Promise<{ lines: Uint32Array; total: number }> {
    const found: number[] = [];
    let total = 0;
    const lines = this.lines;
    const dec = new TextDecoder();
    const flags = re.flags.replace(/[gy]/g, '');
    const perLine = new RegExp(re.source, flags);
    const global = new RegExp(re.source, `${flags.replace("m", "")}gm`);
    let l0 = 0;
    while (l0 < lines) {
      // As many whole lines as fit in one chunk.
      const base = this.lineStart.buf[l0];
      let l1 = l0 + 1;
      while (l1 < lines && this.lineStart.buf[l1] - base < this.chunkBytes) l1++;
      const end = l1 < lines ? this.lineStart.buf[l1] : this.size;
      const bytes = await this.read(base, end);
      const text = dec.decode(bytes);
      if (text.length === bytes.length) {
        // Single-byte text: character offsets equal byte offsets, so search the chunk at once.
        global.lastIndex = 0;
        let line = l0;
        let m: RegExpExecArray | null;
        while ((m = global.exec(text))) {
          const at = base + m.index;
          while (line + 1 < l1 && this.lineStart.buf[line + 1] <= at) line++;
          total++;
          if (found.length < limit) found.push(line);
          // One hit per line: continue at the next line.
          const next = line + 1 < l1 ? this.lineStart.buf[line + 1] - base : text.length;
          global.lastIndex = Math.max(next, m.index + 1);
          if (next >= text.length) break;
          line++;
        }
      } else {
        for (let i = l0; i < l1; i++) {
          const s = this.lineStart.buf[i] - base;
          const e = (i + 1 < lines ? this.lineStart.buf[i + 1] : this.size) - base;
          if (perLine.test(dec.decode(bytes.subarray(s, e)))) {
            total++;
            if (found.length < limit) found.push(i);
          }
        }
      }
      l0 = l1;
      progress?.(l0, lines);
    }
    return { lines: Uint32Array.from(found), total };
  }
}

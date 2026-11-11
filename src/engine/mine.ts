// TypeScript twin of engine-rs/src/mine.rs (template mining for auto tables).
// Same tokens, same masking, same merge order: tests/unit/mine.test.ts compares
// the two. Keep the files in the same shape.
import { FIELD_STRIDE, type LogIndex } from './logparse';

export const KIND_LITERAL = 0;
export const KIND_VAR = 1;
/** A path whose id-like segments were replaced: text is the route, the value is the real path. */
export const KIND_PATH = 2;
/** A position where merged templates had different words. */
export const KIND_MERGED = 3;
export const MAX_TOKENS = 48;
export const MAX_MESSAGE = 800;
export const SKIP = 0xffffffff;

export interface Tok {
  kind: number;
  text: string;
}

export interface Template {
  count: number;
  /** Index of the first entry with this template. */
  first: number;
  tokens: Tok[];
}

export interface Mined {
  /** Template id of every entry; SKIP for entries left out. */
  ids: Uint32Array;
  templates: Template[];
}

type B = Uint8Array;
const isDigit = (b: number) => b >= 48 && b <= 57;
const isAlpha = (b: number) => (b >= 97 && b <= 122) || (b >= 65 && b <= 90);
const dec = new TextDecoder();
const text = (l: B, a: number, b: number) => dec.decode(l.subarray(a, b));

/** Token boundaries [start, end, start, end, ...] of msg = l[a..n). */
export function tokenize(l: B, a: number, n: number): number[] {
  const out: number[] = [];
  let i = a;
  while (i < n) {
    while (i < n && (l[i] === 32 || l[i] === 9)) i++;
    if (i >= n) break;
    if (out.length === MAX_TOKENS * 2) {
      out.push(i, n);
      break;
    }
    const start = i;
    let quote = 0;
    while (i < n) {
      const b = l[i];
      if (quote !== 0) {
        if (b === quote) quote = 0;
      } else if (b === 34) quote = 34;
      else if (b === 39 && (i === start || l[i - 1] === 61)) quote = 39;
      else if (b === 32 || b === 9) break;
      i++;
    }
    out.push(start, i);
  }
  return out;
}

/** Length of a leading number in l[a..n), or 0. */
function numberLen(l: B, a: number, n: number): number {
  let i = a;
  if (i < n && (l[i] === 45 || l[i] === 43)) i++;
  const digits = i;
  while (i < n && isDigit(l[i])) i++;
  if (i === digits) return 0;
  while (i + 1 < n && (l[i] === 46 || l[i] === 44) && isDigit(l[i + 1])) {
    i++;
    while (i < n && isDigit(l[i])) i++;
  }
  return i - a;
}

let oNum = 0;
let oUnit = 0;

/** For "84ms" sets oNum = 2 and oUnit = 4 (relative to a). Returns false if not number + unit. */
function numberUnit(l: B, a: number, n: number): boolean {
  const k = numberLen(l, a, n);
  oNum = 0;
  oUnit = 0;
  if (k === 0) return false;
  const rest = n - a - k;
  if (rest === 0) {
    oNum = k;
    oUnit = k;
    return true;
  }
  if (rest === 1 && l[a + k] === 37) {
    oNum = k;
    oUnit = k + 1;
    return true;
  }
  if (rest <= 3) {
    for (let i = a + k; i < n; i++) if (!isAlpha(l[i])) return false;
    oNum = k;
    oUnit = n - a;
    return true;
  }
  return false;
}

function hasDigit(l: B, a: number, n: number): boolean {
  for (let i = a; i < n; i++) if (isDigit(l[i])) return true;
  return false;
}

export let oP = 0;
export let oS = 0;

/** Sets oP/oS: the token's core without one opening bracket and trailing punctuation. */
export function coreSpan(l: B, a: number, n: number): void {
  let p = a;
  if (n - a > 1 && (l[a] === 40 || l[a] === 91 || l[a] === 123 || l[a] === 60)) p = a + 1;
  let s = n;
  while (s > p + 1) {
    const b = l[s - 1];
    if (b === 44 || b === 59 || b === 58 || b === 46 || b === 41 || b === 93 || b === 125 || b === 62) s--;
    else break;
  }
  oP = p;
  oS = s;
}

/** Offset of '=' (relative to a) when l[a..n) is key=value with an identifier-like key, else 0. */
export function keyLen(l: B, a: number, n: number): number {
  if (n <= a || !(isAlpha(l[a]) || l[a] === 95)) return 0;
  for (let k = a; k < n; k++) {
    const b = l[k];
    if (b === 61) return k - a;
    if (!(isAlpha(b) || isDigit(b) || b === 95 || b === 46 || b === 45)) return 0;
  }
  return 0;
}

/** Masks the token l[a..n). */
export function classify(l: B, a: number, n: number): Tok {
  coreSpan(l, a, n);
  const p = oP;
  const s = oS;
  const wrap = (kind: number, middle: string): Tok => ({ kind, text: text(l, a, p) + middle + text(l, s, n) });
  if (s === p) return { kind: KIND_LITERAL, text: text(l, a, n) };
  if (s - p >= 2 && (l[p] === 34 || l[p] === 39)) return wrap(KIND_VAR, '<*>');
  const k = keyLen(l, p, s);
  if (k > 0) {
    const v = p + k + 1;
    const ok = numberUnit(l, v, s);
    return wrap(KIND_VAR, `${text(l, p, v)}<*>${ok && oNum > 0 ? text(l, v + oNum, v + oUnit) : ''}`);
  }
  if (l[p] === 47 && s - p > 1) {
    let route = '';
    let replaced = false;
    let i = p + 1;
    for (;;) {
      const seg = i;
      while (i < s && l[i] !== 47 && l[i] !== 63) i++;
      route += '/';
      if (hasDigit(l, seg, i)) {
        route += '{id}';
        replaced = true;
      } else route += text(l, seg, i);
      if (i >= s || l[i] === 63) break;
      i++;
    }
    if (i < s) replaced = true;
    return replaced ? wrap(KIND_PATH, route) : { kind: KIND_LITERAL, text: text(l, a, n) };
  }
  if (numberUnit(l, p, s) && oNum > 0) return wrap(KIND_VAR, `<*>${text(l, p + oNum, p + oUnit)}`);
  if (hasDigit(l, p, s)) return wrap(KIND_VAR, '<*>');
  return { kind: KIND_LITERAL, text: text(l, a, n) };
}

/** Tokens of one message, masked. */
export function maskMessage(l: B, a: number, n: number): Tok[] {
  if (n - a > MAX_MESSAGE) n = a + MAX_MESSAGE;
  const spans = tokenize(l, a, n);
  const out: Tok[] = [];
  for (let i = 0; i < spans.length; i += 2) out.push(classify(l, spans[i], spans[i + 1]));
  return out;
}

const same = (x: Tok, y: Tok) => x.kind === y.kind && x.text === y.text;

export class Miner {
  private readonly map = new Map<string, number>();
  private readonly templates: Template[] = [];
  private ids: number[] = [];

  add(l: B, a: number, n: number): number {
    const tokens = maskMessage(l, a, n);
    let key = '';
    for (const t of tokens) key += `${String.fromCharCode(t.kind + 1)}${t.text}\u001f`;
    const entry = this.ids.length;
    let id = this.map.get(key);
    if (id === undefined) {
      id = this.templates.length;
      this.templates.push({ tokens, count: 1, first: entry });
      this.map.set(key, id);
    } else this.templates[id].count++;
    this.ids.push(id);
    return id;
  }

  skip(): void {
    this.ids.push(SKIP);
  }

  finish(): Mined {
    const groups: Template[] = [];
    const buckets = new Map<string, number[]>();
    const remap: number[] = [];
    for (const t of this.templates) {
      const len = t.tokens.length;
      let target = -1;
      let bucketKey = '';
      if (len >= 4) {
        bucketKey = `${len}\u001f${t.tokens[0].kind}\u001f${t.tokens[0].text}`;
        const allowed = len === 4 ? 1 : Math.floor((len * 2) / 5);
        const list = buckets.get(bucketKey);
        if (list) {
          for (const gi of list) {
            const g = groups[gi];
            let diff = 0;
            for (let i = 0; i < len; i++) if (g.tokens[i].kind !== KIND_MERGED && !same(g.tokens[i], t.tokens[i])) diff++;
            if (diff <= allowed) {
              target = gi;
              break;
            }
          }
        }
      }
      if (target >= 0) {
        const g = groups[target];
        for (let i = 0; i < len; i++) if (g.tokens[i].kind !== KIND_MERGED && !same(g.tokens[i], t.tokens[i])) g.tokens[i] = { kind: KIND_MERGED, text: '<*>' };
        g.count += t.count;
        if (t.first < g.first) g.first = t.first;
        remap.push(target);
      } else {
        const gi = groups.length;
        groups.push({ tokens: t.tokens.slice(), count: t.count, first: t.first });
        if (len >= 4) {
          const list = buckets.get(bucketKey);
          if (list) list.push(gi);
          else buckets.set(bucketKey, [gi]);
        }
        remap.push(gi);
      }
    }
    const ids = new Uint32Array(this.ids.length);
    for (let i = 0; i < ids.length; i++) ids[i] = this.ids[i] === SKIP ? SKIP : remap[this.ids[i]];
    return { ids, templates: groups };
  }
}

/** Decodes the template list produced by the Rust engine. */
export function decodeTemplates(blob: Uint8Array): Template[] {
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let p = 0;
  const u32 = () => {
    const v = view.getUint32(p, true);
    p += 4;
    return v;
  };
  const n = u32();
  const out: Template[] = [];
  for (let t = 0; t < n; t++) {
    const count = u32();
    const first = u32();
    const tokens: Tok[] = [];
    const k = u32();
    for (let i = 0; i < k; i++) {
      const kind = blob[p++];
      const len = u32();
      tokens.push({ kind, text: dec.decode(blob.subarray(p, p + len)) });
      p += len;
    }
    out.push({ count, first, tokens });
  }
  return out;
}

/**
 * Where each entry's message starts and ends in `bytes`: pairs of u32.
 * Access-log entries are marked SKIP (they get one request table instead).
 */
export function messageSpans(bytes: Uint8Array, ix: LogIndex): Uint32Array {
  const n = ix.fields.length / FIELD_STRIDE;
  const lines = ix.level.length;
  const format = ix.summary[2];
  const out = new Uint32Array(n * 2);
  for (let e = 0; e < n; e++) {
    const o = e * FIELD_STRIDE;
    const line = ix.fields[o];
    // The last line of a stretch may or may not carry its line break.
    let end = line + 1 < lines ? ix.lineStart[line + 1] : bytes.length;
    if (end > 0 && bytes[end - 1] === 10) end--;
    if (end > 0 && bytes[end - 1] === 13) end--;
    let start = ix.fields[o + 7];
    if (format === 4) {
      out[e * 2] = SKIP;
      continue;
    }
    if (format === 3 && start > ix.lineStart[line]) {
      // JSON: the message is the string value that starts here; stop at its closing quote.
      let q = start;
      while (q < end && bytes[q] !== 34) {
        if (bytes[q] === 92) q++;
        q++;
      }
      end = Math.min(end, q);
    }
    if (start > end) start = end;
    out[e * 2] = start;
    out[e * 2 + 1] = end;
  }
  return out;
}

/** Mines one stretch with the TypeScript twin. */
export function mineSpans(miner: Miner, bytes: Uint8Array, spans: Uint32Array): void {
  for (let i = 0; i < spans.length; i += 2) {
    if (spans[i] === SKIP) miner.skip();
    else miner.add(bytes, spans[i], spans[i + 1]);
  }
}

// TypeScript twin of engine-rs/src/log.rs. Same algorithm, same order, same
// constants: tests/unit/log-parity.test.ts compares the two on every fixture.
// Keep the two files in the same shape so they can be read side by side.

export const LV = { NONE: 0, TRACE: 1, DEBUG: 2, INFO: 3, WARN: 4, ERROR: 5, FATAL: 6 } as const;
export const LEVEL_NAMES = ['', 'TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];
export const FLAG_ENTRY = 1;
export const FLAG_FRAME = 2;
export const FLAG_CAUSE = 4;
export const FORMAT_NAMES = ['', 'Spring Boot', 'Logback / Log4j', 'JSON lines', 'Access log', 'Syslog', 'java.util.logging', 'Epoch timestamps', 'Generic'];
const FMT = { NONE: 0, SPRING: 1, LOGBACK: 2, JSON: 3, ACCESS: 4, SYSLOG: 5, JUL: 6, EPOCH: 7, GENERIC: 8 } as const;
export const TS_WINDOW = 64;
export const FIELD_STRIDE = 8;
export const SUMMARY_LEN = 16;

const TK_ISO = 1;
const TK_ACCESS = 2;
const TK_MONTH = 3;
const TK_JUL = 4;
const TK_EPOCH = 5;
const TK_TIME = 6;
const NO_ZONE = -2147483648;

export interface LogIndex {
  lineStart: Uint32Array;
  level: Uint8Array;
  flags: Uint8Array;
  ts: Float64Array;
  /** Per entry: line, thread off/len, logger off/len, trace off/len, message off. */
  fields: Uint32Array;
  summary: Float64Array;
}

interface Stamp {
  ms: number;
  start: number;
  end: number;
  kind: number;
  zone: number;
}

interface Entry {
  ms: number;
  level: number;
  fmt: number;
  zone: number;
  prefixed: boolean;
  threadOff: number;
  threadLen: number;
  loggerOff: number;
  loggerLen: number;
  traceOff: number;
  traceLen: number;
  msg: number;
}

type B = Uint8Array;

const isDigit = (b: number) => b >= 48 && b <= 57;
const isAlnum = (b: number) => isDigit(b) || (b >= 97 && b <= 122) || (b >= 65 && b <= 90);
const isHex = (b: number) => isDigit(b) || (b >= 97 && b <= 102);
const isName = (b: number) => isAlnum(b) || b === 46 || b === 95 || b === 36 || b === 45 || b === 47;
const lower = (b: number) => (b >= 65 && b <= 90 ? b + 32 : b);

/** `n` digits at `at` (absolute index, limited by `end`), or -1. */
function num(l: B, end: number, at: number, n: number): number {
  if (at + n > end) return -1;
  let v = 0;
  for (let i = at; i < at + n; i++) {
    const b = l[i];
    if (!isDigit(b)) return -1;
    v = v * 10 + (b - 48);
  }
  return v;
}

function daysFromCivil(y: number, m: number, d: number): number {
  if (m <= 2) y -= 1;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (m + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function toMs(y: number, mo: number, d: number, h: number, mi: number, s: number, frac: number): number {
  return (daysFromCivil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s) * 1000 + frac;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].map((m) => [m.charCodeAt(0), m.charCodeAt(1), m.charCodeAt(2)]);

function month(l: B, end: number, at: number): number {
  if (at + 3 > end) return -1;
  for (let i = 0; i < 12; i++) {
    const m = MONTHS[i];
    if (l[at] === m[0] && l[at + 1] === m[1] && l[at + 2] === m[2]) return i + 1;
  }
  return -1;
}

// Small out-parameters instead of tuples, to keep the hot path allocation-free.
let oH = 0;
let oM = 0;
let oS = 0;
let oFrac = 0;
let oPos = 0;
let oZone = 0;

function hms(l: B, end: number, at: number): boolean {
  const h = num(l, end, at, 2);
  const m = num(l, end, at + 3, 2);
  const s = num(l, end, at + 6, 2);
  if (h < 0 || m < 0 || s < 0 || h > 23 || m > 59 || s > 60 || l[at + 2] !== 58 || l[at + 5] !== 58) return false;
  oH = h;
  oM = m;
  oS = s;
  return true;
}

function fraction(l: B, end: number, at: number): void {
  if (at + 1 < end && (l[at] === 46 || l[at] === 44) && isDigit(l[at + 1])) {
    let p = at + 1;
    let ms = 0;
    let n = 0;
    while (p < end && isDigit(l[p])) {
      if (n < 3) {
        ms = ms * 10 + (l[p] - 48);
        n++;
      }
      p++;
    }
    while (n < 3) {
      ms *= 10;
      n++;
    }
    oFrac = ms;
    oPos = p;
    return;
  }
  oFrac = 0;
  oPos = at;
}

function zone(l: B, end: number, at: number): void {
  if (at < end && l[at] === 90) {
    oZone = 0;
    oPos = at + 1;
    return;
  }
  let p = at;
  if (p + 5 < end && l[p] === 32 && (l[p + 1] === 43 || l[p + 1] === 45) && num(l, end, p + 2, 4) >= 0) p += 1;
  if (p < end && (l[p] === 43 || l[p] === 45)) {
    const sign = l[p] === 45 ? -1 : 1;
    const hh = num(l, end, p + 1, 2);
    if (hh >= 0) {
      const colon = p + 3 < end && l[p + 3] === 58;
      const mm = num(l, end, colon ? p + 4 : p + 3, 2);
      if (mm >= 0) {
        oZone = sign * (hh * 60 + mm);
        oPos = colon ? p + 6 : p + 5;
        return;
      }
    }
  }
  oZone = NO_ZONE;
  oPos = at;
}

function tryIso(l: B, end: number, p: number): Stamp | null {
  if (p + 19 > end) return null;
  const y = num(l, end, p, 4);
  const sep = l[p + 4];
  if (y < 1970 || (sep !== 45 && sep !== 47) || l[p + 7] !== sep) return null;
  const mo = num(l, end, p + 5, 2);
  const d = num(l, end, p + 8, 2);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || (l[p + 10] !== 84 && l[p + 10] !== 32)) return null;
  if (!hms(l, end, p + 11)) return null;
  const h = oH;
  const mi = oM;
  const s = oS;
  fraction(l, end, p + 19);
  const frac = oFrac;
  zone(l, end, oPos);
  return { ms: toMs(y, mo, d, h, mi, s, frac), start: p, end: oPos, kind: TK_ISO, zone: oZone };
}

function tryAccess(l: B, end: number, p: number): Stamp | null {
  if (p + 20 > end || l[p + 2] !== 47 || l[p + 6] !== 47 || l[p + 11] !== 58) return null;
  const d = num(l, end, p, 2);
  const mo = month(l, end, p + 3);
  const y = num(l, end, p + 7, 4);
  if (d < 1 || d > 31 || mo < 0 || y < 1970) return null;
  if (!hms(l, end, p + 12)) return null;
  const h = oH;
  const mi = oM;
  const s = oS;
  zone(l, end, p + 20);
  return { ms: toMs(y, mo, d, h, mi, s, 0), start: p, end: oPos, kind: TK_ACCESS, zone: oZone };
}

function tryMonth(l: B, end: number, p: number, defaultYear: number): Stamp | null {
  const n = end;
  const mo = month(l, end, p);
  if (mo < 0 || p + 4 >= n || l[p + 3] !== 32) return null;
  let q = p + 4;
  if (q < n && l[q] === 32) q++;
  let d = 0;
  const ds = q;
  while (q < n && isDigit(l[q]) && q - ds < 2) {
    d = d * 10 + (l[q] - 48);
    q++;
  }
  if (q === ds || d < 1 || d > 31 || q >= n) return null;
  if (l[q] === 44) {
    if (q + 6 >= n || l[q + 1] !== 32) return null;
    const y = num(l, end, q + 2, 4);
    if (y < 1970 || q + 6 >= n || l[q + 6] !== 32) return null;
    let t = q + 7;
    let h = 0;
    const hs = t;
    while (t < n && isDigit(l[t]) && t - hs < 2) {
      h = h * 10 + (l[t] - 48);
      t++;
    }
    if (t === hs || t + 6 > n || l[t] !== 58 || l[t + 3] !== 58) return null;
    const mi = num(l, end, t + 1, 2);
    const s = num(l, end, t + 4, 2);
    if (mi < 0 || s < 0 || h > 23 || mi > 59) return null;
    let e = t + 6;
    if (e + 2 < n && l[e] === 32 && (l[e + 1] === 65 || l[e + 1] === 80) && l[e + 2] === 77) {
      if (l[e + 1] === 80 && h < 12) h += 12;
      else if (l[e + 1] === 65 && h === 12) h = 0;
      e += 3;
    }
    return { ms: toMs(y, mo, d, h, mi, s, 0), start: p, end: e, kind: TK_JUL, zone: NO_ZONE };
  }
  if (l[q] !== 32 || q + 9 > n) return null;
  if (!hms(l, end, q + 1)) return null;
  const h = oH;
  const mi = oM;
  const s = oS;
  fraction(l, end, q + 9);
  return { ms: toMs(defaultYear, mo, d, h, mi, s, oFrac), start: p, end: oPos, kind: TK_MONTH, zone: NO_ZONE };
}

function tryEpoch(l: B, end: number, p: number): Stamp | null {
  const n = end;
  let q = p;
  while (q < n && isDigit(l[q]) && q - p < 14) q++;
  const digits = q - p;
  if (digits !== 10 && digits !== 13) return null;
  let v = 0;
  for (let i = p; i < q; i++) v = v * 10 + (l[i] - 48);
  let ms = digits === 10 ? v * 1000 : v;
  let e = q;
  if (digits === 10) {
    fraction(l, end, q);
    ms += oFrac;
    e = oPos;
  }
  if (ms < 978307200000 || ms > 4102444800000) return null;
  if (e < n && (isAlnum(l[e]) || l[e] === 45 || l[e] === 95)) return null;
  return { ms, start: p, end: e, kind: TK_EPOCH, zone: 0 };
}

function tryTime(l: B, end: number, p: number): Stamp | null {
  if (p + 8 > end) return null;
  if (!hms(l, end, p)) return null;
  const h = oH;
  const mi = oM;
  const s = oS;
  fraction(l, end, p + 8);
  if (oPos < end && isAlnum(l[oPos])) return null;
  return { ms: toMs(1970, 1, 1, h, mi, s, oFrac), start: p, end: oPos, kind: TK_TIME, zone: NO_ZONE };
}

function findStamp(l: B, a: number, end: number, defaultYear: number): Stamp | null {
  const limit = end - a < TS_WINDOW ? end : a + TS_WINDOW;
  for (let p = a; p < limit; p++) {
    const b = l[p];
    const prev = p === a ? 0 : l[p - 1];
    const boundary = p === a || !(isAlnum(prev) || prev === 46 || prev === 95 || prev === 45 || prev === 58 || prev === 47);
    if (!boundary) continue;
    if (isDigit(b)) {
      let s = tryIso(l, end, p);
      if (s) return s;
      s = tryAccess(l, end, p);
      if (s) return s;
      s = tryEpoch(l, end, p);
      if (s) return s;
      if (p === a || (p === a + 1 && l[a] === 91)) {
        s = tryTime(l, end, p);
        if (s) return s;
      }
    } else if (b >= 65 && b <= 83) {
      const s = tryMonth(l, end, p, defaultYear);
      if (s) return s;
    }
  }
  return null;
}

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const LEVEL_WORDS: [number[], number][] = [
  [enc('TRACE'), LV.TRACE],
  [enc('DEBUG'), LV.DEBUG],
  [enc('INFO'), LV.INFO],
  [enc('WARNING'), LV.WARN],
  [enc('WARN'), LV.WARN],
  [enc('ERROR'), LV.ERROR],
  [enc('FATAL'), LV.FATAL],
  [enc('SEVERE'), LV.ERROR],
  [enc('CRITICAL'), LV.FATAL],
  [enc('NOTICE'), LV.INFO],
  [enc('FINEST'), LV.TRACE],
  [enc('FINER'), LV.TRACE],
  [enc('FINE'), LV.DEBUG],
];

let oLevelLen = 0;

/** An upper-case level word at `p` (line is l[a..end)). Sets oLevelLen. */
function levelAt(l: B, a: number, end: number, p: number): number {
  if (p > a && (isAlnum(l[p - 1]) || l[p - 1] === 95 || l[p - 1] === 46)) return LV.NONE;
  outer: for (let w = 0; w < LEVEL_WORDS.length; w++) {
    const word = LEVEL_WORDS[w][0];
    const e = p + word.length;
    if (e > end) continue;
    for (let i = 0; i < word.length; i++) if (l[p + i] !== word[i]) continue outer;
    if (e === end || !(isAlnum(l[e]) || l[e] === 95)) {
      oLevelLen = word.length;
      return LEVEL_WORDS[w][1];
    }
  }
  return LV.NONE;
}

let oLevelEnd = 0;

function findLevel(l: B, a: number, end: number, from: number, to: number): number {
  if (to > end) to = end;
  for (let p = from; p < to; p++) {
    const b = l[p];
    if (b >= 67 && b <= 87) {
      const lv = levelAt(l, a, end, p);
      if (lv !== LV.NONE) {
        oLevelEnd = p + oLevelLen;
        return lv;
      }
    }
  }
  return LV.NONE;
}

function eqCi(l: B, s: number, e: number, word: string): boolean {
  if (e - s !== word.length) return false;
  for (let i = 0; i < word.length; i++) if (lower(l[s + i]) !== word.charCodeAt(i)) return false;
  return true;
}

function levelValue(l: B, s: number, e: number): number {
  if (e <= s) return LV.NONE;
  if (isDigit(l[s])) {
    let n = 0;
    for (let i = s; i < e; i++) {
      if (!isDigit(l[i])) break;
      n = n * 10 + (l[i] - 48);
    }
    return n >= 60 ? LV.FATAL : n >= 50 ? LV.ERROR : n >= 40 ? LV.WARN : n >= 30 ? LV.INFO : n >= 20 ? LV.DEBUG : LV.TRACE;
  }
  const is = (w: string) => eqCi(l, s, e, w);
  if (is('trace') || is('finest') || is('finer')) return LV.TRACE;
  if (is('debug') || is('fine')) return LV.DEBUG;
  if (is('info') || is('information') || is('notice')) return LV.INFO;
  if (is('warn') || is('warning')) return LV.WARN;
  if (is('error') || is('err') || is('severe')) return LV.ERROR;
  if (is('fatal') || is('critical') || is('panic')) return LV.FATAL;
  return LV.NONE;
}

function isTrace(l: B, s: number, e: number): boolean {
  let n = s;
  while (n < e && isHex(l[n])) n++;
  if (n - s < 16) return false;
  if (n === e) return true;
  if (l[n] !== 45) return false;
  if (n + 1 >= e) return false;
  for (let i = n + 1; i < e; i++) if (!isHex(l[i])) return false;
  return true;
}

let oSpanOff = 0;
let oSpanLen = 0;

function findTrace(l: B, a: number, end: number): void {
  const limit = end - a < 600 ? end : a + 600;
  for (let p = a; p + 7 < limit; p++) {
    if (lower(l[p]) === 116 && lower(l[p + 1]) === 114 && lower(l[p + 2]) === 97 && lower(l[p + 3]) === 99 && lower(l[p + 4]) === 101) {
      let q = p + 5;
      if (q < limit && (l[q] === 95 || l[q] === 46 || l[q] === 45)) q++;
      if (q + 1 < limit && lower(l[q]) === 105 && lower(l[q + 1]) === 100) {
        q += 2;
        while (q < end && (l[q] === 34 || l[q] === 61 || l[q] === 58 || l[q] === 32 || l[q] === 39)) q++;
        const s = q;
        while (q < end && isHex(l[q])) q++;
        if (q - s >= 16) {
          oSpanOff = s;
          oSpanLen = q - s;
          return;
        }
      }
    }
  }
  oSpanOff = 0;
  oSpanLen = 0;
}

let oA = 0;
let oB = 0;

function trim(l: B, a: number, b: number): void {
  while (a < b && l[a] === 32) a++;
  while (b > a && l[b - 1] === 32) b--;
  oA = a;
  oB = b;
}

function skipSpaces(l: B, end: number, p: number): number {
  while (p < end && l[p] === 32) p++;
  return p;
}

function keyIs(l: B, s: number, e: number, names: string[]): boolean {
  outer: for (const name of names) {
    if (e - s !== name.length) continue;
    for (let i = 0; i < name.length; i++) if (l[s + i] !== name.charCodeAt(i)) continue outer;
    return true;
  }
  return false;
}

const K_TS = ['@timestamp', 'timestamp', 'time', 'ts', 'date', 'datetime', 't'];
const K_LEVEL = ['level', 'severity', 'log.level', 'lvl', 'loglevel', 'levelname'];
const K_LOGGER = ['logger', 'logger_name', 'loggerName', 'log.logger'];
const K_THREAD = ['thread', 'thread_name', 'threadName', 'process.thread.name'];
const K_TRACE = ['traceId', 'trace_id', 'trace.id', 'traceid', 'dd.trace_id'];
const K_MSG = ['message', 'msg', 'log'];

function blank(ms: number, fmt: number, zoneMin: number, msg: number): Entry {
  return { ms, level: LV.NONE, fmt, zone: zoneMin, prefixed: false, threadOff: 0, threadLen: 0, loggerOff: 0, loggerLen: 0, traceOff: 0, traceLen: 0, msg };
}

function parseJson(l: B, a: number, n: number, defaultYear: number): Entry | null {
  const e = blank(NaN, FMT.JSON, NO_ZONE, a);
  let found = false;
  let depth = 0;
  let p = a;
  while (p < n) {
    const b = l[p];
    if (b === 123 || b === 91) {
      depth++;
      p++;
    } else if (b === 125 || b === 93) {
      depth--;
      p++;
    } else if (b === 34) {
      const ks = p + 1;
      let q = ks;
      while (q < n && l[q] !== 34) {
        if (l[q] === 92) q++;
        q++;
      }
      const ke = q > n ? n : q;
      p = ke + 1;
      if (depth !== 1) continue;
      let c = skipSpaces(l, n, p);
      if (c >= n || l[c] !== 58) continue;
      c = skipSpaces(l, n, c + 1);
      if (c >= n) break;
      let vs: number;
      let ve: number;
      let next: number;
      if (l[c] === 34) {
        let v = c + 1;
        while (v < n && l[v] !== 34) {
          if (l[v] === 92) v++;
          v++;
        }
        const vend = v > n ? n : v;
        vs = c + 1;
        ve = vend;
        next = vend + 1;
      } else if (l[c] === 123 || l[c] === 91) {
        p = c;
        continue;
      } else {
        let v = c;
        while (v < n && l[v] !== 44 && l[v] !== 125 && l[v] !== 32) v++;
        vs = c;
        ve = v;
        next = v;
      }
      if (keyIs(l, ks, ke, K_TS)) {
        if (Number.isNaN(e.ms)) {
          let s = tryIso(l, ve, vs);
          if (s && s.start === vs) {
            e.ms = s.ms;
            e.zone = s.zone;
            found = true;
          } else {
            s = tryEpoch(l, ve, vs);
            if (s) {
              e.ms = s.ms;
              e.zone = 0;
              found = true;
            } else {
              s = tryMonth(l, ve, vs, defaultYear);
              if (s) {
                e.ms = s.ms;
                found = true;
              }
            }
          }
        }
      } else if (keyIs(l, ks, ke, K_LEVEL)) {
        if (e.level === LV.NONE) {
          e.level = levelValue(l, vs, ve);
          if (e.level !== LV.NONE) found = true;
        }
      } else if (keyIs(l, ks, ke, K_LOGGER)) {
        e.loggerOff = vs;
        e.loggerLen = ve - vs;
      } else if (keyIs(l, ks, ke, K_THREAD)) {
        e.threadOff = vs;
        e.threadLen = ve - vs;
      } else if (keyIs(l, ks, ke, K_TRACE)) {
        if (ve > vs) {
          e.traceOff = vs;
          e.traceLen = ve - vs;
        }
      } else if (keyIs(l, ks, ke, K_MSG)) {
        e.msg = vs;
        found = true;
      }
      p = next;
    } else p++;
  }
  return found ? e : null;
}

/** Parses the line l[a..n) (no line break). null means "continuation line". */
function parseLine(l: B, a: number, n: number, defaultYear: number): Entry | null {
  if (n === a || l[a] === 32 || l[a] === 9) return null;
  if (l[a] === 123) return parseJson(l, a, n, defaultYear);
  const st = findStamp(l, a, n, defaultYear);
  if (!st) return null;
  const e = blank(st.ms, FMT.GENERIC, st.zone, st.end);
  e.prefixed = st.start > a && l[a] === 91 && st.kind !== TK_ACCESS && st.kind !== TK_TIME;

  if (st.kind === TK_ACCESS) {
    e.fmt = FMT.ACCESS;
    e.level = LV.INFO;
    let q = st.end;
    while (q < n && l[q] !== 34) q++;
    if (q < n) {
      e.msg = q + 1;
      let c = q + 1;
      while (c < n && l[c] !== 34) c++;
      const s = skipSpaces(l, n, c + 1);
      const status = num(l, n, s, 3);
      if (status >= 500) e.level = LV.ERROR;
      else if (status >= 400) e.level = LV.WARN;
    }
    return e;
  }

  let lv = findLevel(l, a, n, st.end, st.end + 96);
  let le = oLevelEnd;
  if (lv === LV.NONE && st.start > a) {
    lv = findLevel(l, a, n, a, st.start);
    if (lv !== LV.NONE) le = st.end;
  }
  e.level = lv;
  let after = lv !== LV.NONE ? le : st.end;

  let c = skipSpaces(l, n, after);
  const pid = c;
  while (c < n && isDigit(l[c])) c++;
  const d = skipSpaces(l, n, c);
  if (lv !== LV.NONE && c > pid && d + 3 <= n && l[d] === 45 && l[d + 1] === 45 && l[d + 2] === 45) {
    e.fmt = FMT.SPRING;
    let q = skipSpaces(l, n, d + 3);
    const plain: number[] = [];
    let count = 0;
    while (q < n && l[q] === 91 && count < 4) {
      let r = q + 1;
      while (r < n && l[r] !== 93) r++;
      if (r >= n) break;
      trim(l, q + 1, r);
      count++;
      if (isTrace(l, oA, oB)) {
        e.traceOff = oA;
        e.traceLen = oB - oA;
      } else plain.push(oA, oB);
      q = skipSpaces(l, n, r + 1);
    }
    if (plain.length > 0) {
      e.threadOff = plain[plain.length - 2];
      e.threadLen = plain[plain.length - 1] - e.threadOff;
    }
    const ls2 = q;
    while (q < n && l[q] !== 32) q++;
    if (q > ls2) {
      e.loggerOff = ls2;
      e.loggerLen = q - ls2;
    }
    let m = q;
    while (m + 2 < n && !(l[m] === 32 && l[m + 1] === 58 && l[m + 2] === 32)) m++;
    e.msg = m + 2 < n ? m + 3 : q;
    if (e.traceLen === 0) {
      findTrace(l, a, n);
      e.traceOff = oSpanOff;
      e.traceLen = oSpanLen;
    }
    return e;
  }

  e.fmt = st.kind === TK_EPOCH ? FMT.EPOCH : st.kind === TK_JUL ? FMT.JUL : st.kind === TK_MONTH ? FMT.SYSLOG : lv !== LV.NONE ? FMT.LOGBACK : FMT.GENERIC;

  const scanTo = st.end + 160 < n ? st.end + 160 : n;
  let q = st.end;
  let seen = 0;
  while (q < scanTo && seen < 4) {
    if (l[q] === 91) {
      let r = q + 1;
      while (r < n && l[r] !== 93 && r - q <= 80) r++;
      if (r < n && l[r] === 93) {
        trim(l, q + 1, r);
        const g0 = oA;
        const g1 = oB;
        seen++;
        if (g1 > g0 && levelAt(l, a, n, g0) === LV.NONE) {
          if (isTrace(l, g0, g1)) {
            if (e.traceLen === 0) {
              e.traceOff = g0;
              e.traceLen = g1 - g0;
            }
          } else if (e.threadLen === 0) {
            e.threadOff = g0;
            e.threadLen = g1 - g0;
          }
        }
        q = r + 1;
        continue;
      }
    }
    q++;
  }

  if (e.fmt === FMT.SYSLOG) after = st.end;
  const sepTo = after + 240 < n ? after + 240 : n;
  let msg = after;
  for (let m = after; m + 1 < sepTo; m++) {
    const dash = l[m] === 32 && l[m + 1] === 45 && m + 2 < n && l[m + 2] === 32;
    const colon = l[m] === 58 && l[m + 1] === 32;
    if (dash || colon) {
      let nameEnd = m;
      while (nameEnd > after && l[nameEnd - 1] === 32) nameEnd--;
      let nameStart = nameEnd;
      while (nameStart > after && isName(l[nameStart - 1])) nameStart--;
      if (nameStart === nameEnd && nameEnd > after && l[nameEnd - 1] === 93) {
        let b2 = nameEnd - 1;
        while (b2 > after && l[b2] !== 91) b2--;
        nameEnd = b2;
        nameStart = nameEnd;
        while (nameStart > after && isName(l[nameStart - 1])) nameStart--;
      }
      let dotted = false;
      for (let k = nameStart; k < nameEnd; k++) if (l[k] === 46) dotted = true;
      const named = nameEnd - nameStart >= 2 && !isDigit(l[nameStart]) && (e.fmt === FMT.SYSLOG || dotted || (l[nameStart] >= 65 && l[nameStart] <= 90));
      if (named) {
        e.loggerOff = nameStart;
        e.loggerLen = nameEnd - nameStart;
        msg = dash ? m + 3 : m + 2;
      }
      break;
    }
  }
  e.msg = skipSpaces(l, n, msg);
  if (e.traceLen === 0) {
    findTrace(l, a, n);
    e.traceOff = oSpanOff;
    e.traceLen = oSpanLen;
  }
  return e;
}

function startsWith(l: B, p: number, n: number, word: string): boolean {
  if (p + word.length > n) return false;
  for (let i = 0; i < word.length; i++) if (l[p + i] !== word.charCodeAt(i)) return false;
  return true;
}

function continuationFlags(l: B, a: number, n: number): number {
  let p = a;
  while (p < n && (l[p] === 32 || l[p] === 9)) p++;
  if (startsWith(l, p, n, 'at ') || startsWith(l, p, n, '... ')) return FLAG_FRAME;
  if (startsWith(l, p, n, 'Caused by:') || startsWith(l, p, n, 'Suppressed:')) return FLAG_CAUSE;
  return 0;
}

/** Growable typed arrays: the line count is not known up front. */
class Grow<T extends Uint8Array | Uint32Array | Float64Array> {
  len = 0;
  constructor(
    public buf: T,
    private readonly make: (n: number) => T,
  ) {}
  push(v: number): void {
    if (this.len === this.buf.length) {
      const next = this.make(this.buf.length * 2);
      next.set(this.buf as never);
      this.buf = next;
    }
    this.buf[this.len++] = v;
  }
  done(): T {
    return this.buf.slice(0, this.len) as T;
  }
}

export function parseLogTs(bytes: Uint8Array, defaultYear: number): LogIndex {
  const n = bytes.length;
  const guess = Math.max(16, Math.ceil(n / 80));
  const lineStart = new Grow(new Uint32Array(guess), (k) => new Uint32Array(k));
  const level = new Grow(new Uint8Array(guess), (k) => new Uint8Array(k));
  const flags = new Grow(new Uint8Array(guess), (k) => new Uint8Array(k));
  const ts = new Grow(new Float64Array(guess), (k) => new Float64Array(k));
  const fields = new Grow(new Uint32Array(guess * 4), (k) => new Uint32Array(k));
  const fmtVotes = new Array<number>(9).fill(0);
  const counts = new Array<number>(7).fill(0);
  let prefixed = 0;
  let stamped = 0;
  let firstTs = NaN;
  let lastTs = NaN;
  let zoneMin = NO_ZONE;
  let curLevel: number = LV.NONE;
  let curTs = NaN;
  let pending = -1;
  let entries = 0;

  let start = 0;
  for (;;) {
    let end = bytes.indexOf(10, start);
    if (end < 0) end = n;
    let stop = end;
    if (stop > start && bytes[stop - 1] === 13) stop--;
    const li = level.len;
    lineStart.push(start);
    const e = parseLine(bytes, start, stop, defaultYear);
    if (e) {
      entries++;
      fmtVotes[e.fmt]++;
      if (e.prefixed) prefixed++;
      if (!Number.isNaN(e.ms)) {
        stamped++;
        if (Number.isNaN(firstTs)) firstTs = e.ms;
        lastTs = e.ms;
      }
      if (zoneMin === NO_ZONE && e.zone !== NO_ZONE) zoneMin = e.zone;
      curLevel = e.level;
      curTs = e.ms;
      pending = e.level === LV.NONE ? li : -1;
      counts[e.level]++;
      level.push(e.level);
      flags.push(FLAG_ENTRY);
      ts.push(e.ms);
      fields.push(li);
      fields.push(e.threadOff);
      fields.push(e.threadLen);
      fields.push(e.loggerOff);
      fields.push(e.loggerLen);
      fields.push(e.traceOff);
      fields.push(e.traceLen);
      fields.push(e.msg);
    } else {
      if (pending >= 0 && pending + 1 === li) {
        const lv = levelAt(bytes, start, stop, start);
        if (lv !== LV.NONE && start + oLevelLen < stop && bytes[start + oLevelLen] === 58) {
          counts[LV.NONE]--;
          counts[lv]++;
          level.buf[pending] = lv;
          curLevel = lv;
        }
      }
      pending = -1;
      level.push(curLevel);
      flags.push(continuationFlags(bytes, start, stop));
      ts.push(curTs);
    }
    if (end >= n) break;
    start = end + 1;
  }

  let fmt = 0;
  let best = 0;
  for (let i = 0; i < fmtVotes.length; i++) {
    if (fmtVotes[i] > best) {
      best = fmtVotes[i];
      fmt = i;
    }
  }
  const summary = new Float64Array(SUMMARY_LEN);
  summary[0] = level.len;
  summary[1] = entries;
  summary[2] = fmt;
  summary[3] = prefixed;
  summary[4] = firstTs;
  summary[5] = lastTs;
  for (let i = 0; i < 7; i++) summary[6 + i] = counts[i];
  summary[13] = zoneMin === NO_ZONE ? NaN : zoneMin;
  summary[14] = stamped;
  return { lineStart: lineStart.done(), level: level.done(), flags: flags.done(), ts: ts.done(), fields: fields.done(), summary };
}

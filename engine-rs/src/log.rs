//! Log parsing: one pass over the bytes of a log file, producing per-line
//! arrays (level, flags, timestamp) and per-entry field positions.
//!
//! The TypeScript twin is `src/engine/logparse.ts`. Both must produce identical
//! output for every input; `tests/unit/log-parity.test.ts` checks that. Keep the
//! two files in the same shape so they can be compared side by side.

pub const LV_NONE: u8 = 0;
pub const LV_TRACE: u8 = 1;
pub const LV_DEBUG: u8 = 2;
pub const LV_INFO: u8 = 3;
pub const LV_WARN: u8 = 4;
pub const LV_ERROR: u8 = 5;
pub const LV_FATAL: u8 = 6;

pub const FLAG_ENTRY: u8 = 1;
pub const FLAG_FRAME: u8 = 2;
pub const FLAG_CAUSE: u8 = 4;

pub const FMT_NONE: u8 = 0;
pub const FMT_SPRING: u8 = 1;
pub const FMT_LOGBACK: u8 = 2;
pub const FMT_JSON: u8 = 3;
pub const FMT_ACCESS: u8 = 4;
pub const FMT_SYSLOG: u8 = 5;
pub const FMT_JUL: u8 = 6;
pub const FMT_EPOCH: u8 = 7;
pub const FMT_GENERIC: u8 = 8;
const FMT_COUNT: usize = 9;

/// Timestamps may start this far into a line (Kubernetes/Docker prefixes).
pub const TS_WINDOW: usize = 64;
/// u32 values stored per entry in `fields`.
pub const FIELD_STRIDE: usize = 8;
pub const SUMMARY_LEN: usize = 16;

const TK_ISO: u8 = 1;
const TK_ACCESS: u8 = 2;
const TK_MONTH: u8 = 3;
const TK_JUL: u8 = 4;
const TK_EPOCH: u8 = 5;
const TK_TIME: u8 = 6;

#[derive(Default)]
pub struct LogIndex {
    /// Byte offset of each line start.
    pub line_start: Vec<u32>,
    /// Level of each line (continuation lines inherit their entry's level).
    pub level: Vec<u8>,
    pub flags: Vec<u8>,
    /// Wall-clock time in ms (as written in the log, zone ignored); NaN if unknown.
    pub ts: Vec<f64>,
    /// Per entry: line, thread off/len, logger off/len, trace off/len, message off.
    pub fields: Vec<u32>,
    /// lines, entries, format, k8s prefix lines, first ts, last ts,
    /// counts for levels 0..=6 (7 values), zone offset minutes (NaN if none),
    /// entries with a timestamp, reserved.
    pub summary: [f64; SUMMARY_LEN],
}

#[derive(Clone, Copy)]
struct Stamp {
    ms: f64,
    start: usize,
    end: usize,
    kind: u8,
    /// Zone offset in minutes, or i32::MIN when the stamp has none.
    zone: i32,
}

#[derive(Clone, Copy, Default)]
struct Span {
    off: usize,
    len: usize,
}

struct Entry {
    ms: f64,
    level: u8,
    fmt: u8,
    zone: i32,
    prefixed: bool,
    thread: Span,
    logger: Span,
    trace: Span,
    msg: usize,
}

#[inline]
fn is_digit(b: u8) -> bool {
    b >= b'0' && b <= b'9'
}

#[inline]
fn is_alnum(b: u8) -> bool {
    is_digit(b) || (b >= b'a' && b <= b'z') || (b >= b'A' && b <= b'Z')
}

#[inline]
fn is_hex(b: u8) -> bool {
    is_digit(b) || (b >= b'a' && b <= b'f')
}

#[inline]
fn is_name(b: u8) -> bool {
    is_alnum(b) || b == b'.' || b == b'_' || b == b'$' || b == b'-' || b == b'/'
}

fn num(l: &[u8], at: usize, n: usize) -> i64 {
    if at + n > l.len() {
        return -1;
    }
    let mut v: i64 = 0;
    for &b in &l[at..at + n] {
        if !is_digit(b) {
            return -1;
        }
        v = v * 10 + (b - b'0') as i64;
    }
    v
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn to_ms(y: i64, mo: i64, d: i64, h: i64, mi: i64, s: i64, frac: i64) -> f64 {
    ((days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + s) * 1000 + frac) as f64
}

fn month(l: &[u8], at: usize) -> i64 {
    if at + 3 > l.len() {
        return -1;
    }
    match &l[at..at + 3] {
        b"Jan" => 1,
        b"Feb" => 2,
        b"Mar" => 3,
        b"Apr" => 4,
        b"May" => 5,
        b"Jun" => 6,
        b"Jul" => 7,
        b"Aug" => 8,
        b"Sep" => 9,
        b"Oct" => 10,
        b"Nov" => 11,
        b"Dec" => 12,
        _ => -1,
    }
}

/// HH:MM:SS at `at`; returns (h, m, s) or h = -1.
fn hms(l: &[u8], at: usize) -> (i64, i64, i64) {
    let h = num(l, at, 2);
    let m = num(l, at + 3, 2);
    let s = num(l, at + 6, 2);
    if h < 0 || m < 0 || s < 0 || h > 23 || m > 59 || s > 60 || l[at + 2] != b':' || l[at + 5] != b':' {
        return (-1, 0, 0);
    }
    (h, m, s)
}

/// Optional fraction ".123" / ",123456" at `at`; returns (ms, new position).
fn fraction(l: &[u8], at: usize) -> (i64, usize) {
    if at + 1 < l.len() && (l[at] == b'.' || l[at] == b',') && is_digit(l[at + 1]) {
        let mut p = at + 1;
        let mut ms: i64 = 0;
        let mut n = 0;
        while p < l.len() && is_digit(l[p]) {
            if n < 3 {
                ms = ms * 10 + (l[p] - b'0') as i64;
                n += 1;
            }
            p += 1;
        }
        while n < 3 {
            ms *= 10;
            n += 1;
        }
        return (ms, p);
    }
    (0, at)
}

/// Optional zone "Z", "+05:30", "+0530", " +0530" at `at`; returns (minutes or MIN, new position).
fn zone(l: &[u8], at: usize) -> (i32, usize) {
    let n = l.len();
    if at < n && l[at] == b'Z' {
        return (0, at + 1);
    }
    let mut p = at;
    if p + 5 < n && l[p] == b' ' && (l[p + 1] == b'+' || l[p + 1] == b'-') && num(l, p + 2, 4) >= 0 {
        p += 1;
    }
    if p < n && (l[p] == b'+' || l[p] == b'-') {
        let sign = if l[p] == b'-' { -1 } else { 1 };
        let hh = num(l, p + 1, 2);
        if hh >= 0 {
            let colon = p + 3 < n && l[p + 3] == b':';
            let mm = num(l, if colon { p + 4 } else { p + 3 }, 2);
            if mm >= 0 {
                return (sign * (hh * 60 + mm) as i32, if colon { p + 6 } else { p + 5 });
            }
        }
    }
    (i32::MIN, at)
}

fn try_iso(l: &[u8], p: usize) -> Option<Stamp> {
    if p + 19 > l.len() {
        return None;
    }
    let y = num(l, p, 4);
    let sep = l[p + 4];
    if y < 1970 || (sep != b'-' && sep != b'/') || l[p + 7] != sep {
        return None;
    }
    let mo = num(l, p + 5, 2);
    let d = num(l, p + 8, 2);
    if mo < 1 || mo > 12 || d < 1 || d > 31 || (l[p + 10] != b'T' && l[p + 10] != b' ') {
        return None;
    }
    let (h, mi, s) = hms(l, p + 11);
    if h < 0 {
        return None;
    }
    let (frac, after) = fraction(l, p + 19);
    let (zn, end) = zone(l, after);
    Some(Stamp { ms: to_ms(y, mo, d, h, mi, s, frac), start: p, end, kind: TK_ISO, zone: zn })
}

/// 14/Mar/2026:10:15:02 +0530
fn try_access(l: &[u8], p: usize) -> Option<Stamp> {
    if p + 20 > l.len() || l[p + 2] != b'/' || l[p + 6] != b'/' || l[p + 11] != b':' {
        return None;
    }
    let d = num(l, p, 2);
    let mo = month(l, p + 3);
    let y = num(l, p + 7, 4);
    if d < 1 || d > 31 || mo < 0 || y < 1970 {
        return None;
    }
    let (h, mi, s) = hms(l, p + 12);
    if h < 0 {
        return None;
    }
    let (zn, end) = zone(l, p + 20);
    Some(Stamp { ms: to_ms(y, mo, d, h, mi, s, 0), start: p, end, kind: TK_ACCESS, zone: zn })
}

/// "Mar 14 10:15:02" (syslog) or "Mar 14, 2026 10:15:02 AM" (java.util.logging).
fn try_month(l: &[u8], p: usize, default_year: i64) -> Option<Stamp> {
    let n = l.len();
    let mo = month(l, p);
    if mo < 0 || p + 4 >= n || l[p + 3] != b' ' {
        return None;
    }
    let mut q = p + 4;
    if q < n && l[q] == b' ' {
        q += 1;
    }
    let mut d: i64 = 0;
    let ds = q;
    while q < n && is_digit(l[q]) && q - ds < 2 {
        d = d * 10 + (l[q] - b'0') as i64;
        q += 1;
    }
    if q == ds || d < 1 || d > 31 || q >= n {
        return None;
    }
    if l[q] == b',' {
        // Mar 14, 2026 10:15:02 AM
        if q + 6 >= n || l[q + 1] != b' ' {
            return None;
        }
        let y = num(l, q + 2, 4);
        if y < 1970 || q + 6 >= n || l[q + 6] != b' ' {
            return None;
        }
        let mut t = q + 7;
        let mut h: i64 = 0;
        let hs = t;
        while t < n && is_digit(l[t]) && t - hs < 2 {
            h = h * 10 + (l[t] - b'0') as i64;
            t += 1;
        }
        if t == hs || t + 6 > n || l[t] != b':' || l[t + 3] != b':' {
            return None;
        }
        let mi = num(l, t + 1, 2);
        let s = num(l, t + 4, 2);
        if mi < 0 || s < 0 || h > 23 || mi > 59 {
            return None;
        }
        let mut end = t + 6;
        if end + 2 < n && l[end] == b' ' && (l[end + 1] == b'A' || l[end + 1] == b'P') && l[end + 2] == b'M' {
            if l[end + 1] == b'P' && h < 12 {
                h += 12;
            } else if l[end + 1] == b'A' && h == 12 {
                h = 0;
            }
            end += 3;
        }
        return Some(Stamp { ms: to_ms(y, mo, d, h, mi, s, 0), start: p, end, kind: TK_JUL, zone: i32::MIN });
    }
    if l[q] != b' ' || q + 9 > n {
        return None;
    }
    let (h, mi, s) = hms(l, q + 1);
    if h < 0 {
        return None;
    }
    let (frac, end) = fraction(l, q + 9);
    Some(Stamp { ms: to_ms(default_year, mo, d, h, mi, s, frac), start: p, end, kind: TK_MONTH, zone: i32::MIN })
}

/// 10 digits (seconds, optional .fraction) or 13 digits (milliseconds).
fn try_epoch(l: &[u8], p: usize) -> Option<Stamp> {
    let n = l.len();
    let mut q = p;
    while q < n && is_digit(l[q]) && q - p < 14 {
        q += 1;
    }
    let digits = q - p;
    if digits != 10 && digits != 13 {
        return None;
    }
    let mut v: i64 = 0;
    for &b in &l[p..q] {
        v = v * 10 + (b - b'0') as i64;
    }
    let mut ms = if digits == 10 { v * 1000 } else { v };
    let mut end = q;
    if digits == 10 {
        let (frac, after) = fraction(l, q);
        ms += frac;
        end = after;
    }
    // 2001-01-01 .. 2100-01-01
    if ms < 978307200000 || ms > 4102444800000 {
        return None;
    }
    if end < n && (is_alnum(l[end]) || l[end] == b'-' || l[end] == b'_') {
        return None;
    }
    Some(Stamp { ms: ms as f64, start: p, end, kind: TK_EPOCH, zone: 0 })
}

fn try_time(l: &[u8], p: usize) -> Option<Stamp> {
    if p + 8 > l.len() {
        return None;
    }
    let (h, mi, s) = hms(l, p);
    if h < 0 {
        return None;
    }
    let (frac, end) = fraction(l, p + 8);
    if end < l.len() && is_alnum(l[end]) {
        return None;
    }
    Some(Stamp { ms: to_ms(1970, 1, 1, h, mi, s, frac), start: p, end, kind: TK_TIME, zone: i32::MIN })
}

fn find_stamp(l: &[u8], default_year: i64) -> Option<Stamp> {
    let limit = if l.len() < TS_WINDOW { l.len() } else { TS_WINDOW };
    let mut p = 0;
    while p < limit {
        let b = l[p];
        let boundary = p == 0 || !(is_alnum(l[p - 1]) || l[p - 1] == b'.' || l[p - 1] == b'_' || l[p - 1] == b'-' || l[p - 1] == b':' || l[p - 1] == b'/');
        if boundary {
            if is_digit(b) {
                if let Some(s) = try_iso(l, p) {
                    return Some(s);
                }
                if let Some(s) = try_access(l, p) {
                    return Some(s);
                }
                if let Some(s) = try_epoch(l, p) {
                    return Some(s);
                }
                if p == 0 || (p == 1 && l[0] == b'[') {
                    if let Some(s) = try_time(l, p) {
                        return Some(s);
                    }
                }
            } else if b >= b'A' && b <= b'S' {
                if let Some(s) = try_month(l, p, default_year) {
                    return Some(s);
                }
            }
        }
        p += 1;
    }
    None
}

const LEVEL_WORDS: [(&[u8], u8); 13] = [
    (b"TRACE", LV_TRACE),
    (b"DEBUG", LV_DEBUG),
    (b"INFO", LV_INFO),
    (b"WARNING", LV_WARN),
    (b"WARN", LV_WARN),
    (b"ERROR", LV_ERROR),
    (b"FATAL", LV_FATAL),
    (b"SEVERE", LV_ERROR),
    (b"CRITICAL", LV_FATAL),
    (b"NOTICE", LV_INFO),
    (b"FINEST", LV_TRACE),
    (b"FINER", LV_TRACE),
    (b"FINE", LV_DEBUG),
];

/// An upper-case level word at `p`, bounded by non-alphanumerics. Returns (level, length).
fn level_at(l: &[u8], p: usize) -> (u8, usize) {
    if p > 0 && (is_alnum(l[p - 1]) || l[p - 1] == b'_' || l[p - 1] == b'.') {
        return (LV_NONE, 0);
    }
    for (word, lv) in LEVEL_WORDS.iter() {
        let e = p + word.len();
        if e <= l.len() && &l[p..e] == *word && (e == l.len() || !(is_alnum(l[e]) || l[e] == b'_')) {
            return (*lv, word.len());
        }
    }
    (LV_NONE, 0)
}

/// First level word in l[from..to). Returns (level, start, end).
fn find_level(l: &[u8], from: usize, to: usize) -> (u8, usize, usize) {
    let to = if to > l.len() { l.len() } else { to };
    let mut p = from;
    while p < to {
        let b = l[p];
        if b >= b'C' && b <= b'W' {
            let (lv, len) = level_at(l, p);
            if lv != LV_NONE {
                return (lv, p, p + len);
            }
        }
        p += 1;
    }
    (LV_NONE, 0, 0)
}

fn lower(b: u8) -> u8 {
    if b >= b'A' && b <= b'Z' {
        b + 32
    } else {
        b
    }
}

fn eq_ci(a: &[u8], word: &[u8]) -> bool {
    a.len() == word.len() && a.iter().zip(word.iter()).all(|(x, y)| lower(*x) == *y)
}

/// Level from a JSON value (any case, or a pino-style number).
fn level_value(v: &[u8]) -> u8 {
    if v.is_empty() {
        return LV_NONE;
    }
    if is_digit(v[0]) {
        let mut n: i64 = 0;
        for &b in v {
            if !is_digit(b) {
                break;
            }
            n = n * 10 + (b - b'0') as i64;
        }
        return if n >= 60 {
            LV_FATAL
        } else if n >= 50 {
            LV_ERROR
        } else if n >= 40 {
            LV_WARN
        } else if n >= 30 {
            LV_INFO
        } else if n >= 20 {
            LV_DEBUG
        } else {
            LV_TRACE
        };
    }
    if eq_ci(v, b"trace") || eq_ci(v, b"finest") || eq_ci(v, b"finer") {
        LV_TRACE
    } else if eq_ci(v, b"debug") || eq_ci(v, b"fine") {
        LV_DEBUG
    } else if eq_ci(v, b"info") || eq_ci(v, b"information") || eq_ci(v, b"notice") {
        LV_INFO
    } else if eq_ci(v, b"warn") || eq_ci(v, b"warning") {
        LV_WARN
    } else if eq_ci(v, b"error") || eq_ci(v, b"err") || eq_ci(v, b"severe") {
        LV_ERROR
    } else if eq_ci(v, b"fatal") || eq_ci(v, b"critical") || eq_ci(v, b"panic") {
        LV_FATAL
    } else {
        LV_NONE
    }
}

/// True for 16+ hex digits, optionally "-" and more hex (trace-span).
fn is_trace(v: &[u8]) -> bool {
    let mut n = 0;
    while n < v.len() && is_hex(v[n]) {
        n += 1;
    }
    if n < 16 {
        return false;
    }
    if n == v.len() {
        return true;
    }
    if v[n] != b'-' {
        return false;
    }
    let rest = &v[n + 1..];
    !rest.is_empty() && rest.iter().all(|b| is_hex(*b))
}

/// Looks for traceId= / trace_id": / trace.id: followed by 16+ hex digits.
fn find_trace(l: &[u8], base: usize) -> Span {
    let limit = if l.len() < 600 { l.len() } else { 600 };
    let mut p = 0;
    while p + 7 < limit {
        if lower(l[p]) == b't' && lower(l[p + 1]) == b'r' && lower(l[p + 2]) == b'a' && lower(l[p + 3]) == b'c' && lower(l[p + 4]) == b'e' {
            let mut q = p + 5;
            if q < limit && (l[q] == b'_' || l[q] == b'.' || l[q] == b'-') {
                q += 1;
            }
            if q + 1 < limit && lower(l[q]) == b'i' && lower(l[q + 1]) == b'd' {
                q += 2;
                while q < l.len() && (l[q] == b'"' || l[q] == b'=' || l[q] == b':' || l[q] == b' ' || l[q] == b'\'') {
                    q += 1;
                }
                let s = q;
                while q < l.len() && is_hex(l[q]) {
                    q += 1;
                }
                if q - s >= 16 {
                    return Span { off: base + s, len: q - s };
                }
            }
        }
        p += 1;
    }
    Span::default()
}

fn trim(l: &[u8], mut a: usize, mut b: usize) -> (usize, usize) {
    while a < b && l[a] == b' ' {
        a += 1;
    }
    while b > a && l[b - 1] == b' ' {
        b -= 1;
    }
    (a, b)
}

fn skip_spaces(l: &[u8], mut p: usize) -> usize {
    while p < l.len() && l[p] == b' ' {
        p += 1;
    }
    p
}

/// One line of a JSON-lines log. Only top-level keys are read.
fn parse_json(l: &[u8], base: usize, default_year: i64) -> Option<Entry> {
    let n = l.len();
    let mut e = Entry { ms: f64::NAN, level: LV_NONE, fmt: FMT_JSON, zone: i32::MIN, prefixed: false, thread: Span::default(), logger: Span::default(), trace: Span::default(), msg: base };
    let mut found = false;
    let mut depth = 0i32;
    let mut p = 0;
    while p < n {
        let b = l[p];
        if b == b'{' || b == b'[' {
            depth += 1;
            p += 1;
        } else if b == b'}' || b == b']' {
            depth -= 1;
            p += 1;
        } else if b == b'"' {
            let ks = p + 1;
            let mut q = ks;
            while q < n && l[q] != b'"' {
                if l[q] == b'\\' {
                    q += 1;
                }
                q += 1;
            }
            let ke = if q > n { n } else { q };
            p = ke + 1;
            if depth != 1 {
                continue;
            }
            let mut c = skip_spaces(l, p);
            if c >= n || l[c] != b':' {
                continue;
            }
            c = skip_spaces(l, c + 1);
            if c >= n {
                break;
            }
            // Value span: string contents, or a bare token.
            let (vs, ve, next);
            if l[c] == b'"' {
                let mut v = c + 1;
                while v < n && l[v] != b'"' {
                    if l[v] == b'\\' {
                        v += 1;
                    }
                    v += 1;
                }
                let vend = if v > n { n } else { v };
                vs = c + 1;
                ve = vend;
                next = vend + 1;
            } else if l[c] == b'{' || l[c] == b'[' {
                p = c;
                continue;
            } else {
                let mut v = c;
                while v < n && l[v] != b',' && l[v] != b'}' && l[v] != b' ' {
                    v += 1;
                }
                vs = c;
                ve = v;
                next = v;
            }
            let key = &l[ks..ke];
            let val = &l[vs..ve];
            match key {
                b"@timestamp" | b"timestamp" | b"time" | b"ts" | b"date" | b"datetime" | b"t" => {
                    if e.ms.is_nan() {
                        if let Some(s) = try_iso(val, 0) {
                            e.ms = s.ms;
                            e.zone = s.zone;
                            found = true;
                        } else if let Some(s) = try_epoch(val, 0) {
                            e.ms = s.ms;
                            e.zone = 0;
                            found = true;
                        } else if let Some(s) = try_month(val, 0, default_year) {
                            e.ms = s.ms;
                            found = true;
                        }
                    }
                }
                b"level" | b"severity" | b"log.level" | b"lvl" | b"loglevel" | b"levelname" => {
                    if e.level == LV_NONE {
                        e.level = level_value(val);
                        if e.level != LV_NONE {
                            found = true;
                        }
                    }
                }
                b"logger" | b"logger_name" | b"loggerName" | b"log.logger" => {
                    e.logger = Span { off: base + vs, len: ve - vs };
                }
                b"thread" | b"thread_name" | b"threadName" | b"process.thread.name" => {
                    e.thread = Span { off: base + vs, len: ve - vs };
                }
                b"traceId" | b"trace_id" | b"trace.id" | b"traceid" | b"dd.trace_id" => {
                    if ve > vs {
                        e.trace = Span { off: base + vs, len: ve - vs };
                    }
                }
                b"message" | b"msg" | b"log" => {
                    e.msg = base + vs;
                    found = true;
                }
                _ => {}
            }
            p = next;
        } else {
            p += 1;
        }
    }
    if found {
        Some(e)
    } else {
        None
    }
}

/// Parses one line (without its line break). None means "continuation line".
fn parse_line(l: &[u8], base: usize, default_year: i64) -> Option<Entry> {
    let n = l.len();
    if n == 0 || l[0] == b' ' || l[0] == b'\t' {
        return None;
    }
    if l[0] == b'{' {
        return parse_json(l, base, default_year);
    }
    let st = find_stamp(l, default_year)?;
    let mut e = Entry { ms: st.ms, level: LV_NONE, fmt: FMT_GENERIC, zone: st.zone, prefixed: st.start > 0 && l[0] == b'[' && st.kind != TK_ACCESS && st.kind != TK_TIME, thread: Span::default(), logger: Span::default(), trace: Span::default(), msg: base + st.end };

    if st.kind == TK_ACCESS {
        // ip - user [date] "GET /path HTTP/1.1" 200 123
        e.fmt = FMT_ACCESS;
        e.level = LV_INFO;
        let mut q = st.end;
        while q < n && l[q] != b'"' {
            q += 1;
        }
        if q < n {
            e.msg = base + q + 1;
            let mut c = q + 1;
            while c < n && l[c] != b'"' {
                c += 1;
            }
            let s = skip_spaces(l, c + 1);
            let status = num(l, s, 3);
            if status >= 500 {
                e.level = LV_ERROR;
            } else if status >= 400 {
                e.level = LV_WARN;
            }
        }
        return Some(e);
    }

    // Level: normally just after the timestamp, sometimes just before it.
    let (mut lv, mut ls, mut le) = find_level(l, st.end, st.end + 96);
    if lv == LV_NONE && st.start > 0 {
        let r = find_level(l, 0, st.start);
        lv = r.0;
        ls = r.1;
        le = r.2;
        if lv != LV_NONE {
            le = st.end;
            ls = st.end;
        }
    }
    e.level = lv;
    let after = if lv != LV_NONE { le } else { st.end };
    let _ = ls;

    // Spring Boot: "LEVEL pid --- [app] [thread] [trace-span] logger : message"
    let mut c = skip_spaces(l, after);
    let pid = c;
    while c < n && is_digit(l[c]) {
        c += 1;
    }
    let d = skip_spaces(l, c);
    if lv != LV_NONE && c > pid && d + 3 <= n && &l[d..d + 3] == b"---" {
        e.fmt = FMT_SPRING;
        let mut q = skip_spaces(l, d + 3);
        let mut groups: [(usize, usize); 4] = [(0, 0); 4];
        let mut count = 0;
        while q < n && l[q] == b'[' && count < 4 {
            let mut r = q + 1;
            while r < n && l[r] != b']' {
                r += 1;
            }
            if r >= n {
                break;
            }
            groups[count] = trim(l, q + 1, r);
            count += 1;
            q = skip_spaces(l, r + 1);
        }
        let mut plain: [(usize, usize); 4] = [(0, 0); 4];
        let mut plain_n = 0;
        for g in groups.iter().take(count) {
            if is_trace(&l[g.0..g.1]) {
                e.trace = Span { off: base + g.0, len: g.1 - g.0 };
            } else {
                plain[plain_n] = *g;
                plain_n += 1;
            }
        }
        if plain_n > 0 {
            let t = plain[plain_n - 1];
            e.thread = Span { off: base + t.0, len: t.1 - t.0 };
        }
        let ls2 = q;
        while q < n && l[q] != b' ' {
            q += 1;
        }
        if q > ls2 {
            e.logger = Span { off: base + ls2, len: q - ls2 };
        }
        let mut m = q;
        while m + 2 < n && !(l[m] == b' ' && l[m + 1] == b':' && l[m + 2] == b' ') {
            m += 1;
        }
        e.msg = base + if m + 2 < n { m + 3 } else { q };
        if e.trace.len == 0 {
            e.trace = find_trace(l, base);
        }
        return Some(e);
    }

    e.fmt = if st.kind == TK_EPOCH {
        FMT_EPOCH
    } else if st.kind == TK_JUL {
        FMT_JUL
    } else if st.kind == TK_MONTH {
        FMT_SYSLOG
    } else if lv != LV_NONE {
        FMT_LOGBACK
    } else {
        FMT_GENERIC
    };

    // Bracket groups near the start: a thread name and/or a trace id.
    let scan_to = if st.end + 160 < n { st.end + 160 } else { n };
    let mut q = st.end;
    let mut seen = 0;
    while q < scan_to && seen < 4 {
        if l[q] == b'[' {
            let mut r = q + 1;
            while r < n && l[r] != b']' && r - q <= 80 {
                r += 1;
            }
            if r < n && l[r] == b']' {
                let g = trim(l, q + 1, r);
                seen += 1;
                if g.1 > g.0 && level_at(l, g.0).0 == LV_NONE {
                    if is_trace(&l[g.0..g.1]) {
                        if e.trace.len == 0 {
                            e.trace = Span { off: base + g.0, len: g.1 - g.0 };
                        }
                    } else if e.thread.len == 0 {
                        e.thread = Span { off: base + g.0, len: g.1 - g.0 };
                    }
                }
                q = r + 1;
                continue;
            }
        }
        q += 1;
    }

    // Logger: the name just before " - " or ": " / " : ".
    // (syslog has no level before the program name, so start at the timestamp.)
    let after = if e.fmt == FMT_SYSLOG { st.end } else { after };
    let sep_to = if after + 240 < n { after + 240 } else { n };
    let mut m = after;
    let mut msg = after;
    while m + 1 < sep_to {
        let dash = l[m] == b' ' && l[m + 1] == b'-' && m + 2 < n && l[m + 2] == b' ';
        let colon = l[m] == b':' && l[m + 1] == b' ';
        if dash || colon {
            let mut name_end = m;
            while name_end > after && l[name_end - 1] == b' ' {
                name_end -= 1;
            }
            let mut name_start = name_end;
            while name_start > after && is_name(l[name_start - 1]) {
                name_start -= 1;
            }
            // syslog "proc[123]:" -> drop the pid part
            if name_start == name_end && name_end > after && l[name_end - 1] == b']' {
                let mut b2 = name_end - 1;
                while b2 > after && l[b2] != b'[' {
                    b2 -= 1;
                }
                name_end = b2;
                name_start = name_end;
                while name_start > after && is_name(l[name_start - 1]) {
                    name_start -= 1;
                }
            }
            // A logger looks like a class or program name, not an ordinary word.
            let mut dotted = false;
            let mut k = name_start;
            while k < name_end {
                if l[k] == b'.' {
                    dotted = true;
                }
                k += 1;
            }
            let named = name_end - name_start >= 2 && !is_digit(l[name_start]) && (e.fmt == FMT_SYSLOG || dotted || (l[name_start] >= b'A' && l[name_start] <= b'Z'));
            if named {
                e.logger = Span { off: base + name_start, len: name_end - name_start };
                msg = if dash { m + 3 } else { m + 2 };
            }
            break;
        }
        m += 1;
    }
    e.msg = base + skip_spaces(l, msg);
    if e.trace.len == 0 {
        e.trace = find_trace(l, base);
    }
    Some(e)
}

/// Flags for a continuation line.
fn continuation_flags(l: &[u8]) -> u8 {
    let mut p = 0;
    while p < l.len() && (l[p] == b' ' || l[p] == b'\t') {
        p += 1;
    }
    let r = &l[p..];
    if r.starts_with(b"at ") || r.starts_with(b"... ") {
        FLAG_FRAME
    } else if r.starts_with(b"Caused by:") || r.starts_with(b"Suppressed:") {
        FLAG_CAUSE
    } else {
        0
    }
}

pub fn parse_log(bytes: &[u8], default_year: i64) -> LogIndex {
    let mut ix = LogIndex::default();
    let n = bytes.len();
    let mut fmt_votes = [0u32; FMT_COUNT];
    let mut counts = [0f64; 7];
    let mut prefixed = 0f64;
    let mut stamped = 0f64;
    let mut first_ts = f64::NAN;
    let mut last_ts = f64::NAN;
    let mut zone = i32::MIN;
    let mut cur_level = LV_NONE;
    let mut cur_ts = f64::NAN;
    // Index (in `level`) of the current entry's first line when its level is still unknown.
    let mut pending: usize = usize::MAX;
    let mut entries = 0f64;

    let mut start = 0usize;
    loop {
        let mut end = start;
        while end < n && bytes[end] != b'\n' {
            end += 1;
        }
        let mut stop = end;
        if stop > start && bytes[stop - 1] == b'\r' {
            stop -= 1;
        }
        let line = &bytes[start..stop];
        let li = ix.level.len();
        ix.line_start.push(start as u32);
        match parse_line(line, start, default_year) {
            Some(e) => {
                entries += 1.0;
                fmt_votes[e.fmt as usize] += 1;
                if e.prefixed {
                    prefixed += 1.0;
                }
                if !e.ms.is_nan() {
                    stamped += 1.0;
                    if first_ts.is_nan() {
                        first_ts = e.ms;
                    }
                    last_ts = e.ms;
                }
                if zone == i32::MIN && e.zone != i32::MIN {
                    zone = e.zone;
                }
                cur_level = e.level;
                cur_ts = e.ms;
                pending = if e.level == LV_NONE { li } else { usize::MAX };
                counts[e.level as usize] += 1.0;
                ix.level.push(e.level);
                ix.flags.push(FLAG_ENTRY);
                ix.ts.push(e.ms);
                ix.fields.extend_from_slice(&[li as u32, e.thread.off as u32, e.thread.len as u32, e.logger.off as u32, e.logger.len as u32, e.trace.off as u32, e.trace.len as u32, e.msg as u32]);
            }
            None => {
                // java.util.logging puts "SEVERE: message" on the line after the date.
                if pending != usize::MAX && pending + 1 == li {
                    let (lv, len) = level_at(line, 0);
                    if lv != LV_NONE && len < line.len() && line[len] == b':' {
                        counts[LV_NONE as usize] -= 1.0;
                        counts[lv as usize] += 1.0;
                        ix.level[pending] = lv;
                        cur_level = lv;
                    }
                }
                pending = usize::MAX;
                ix.level.push(cur_level);
                ix.flags.push(continuation_flags(line));
                ix.ts.push(cur_ts);
            }
        }
        if end >= n {
            break;
        }
        start = end + 1;
    }

    let mut fmt = FMT_NONE;
    let mut best = 0u32;
    for (i, v) in fmt_votes.iter().enumerate() {
        if *v > best {
            best = *v;
            fmt = i as u8;
        }
    }
    let s = &mut ix.summary;
    s[0] = ix.level.len() as f64;
    s[1] = entries;
    s[2] = fmt as f64;
    s[3] = prefixed;
    s[4] = first_ts;
    s[5] = last_ts;
    s[6..13].copy_from_slice(&counts);
    s[13] = if zone == i32::MIN { f64::NAN } else { zone as f64 };
    s[14] = stamped;
    s[15] = 0.0;
    ix
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text<'a>(src: &'a [u8], off: u32, len: u32) -> &'a str {
        std::str::from_utf8(&src[off as usize..(off + len) as usize]).unwrap()
    }

    fn ms(y: i64, mo: i64, d: i64, h: i64, mi: i64, s: i64, f: i64) -> f64 {
        to_ms(y, mo, d, h, mi, s, f)
    }

    #[test]
    fn spring_boot_line_with_trace() {
        let src = b"2026-03-14T10:15:02.171+05:30  INFO 18244 --- [order-service] [nio-8080-exec-3] [6f1c2a9b4d3e4f10a1b2c3d4e5f60718-9a8b7c6d5e4f3a2b] c.acme.orders.web.OrderController      : GET /api/orders/90001";
        let ix = parse_log(src, 2026);
        assert_eq!(ix.summary[2] as u8, FMT_SPRING);
        assert_eq!(ix.level[0], LV_INFO);
        assert_eq!(ix.ts[0], ms(2026, 3, 14, 10, 15, 2, 171));
        assert_eq!(ix.summary[13], 330.0);
        let f = &ix.fields;
        assert_eq!(text(src, f[1], f[2]), "nio-8080-exec-3");
        assert_eq!(text(src, f[3], f[4]), "c.acme.orders.web.OrderController");
        assert_eq!(text(src, f[5], f[6]), "6f1c2a9b4d3e4f10a1b2c3d4e5f60718-9a8b7c6d5e4f3a2b");
        assert!(src[f[7] as usize..].starts_with(b"GET /api"));
    }

    #[test]
    fn stack_trace_lines_belong_to_their_entry() {
        let src = b"2026-03-14 10:15:02,118 ERROR [main] com.acme.Foo - boom\njava.lang.IllegalStateException: bad\n\tat com.acme.Foo.run(Foo.java:10)\nCaused by: java.io.IOException: disk\n\t... 12 more\n2026-03-14 10:15:03,000 INFO [main] com.acme.Foo - ok";
        let ix = parse_log(src, 2026);
        assert_eq!(ix.summary[1], 2.0);
        assert_eq!(ix.level, vec![5, 5, 5, 5, 5, 3]);
        assert_eq!(ix.flags, vec![1, 0, FLAG_FRAME, FLAG_CAUSE, FLAG_FRAME, 1]);
        assert_eq!(ix.summary[2] as u8, FMT_LOGBACK);
        let f = &ix.fields;
        assert_eq!(text(src, f[1], f[2]), "main");
        assert_eq!(text(src, f[3], f[4]), "com.acme.Foo");
    }

    #[test]
    fn crlf_parses_like_lf() {
        let lf = b"2026-03-14 10:15:02 INFO a - one\n  more\n2026-03-14 10:15:03 WARN a - two\n";
        let crlf = b"2026-03-14 10:15:02 INFO a - one\r\n  more\r\n2026-03-14 10:15:03 WARN a - two\r\n";
        let a = parse_log(lf, 2026);
        let b = parse_log(crlf, 2026);
        assert_eq!(a.level, b.level);
        assert_eq!(a.flags, b.flags);
        assert_eq!(a.ts, b.ts);
        assert_eq!(a.summary[0], b.summary[0]);
    }

    #[test]
    fn kubernetes_prefix_does_not_collapse_entries() {
        let src = b"[orders-7d9f8b6c5-x2k4q app] 2026-03-14T10:15:02.118Z INFO started\n[orders-7d9f8b6c5-x2k4q app] 2026-03-14T10:15:03.118Z ERROR failed\n[orders-7d9f8b6c5-x2k4q app] 2026-03-14T10:15:04.118Z INFO again";
        let ix = parse_log(src, 2026);
        assert_eq!(ix.summary[1], 3.0);
        assert_eq!(ix.summary[3], 3.0);
        assert_eq!(ix.level, vec![3, 5, 3]);
    }

    #[test]
    fn epoch_json_access_syslog_and_jul() {
        let e = parse_log(b"1773483302118 ERROR pool exhausted\n1773483303 INFO ok", 2026);
        assert_eq!(e.summary[2] as u8, FMT_EPOCH);
        assert_eq!(e.ts[0], 1773483302118.0);
        assert_eq!(e.ts[1], 1773483303000.0);

        let j = parse_log(br#"{"@timestamp":"2026-03-14T10:15:02.118Z","level":"warn","logger_name":"c.a.Foo","thread_name":"main","traceId":"6f1c2a9b4d3e4f10","message":"slow"}"#, 2026);
        assert_eq!(j.summary[2] as u8, FMT_JSON);
        assert_eq!(j.level[0], LV_WARN);
        assert_eq!(j.fields[6], 16);

        let a = parse_log(b"10.24.3.17 - ravi [14/Mar/2026:10:15:02 +0530] \"GET /api/orders/90001 HTTP/1.1\" 503 512 \"-\" \"curl/8\"", 2026);
        assert_eq!(a.summary[2] as u8, FMT_ACCESS);
        assert_eq!(a.level[0], LV_ERROR);
        assert_eq!(a.ts[0], ms(2026, 3, 14, 10, 15, 2, 0));

        let s = parse_log(b"Mar 14 10:15:02 web-1 sshd[4242]: ERROR Failed password for root", 2026);
        assert_eq!(s.summary[2] as u8, FMT_SYSLOG);
        assert_eq!(s.level[0], LV_ERROR);

        let u = parse_log(b"Mar 14, 2026 10:15:02 PM com.acme.Foo run\nSEVERE: it broke\nMar 14, 2026 10:15:03 PM com.acme.Foo run\nINFO: fine", 2026);
        assert_eq!(u.summary[2] as u8, FMT_JUL);
        assert_eq!(u.level, vec![5, 5, 3, 3]);
        assert_eq!(u.ts[0], ms(2026, 3, 14, 22, 15, 2, 0));
    }

    #[test]
    fn prose_is_not_a_log() {
        let ix = parse_log(b"Meeting notes\n\nWe discussed 3 things at length.\nNothing here has a time.", 2026);
        assert_eq!(ix.summary[1], 0.0);
        assert_eq!(ix.summary[2] as u8, FMT_NONE);
    }
}

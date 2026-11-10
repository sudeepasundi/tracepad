//! Tracepad engine: byte-level work that runs inside a Web Worker as WebAssembly.
//!
//! The ABI is deliberately plain (`extern "C"`, pointers and lengths) so the
//! module needs no JS glue generator and no imports. Every function here has a
//! TypeScript twin in `src/engine/` that must return identical results; the
//! parity tests in `tests/unit` enforce that.

pub mod log;

/// Result of one pass over a byte buffer. Field order is the wire format:
/// the wasm export writes these as eight `f64` values in this order.
#[derive(Debug, Default, PartialEq, Clone, Copy)]
pub struct ScanStats {
    /// Number of lines (line breaks + 1; an empty buffer has 1 line).
    pub lines: u64,
    /// Lone `\n` line breaks.
    pub lf: u64,
    /// `\r\n` line breaks.
    pub crlf: u64,
    /// Lone `\r` line breaks.
    pub cr: u64,
    /// NUL bytes (a strong hint that the data is binary or UTF-16).
    pub nul: u64,
    /// Bytes >= 0x80.
    pub high: u64,
    /// Control bytes other than tab, LF, CR, FF and ESC.
    pub control: u64,
    /// Longest line in bytes, excluding its line break.
    pub max_line: u64,
}

pub fn scan(bytes: &[u8]) -> ScanStats {
    let mut s = ScanStats::default();
    let mut line_start = 0usize;
    let mut i = 0usize;
    let n = bytes.len();
    while i < n {
        let b = bytes[i];
        if b == b'\n' {
            s.lf += 1;
            let len = (i - line_start) as u64;
            if len > s.max_line {
                s.max_line = len;
            }
            line_start = i + 1;
        } else if b == b'\r' {
            let len = (i - line_start) as u64;
            if len > s.max_line {
                s.max_line = len;
            }
            if i + 1 < n && bytes[i + 1] == b'\n' {
                s.crlf += 1;
                i += 1;
            } else {
                s.cr += 1;
            }
            line_start = i + 1;
        } else if b == 0 {
            s.nul += 1;
        } else if b >= 0x80 {
            s.high += 1;
        } else if b < 0x20 && b != b'\t' && b != 0x0c && b != 0x1b {
            s.control += 1;
        }
        i += 1;
    }
    let tail = (n - line_start) as u64;
    if tail > s.max_line {
        s.max_line = tail;
    }
    s.lines = s.lf + s.crlf + s.cr + 1;
    s
}

// ---------------------------------------------------------------- wasm ABI

/// ABI version; bump when an export changes shape.
#[no_mangle]
pub extern "C" fn tp_abi() -> u32 {
    2
}

#[no_mangle]
pub extern "C" fn tp_alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len.max(1));
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// # Safety
/// `ptr` must come from `tp_alloc(len)` and must not be used afterwards.
#[no_mangle]
pub unsafe extern "C" fn tp_free(ptr: *mut u8, len: usize) {
    drop(Vec::from_raw_parts(ptr, 0, len.max(1)));
}

/// Scans `len` bytes at `ptr` and writes eight `f64` values to `out`.
///
/// # Safety
/// `ptr..ptr+len` must be readable and `out` must have room for 8 `f64`.
#[no_mangle]
pub unsafe extern "C" fn tp_scan(ptr: *const u8, len: usize, out: *mut f64) {
    let s = scan(std::slice::from_raw_parts(ptr, len));
    let o = std::slice::from_raw_parts_mut(out, 8);
    o[0] = s.lines as f64;
    o[1] = s.lf as f64;
    o[2] = s.crlf as f64;
    o[3] = s.cr as f64;
    o[4] = s.nul as f64;
    o[5] = s.high as f64;
    o[6] = s.control as f64;
    o[7] = s.max_line as f64;
}

// ---- log index: parse once, then read each array through ptr/len accessors.

static mut LOG: Option<log::LogIndex> = None;

/// Parses a log and keeps the result until the next call or `tp_log_free`.
///
/// # Safety
/// `ptr..ptr+len` must be readable. Single-threaded use only.
#[no_mangle]
pub unsafe extern "C" fn tp_log_parse(ptr: *const u8, len: usize, default_year: i32) {
    let ix = log::parse_log(std::slice::from_raw_parts(ptr, len), default_year as i64);
    *std::ptr::addr_of_mut!(LOG) = Some(ix);
}

/// Pointer to one result array: 0 line_start (u32), 1 level (u8), 2 flags (u8),
/// 3 ts (f64), 4 fields (u32), 5 summary (f64).
///
/// # Safety
/// Valid until the next `tp_log_parse` / `tp_log_free`.
#[no_mangle]
pub unsafe extern "C" fn tp_log_ptr(which: u32) -> *const u8 {
    match (&*std::ptr::addr_of!(LOG), which) {
        (Some(ix), 0) => ix.line_start.as_ptr() as *const u8,
        (Some(ix), 1) => ix.level.as_ptr(),
        (Some(ix), 2) => ix.flags.as_ptr(),
        (Some(ix), 3) => ix.ts.as_ptr() as *const u8,
        (Some(ix), 4) => ix.fields.as_ptr() as *const u8,
        (Some(ix), 5) => ix.summary.as_ptr() as *const u8,
        _ => std::ptr::null(),
    }
}

/// Number of elements in the array `which`.
///
/// # Safety
/// See `tp_log_ptr`.
#[no_mangle]
pub unsafe extern "C" fn tp_log_len(which: u32) -> usize {
    match (&*std::ptr::addr_of!(LOG), which) {
        (Some(ix), 0) => ix.line_start.len(),
        (Some(ix), 1) => ix.level.len(),
        (Some(ix), 2) => ix.flags.len(),
        (Some(ix), 3) => ix.ts.len(),
        (Some(ix), 4) => ix.fields.len(),
        (Some(_), 5) => log::SUMMARY_LEN,
        _ => 0,
    }
}

/// # Safety
/// Invalidates every pointer returned by `tp_log_ptr`.
#[no_mangle]
pub unsafe extern "C" fn tp_log_free() {
    *std::ptr::addr_of_mut!(LOG) = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_buffer_is_one_line() {
        let s = scan(b"");
        assert_eq!(s.lines, 1);
        assert_eq!(s.max_line, 0);
    }

    #[test]
    fn counts_each_kind_of_line_break() {
        let s = scan(b"a\nbb\r\nccc\rdddd");
        assert_eq!((s.lf, s.crlf, s.cr), (1, 1, 1));
        assert_eq!(s.lines, 4);
        assert_eq!(s.max_line, 4);
    }

    #[test]
    fn trailing_newline_adds_an_empty_last_line() {
        assert_eq!(scan(b"a\n").lines, 2);
        assert_eq!(scan(b"a\r\n").lines, 2);
    }

    #[test]
    fn counts_nul_high_and_control_bytes() {
        let s = scan(&[b'a', 0, 0, 0xC3, 0xA9, 0x01, b'\t', 0x1b, b'\n']);
        assert_eq!(s.nul, 2);
        assert_eq!(s.high, 2);
        assert_eq!(s.control, 1);
    }

    #[test]
    fn cr_at_end_of_buffer_is_a_lone_cr() {
        let s = scan(b"abc\r");
        assert_eq!((s.cr, s.crlf), (1, 0));
        assert_eq!(s.lines, 2);
    }
}

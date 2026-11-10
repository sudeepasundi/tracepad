// TypeScript twin of `scan` in engine-rs/src/lib.rs. Must stay byte-for-byte
// equivalent; tests/unit/engine-parity.test.ts compares the two.

export interface ScanStats {
  lines: number;
  lf: number;
  crlf: number;
  cr: number;
  nul: number;
  high: number;
  control: number;
  maxLine: number;
}

export function scanTs(bytes: Uint8Array): ScanStats {
  let lf = 0;
  let crlf = 0;
  let cr = 0;
  let nul = 0;
  let high = 0;
  let control = 0;
  let maxLine = 0;
  let lineStart = 0;
  const n = bytes.length;
  for (let i = 0; i < n; i++) {
    const b = bytes[i];
    if (b === 10) {
      lf++;
      if (i - lineStart > maxLine) maxLine = i - lineStart;
      lineStart = i + 1;
    } else if (b === 13) {
      if (i - lineStart > maxLine) maxLine = i - lineStart;
      if (i + 1 < n && bytes[i + 1] === 10) {
        crlf++;
        i++;
      } else cr++;
      lineStart = i + 1;
    } else if (b === 0) nul++;
    else if (b >= 0x80) high++;
    else if (b < 0x20 && b !== 9 && b !== 12 && b !== 27) control++;
  }
  if (n - lineStart > maxLine) maxLine = n - lineStart;
  return { lines: lf + crlf + cr + 1, lf, crlf, cr, nul, high, control, maxLine };
}

export function statsFromF64(o: Float64Array): ScanStats {
  return { lines: o[0], lf: o[1], crlf: o[2], cr: o[3], nul: o[4], high: o[5], control: o[6], maxLine: o[7] };
}

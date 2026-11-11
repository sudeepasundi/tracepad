// Lining up two logs by time: which moment a line belongs to, and which line
// of another log comes at (or first after) that moment. Pure, for unit tests.

export interface TimeIndex {
  /** Per line: wall-clock milliseconds, NaN where there is no timestamp. */
  ts: Float64Array;
  /** 0-based line of each entry's first line, ascending. */
  entryLines: Uint32Array;
}

/** Time of the entry that 0-based `line` belongs to (NaN when there is none). */
export function timeAtLine(ix: TimeIndex, line: number): number {
  const e = ix.entryLines;
  let lo = 0;
  let hi = e.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (e[mid] <= line) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  // Entries without a timestamp take the nearest earlier one that has it.
  for (let i = at; i >= 0 && i > at - 200; i--) {
    const t = ix.ts[e[i]];
    if (Number.isFinite(t)) return t;
  }
  return NaN;
}

/** 0-based line of the first entry at or after `ms` (the last entry when all are earlier). */
export function lineAtTime(ix: TimeIndex, ms: number): number {
  const e = ix.entryLines;
  if (!e.length) return 0;
  let lo = 0;
  let hi = e.length - 1;
  let found = e.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    // Step back over entries without a time so the comparison has something to use.
    let k = mid;
    while (k > lo && !Number.isFinite(ix.ts[e[k]])) k--;
    const t = ix.ts[e[k]];
    if (!Number.isFinite(t) || t < ms) lo = mid + 1;
    else {
      found = k;
      hi = k - 1;
    }
  }
  return e[found];
}

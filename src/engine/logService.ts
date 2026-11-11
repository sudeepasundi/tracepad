// The log engine's working set: for every log tab, the bytes and the index.
// Runs inside the worker; the client falls back to running the very same
// functions on the main thread when workers are unavailable.
import { applyFilter, groupErrors, type ErrorGroup, type FilterResult, type FilterSpec } from './logfilter';
import { parseLogTs, type LogIndex } from './logparse';
import type { WasmEngine } from './wasm';

interface Held {
  bytes: Uint8Array;
  index: LogIndex;
}

const held = new Map<string, Held>();

export function logParse(key: string, bytes: Uint8Array, wasm: WasmEngine | null, year: number): LogIndex {
  let index: LogIndex;
  try {
    index = wasm ? wasm.parseLog(bytes, year) : parseLogTs(bytes, year);
  } catch {
    index = parseLogTs(bytes, year);
  }
  held.set(key, { bytes, index });
  return index;
}

export function logFilter(key: string, spec: FilterSpec): FilterResult | null {
  const h = held.get(key);
  return h ? applyFilter(h.bytes, h.index, spec) : null;
}

export function logGroups(key: string): ErrorGroup[] {
  const h = held.get(key);
  return h ? groupErrors(h.bytes, h.index) : [];
}

/** The in-memory log of an editor tab, if this key has one. */
export function heldLog(key: string): Held | undefined {
  return held.get(key);
}

export function logDrop(key: string): void {
  held.delete(key);
}

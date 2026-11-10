// Main-thread client for the engine. Order of preference:
//   1. Rust/WASM in a worker   2. TypeScript in a worker   3. TypeScript on the main thread
// so the app keeps working wherever workers or WebAssembly are blocked.
import EngineWorker from '../workers/engine.worker?worker&inline';
import type { EngineRequest, EngineResponse } from '../workers/engine.worker';
import wasmUrl from './engine.wasm?url';
import { engineKind } from '../app/state';
import type { ErrorGroup, FilterResult, FilterSpec } from './logfilter';
import type { BigDelta } from './bigindex';
import { bigAppend, bigDrop, bigFilter, bigFind, bigGroups, bigOpen, bigText, type BigOpened } from './bigService';
import { logDrop, logFilter, logGroups, logParse } from './logService';
import { scanTs, type ScanStats } from './scan';

type OnProgress = (done: number, total: number) => void;
type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; progress?: OnProgress };
type Op = EngineRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

/** What the page keeps of a parsed log: enough to colour, fold, plot and navigate. */
export interface PageIndex {
  level: Uint8Array;
  flags: Uint8Array;
  ts: Float64Array;
  summary: Float64Array;
  /** 0-based line of each entry's first line. */
  entryLines: Uint32Array;
}

let worker: Worker | null = null;
let ready: Promise<void> | null = null;
let seq = 1;
const pending = new Map<number, Pending>();

async function loadWasmBytes(): Promise<ArrayBuffer | null> {
  try {
    if (typeof WebAssembly === 'undefined') return null;
    if (wasmUrl.startsWith('data:')) {
      // Single-file build: the module is inlined as base64. Decode by hand so no
      // fetch() is needed (connect-src may forbid data: URLs).
      const bin = atob(wasmUrl.slice(wasmUrl.indexOf(',') + 1));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out.buffer;
    }
    const res = await fetch(wasmUrl);
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function call<T>(msg: Op, transfer: Transferable[] = [], progress?: OnProgress): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject, progress });
    worker!.postMessage({ ...msg, id }, transfer);
  });
}

export function startEngine(): Promise<void> {
  ready ??= (async () => {
    try {
      worker = new EngineWorker();
      worker.onmessage = (e: MessageEvent<EngineResponse>) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        if ('progress' in e.data) {
          p.progress?.(e.data.progress[0], e.data.progress[1]);
          return;
        }
        pending.delete(e.data.id);
        if (e.data.ok) p.resolve(e.data.result);
        else p.reject(new Error(e.data.error));
      };
      const failed = new Promise<never>((_, reject) => {
        worker!.onerror = () => reject(new Error('worker failed'));
        setTimeout(() => reject(new Error('worker timeout')), 8000);
      });
      failed.catch(() => undefined);
      const bytes = await loadWasmBytes();
      const kind = await Promise.race([call<'wasm' | 'ts'>({ op: 'init', bytes: bytes ?? undefined }, bytes ? [bytes] : []), failed]);
      worker.onerror = null;
      engineKind.value = kind;
    } catch {
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error('engine unavailable'));
      pending.clear();
      engineKind.value = 'ts';
    }
  })();
  return ready;
}

/** Counts lines, line-break styles and suspicious bytes. The buffer is copied, not consumed. */
export async function scanBytes(bytes: Uint8Array): Promise<ScanStats> {
  await startEngine();
  if (!worker) return scanTs(bytes);
  const copy = bytes.slice().buffer;
  try {
    return await call<ScanStats>({ op: 'scan', bytes: copy }, [copy]);
  } catch {
    return scanTs(bytes);
  }
}

// ----------------------------------------------------------------------- logs

function localParse(key: string, bytes: Uint8Array, year: number): PageIndex {
  const ix = logParse(key, bytes, null, year);
  const entryLines = new Uint32Array(ix.fields.length / 8);
  for (let i = 0; i < entryLines.length; i++) entryLines[i] = ix.fields[i * 8];
  return { level: ix.level, flags: ix.flags, ts: ix.ts, summary: ix.summary, entryLines };
}

/** Parses a log. `bytes` is handed over to the engine (do not reuse it). */
export async function parseLog(key: string, bytes: Uint8Array): Promise<PageIndex> {
  await startEngine();
  const year = new Date().getFullYear();
  if (!worker) return localParse(key, bytes, year);
  const buf = bytes.buffer as ArrayBuffer;
  return call<PageIndex>({ op: 'log.parse', key, bytes: buf, year }, [buf]);
}

export async function filterLog(key: string, spec: FilterSpec): Promise<FilterResult | null> {
  await startEngine();
  if (!worker) return logFilter(key, spec);
  return call<FilterResult | null>({ op: 'log.filter', key, spec });
}

export async function groupLog(key: string): Promise<ErrorGroup[]> {
  await startEngine();
  if (!worker) return logGroups(key);
  return call<ErrorGroup[]>({ op: 'log.groups', key });
}

export function dropLog(key: string): void {
  if (worker) void call({ op: 'log.drop', key }).catch(() => undefined);
  else {
    logDrop(key);
    bigDrop(key);
  }
}

// ---------------------------------------------------------------- large files

export type { BigDelta, BigOpened };

/** Indexes a large file without loading it. `chunk` is for tests. */
export async function openBig(key: string, file: Blob, start: number, encoding: string, progress?: OnProgress, chunk?: number): Promise<BigOpened> {
  await startEngine();
  const year = new Date().getFullYear();
  if (!worker) return bigOpen(key, file, start, encoding, null, year, chunk, progress);
  return call<BigOpened>({ op: 'big.open', key, file, start, encoding, year, chunk }, [], progress);
}

export async function appendBig(key: string, file: Blob): Promise<BigDelta | null> {
  await startEngine();
  if (!worker) return bigAppend(key, file);
  return call<BigDelta | null>({ op: 'big.append', key, file });
}

export async function textBig(key: string, from: number, to: number): Promise<string[]> {
  await startEngine();
  if (!worker) return bigText(key, from, to);
  return call<string[]>({ op: 'big.text', key, from, to });
}

export async function filterBig(key: string, spec: FilterSpec, progress?: OnProgress): Promise<FilterResult | null> {
  await startEngine();
  if (!worker) return bigFilter(key, spec, progress);
  return call<FilterResult | null>({ op: 'big.filter', key, spec }, [], progress);
}

export async function findBig(key: string, source: string, flags: string, limit: number, progress?: OnProgress): Promise<{ lines: Uint32Array; total: number }> {
  await startEngine();
  if (!worker) return bigFind(key, source, flags, limit, progress);
  return call<{ lines: Uint32Array; total: number }>({ op: 'big.find', key, source, flags, limit }, [], progress);
}

export async function groupBig(key: string): Promise<ErrorGroup[]> {
  await startEngine();
  if (!worker) return bigGroups(key);
  return call<ErrorGroup[]>({ op: 'big.groups', key });
}

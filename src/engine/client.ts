// Main-thread client for the engine. Order of preference:
//   1. Rust/WASM in a worker   2. TypeScript in a worker   3. TypeScript on the main thread
// so the app keeps working wherever workers or WebAssembly are blocked.
import EngineWorker from '../workers/engine.worker?worker&inline';
import type { EngineRequest, EngineResponse } from '../workers/engine.worker';
import wasmUrl from './engine.wasm?url';
import { engineKind } from '../app/state';
import { scanTs, type ScanStats } from './scan';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

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

function call<T>(msg: Omit<EngineRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = seq++;
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
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

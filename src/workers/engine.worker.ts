// Engine worker: runs the Rust/WASM engine, or the TypeScript twin when
// WebAssembly is unavailable (for example blocked by an iframe's CSP).
import { scanTs } from '../engine/scan';
import { WasmEngine } from '../engine/wasm';

export type EngineRequest =
  | { id: number; op: 'init'; module?: WebAssembly.Module; bytes?: ArrayBuffer }
  | { id: number; op: 'scan'; bytes: ArrayBuffer };

export type EngineResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

const ctx = self as unknown as { postMessage(m: EngineResponse): void; onmessage: ((e: MessageEvent<EngineRequest>) => void) | null };
let wasm: WasmEngine | null = null;

ctx.onmessage = async (e) => {
  const m = e.data;
  try {
    let result: unknown;
    if (m.op === 'init') {
      try {
        const src = m.module ?? m.bytes;
        wasm = src ? await WasmEngine.create(src) : null;
      } catch {
        wasm = null;
      }
      result = wasm ? 'wasm' : 'ts';
    } else {
      const bytes = new Uint8Array(m.bytes);
      result = wasm ? wasm.scan(bytes) : scanTs(bytes);
    }
    ctx.postMessage({ id: m.id, ok: true, result });
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

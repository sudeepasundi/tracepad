// Thin, dependency-free wrapper around engine.wasm (plain C ABI, no imports).
// Used by the worker in the browser and directly by the Node parity tests.
import { statsFromF64, type ScanStats } from './scan';

interface Exports {
  memory: WebAssembly.Memory;
  tp_abi(): number;
  tp_alloc(len: number): number;
  tp_free(ptr: number, len: number): void;
  tp_scan(ptr: number, len: number, out: number): void;
}

export const ENGINE_ABI = 1;

export class WasmEngine {
  private constructor(private readonly x: Exports) {}

  static async create(source: WebAssembly.Module | BufferSource): Promise<WasmEngine> {
    const module = source instanceof WebAssembly.Module ? source : await WebAssembly.compile(source);
    const instance = await WebAssembly.instantiate(module, {});
    const x = instance.exports as unknown as Exports;
    if (x.tp_abi() !== ENGINE_ABI) throw new Error('engine.wasm ABI mismatch');
    return new WasmEngine(x);
  }

  scan(bytes: Uint8Array): ScanStats {
    const x = this.x;
    const ptr = x.tp_alloc(bytes.length);
    const out = x.tp_alloc(64);
    try {
      new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
      x.tp_scan(ptr, bytes.length, out);
      // Copy out before freeing; the view dies if memory grows.
      return statsFromF64(new Float64Array(x.memory.buffer.slice(out, out + 64)));
    } finally {
      x.tp_free(ptr, bytes.length);
      x.tp_free(out, 64);
    }
  }
}

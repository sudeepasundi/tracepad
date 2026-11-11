// Thin, dependency-free wrapper around engine.wasm (plain C ABI, no imports).
// Used by the worker in the browser and directly by the Node parity tests.
import type { LogIndex } from './logparse';
import { decodeTemplates, type Mined } from './mine';
import { statsFromF64, type ScanStats } from './scan';

interface Exports {
  memory: WebAssembly.Memory;
  tp_abi(): number;
  tp_alloc(len: number): number;
  tp_free(ptr: number, len: number): void;
  tp_scan(ptr: number, len: number, out: number): void;
  tp_log_parse(ptr: number, len: number, defaultYear: number): void;
  tp_log_ptr(which: number): number;
  tp_log_len(which: number): number;
  tp_log_free(): void;
  tp_mine_begin(): void;
  tp_mine_chunk(ptr: number, len: number, spans: number, count: number): void;
  tp_mine_finish(): void;
  tp_mine_ptr(which: number): number;
  tp_mine_len(which: number): number;
  tp_mine_free(): void;
}

export const ENGINE_ABI = 3;

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

  mineBegin(): void {
    this.x.tp_mine_begin();
  }

  /** Feeds one stretch of messages; `spans` holds (start, end) pairs into `bytes`. */
  mineChunk(bytes: Uint8Array, spans: Uint32Array): void {
    const x = this.x;
    const ptr = x.tp_alloc(bytes.length);
    const sp = x.tp_alloc(spans.byteLength + 4);
    try {
      new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
      // The allocator hands out byte-aligned memory; copy the pairs as bytes.
      new Uint8Array(x.memory.buffer, sp, spans.byteLength).set(new Uint8Array(spans.buffer, spans.byteOffset, spans.byteLength));
      x.tp_mine_chunk(ptr, bytes.length, sp, spans.length / 2);
    } finally {
      x.tp_free(ptr, bytes.length);
      x.tp_free(sp, spans.byteLength + 4);
    }
  }

  mineFinish(): Mined {
    const x = this.x;
    x.tp_mine_finish();
    try {
      const idsAt = x.tp_mine_ptr(0);
      const ids = new Uint32Array(x.memory.buffer.slice(idsAt, idsAt + x.tp_mine_len(0) * 4));
      const blobAt = x.tp_mine_ptr(1);
      const blob = new Uint8Array(x.memory.buffer.slice(blobAt, blobAt + x.tp_mine_len(1)));
      return { ids, templates: decodeTemplates(blob) };
    } finally {
      x.tp_mine_free();
    }
  }

  parseLog(bytes: Uint8Array, defaultYear: number): LogIndex {
    const x = this.x;
    const ptr = x.tp_alloc(bytes.length);
    try {
      new Uint8Array(x.memory.buffer, ptr, bytes.length).set(bytes);
      x.tp_log_parse(ptr, bytes.length, defaultYear);
      // Copies: the engine's own arrays are released right after.
      const copy = (which: number, bytesPer: number): ArrayBuffer => {
        const at = x.tp_log_ptr(which);
        const len = x.tp_log_len(which) * bytesPer;
        return len ? x.memory.buffer.slice(at, at + len) : new ArrayBuffer(0);
      };
      return {
        lineStart: new Uint32Array(copy(0, 4)),
        level: new Uint8Array(copy(1, 1)),
        flags: new Uint8Array(copy(2, 1)),
        ts: new Float64Array(copy(3, 8)),
        fields: new Uint32Array(copy(4, 4)),
        summary: new Float64Array(copy(5, 8)),
      };
    } finally {
      x.tp_log_free();
      x.tp_free(ptr, bytes.length);
    }
  }
}

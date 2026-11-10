// Engine worker: runs the Rust/WASM engine, or the TypeScript twin when
// WebAssembly is unavailable (for example blocked by an iframe's CSP).
import type { FilterSpec } from '../engine/logfilter';
import { logDrop, logFilter, logGroups, logParse } from '../engine/logService';
import { scanTs } from '../engine/scan';
import { WasmEngine } from '../engine/wasm';

export type EngineRequest =
  | { id: number; op: 'init'; module?: WebAssembly.Module; bytes?: ArrayBuffer }
  | { id: number; op: 'scan'; bytes: ArrayBuffer }
  | { id: number; op: 'log.parse'; key: string; bytes: ArrayBuffer; year: number }
  | { id: number; op: 'log.filter'; key: string; spec: FilterSpec }
  | { id: number; op: 'log.groups'; key: string }
  | { id: number; op: 'log.drop'; key: string };

export type EngineResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

const ctx = self as unknown as { postMessage(m: EngineResponse, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<EngineRequest>) => void) | null };
let wasm: WasmEngine | null = null;

ctx.onmessage = async (e) => {
  const m = e.data;
  try {
    let result: unknown;
    const transfer: Transferable[] = [];
    switch (m.op) {
      case 'init': {
        try {
          const src = m.module ?? m.bytes;
          wasm = src ? await WasmEngine.create(src) : null;
        } catch {
          wasm = null;
        }
        result = wasm ? 'wasm' : 'ts';
        break;
      }
      case 'scan': {
        const bytes = new Uint8Array(m.bytes);
        result = wasm ? wasm.scan(bytes) : scanTs(bytes);
        break;
      }
      case 'log.parse': {
        const ix = logParse(m.key, new Uint8Array(m.bytes), wasm, m.year);
        // The worker keeps its own index; the page gets copies of what it draws from.
        const copy = { level: ix.level.slice(), flags: ix.flags.slice(), ts: ix.ts.slice(), summary: ix.summary.slice(), entryLines: new Uint32Array(ix.fields.length / 8) };
        for (let i = 0; i < copy.entryLines.length; i++) copy.entryLines[i] = ix.fields[i * 8];
        result = copy;
        transfer.push(copy.level.buffer, copy.flags.buffer, copy.ts.buffer, copy.summary.buffer, copy.entryLines.buffer);
        break;
      }
      case 'log.filter': {
        const r = logFilter(m.key, m.spec);
        result = r;
        if (r) transfer.push(r.mask.buffer);
        break;
      }
      case 'log.groups':
        result = logGroups(m.key);
        break;
      case 'log.drop':
        logDrop(m.key);
        result = true;
        break;
    }
    ctx.postMessage({ id: m.id, ok: true, result }, transfer);
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

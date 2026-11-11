// Engine worker: runs the Rust/WASM engine, or the TypeScript twin when
// WebAssembly is unavailable (for example blocked by an iframe's CSP).
import { bigAppend, bigDrop, bigFilter, bigFind, bigGroups, bigOpen, bigText } from '../engine/bigService';
import type { FilterSpec } from '../engine/logfilter';
import { logDrop, logFilter, logGroups, logParse } from '../engine/logService';
import { scanTs } from '../engine/scan';
import { tabExtract, tabMine, tabTable, tablesDrop } from '../engine/tableService';
import type { ExtractSpec } from '../engine/tables';
import { WasmEngine } from '../engine/wasm';

export type EngineRequest =
  | { id: number; op: 'init'; module?: WebAssembly.Module; bytes?: ArrayBuffer }
  | { id: number; op: 'scan'; bytes: ArrayBuffer }
  | { id: number; op: 'log.parse'; key: string; bytes: ArrayBuffer; year: number }
  | { id: number; op: 'log.filter'; key: string; spec: FilterSpec }
  | { id: number; op: 'log.groups'; key: string }
  | { id: number; op: 'log.drop'; key: string }
  | { id: number; op: 'big.open'; key: string; file: Blob; start: number; encoding: string; year: number; chunk?: number }
  | { id: number; op: 'big.append'; key: string; file: Blob }
  | { id: number; op: 'big.text'; key: string; from: number; to: number }
  | { id: number; op: 'big.filter'; key: string; spec: FilterSpec }
  | { id: number; op: 'big.find'; key: string; source: string; flags: string; limit: number }
  | { id: number; op: 'big.groups'; key: string }
  | { id: number; op: 'tab.mine'; key: string }
  | { id: number; op: 'tab.table'; key: string; which: number | 'access' }
  | { id: number; op: 'tab.extract'; key: string; spec: ExtractSpec };

export type EngineResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string } | { id: number; progress: [number, number] };

const ctx = self as unknown as { postMessage(m: EngineResponse, transfer?: Transferable[]): void; onmessage: ((e: MessageEvent<EngineRequest>) => void) | null };
let wasm: WasmEngine | null = null;

ctx.onmessage = async (e) => {
  const m = e.data;
  // At most ~10 progress messages a second.
  let last = 0;
  const progress = (done: number, total: number) => {
    const now = Date.now();
    if (now - last < 90 && done < total) return;
    last = now;
    ctx.postMessage({ id: m.id, progress: [done, total] });
  };
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
        bigDrop(m.key);
        tablesDrop(m.key);
        result = true;
        break;
      case 'big.open': {
        const r = await bigOpen(m.key, m.file, m.start, m.encoding, wasm, m.year, m.chunk, progress);
        result = r;
        transfer.push(r.level.buffer, r.flags.buffer, r.ts.buffer, r.entryLines.buffer, r.summary.buffer);
        break;
      }
      case 'big.append': {
        const r = await bigAppend(m.key, m.file);
        result = r;
        if (r) transfer.push(r.level.buffer, r.flags.buffer, r.ts.buffer, r.entryLines.buffer, r.summary.buffer);
        break;
      }
      case 'big.text':
        result = await bigText(m.key, m.from, m.to);
        break;
      case 'big.filter': {
        const r = await bigFilter(m.key, m.spec, progress);
        result = r;
        if (r) transfer.push(r.mask.buffer);
        break;
      }
      case 'big.find': {
        const r = await bigFind(m.key, m.source, m.flags, m.limit, progress);
        result = r;
        transfer.push(r.lines.buffer);
        break;
      }
      case 'big.groups':
        result = await bigGroups(m.key, progress);
        break;
      case 'tab.mine':
        result = await tabMine(m.key, wasm, progress);
        break;
      case 'tab.table':
        result = await tabTable(m.key, m.which, progress);
        break;
      case 'tab.extract':
        result = await tabExtract(m.key, m.spec, progress);
        break;
    }
    ctx.postMessage({ id: m.id, ok: true, result }, transfer);
  } catch (err) {
    ctx.postMessage({ id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};

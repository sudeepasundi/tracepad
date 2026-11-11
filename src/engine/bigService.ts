// Large files held by the engine: the File stays on disk, the index in memory.
// Used by the worker, and by the page itself when workers are unavailable.
import { BigIndex, type BigDelta, type Progress } from './bigindex';
import type { ErrorGroup, FilterResult, FilterSpec } from './logfilter';
import { parseLogTs } from './logparse';
import type { WasmEngine } from './wasm';

interface Held {
  index: BigIndex;
  encoding: string;
}

export interface BigOpened {
  level: Uint8Array;
  flags: Uint8Array;
  ts: Float64Array;
  entryLines: Uint32Array;
  summary: Float64Array;
  size: number;
}

const held = new Map<string, Held>();

const reader = (file: Blob) => async (from: number, to: number) => new Uint8Array(await file.slice(from, to).arrayBuffer());

export async function bigOpen(key: string, file: Blob, start: number, encoding: string, wasm: WasmEngine | null, year: number, chunk: number | undefined, progress?: Progress): Promise<BigOpened> {
  const parse = (bytes: Uint8Array) => {
    if (wasm) {
      try {
        return wasm.parseLog(bytes, year);
      } catch {
        /* fall through to the TypeScript twin */
      }
    }
    return parseLogTs(bytes, year);
  };
  const index = new BigIndex(reader(file), parse, start, chunk);
  await index.build(file.size, progress);
  held.set(key, { index, encoding });
  return { level: index.level.view().slice(), flags: index.flags.view().slice(), ts: index.ts.view().slice(), entryLines: index.entryLine.view().slice(), summary: index.summary(), size: index.size };
}

/** null = the file was rewritten and must be opened again. */
export async function bigAppend(key: string, file: Blob): Promise<BigDelta | null> {
  const h = held.get(key);
  if (!h) return null;
  h.index.setReader(reader(file));
  return h.index.append(file.size);
}

export async function bigText(key: string, from: number, to: number): Promise<string[]> {
  const h = held.get(key);
  return h ? h.index.text(from, to, h.encoding) : [];
}

export async function bigFilter(key: string, spec: FilterSpec, progress?: Progress): Promise<FilterResult | null> {
  const h = held.get(key);
  return h ? h.index.filter(spec, progress) : null;
}

export async function bigFind(key: string, source: string, flags: string, limit: number, progress?: Progress): Promise<{ lines: Uint32Array; total: number }> {
  const h = held.get(key);
  return h ? h.index.find(new RegExp(source, flags), limit, progress) : { lines: new Uint32Array(0), total: 0 };
}

export async function bigGroups(key: string, progress?: Progress): Promise<ErrorGroup[]> {
  const h = held.get(key);
  return h ? h.index.groups(progress) : [];
}

export function bigIndexOf(key: string): BigIndex | undefined {
  return held.get(key)?.index;
}

export function bigDrop(key: string): void {
  held.delete(key);
}

// Tables for whichever kind of log a tab holds: an in-memory one (editor tabs)
// or a disk-backed one (large files). Runs in the worker, or on the page when
// workers are unavailable.
import { bigIndexOf } from './bigService';
import { heldLog } from './logService';
import { accessTable, extractTable, mineLog, templateTable, type ExtractSpec, type MineResult, type Table, type TemplateInfo, type Walk } from './tables';
import type { WasmEngine } from './wasm';

type Progress = (done: number, total: number) => void;

interface Mined {
  result: MineResult;
  /** What was mined: if the tab's log has changed since, the result is stale. */
  token: unknown;
}

const mines = new Map<string, Mined>();

function source(key: string): { walk: Walk; token: unknown } | null {
  const held = heldLog(key);
  if (held) {
    return {
      token: held.index,
      walk: async (fn, progress) => {
        fn({ bytes: held.bytes, ix: held.index, lineBase: 0, entryBase: 0 });
        progress?.(1, 1);
      },
    };
  }
  const big = bigIndexOf(key);
  if (big) return { token: `${big.lines}:${big.size}`, walk: (fn, progress) => big.walk(fn, progress) };
  return null;
}

export interface MineSummary {
  templates: TemplateInfo[];
  /** Entries in the access-log request table (0 when the log is not an access log). */
  accessEntries: number;
  entries: number;
  ms: number;
}

export async function tabMine(key: string, wasm: WasmEngine | null, progress?: Progress): Promise<MineSummary | null> {
  const src = source(key);
  if (!src) return null;
  const t0 = Date.now();
  const result = await mineLog(src.walk, wasm, progress);
  mines.set(key, { result, token: src.token });
  return { templates: result.templates, accessEntries: result.accessEntries, entries: result.mined.ids.length, ms: Date.now() - t0 };
}

/** null = the log changed since it was mined: mine again first. */
export async function tabTable(key: string, which: number | 'access', progress?: Progress): Promise<Table | null> {
  const src = source(key);
  const m = mines.get(key);
  if (!src || !m || m.token !== src.token) return null;
  return which === 'access' ? accessTable(src.walk, progress) : templateTable(src.walk, m.result, which, progress);
}

export async function tabExtract(key: string, spec: ExtractSpec, progress?: Progress): Promise<Table | null> {
  const src = source(key);
  return src ? extractTable(src.walk, spec, progress) : null;
}

export function tablesDrop(key: string): void {
  mines.delete(key);
}

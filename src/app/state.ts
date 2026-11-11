import { computed, signal } from '@preact/signals';
import type { Encoding } from '../files/encoding';

export interface Tab {
  id: number;
  /** Stable across reloads (id is per page load); ties session records together. */
  uid: string;
  name: string;
  /** Linked file (File System Access API). Absent for new tabs and one-time snapshots. */
  handle?: FileSystemFileHandle;
  untitled: boolean;
  encoding: Encoding;
  eol: 'LF' | 'CRLF';
  lang: string;
  dirty: boolean;
  /** Detected (or forced) as a log: timeline, filters and level colours apply. */
  isLog?: boolean;
  /** true/false = the user's explicit choice; undefined = detect automatically. */
  forceLog?: boolean;
  /** Large file: read-only, shown by the disk-backed viewer instead of the editor. */
  big?: boolean;
  /** Large file of which only the end is shown. */
  tailOnly?: boolean;
  /** Keep the end of a linked file in view as it grows (tail -f). */
  follow?: boolean;
  /** The linked file has disappeared from disk. */
  missing?: boolean;
  /** Restored linked file waiting for permission; content not loaded yet. */
  locked?: boolean;
  /** The Markdown preview is shown beside this tab. */
  preview?: boolean;
  lastUsed: number;
}

export interface MenuItem {
  label: string;
  hint?: string;
  run?: () => void;
  disabled?: boolean;
  separator?: boolean;
}

export interface CursorInfo {
  line: number;
  col: number;
  lines: number;
  chars: number;
  selections: number;
  selectedChars: number;
}

export type SidebarPanel = 'files' | 'insights' | 'tables' | 'highlights' | 'appearance' | 'help';

export const tabs = signal<Tab[]>([]);
export const activeId = signal<number | null>(null);
export const activeTab = computed(() => tabs.value.find((t) => t.id === activeId.value) ?? null);
export const cursor = signal<CursorInfo>({ line: 1, col: 1, lines: 1, chars: 0, selections: 1, selectedChars: 0 });
/** null = closed. The sidebar never opens by itself; only a click or a command sets this. */
export const sidebar = signal<SidebarPanel | null>(null);
export const paletteOpen = signal(false);
export const findOpen = signal<null | 'find' | 'replace'>(null);
export const dropActive = signal(false);
/** Which tab name is being edited in place, and where. */
export const renaming = signal<{ id: number; where: 'tab' | 'list' } | null>(null);
export const menu = signal<{ x: number; y: number; items: MenuItem[] } | null>(null);
/** Bumped to move keyboard focus into the Open files filter box. */
export const filesFocus = signal(0);
/** 'wasm' when the Rust engine is running, 'ts' for the TypeScript fallback. */
export const engineKind = signal<'wasm' | 'ts' | 'starting'>('starting');
export const activeDocEmpty = signal(true);

let nextId = 1;
export function newTabId(): number {
  return nextId++;
}

export function patchTab(id: number, patch: Partial<Tab>): void {
  tabs.value = tabs.value.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

export function nextUntitledName(): string {
  const used = new Set(tabs.value.map((t) => t.name));
  for (let i = 1; ; i++) {
    const name = `untitled-${i}.txt`;
    if (!used.has(name)) return name;
  }
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** True when the app runs inside a frame whose parent is another origin. */
export const crossOriginFramed = (() => {
  try {
    if (window.self === window.top) return false;
    void window.top!.location.href;
    return false;
  } catch {
    return true;
  }
})();

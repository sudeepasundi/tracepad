// One registry for every action: the command palette, keyboard shortcuts, buttons
// and the Help panel all read from here.
import { isMac } from './state';

export interface Command {
  id: string;
  title: string;
  category: string;
  /** e.g. "Ctrl+Shift+P". The first entry is the one shown in menus. */
  keys?: string[];
  /** Shown instead of `keys` for gestures the editor handles itself. */
  hint?: string;
  run: () => void | Promise<void>;
}

const registry = new Map<string, Command>();
const byKey = new Map<string, string>();

export function registerCommands(list: Command[]): void {
  for (const c of list) {
    registry.set(c.id, c);
    for (const k of c.keys ?? []) byKey.set(normaliseKey(k), c.id);
  }
}

export function allCommands(): Command[] {
  return [...registry.values()];
}

export function runCommand(id: string): void {
  const c = registry.get(id);
  if (!c) return;
  try {
    void Promise.resolve(c.run()).catch(reportError);
  } catch (e) {
    reportError(e);
  }
}

function reportError(e: unknown): void {
  console.error(e);
  window.dispatchEvent(new CustomEvent('tp-error', { detail: e instanceof Error ? e.message : String(e) }));
}

export function shortcutLabel(c: Command): string {
  const k = c.keys?.[0];
  if (!k) return c.hint ?? '';
  return isMac ? k.replace('Ctrl', '⌘').replace('Alt', '⌥').replace('Shift', '⇧') : k;
}

function normaliseKey(k: string): string {
  const parts = k.split('+').map((p) => p.trim());
  const key = parts.pop()!;
  const mods = ['Ctrl', 'Alt', 'Shift'].filter((m) => parts.includes(m));
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
}

const CODE_NAMES: Record<string, string> = {
  Backslash: '\\', Comma: ',', Period: '.', Equal: '=', Minus: '-', Slash: '/', BracketLeft: '[', BracketRight: ']',
};

export function eventKey(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (CODE_NAMES[e.code]) key = CODE_NAMES[e.code];
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

// ---- Layers: dialogs, menus, the palette and the find box.
// Escape goes to the top-most open layer first, and shortcuts are ignored while
// a modal layer is open. Open/closed is read from live state at the moment of
// the key press, so it can never lag behind a render.
export interface Layer {
  /** Higher closes first. */
  priority: number;
  modal: boolean;
  isOpen: () => boolean;
  close: () => void;
}

const layers: Layer[] = [];

export function registerLayer(layer: Layer): void {
  layers.push(layer);
  layers.sort((a, b) => b.priority - a.priority);
}

export function installKeyboard(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      const open = layers.filter((l) => l.isOpen());
      if (e.key === 'Escape' && !e.isComposing && open.length) {
        e.preventDefault();
        e.stopPropagation();
        open[0].close();
        return;
      }
      const key = eventKey(e);
      if (!key) return;
      const id = byKey.get(key);
      if (!id) return;
      // Always swallow our shortcuts (Ctrl+Shift+P would otherwise print, Ctrl+S
      // would save the page), but run nothing while a dialog is open.
      e.preventDefault();
      e.stopPropagation();
      if (!open.some((l) => l.modal)) runCommand(id);
    },
    true,
  );
}

import { effect, signal } from '@preact/signals';
import { loadJSON, saveJSON } from './storage';
import type { HighlightRule } from '../editor/log';
import { buildPalette, findAccent, findTheme } from './themes';

export interface Settings {
  theme: string;
  accent: string;
  density: 'comfortable' | 'compact';
  fontFamily: string;
  fontSize: number;
  wordWrap: boolean;
  minimap: boolean;
  lineNumbers: boolean;
  sidebarWidth: number;
  filesSort: 'order' | 'name' | 'recent' | 'type';
  /** Stack frames from this package are highlighted, e.g. com.mycompany. */
  ownPackage: string;
  highlights: HighlightRule[];
  /** Files larger than this open in the read-only large-file viewer. */
  largeFileMB: number;
  /** Height of the bottom results panel in pixels. */
  panelHeight: number;
  /** Above this size, offer to show only the end of the file. */
  tailAskMB: number;
  /** How much of the end is shown then. */
  tailMB: number;
}

export const FONT_CHOICES: { id: string; name: string; stack: string }[] = [
  { id: 'cascadia', name: 'Cascadia Code', stack: '"Cascadia Code", "Cascadia Mono", Consolas, "SF Mono", Menlo, monospace' },
  { id: 'consolas', name: 'Consolas', stack: 'Consolas, "SF Mono", Menlo, "DejaVu Sans Mono", monospace' },
  { id: 'jetbrains', name: 'JetBrains Mono', stack: '"JetBrains Mono", "Cascadia Code", Consolas, Menlo, monospace' },
  { id: 'fira', name: 'Fira Code', stack: '"Fira Code", "Cascadia Code", Consolas, Menlo, monospace' },
  { id: 'courier', name: 'Courier New', stack: '"Courier New", Courier, monospace' },
  { id: 'system', name: 'System monospace', stack: 'ui-monospace, monospace' },
];

export const SIDEBAR_DEFAULT = 300;
export const FONT_MIN = 9;
export const FONT_MAX = 28;

export const DEFAULTS: Settings = {
  theme: 'midnight',
  accent: 'blue',
  density: 'comfortable',
  fontFamily: 'cascadia',
  fontSize: 13,
  wordWrap: false,
  minimap: true,
  lineNumbers: true,
  sidebarWidth: SIDEBAR_DEFAULT,
  filesSort: 'order',
  ownPackage: '',
  highlights: [],
  largeFileMB: 64,
  panelHeight: 340,
  tailAskMB: 1024,
  tailMB: 500,
};

const KEY = 'tracepad.settings';

export const settings = signal<Settings>({ ...DEFAULTS, ...loadJSON<Partial<Settings>>(KEY, {}) });

let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false;

/** Writes pending settings now. Called on a short debounce and whenever the page may go away. */
export function flushSettings(): void {
  if (!pending) return;
  pending = false;
  if (timer) clearTimeout(timer);
  timer = undefined;
  saveJSON(KEY, settings.value);
}

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
  pending = true;
  if (timer) clearTimeout(timer);
  timer = setTimeout(flushSettings, 300);
}

/** Applies theme, accent, density and font to the document root. */
export function applyAppearance(s: Settings = settings.value): void {
  const root = document.documentElement;
  const theme = findTheme(s.theme);
  const palette = buildPalette(theme, findAccent(s.accent));
  for (const [k, v] of Object.entries(palette)) root.style.setProperty(k, v);
  root.dataset.mode = theme.dark ? 'dark' : 'light';
  root.dataset.density = s.density;
  root.style.colorScheme = theme.dark ? 'dark' : 'light';
  const font = FONT_CHOICES.find((f) => f.id === s.fontFamily) ?? FONT_CHOICES[0];
  root.style.setProperty('--tp-mono', font.stack);
  root.style.setProperty('--tp-font-size', `${s.fontSize}px`);
  document.body.style.background = theme.bg;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.surface);
  window.dispatchEvent(new CustomEvent('tp-appearance'));
}

export function initSettings(): void {
  effect(() => applyAppearance(settings.value));
  // A debounced save must not be lost when the tab closes right after a change.
  window.addEventListener('pagehide', flushSettings);
  window.addEventListener('beforeunload', flushSettings);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSettings();
  });
}

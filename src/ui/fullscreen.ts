// One full-screen mode for the whole app (results panel today; preview and
// compare later). The chosen element covers the app, and real browser full
// screen is requested on the document root, so toasts, menus and dialogs stay
// visible. Where that is not allowed (inside an iframe) it simply fills the frame.
import { signal } from '@preact/signals';
import { registerLayer } from '../app/commands';

export type FullscreenTarget = 'panel' | 'preview' | 'compare';
export const fullscreen = signal<FullscreenTarget | null>(null);

type KeyboardLock = { lock?(keys: string[]): Promise<void>; unlock?(): void };
const keyboard = () => (navigator as unknown as { keyboard?: KeyboardLock }).keyboard;

export function enterFullscreen(target: FullscreenTarget): void {
  fullscreen.value = target;
  try {
    if (!document.fullscreenElement) {
      void document.documentElement
        .requestFullscreen()
        // With Escape locked, the key reaches the page first, so dialogs and the
        // find box can close before full screen ends.
        .then(() => keyboard()?.lock?.(['Escape']).catch(() => undefined))
        .catch(() => undefined);
    }
  } catch {
    /* not allowed here: the element still fills the window */
  }
}

export function exitFullscreen(): void {
  fullscreen.value = null;
  try {
    keyboard()?.unlock?.();
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  } catch {
    /* nothing to leave */
  }
}

export function toggleFullscreen(target: FullscreenTarget): void {
  if (fullscreen.value === target) exitFullscreen();
  else enterFullscreen(target);
}

// Lowest priority: Escape reaches this only after dialogs, menus, the palette and the find box.
registerLayer({ priority: 1, modal: false, isOpen: () => fullscreen.value !== null, close: exitFullscreen });

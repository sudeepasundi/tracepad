// Toasts and promise-based dialogs. State only; rendering lives in ui/Overlays.tsx.
import { signal } from '@preact/signals';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'ok';
  text: string;
  action?: { label: string; run: () => void };
  sticky?: boolean;
}

export const toasts = signal<Toast[]>([]);
let toastId = 1;

export function toast(text: string, opts: Partial<Omit<Toast, 'id' | 'text'>> & { ms?: number } = {}): number {
  const id = toastId++;
  const t: Toast = { id, kind: opts.kind ?? 'info', text, action: opts.action, sticky: opts.sticky };
  toasts.value = [...toasts.value.slice(-3), t];
  if (!t.sticky) setTimeout(() => dismissToast(id), opts.ms ?? (t.kind === 'error' ? 7000 : 3500));
  return id;
}

export function dismissToast(id: number): void {
  toasts.value = toasts.value.filter((t) => t.id !== id);
}

export interface DialogButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

export interface DialogSpec {
  id: number;
  title: string;
  message?: string;
  /** When set, the dialog shows a text field and resolves with its value. */
  input?: { value: string; placeholder?: string; label: string; validate?: (v: string) => string | null };
  buttons: DialogButton[];
  resolve: (r: { button: string; value: string } | null) => void;
}

export const dialog = signal<DialogSpec | null>(null);

let dialogId = 1;

export function ask(spec: Omit<DialogSpec, 'resolve' | 'id'>): Promise<{ button: string; value: string } | null> {
  return new Promise((resolve) => {
    dialog.value?.resolve(null);
    dialog.value = {
      ...spec,
      id: dialogId++,
      resolve: (r) => {
        dialog.value = null;
        resolve(r);
      },
    };
  });
}

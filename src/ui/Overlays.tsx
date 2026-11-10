import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { registerLayer } from '../app/commands';
import { dialog, dismissToast, toasts, type DialogSpec } from '../app/feedback';
import { dropActive } from '../app/state';
import { IconClose, IconFolder } from './icons';

registerLayer({ priority: 100, modal: true, isOpen: () => dialog.value !== null, close: () => dialog.value?.resolve(null) });

export function DialogHost() {
  const spec = dialog.value;
  // Keyed by the spec object, so each dialog starts with fresh state.
  return spec ? <DialogBody key={spec.id} spec={spec} /> : null;
}

function DialogBody({ spec }: { spec: DialogSpec }) {
  const [value, setValue] = useState(spec.input?.value ?? '');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const focusTarget = box.current?.querySelector<HTMLElement>(spec.input ? 'input' : '.tp-btn-primary') ?? box.current?.querySelector<HTMLElement>('.tp-btn');
    focusTarget?.focus();
    if (focusTarget instanceof HTMLInputElement) focusTarget.select();
  }, []);

  const press = (button: string, primary?: boolean) => {
    if (primary && spec.input?.validate) {
      const problem = spec.input.validate(value);
      if (problem) {
        setError(problem);
        return;
      }
    }
    spec.resolve({ button, value });
  };
  const primary = spec.buttons.find((b) => b.primary);

  return (
    <div class="tp-scrim" onMouseDown={(e) => e.target === e.currentTarget && spec.resolve(null)}>
      <div class="tp-dialog" role="dialog" aria-modal="true" aria-labelledby="tp-dialog-title" ref={box}>
        <h2 class="tp-dialog-title" id="tp-dialog-title">
          {spec.title}
        </h2>
        {spec.message && <p class="tp-dialog-text">{spec.message}</p>}
        {spec.input && (
          <label class="tp-field">
            <span class="tp-field-label">{spec.input.label}</span>
            <input
              type="text"
              class="tp-input"
              value={value}
              placeholder={spec.input.placeholder}
              spellcheck={false}
              autocomplete="off"
              aria-invalid={!!error}
              onInput={(e) => {
                setValue((e.target as HTMLInputElement).value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && primary) {
                  e.preventDefault();
                  press(primary.id, true);
                }
              }}
            />
            {error && <span class="tp-field-error">{error}</span>}
          </label>
        )}
        <div class="tp-dialog-buttons">
          {spec.buttons.map((b) => (
            <button key={b.id} type="button" class={`tp-btn${b.primary ? ' tp-btn-primary' : ''}${b.danger ? ' tp-btn-danger' : ''}`} onClick={() => press(b.id, b.primary)}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Toasts() {
  const list = toasts.value;
  return (
    <div class="tp-toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class={`tp-toast tp-toast-${t.kind}`}>
          <span class="tp-toast-text">{t.text}</span>
          {t.action && (
            <button
              type="button"
              class="tp-btn tp-btn-small tp-btn-primary"
              onClick={() => {
                dismissToast(t.id);
                t.action!.run();
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" class="tp-btn-icon" aria-label="Dismiss" onClick={() => dismissToast(t.id)}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

export function DropOverlay() {
  if (!dropActive.value) return null;
  return (
    <div class="tp-drop" aria-hidden="true">
      <div class="tp-drop-card">
        <IconFolder size={28} />
        <div class="tp-drop-title">Drop files to open them</div>
        <div class="tp-drop-sub">They stay on this device</div>
      </div>
    </div>
  );
}

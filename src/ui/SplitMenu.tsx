// The split button in the top bar: hover or click shows the five layouts.
// Click the zone where the current file should go.
import { signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { registerLayer } from '../app/commands';
import { SPLIT_LAYOUTS } from '../app/layouts';
import { applyLayout, isSplit, layout, unsplit } from '../app/panes';
import { settings, updateSettings, type Settings } from '../app/settings';
import { focusEditor } from '../editor/editor';
import { IconSplit } from './icons';
import { LayoutThumb } from './Panes';

const open = signal(false);
registerLayer({ priority: 40, modal: false, isOpen: () => open.value, close: () => (open.value = false) });

const SYNC: { id: Settings['syncScroll']; label: string; title: string }[] = [
  { id: 'time', label: 'By time', title: 'Logs line up at the same moment' },
  { id: 'line', label: 'By line', title: 'The same line number in every pane' },
  { id: 'off', label: 'Off', title: 'Each pane scrolls on its own' },
];

export function SplitMenu() {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const hover = (on: boolean) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => (open.value = on), on ? 120 : 320);
  };
  const pick = (run: () => void) => {
    open.value = false;
    run();
    focusEditor();
  };
  const sync = settings.value.syncScroll;
  return (
    <div class="tp-split" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
      <button
        type="button"
        class="tp-btn-icon"
        aria-label="Split layouts"
        aria-haspopup="dialog"
        aria-expanded={open.value}
        title="Split view (Ctrl+\)"
        onClick={() => {
          clearTimeout(timer.current);
          open.value = !open.value;
        }}
      >
        <IconSplit size={17} />
      </button>
      {open.value && (
        <div class="tp-split-pop" role="dialog" aria-label="Split layouts">
          <div class="tp-split-hint">Click where this file should go</div>
          <div class="tp-split-thumbs">
            {SPLIT_LAYOUTS.map((l) => (
              <LayoutThumb key={l.id} id={l.id} name={l.name} active={layout.value === l.id} onPick={(zone) => pick(() => applyLayout(l.id, zone))} />
            ))}
          </div>
          <div class="tp-split-row">
            <span class="tp-split-label" id="tp-sync-label">
              Scroll together
            </span>
            <div class="tp-seg" role="group" aria-labelledby="tp-sync-label">
              {SYNC.map((s) => (
                <button key={s.id} type="button" class="tp-seg-btn" aria-pressed={sync === s.id} title={s.title} onClick={() => updateSettings({ syncScroll: s.id })}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          {isSplit.value && (
            <button type="button" class="tp-btn tp-btn-small tp-split-one" onClick={() => pick(unsplit)}>
              Back to one editor
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// The compare view's entry points that must be there from the start: the list
// of files to compare with, and a loader for the view itself (the diff library
// is only fetched when a comparison is first opened).
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { compare, comparePick, compareTabs } from '../app/compare';
import { tabs } from '../app/state';

type CompareModule = typeof import('./Compare');
let loading: Promise<CompareModule> | null = null;

export function LazyCompare() {
  const wanted = compare.value !== null;
  const [mod, setMod] = useState<CompareModule | null>(null);
  useEffect(() => {
    if (wanted && !mod) void (loading ??= import('./Compare')).then(setMod);
  }, [wanted]);
  return wanted && mod ? <mod.Compare /> : null;
}

/** "Compare with…": the other open files, as a list to pick from. */
export function ComparePicker() {
  const id = comparePick.value;
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    box.current?.querySelector<HTMLElement>('.tp-pick-item')?.focus();
  }, [id]);
  if (id == null) return null;
  const tab = tabs.value.find((t) => t.id === id);
  const others = tabs.value.filter((t) => t.id !== id && !t.big && !t.locked).sort((x, y) => y.lastUsed - x.lastUsed);
  if (!tab) return null;
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = Array.from(box.current?.querySelectorAll<HTMLElement>('.tp-pick-item') ?? []);
    const i = items.indexOf(document.activeElement as HTMLElement);
    items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
    e.preventDefault();
  };
  return (
    <div class="tp-scrim" onMouseDown={(e) => e.target === e.currentTarget && (comparePick.value = null)}>
      <div class="tp-dialog tp-pick" role="dialog" aria-modal="true" aria-labelledby="tp-pick-title" ref={box} onKeyDown={onKey}>
        <h2 class="tp-dialog-title" id="tp-pick-title">
          Compare {tab.name} with…
        </h2>
        <div class="tp-pick-list">
          {others.map((t) => (
            <button key={t.id} type="button" class="tp-pick-item" onClick={() => compareTabs(id, t.id)}>
              <span class="tp-pick-name">{t.name}</span>
              <span class="tp-pick-meta">
                {t.isLog ? 'Log' : t.lang}
                {t.dirty ? ' · unsaved' : ''}
              </span>
            </button>
          ))}
        </div>
        <div class="tp-dialog-buttons">
          <button type="button" class="tp-btn" onClick={() => (comparePick.value = null)}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

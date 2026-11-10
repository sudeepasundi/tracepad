// "Open files" sidebar panel: every open file with filter, sort, keyboard
// navigation, rename, close, the tab menu and drag to reorder.
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { settings, updateSettings, type Settings } from '../app/settings';
import { activeId, filesFocus, renaming, tabs, type Tab } from '../app/state';
import { activateTab, closeTab, openTabMenu, startRename } from '../app/tabs';
import { IconClose, IconMore, IconSearch } from './icons';
import { RenameInput } from './RenameInput';
import { consumeDragClick, startReorder } from './reorder';

const filter = signal('');

const SORTS: { id: Settings['filesSort']; label: string }[] = [
  { id: 'order', label: 'Tab order' },
  { id: 'name', label: 'Name' },
  { id: 'recent', label: 'Recently used' },
  { id: 'type', label: 'Type' },
];

const ext = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

export function visibleFiles(list: Tab[], text: string, sort: Settings['filesSort']): Tab[] {
  const q = text.trim().toLowerCase();
  const out = q ? list.filter((t) => t.name.toLowerCase().includes(q)) : [...list];
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  else if (sort === 'recent') out.sort((a, b) => b.lastUsed - a.lastUsed);
  else if (sort === 'type') out.sort((a, b) => ext(a.name).localeCompare(ext(b.name)) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return out;
}

export function FilesPanel() {
  const all = tabs.value;
  const active = activeId.value;
  const sort = settings.value.filesSort;
  const edit = renaming.value;
  const text = filter.value;
  const list = visibleFiles(all, text, sort);
  const box = useRef<HTMLInputElement>(null);
  const rows = useRef<HTMLUListElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);
  const canDrag = sort === 'order' && !text.trim();
  const focusTick = filesFocus.value;

  useLayoutEffect(() => {
    if (focusTick > 0) {
      box.current?.focus();
      box.current?.select();
    }
  }, [focusTick]);

  const focusRow = (id: number) => {
    setCursor(id);
    rows.current?.querySelector<HTMLElement>(`[data-tab-id="${id}"] .tp-file-main`)?.focus();
  };

  const onRowKey = (e: KeyboardEvent, t: Tab) => {
    const i = list.findIndex((x) => x.id === t.id);
    if (e.key === 'ArrowDown' && list[i + 1]) focusRow(list[i + 1].id);
    else if (e.key === 'ArrowUp') {
      if (list[i - 1]) focusRow(list[i - 1].id);
      else box.current?.focus();
    } else if (e.key === 'Home') focusRow(list[0].id);
    else if (e.key === 'End') focusRow(list[list.length - 1].id);
    else if (e.key === 'Delete') {
      const next = list[i + 1] ?? list[i - 1];
      void closeTab(t.id).then((closed) => closed && next && focusRow(next.id));
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      openTabMenu(r.left + 24, r.bottom, t.id, 'list');
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div class="tp-files">
      <div class="tp-files-tools">
        <label class="tp-files-filter">
          <IconSearch size={14} />
          <input
            ref={box}
            type="text"
            class="tp-files-input"
            placeholder="Filter files"
            aria-label="Filter open files"
            spellcheck={false}
            autocomplete="off"
            value={text}
            onInput={(e) => (filter.value = (e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && list[0]) {
                e.preventDefault();
                filter.value = '';
                activateTab(list[0].id);
              } else if (e.key === 'ArrowDown' && list[0]) {
                e.preventDefault();
                focusRow(list[0].id);
              }
            }}
          />
        </label>
        <select class="tp-files-sort" aria-label="Sort open files" title="Sort" value={sort} onChange={(e) => updateSettings({ filesSort: (e.target as HTMLSelectElement).value as Settings['filesSort'] })}>
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div class="tp-files-count" aria-live="polite">
        {text.trim() ? `${list.length} of ${all.length} files` : `${all.length} ${all.length === 1 ? 'file' : 'files'}`}
        {canDrag && all.length > 1 ? ' · drag to reorder' : ''}
      </div>
      {list.length === 0 && <div class="tp-files-none">No open file matches “{text.trim()}”.</div>}
      <ul class="tp-filelist" role="list" ref={rows}>
        {list.map((t) => {
          const editing = edit?.id === t.id && edit.where === 'list';
          return (
            <li
              key={t.id}
              data-tab-id={t.id}
              class={`tp-file${t.id === active ? ' is-active' : ''}`}
              onContextMenu={(e) => {
                e.preventDefault();
                openTabMenu(e.clientX, e.clientY, t.id, 'list');
              }}
              onPointerDown={(e) => {
                if (!canDrag || editing || (e.target as HTMLElement).closest('.tp-btn-icon')) return;
                startReorder({ event: e, id: t.id, axis: 'y', container: rows.current!, itemSelector: '.tp-file' });
              }}
            >
              {editing ? (
                <div class="tp-file-main">
                  <span class={`tp-file-dot${t.dirty ? ' is-dirty' : ''}`} aria-hidden="true" />
                  <RenameInput id={t.id} name={t.name} />
                </div>
              ) : (
                <button
                  type="button"
                  class="tp-file-main"
                  tabIndex={cursor === t.id || (cursor === null && t.id === active) ? 0 : -1}
                  aria-current={t.id === active ? 'true' : undefined}
                  title={`${t.name}${t.id === active ? ' (current file)' : ''}\nDouble-click or F2 to rename`}
                  onClick={() => {
                    if (!consumeDragClick()) activateTab(t.id);
                  }}
                  onDblClick={() => startRename(t.id, 'list')}
                  onFocus={() => setCursor(t.id)}
                  onKeyDown={(e) => onRowKey(e, t)}
                >
                  <span class={`tp-file-dot${t.dirty ? ' is-dirty' : ''}`} aria-hidden="true" />
                  <span class="tp-file-name">{t.name}</span>
                  {t.dirty && <span class="tp-tag tp-tag-accent">unsaved</span>}
                  {t.locked && <span class="tp-tag">needs access</span>}
                  {(t.isLog || t.lang === 'Log') && <span class="tp-tag">log</span>}
                </button>
              )}
              <button
                type="button"
                class="tp-btn-icon tp-file-btn"
                aria-label={`More actions for ${t.name}`}
                title="More actions"
                onClick={(e) => {
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  openTabMenu(r.left, r.bottom + 2, t.id, 'list');
                }}
              >
                <IconMore size={14} />
              </button>
              <button type="button" class="tp-btn-icon tp-file-btn" aria-label={`Close ${t.name}`} title="Close" onClick={() => void closeTab(t.id)}>
                <IconClose size={13} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

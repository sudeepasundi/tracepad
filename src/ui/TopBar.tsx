import { useEffect, useRef } from 'preact/hooks';
import { runCommand } from '../app/commands';
import { activeId, isMac, tabs } from '../app/state';
import { activateTab, closeTab } from '../app/tabs';
import { IconClose, IconFolder, IconPlus, IconSave, IconSearch, Logo } from './icons';

export function TopBar() {
  const list = tabs.value;
  const active = activeId.value;
  const strip = useRef<HTMLDivElement>(null);

  // Keep the active tab in view; the strip scrolls sideways instead of squeezing names.
  useEffect(() => {
    strip.current?.querySelector('.tp-tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active, list.length]);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth || e.deltaX !== 0) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <header class="tp-topbar">
      <div class="tp-brand" title={`Tracepad ${__APP_VERSION__}`}>
        <Logo size={20} />
      </div>
      <div class="tp-tabs" role="tablist" aria-label="Open files" ref={strip}>
        {list.map((t) => (
          <div
            key={t.id}
            role="tab"
            tabIndex={t.id === active ? 0 : -1}
            aria-selected={t.id === active}
            class={`tp-tab${t.id === active ? ' is-active' : ''}${t.dirty ? ' is-dirty' : ''}`}
            title={t.handle ? `${t.name} (linked to the file on disk)` : t.name}
            onMouseDown={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                void closeTab(t.id);
              }
            }}
            onClick={() => activateTab(t.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activateTab(t.id);
              }
            }}
          >
            <span class="tp-tab-name">{t.name}</span>
            <button
              type="button"
              class="tp-tab-close"
              aria-label={t.dirty ? `Close ${t.name} (unsaved changes)` : `Close ${t.name}`}
              title={`Close (${isMac ? '⌥W' : 'Alt+W'})`}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(t.id);
              }}
            >
              <span class="tp-tab-dot" aria-hidden="true" />
              <IconClose size={13} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" class="tp-btn-icon tp-newtab" aria-label="New tab" title="New tab (Alt+N)" onClick={() => runCommand('file.new')}>
        <IconPlus size={17} />
      </button>
      <div class="tp-topbar-actions">
        <button type="button" class="tp-btn-icon" aria-label="Open a file" title="Open files (Ctrl+O)" onClick={() => runCommand('file.open')}>
          <IconFolder size={17} />
        </button>
        <button type="button" class="tp-btn-icon" aria-label="Save" title="Save (Ctrl+S)" onClick={() => runCommand('file.save')}>
          <IconSave size={17} />
        </button>
        <button type="button" class="tp-cmd-pill" aria-label="Search commands" title="Command palette (Ctrl+Shift+P)" onClick={() => runCommand('view.palette')}>
          <IconSearch size={15} />
          <span class="tp-cmd-pill-text">Search commands</span>
          <kbd class="tp-kbd">{isMac ? '⌘⇧P' : 'Ctrl+Shift+P'}</kbd>
        </button>
      </div>
    </header>
  );
}

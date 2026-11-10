import type { ComponentChildren } from 'preact';
import { toggleSetting, toggleSidebar, setFontSize } from '../app/actions';
import { allCommands, shortcutLabel } from '../app/commands';
import { FONT_CHOICES, FONT_MAX, FONT_MIN, SIDEBAR_DEFAULT, settings, updateSettings } from '../app/settings';
import { storageIsPersistent } from '../app/storage';
import { activeId, engineKind, sidebar, tabs, type SidebarPanel } from '../app/state';
import { activateTab, closeTab } from '../app/tabs';
import { ACCENTS, THEMES, buildPalette, findAccent } from '../app/themes';
import { IconCheck, IconClose, IconFiles, IconHelp, IconLock, IconPalette } from './icons';

const PANELS: { id: SidebarPanel; label: string; icon: () => ComponentChildren; bottom?: boolean }[] = [
  { id: 'files', label: 'Open files list (Ctrl+Shift+E)', icon: () => <IconFiles size={20} /> },
  { id: 'appearance', label: 'Appearance', icon: () => <IconPalette size={20} />, bottom: true },
  { id: 'help', label: 'Help and shortcuts', icon: () => <IconHelp size={20} />, bottom: true },
];

export function Rail() {
  const open = sidebar.value;
  const count = tabs.value.length;
  const button = (p: (typeof PANELS)[number]) => (
    <button
      key={p.id}
      type="button"
      class={`tp-rail-btn${open === p.id ? ' is-active' : ''}`}
      aria-label={p.label}
      aria-pressed={open === p.id}
      title={p.label}
      onClick={() => toggleSidebar(p.id)}
    >
      {p.icon()}
      {p.id === 'files' && count > 1 && (
        <span class="tp-rail-badge" aria-label={`${count} open files`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
  return (
    <nav class="tp-rail" aria-label="Panels">
      {PANELS.filter((p) => !p.bottom).map(button)}
      <div class="tp-rail-gap" />
      {PANELS.filter((p) => p.bottom).map(button)}
    </nav>
  );
}

const TITLES: Record<SidebarPanel, string> = { files: 'Open files', appearance: 'Appearance', help: 'Help' };

export function Sidebar() {
  const panel = sidebar.value;
  if (!panel) return null;
  const width = settings.value.sidebarWidth;

  const startResize = (e: PointerEvent) => {
    const handle = e.currentTarget as HTMLElement;
    const startX = e.clientX;
    const startW = width;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    const move = (ev: PointerEvent) => updateSettings({ sidebarWidth: Math.max(220, Math.min(Math.round(window.innerWidth * 0.6), startW + ev.clientX - startX)) });
    const up = () => {
      handle.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    e.preventDefault();
  };

  return (
    <aside class="tp-sidebar" style={{ width: `${width}px` }} aria-label={TITLES[panel]}>
      <div class="tp-sidebar-head">
        <h2 class="tp-sidebar-title">{TITLES[panel]}</h2>
        <button type="button" class="tp-btn-icon" aria-label="Close sidebar" title="Close" onClick={() => (sidebar.value = null)}>
          <IconClose size={15} />
        </button>
      </div>
      <div class="tp-sidebar-body">
        {panel === 'files' && <FilesPanel />}
        {panel === 'appearance' && <AppearancePanel />}
        {panel === 'help' && <HelpPanel />}
      </div>
      <div
        class="tp-sidebar-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize, double-click to reset"
        onPointerDown={startResize}
        onDblClick={() => updateSettings({ sidebarWidth: SIDEBAR_DEFAULT })}
      />
    </aside>
  );
}

function FilesPanel() {
  const list = tabs.value;
  const active = activeId.value;
  return (
    <ul class="tp-filelist" role="list">
      {list.map((t) => (
        <li key={t.id} class={`tp-file${t.id === active ? ' is-active' : ''}`}>
          <button type="button" class="tp-file-main" aria-current={t.id === active ? 'true' : undefined} onClick={() => activateTab(t.id)}>
            <span class={`tp-file-dot${t.dirty ? ' is-dirty' : ''}`} aria-hidden="true" />
            <span class="tp-file-name">{t.name}</span>
            <span class="tp-file-meta">{t.dirty ? 'unsaved' : t.lang === 'Log' ? 'log' : ''}</span>
          </button>
          <button type="button" class="tp-btn-icon tp-file-close" aria-label={`Close ${t.name}`} title="Close" onClick={() => void closeTab(t.id)}>
            <IconClose size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

function Section({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <section class="tp-section">
      <h3 class="tp-section-title">{title}</h3>
      {children}
    </section>
  );
}

function Switch({ label, on, flip }: { label: string; on: boolean; flip: () => void }) {
  return (
    <button type="button" class="tp-switch-row" role="switch" aria-checked={on} onClick={flip}>
      <span>{label}</span>
      <span class={`tp-switch${on ? ' is-on' : ''}`} aria-hidden="true" />
    </button>
  );
}

function AppearancePanel() {
  const s = settings.value;
  const accent = findAccent(s.accent);
  return (
    <div>
      <Section title="Theme">
        <div class="tp-theme-grid" role="radiogroup" aria-label="Theme">
          {THEMES.map((t) => {
            const p = buildPalette(t, accent);
            return (
              <button key={t.id} type="button" role="radio" aria-checked={s.theme === t.id} class={`tp-theme-card${s.theme === t.id ? ' is-active' : ''}`} onClick={() => updateSettings({ theme: t.id })}>
                <span class="tp-theme-preview" style={{ background: t.bg, borderColor: t.border }} aria-hidden="true">
                  <i style={{ background: p['--tp-accent'], width: '38%' }} />
                  <i style={{ background: t.muted, width: '72%' }} />
                  <i style={{ background: t.text, width: '54%' }} />
                </span>
                <span class="tp-theme-name">{t.name}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Accent colour">
        <div class="tp-accent-row" role="radiogroup" aria-label="Accent colour">
          {ACCENTS.map((a) => (
            <button
              key={a.id}
              type="button"
              role="radio"
              aria-checked={s.accent === a.id}
              aria-label={a.name}
              title={a.name}
              class={`tp-accent-dot${s.accent === a.id ? ' is-active' : ''}`}
              style={{ background: a.base }}
              onClick={() => updateSettings({ accent: a.id })}
            >
              {s.accent === a.id && <IconCheck size={14} />}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Density">
        <div class="tp-segment" role="radiogroup" aria-label="Density">
          {(['comfortable', 'compact'] as const).map((d) => (
            <button key={d} type="button" role="radio" aria-checked={s.density === d} class={`tp-segment-btn${s.density === d ? ' is-active' : ''}`} onClick={() => updateSettings({ density: d })}>
              {d === 'comfortable' ? 'Comfortable' : 'Compact'}
            </button>
          ))}
        </div>
      </Section>
      <Section title="Editor font">
        <label class="tp-field">
          <span class="tp-field-label">Font family (must be installed on this device)</span>
          <select class="tp-input" value={s.fontFamily} onChange={(e) => updateSettings({ fontFamily: (e.target as HTMLSelectElement).value })}>
            {FONT_CHOICES.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <div class="tp-field">
          <span class="tp-field-label" id="tp-fontsize-label">
            Font size
          </span>
          <div class="tp-stepper" role="group" aria-labelledby="tp-fontsize-label">
            <button type="button" class="tp-btn" aria-label="Smaller font" disabled={s.fontSize <= FONT_MIN} onClick={() => setFontSize(s.fontSize - 1)}>
              −
            </button>
            <output class="tp-stepper-value">{s.fontSize} px</output>
            <button type="button" class="tp-btn" aria-label="Larger font" disabled={s.fontSize >= FONT_MAX} onClick={() => setFontSize(s.fontSize + 1)}>
              +
            </button>
          </div>
        </div>
      </Section>
      <Section title="Editor">
        <Switch label="Word wrap" on={s.wordWrap} flip={() => toggleSetting('wordWrap')} />
        <Switch label="Minimap" on={s.minimap} flip={() => toggleSetting('minimap')} />
        <Switch label="Line numbers" on={s.lineNumbers} flip={() => toggleSetting('lineNumbers')} />
      </Section>
    </div>
  );
}

function HelpPanel() {
  const groups = new Map<string, ReturnType<typeof allCommands>>();
  for (const c of allCommands()) {
    if (!shortcutLabel(c)) continue;
    groups.set(c.category, [...(groups.get(c.category) ?? []), c]);
  }
  const engine = engineKind.value;
  return (
    <div>
      <Section title="Privacy">
        <p class="tp-help-text tp-help-privacy">
          <IconLock size={15} />
          <span>Your files never leave this device. Tracepad has no server, no analytics and makes no network requests after it has loaded.</span>
        </p>
      </Section>
      {[...groups].map(([cat, cmds]) => (
        <Section key={cat} title={cat}>
          <dl class="tp-keys">
            {cmds.map((c) => (
              <div key={c.id} class="tp-keys-row">
                <dt>{c.title}</dt>
                <dd>
                  <kbd class="tp-kbd">{shortcutLabel(c)}</kbd>
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      ))}
      <Section title="About">
        <dl class="tp-keys">
          <div class="tp-keys-row">
            <dt>Version</dt>
            <dd>{__APP_VERSION__}</dd>
          </div>
          <div class="tp-keys-row">
            <dt>Engine</dt>
            <dd data-testid="engine-kind">{engine === 'wasm' ? 'Rust (WebAssembly)' : engine === 'ts' ? 'TypeScript fallback' : 'Starting…'}</dd>
          </div>
          <div class="tp-keys-row">
            <dt>Build</dt>
            <dd>{__SINGLE__ ? 'Single file' : 'Web app'}</dd>
          </div>
          <div class="tp-keys-row">
            <dt>Settings storage</dt>
            <dd>{storageIsPersistent() ? 'This browser' : 'This page only'}</dd>
          </div>
        </dl>
      </Section>
    </div>
  );
}

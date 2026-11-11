// Bottom results panel: tabs of results, a toolbar for the table on show, and
// (for auto tables) the list of patterns beside the selected table.
import { useState } from 'preact/hooks';
import { activeResult, closeResult, copyCsv, copyRich, countByColumn, filterLogTo, jumpToRow, openAsTab, panelMaximised, panelOpen, popOut, results, selectTemplate, type ResultTab } from '../app/results';
import { settings, updateSettings } from '../app/settings';
import { KIND_LITERAL } from '../engine/mine';
import type { TemplateInfo } from '../engine/tables';
import { fullscreen, toggleFullscreen } from './fullscreen';
import { IconClose, IconExpand, IconMaximise, IconSearch } from './icons';
import { VirtualTable } from './VirtualTable';

export const PANEL_DEFAULT = 340;

function TemplateText({ t }: { t: TemplateInfo }) {
  return (
    <span class="tp-pat-text">
      {t.tokens.map((k, i) => (
        <span key={i} class={k.kind === KIND_LITERAL ? undefined : 'tp-pat-var'}>
          {k.text}
          {i < t.tokens.length - 1 ? ' ' : ''}
        </span>
      ))}
    </span>
  );
}

function PatternList({ r }: { r: ResultTab }) {
  const [text, setText] = useState('');
  const auto = r.auto!;
  const q = text.trim().toLowerCase();
  const list = q ? auto.templates.filter((t) => t.tokens.some((k) => k.text.toLowerCase().includes(q))) : auto.templates;
  return (
    <div class="tp-pats">
      <label class="tp-files-filter tp-pats-filter">
        <IconSearch size={14} />
        <input type="text" class="tp-files-input" placeholder="Filter patterns" aria-label="Filter patterns" spellcheck={false} autocomplete="off" value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} />
      </label>
      <div class="tp-pats-count" aria-live="polite">
        {q ? `${list.length} of ${auto.templates.length} patterns` : `${auto.templates.length + (auto.accessEntries ? 1 : 0)} patterns from ${auto.entries.toLocaleString()} entries`}
      </div>
      <ul class="tp-pats-list" role="listbox" aria-label="Patterns">
        {auto.accessEntries > 0 && !q && (
          <li>
            <button type="button" role="option" aria-selected={auto.selected === 'access'} class={`tp-pat${auto.selected === 'access' ? ' is-active' : ''}`} onClick={() => void selectTemplate(r.id, 'access')}>
              <span class="tp-pat-count">{auto.accessEntries.toLocaleString()}</span>
              <span class="tp-pat-text">Requests (method, route, status, bytes)</span>
            </button>
          </li>
        )}
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" role="option" aria-selected={auto.selected === t.id} class={`tp-pat${auto.selected === t.id ? ' is-active' : ''}`} title={`First seen on line ${t.firstLine.toLocaleString()}`} onClick={() => void selectTemplate(r.id, t.id)}>
              <span class={`tp-pat-count tp-pat-count-${t.level}`}>{t.count.toLocaleString()}</span>
              <TemplateText t={t} />
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 && <div class="tp-files-none">No pattern contains “{text.trim()}”.</div>}
    </div>
  );
}

function TableArea({ r }: { r: ResultTab }) {
  const [selected, setSelected] = useState<number | null>(null);
  const t = r.table;
  const loading = r.auto?.loading ?? null;
  if (!t) {
    return (
      <div class="tp-panel-note">
        {loading !== null ? `Building the table… ${Math.round(loading * 100)}%` : r.auto ? 'Choose a pattern to see its table.' : ''}
      </div>
    );
  }
  const jumpable = t.lines.length > 0 && (r.source !== null || !!r.rowTabs);
  return (
    <div class="tp-table-area">
      <div class="tp-table-tools" role="toolbar" aria-label="Table actions">
        <span class="tp-table-rows" data-testid="table-rows">
          {t.total.toLocaleString()} {t.total === 1 ? 'row' : 'rows'}
          {t.total > t.rows.length ? ` (first ${t.rows.length.toLocaleString()} shown)` : ''}
        </span>
        <select
          class="tp-files-sort tp-table-countby"
          aria-label="Count by value of a column"
          value=""
          onChange={(e) => {
            const el = e.target as HTMLSelectElement;
            if (el.value !== '') countByColumn(r.id, Number(el.value));
            el.value = '';
          }}
        >
          <option value="">Count by value…</option>
          {t.columns.map((c, i) => (
            <option key={i} value={i}>
              {c.name}
            </option>
          ))}
        </select>
        <button type="button" class="tp-btn tp-btn-small" title="Copy as a real table: pastes into Excel, Outlook, Teams and Word" onClick={() => void copyRich(t)}>
          Copy as table
        </button>
        <button type="button" class="tp-btn tp-btn-small" onClick={() => void copyCsv(t)}>
          Copy CSV
        </button>
        <button type="button" class="tp-btn tp-btn-small" onClick={() => openAsTab(t)}>
          Open as new tab
        </button>
        {t.pattern && r.source !== null && (
          <button type="button" class="tp-btn tp-btn-small" onClick={() => filterLogTo(r.id)}>
            Filter log to these lines
          </button>
        )}
        <button type="button" class="tp-btn tp-btn-small" title="Open this table in its own browser window" onClick={() => popOut(t)}>
          Pop out table
        </button>
      </div>
      {t.rows.length === 0 ? (
        <div class="tp-panel-note">Nothing matched.</div>
      ) : (
        <VirtualTable
          table={t}
          selected={selected}
          onRow={(i) => {
            setSelected(i);
            if (jumpable) jumpToRow(r.id, i);
          }}
        />
      )}
      {loading !== null && (
        <div class="tp-big-busy" role="progressbar" aria-label="Building the table" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(loading * 100)}>
          <i style={{ width: `${Math.max(4, loading * 100)}%` }} />
        </div>
      )}
    </div>
  );
}

export function ResultsPanel() {
  const list = results.value;
  const open = panelOpen.value;
  const max = panelMaximised.value;
  const full = fullscreen.value === 'panel';
  if (!open || !list.length) return null;
  const active = list.find((r) => r.id === activeResult.value) ?? list[list.length - 1];
  const height = settings.value.panelHeight;

  const startResize = (e: PointerEvent) => {
    if (max || full) return;
    const handle = e.currentTarget as HTMLElement;
    const startY = e.clientY;
    const startH = (handle.parentElement as HTMLElement).offsetHeight;
    const room = (handle.parentElement!.parentElement as HTMLElement).clientHeight;
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    const move = (ev: PointerEvent) => updateSettings({ panelHeight: Math.round(Math.max(120, Math.min(room - 90, startH + startY - ev.clientY))) });
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
    <section class={`tp-panel${max ? ' is-max' : ''}${full ? ' is-fullscreen' : ''}`} style={max || full ? undefined : { height: `${height}px` }} aria-label="Results">
      <div class="tp-panel-resize" role="separator" aria-orientation="horizontal" aria-label="Resize results panel" title="Drag to resize, double-click to reset" onPointerDown={startResize} onDblClick={() => updateSettings({ panelHeight: PANEL_DEFAULT })} />
      <header class="tp-panel-head" onDblClick={(e) => (e.target as HTMLElement).closest('button') === null && toggleFullscreen('panel')}>
        <div class="tp-panel-tabs" role="tablist" aria-label="Results">
          {list.map((r) => (
            <div key={r.id} role="tab" tabIndex={r.id === active.id ? 0 : -1} aria-selected={r.id === active.id} class={`tp-ptab${r.id === active.id ? ' is-active' : ''}`} title={r.title} onClick={() => (activeResult.value = r.id)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (activeResult.value = r.id)}>
              <span class="tp-ptab-name">{r.title}</span>
              <button
                type="button"
                class="tp-tab-close tp-ptab-close"
                aria-label={`Close result ${r.title}`}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  closeResult(r.id);
                }}
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
        </div>
        <div class="tp-panel-actions">
          <button type="button" class="tp-btn-icon" aria-label={max ? 'Restore results panel' : 'Maximise results panel'} aria-pressed={max} title={max ? 'Restore' : 'Maximise'} onClick={() => (panelMaximised.value = !max)}>
            <IconMaximise size={15} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label={full ? 'Leave full screen' : 'Results full screen'} aria-pressed={full} title={full ? 'Leave full screen (Esc)' : 'Full screen'} onClick={() => toggleFullscreen('panel')}>
            <IconExpand size={15} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Close results panel" title="Close panel (results stay open)" onClick={() => (panelOpen.value = false)}>
            <IconClose size={15} />
          </button>
        </div>
      </header>
      <div class="tp-panel-body" key={active.id}>
        {active.error ? (
          <div class="tp-panel-note is-error" role="alert">
            {active.error}
          </div>
        ) : active.busy !== null ? (
          <div class="tp-panel-note" role="status">
            <div class="tp-big-bar tp-panel-bar" role="progressbar" aria-label="Working" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(active.busy * 100)}>
              <i style={{ width: `${Math.max(3, active.busy * 100)}%` }} />
            </div>
            {active.kind === 'auto' ? 'Learning the patterns in this log…' : 'Extracting…'}
          </div>
        ) : active.kind === 'auto' && active.auto ? (
          active.auto.templates.length + active.auto.accessEntries === 0 ? (
            <div class="tp-panel-note">No log entries were found, so there are no patterns to show.</div>
          ) : (
            <div class="tp-auto">
              <PatternList r={active} />
              <TableArea r={active} key={String(active.auto.selected)} />
            </div>
          )
        ) : (
          <TableArea r={active} />
        )}
      </div>
    </section>
  );
}

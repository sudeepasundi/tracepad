// Sidebar panels for logs: "Log insights" and "Highlight rules".
import { useEffect } from 'preact/hooks';
import { forceLog, loadGroups, logGroups, logInfo, refreshLogDecorations } from '../app/logs';
import { settings, updateSettings } from '../app/settings';
import { activeTab } from '../app/state';
import type { HighlightRule } from '../editor/log';
import { goToLine, getView } from '../editor/editor';
import { LEVEL_NAMES, LV } from '../engine/logparse';
import { IconClose, IconPlus } from './icons';
import { formatTime } from './LogBar';

function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'under a second';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min ${s % 60} s`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

export function InsightsPanel() {
  const tab = activeTab.value;
  const info = tab ? logInfo.value[tab.id] : undefined;
  const groups = logGroups.value;
  const version = info?.version ?? 0;

  useEffect(() => {
    if (tab && info?.status === 'ready') void loadGroups(tab.id);
  }, [tab?.id, version]);

  if (!tab) return null;
  if (!tab.isLog || !info) {
    return (
      <div class="tp-section">
        <p class="tp-help-text">
          {tab.name} is not being treated as a log. Tracepad looks for lines that start with a timestamp (Spring Boot, Logback, JSON lines, access logs, syslog and others).
        </p>
        <button type="button" class="tp-btn tp-insight-force" onClick={() => forceLog(true)}>
          Treat this tab as a log
        </button>
      </div>
    );
  }

  const max = Math.max(1, ...info.counts);
  const mine = groups && groups.tabId === tab.id ? groups.groups : null;
  // Click steps through the occurrences, starting after the cursor.
  const visit = (lines: number[]) => {
    const s = getView().state;
    const at = s.doc.lineAt(s.selection.main.head).number;
    goToLine(lines.find((l) => l > at) ?? lines[0]);
  };

  return (
    <div>
      <section class="tp-section">
        <h3 class="tp-section-title">Summary</h3>
        <dl class="tp-keys">
          <div class="tp-keys-row">
            <dt>Format</dt>
            <dd data-testid="log-format">
              {info.format}
              {info.prefixed > 0 ? ' · container prefix' : ''}
            </dd>
          </div>
          <div class="tp-keys-row">
            <dt>Entries</dt>
            <dd>
              {info.entries.toLocaleString()} in {info.lines.toLocaleString()} lines
            </dd>
          </div>
          {info.stamped > 0 && (
            <>
              <div class="tp-keys-row">
                <dt>From</dt>
                <dd>{formatTime(info.firstTs, true)}</dd>
              </div>
              <div class="tp-keys-row">
                <dt>To</dt>
                <dd>{formatTime(info.lastTs, true)}</dd>
              </div>
              <div class="tp-keys-row">
                <dt>Covers</dt>
                <dd>{duration(info.lastTs - info.firstTs)}</dd>
              </div>
            </>
          )}
        </dl>
      </section>
      <section class="tp-section">
        <h3 class="tp-section-title">Levels</h3>
        <div class="tp-levels">
          {[LV.FATAL, LV.ERROR, LV.WARN, LV.INFO, LV.DEBUG, LV.TRACE, LV.NONE]
            .filter((lv) => info.counts[lv] > 0)
            .map((lv) => (
              <div key={lv} class="tp-level-row">
                <span class={`tp-level-name tp-lvword-${lv}`}>{lv === LV.NONE ? 'OTHER' : LEVEL_NAMES[lv]}</span>
                <span class="tp-level-track">
                  <i class={`tp-level-fill tp-level-fill-${lv}`} style={{ width: `${Math.max(2, (info.counts[lv] / max) * 100)}%` }} />
                </span>
                <span class="tp-level-count">{info.counts[lv].toLocaleString()}</span>
              </div>
            ))}
        </div>
      </section>
      <section class="tp-section">
        <h3 class="tp-section-title">Stack frames</h3>
        <label class="tp-field">
          <span class="tp-field-label">Your package prefix (its frames are highlighted, the rest dimmed)</span>
          <input
            type="text"
            class="tp-input"
            placeholder="com.mycompany"
            spellcheck={false}
            autocomplete="off"
            value={settings.value.ownPackage}
            onInput={(e) => {
              updateSettings({ ownPackage: (e.target as HTMLInputElement).value });
              refreshLogDecorations();
            }}
          />
        </label>
        <p class="tp-help-text tp-help-small">Left empty, frames from common libraries (java., org.springframework., org.apache.…) are dimmed.</p>
      </section>
      <section class="tp-section">
        <h3 class="tp-section-title">Repeated errors and warnings</h3>
        {!mine && <p class="tp-help-text">Grouping…</p>}
        {mine && mine.length === 0 && <p class="tp-help-text">No errors or warnings in this log.</p>}
        {mine && mine.length > 0 && (
          <ul class="tp-groups" role="list">
            {mine.map((g, i) => (
              <li key={i}>
                <button type="button" class="tp-group" title={`${g.sample}\n\nClick to step through the ${g.count} occurrence${g.count === 1 ? '' : 's'}`} onClick={() => visit(g.lines)}>
                  <span class={`tp-group-count tp-group-count-${g.level}`}>{g.count.toLocaleString()}×</span>
                  <span class="tp-group-text">
                    {g.exception && <span class="tp-group-exc">{g.exception.split('.').pop()}</span>}
                    <span class="tp-group-msg">{g.sample}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {tab.forceLog !== undefined || tab.lang !== 'Log' ? (
        <section class="tp-section">
          <button type="button" class="tp-btn" onClick={() => forceLog(false)}>
            Stop treating this tab as a log
          </button>
        </section>
      ) : null}
    </div>
  );
}

const COLOR_NAMES = ['Yellow', 'Green', 'Blue', 'Pink', 'Orange', 'Purple'];

function valid(rule: HighlightRule): boolean {
  if (!rule.regex || !rule.pattern) return true;
  try {
    return !new RegExp(rule.pattern).test('');
  } catch {
    return false;
  }
}

export function HighlightsPanel() {
  const rules = settings.value.highlights;
  const save = (next: HighlightRule[]) => {
    updateSettings({ highlights: next });
    refreshLogDecorations();
  };
  const patch = (id: number, p: Partial<HighlightRule>) => save(rules.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const add = () => save([...rules, { id: Math.max(0, ...rules.map((r) => r.id)) + 1, pattern: '', regex: false, color: rules.length % 6, on: true }]);

  return (
    <div class="tp-section">
      <p class="tp-help-text">Words or patterns to mark in every file, each in its own colour. Matching ignores case.</p>
      <ul class="tp-rules" role="list">
        {rules.map((r) => (
          <li key={r.id} class={`tp-rule${r.on ? '' : ' is-off'}`}>
            <input type="checkbox" class="tp-rule-on" aria-label={`Rule ${r.pattern || 'empty'} enabled`} checked={r.on} onChange={() => patch(r.id, { on: !r.on })} />
            <button
              type="button"
              class={`tp-rule-color tp-hl-${r.color}`}
              aria-label={`Colour: ${COLOR_NAMES[r.color]}. Click to change`}
              title={`${COLOR_NAMES[r.color]} (click to change)`}
              onClick={() => patch(r.id, { color: (r.color + 1) % 6 })}
            />
            <input
              type="text"
              class={`tp-input tp-rule-pattern${valid(r) ? '' : ' is-invalid'}`}
              placeholder={r.regex ? 'regular expression' : 'text to highlight'}
              aria-label="Text or pattern to highlight"
              aria-invalid={!valid(r)}
              spellcheck={false}
              autocomplete="off"
              value={r.pattern}
              onInput={(e) => patch(r.id, { pattern: (e.target as HTMLInputElement).value })}
            />
            <button type="button" class="tp-find-toggle" aria-pressed={r.regex} aria-label="Regular expression" title="Regular expression" onClick={() => patch(r.id, { regex: !r.regex })} data-glyph=".*" />
            <button type="button" class="tp-btn-icon tp-file-btn" aria-label={`Delete rule ${r.pattern || 'empty'}`} title="Delete rule" onClick={() => save(rules.filter((x) => x.id !== r.id))}>
              <IconClose size={13} />
            </button>
          </li>
        ))}
      </ul>
      <button type="button" class="tp-btn tp-rule-add" onClick={add}>
        <IconPlus size={14} />
        Add rule
      </button>
    </div>
  );
}

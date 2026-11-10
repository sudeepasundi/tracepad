import { toggleEol, toggleSetting } from '../app/actions';
import { runCommand } from '../app/commands';
import { settings } from '../app/settings';
import { logInfo } from '../app/logs';
import { activeTab, cursor } from '../app/state';

export function StatusBar() {
  const tab = activeTab.value;
  const c = cursor.value;
  const wrap = settings.value.wordWrap;
  const log = tab?.isLog ? logInfo.value[tab.id] : undefined;
  return (
    <footer class="tp-status" aria-label="Status bar">
      <div class="tp-status-left">
        {tab && (
          <span class={`tp-status-item tp-status-state${tab.dirty ? ' is-dirty' : ''}`} title={tab.handle ? 'Linked to the file on disk: Save writes back to it' : 'Not linked to a file on disk yet'}>
            {tab.locked ? 'Waiting for access' : tab.dirty ? 'Unsaved changes' : tab.handle ? 'Saved to disk' : tab.untitled ? 'New file' : 'Not linked to disk'}
          </span>
        )}
        {c.selections > 1 ? <span class="tp-status-item">{c.selections} cursors</span> : c.selectedChars > 0 ? <span class="tp-status-item tp-hide-phone">{c.selectedChars.toLocaleString()} selected</span> : null}
      </div>
      <div class="tp-status-right">
        <button type="button" class="tp-status-item tp-status-btn" title="Go to line (Ctrl+G)" onClick={() => runCommand('edit.goto')}>
          Ln {c.line.toLocaleString()}, Col {c.col.toLocaleString()}
        </button>
        <span class="tp-status-item tp-hide-phone" title="Lines in this file">
          {c.lines.toLocaleString()} {c.lines === 1 ? 'line' : 'lines'}
        </span>
        <button type="button" class="tp-status-item tp-status-btn tp-hide-phone" aria-pressed={wrap} title="Toggle word wrap (Alt+Z)" onClick={() => toggleSetting('wordWrap')}>
          {wrap ? 'Wrap on' : 'Wrap off'}
        </button>
        {tab && (
          <>
            <span class="tp-status-item" title="File encoding, kept when you save" data-testid="status-encoding">
              {tab.encoding}
            </span>
            <button type="button" class="tp-status-item tp-status-btn" title="Line endings; click to switch between LF and CRLF" data-testid="status-eol" onClick={toggleEol}>
              {tab.eol}
            </button>
            {log && (
              <button type="button" class="tp-status-item tp-status-btn tp-hide-phone" title="Detected log format. Click for log insights" data-testid="status-format" onClick={() => runCommand('view.insights')}>
                {log.status === 'parsing' ? 'Reading log…' : log.format}
              </button>
            )}
            <span class="tp-status-item tp-hide-phone" title="Syntax mode" data-testid="status-lang">
              {tab.lang}
            </span>
          </>
        )}
      </div>
    </footer>
  );
}

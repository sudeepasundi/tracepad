import { render } from 'preact';
import { registerAllCommands } from './app/actions';
import { installKeyboard } from './app/commands';
import { toast } from './app/feedback';
import { hasUnstoredChanges } from './app/session';
import { initSettings } from './app/settings';
import { activeId, crossOriginFramed, tabs } from './app/state';
import { docOf, getView, scrollTabToLine, topLineOf, viewOf } from './editor/editor';
import { focusedPane, layout, paneTabs } from './app/panes';
import { hiddenField } from './editor/log';
import { activeResult, results } from './app/results';
import { getBig, rowCount } from './app/big';
import { checkDisk } from './files/watch';
import { startEngine } from './engine/client';
import { installDrop } from './files/fileio';
import { App } from './ui/App';
import { installPasteTables } from './app/pastetables';

initSettings();
registerAllCommands();
installKeyboard();
installDrop();
installPasteTables();
render(<App />, document.getElementById('app')!);
void startEngine();

// Read-only hook used by the end-to-end tests (and handy in the console).
(window as unknown as { __tracepad: unknown }).__tracepad = {
  version: __APP_VERSION__,
  docText: () => getView().state.doc.toString(),
  selections: () => getView().state.selection.ranges.length,
  // Lines currently drawn or reachable, i.e. not hidden by a filter.
  hiddenLines: () => {
    const s = getView().state;
    let n = 0;
    s.field(hiddenField).between(0, s.doc.length, (from, to) => {
      n += s.doc.lineAt(to).number - s.doc.lineAt(from).number + 1;
    });
    return n;
  },
  cursorLine: () => {
    const s = getView().state;
    return s.doc.lineAt(s.selection.main.head).number;
  },
  lineText: (n: number) => getView().state.doc.line(n).text,
  /** The table shown in the results panel, for tests. */
  table: () => {
    const r = results.value.find((x) => x.id === activeResult.value);
    return r?.table ? { title: r.table.title, columns: r.table.columns.map((c) => c.name), rows: r.table.rows.length, total: r.table.total, first: r.table.rows[0] ?? null, ms: r.auto?.ms ?? null, patterns: r.auto?.templates.length ?? null } : null;
  },
  panes: () => ({ layout: layout.value, tabs: paneTabs.value.map((id) => tabs.value.find((t) => t.id === id)?.name ?? null), focused: focusedPane.value }),
  /** 0-based line at the top of the pane that shows the named tab. */
  topLine: (name: string) => {
    const t = tabs.value.find((x) => x.name === name);
    return t ? topLineOf(t.id) : null;
  },
  scrollTab: (name: string, line: number) => {
    const t = tabs.value.find((x) => x.name === name);
    if (t) scrollTabToLine(t.id, line);
  },
  textOf: (name: string) => {
    const t = tabs.value.find((x) => x.name === name);
    return t ? (docOf(t.id)?.toString() ?? '') : '';
  },
  /** Lines hidden by the filter in the named tab (which may be in any pane). */
  hiddenIn: (name: string) => {
    const t = tabs.value.find((x) => x.name === name);
    const s = t ? viewOf(t.id)?.state : undefined;
    if (!s) return -1;
    let n = 0;
    s.field(hiddenField).between(0, s.doc.length, (from, to) => {
      n += s.doc.lineAt(to).number - s.doc.lineAt(from).number + 1;
    });
    return n;
  },
  scrollEditor: (top: number) => void (getView().scrollDOM.scrollTop = top),
  /** Check linked files for changes on disk right now (normally every second or two). */
  checkDisk,
  big: () => {
    const b = getBig(activeId.value);
    return b ? { status: b.status, lines: b.lines, rows: rowCount(b), top: b.top, cursor: b.cursor + 1, size: b.size, cached: b.cache.size } : null;
  },
};

window.addEventListener('tp-error', (e) => toast(String((e as CustomEvent).detail), { kind: 'error' }));
window.addEventListener('tp-appearance', () => {
  try {
    getView().requestMeasure();
  } catch {
    /* editor not mounted yet */
  }
});

// Unsaved work normally comes back with the session. Warn only when some of it
// could not be kept (too large, or storage is unavailable).
window.addEventListener('beforeunload', (e) => {
  if (tabs.value.some((t) => t.dirty) && hasUnstoredChanges()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

let wantReload = false;

// Offline support: only for the hosted web app, never inside a frame or the single file.
if (!__SINGLE__ && !crossOriginFramed && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const offer = (worker: ServiceWorker | null) => {
          if (!worker || !navigator.serviceWorker.controller) return;
          toast('A new version of Tracepad is available.', {
            sticky: true,
            action: {
              label: 'Reload',
              run: () => {
                wantReload = true;
                worker.postMessage('skip-waiting');
              },
            },
          });
        };
        if (reg.waiting) offer(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const next = reg.installing;
          next?.addEventListener('statechange', () => {
            if (next.state === 'installed') offer(next);
          });
        });
      })
      .catch(() => undefined);
    // Reload only when the user asked for the update; the first install also
    // fires controllerchange and must not reload the page.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!wantReload) return;
      wantReload = false;
      window.location.reload();
    });
  });
}

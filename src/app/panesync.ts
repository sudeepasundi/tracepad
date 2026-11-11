// Panes scroll together: by timestamp (several services' logs line up at the
// same moment), by line number, or not at all. Any pane can lead.
import { onPaneScroll, scrollTabToLine, topLineOf } from '../editor/editor';
import { lineAtTime, timeAtLine } from '../engine/timesync';
import { indexFor } from './logs';
import { isSplit, visibleTabs } from './panes';
import { settings } from './settings';

/** Panes we moved ourselves: their scroll events must not lead in turn. */
const quiet = new Map<number, number>();
const pending = new Set<number>();

function follow(source: number): void {
  const mode = settings.value.syncScroll;
  if (mode === 'off' || !isSplit.value) return;
  if ((quiet.get(source) ?? 0) > performance.now()) return;
  const top = topLineOf(source);
  if (top == null) return;
  const from = indexFor(source);
  for (const other of visibleTabs.value) {
    if (other === source) continue;
    let line: number;
    if (mode === 'line') line = top;
    else {
      const to = indexFor(other);
      if (!from || !to) continue;
      const t = timeAtLine(from, top);
      if (!Number.isFinite(t)) continue;
      line = top === 0 ? 0 : lineAtTime(to, t);
    }
    quiet.set(other, performance.now() + 250);
    scrollTabToLine(other, line);
  }
}

export function initPaneSync(): void {
  onPaneScroll((id) => {
    if (pending.has(id)) return;
    pending.add(id);
    requestAnimationFrame(() => {
      pending.delete(id);
      follow(id);
    });
  });
}

// Split view state: which layout is on, which tab each zone shows, and which
// pane has focus. `activeId` is always the tab in the focused pane, so the rest
// of the app (status bar, Save, the log bar, the sidebar) follows the focus.
import { computed, signal } from '@preact/signals';
import { setFocusedPane, showInPane } from '../editor/editor';
import { DEFAULT_SIZES, EQUAL_SIZES, ZONES, layoutWithout, moveDivider, normaliseSizes, type LayoutId } from './layouts';
import { settings, updateSettings } from './settings';
import { activeId, tabs } from './state';

export const layout = signal<LayoutId>('single');
/** Tab id per zone; null = an empty zone waiting for a file. */
export const paneTabs = signal<(number | null)[]>([null]);
export const focusedPane = signal(0);
export const isSplit = computed(() => layout.value !== 'single');
/** Tabs on screen, the focused one first. */
export const visibleTabs = computed(() => {
  const list = paneTabs.value;
  const first = list[focusedPane.value];
  return [first, ...list.filter((id, i) => i !== focusedPane.value && id != null)].filter((id): id is number => id != null);
});

export function paneOf(tabId: number): number {
  return paneTabs.value.indexOf(tabId);
}

/** False until the saved split has been looked at: tabs opening during start-up must not erase it. */
let started = false;

function remember(): void {
  if (!started) return;
  const uid = (id: number | null) => tabs.value.find((t) => t.id === id)?.uid ?? '';
  const next = layout.value === 'single' ? null : { layout: layout.value, uids: paneTabs.value.map(uid) };
  // Only write when something changed: settings are saved whole, and an idle page must not rewrite them.
  if (JSON.stringify(next) !== JSON.stringify(settings.value.splitLayout)) updateSettings({ splitLayout: next });
}

/** The single place that changes the layout, the zones and the focus together. */
function commit(next: LayoutId, list: (number | null)[], focus: number): void {
  const zones = ZONES[next];
  const filled = list.slice(0, zones);
  while (filled.length < zones) filled.push(null);
  let f = Math.max(0, Math.min(zones - 1, focus));
  if (filled[f] == null) {
    const other = filled.findIndex((id) => id != null);
    if (other >= 0) f = other;
  }
  layout.value = next;
  paneTabs.value = filled;
  focusedPane.value = f;
  activeId.value = filled[f];
  setFocusedPane(f);
  // Panes that already exist update now; new ones show their tab when they mount.
  filled.forEach((id, i) => showInPane(i, id));
  setFocusedPane(f);
  remember();
}

export function focusPane(pane: number): void {
  if (pane === focusedPane.value || paneTabs.value[pane] == null) return;
  commit(layout.value, paneTabs.value, pane);
}

/** Brings a tab to the front: focuses its pane, or shows it in the focused pane. */
export function placeTab(id: number): void {
  const at = paneOf(id);
  if (at >= 0) {
    commit(layout.value, paneTabs.value, at);
    return;
  }
  const list = [...paneTabs.value];
  // An empty zone is waiting for a file: it goes there. Otherwise it replaces the focused one.
  const empty = list.indexOf(null);
  const to = empty >= 0 && list[focusedPane.value] != null ? empty : focusedPane.value;
  list[to] = id;
  commit(layout.value, list, to);
}

/** Shows a tab in a given zone. A tab that is in another zone changes places with this one. */
export function setPaneTab(pane: number, id: number): void {
  const list = [...paneTabs.value];
  const from = list.indexOf(id);
  if (from === pane) {
    focusPane(pane);
    return;
  }
  if (from >= 0) list[from] = list[pane];
  list[pane] = id;
  commit(layout.value, list, pane);
}

export function swapWithMain(pane: number): void {
  if (pane <= 0) return;
  const list = [...paneTabs.value];
  [list[0], list[pane]] = [list[pane], list[0]];
  const f = focusedPane.value;
  commit(layout.value, list, f === pane ? 0 : f === 0 ? pane : f);
}

/** Switches to a layout with `id` in `zone`. Files already on screen keep a place, in order. */
export function applyLayout(next: LayoutId, zone = 0, id: number | null = activeId.value): void {
  const zones = ZONES[next];
  const list: (number | null)[] = Array<number | null>(zones).fill(null);
  const z = Math.max(0, Math.min(zones - 1, zone));
  list[z] = id;
  const others = paneTabs.value.filter((t): t is number => t != null && t !== id);
  for (let i = 0; i < zones && others.length; i++) if (list[i] == null) list[i] = others.shift()!;
  commit(next, list, z);
}

/** Takes one zone away ("Leave this space out", or closing a pane). Its file stays open as a tab. */
export function removeZone(pane: number): void {
  if (layout.value === 'single') return;
  const list = paneTabs.value.filter((_, i) => i !== pane);
  const f = focusedPane.value;
  commit(layoutWithout(layout.value), list, f > pane ? f - 1 : f === pane ? Math.min(pane, list.length - 1) : f);
}

/** Back to one editor, keeping the focused file. */
export function unsplit(): void {
  if (layout.value === 'single') return;
  commit('single', [activeId.value], 0);
}

/** A tab was closed. `next` is the tab to show instead when there is only one pane. */
export function tabClosed(id: number, next: number | null): void {
  const at = paneOf(id);
  if (at < 0) return;
  if (layout.value !== 'single') {
    removeZone(at);
    return;
  }
  commit('single', [next], 0);
}

function mostRecentOther(): number | null {
  const on = new Set(paneTabs.value);
  return [...tabs.value].filter((t) => !on.has(t.id)).sort((a, b) => b.lastUsed - a.lastUsed)[0]?.id ?? null;
}

/** Ctrl+\: two files side by side, or back to one. */
export function toggleSplit(): void {
  if (layout.value !== 'single') {
    unsplit();
    return;
  }
  commit('cols2', [activeId.value, mostRecentOther()], 0);
}

/** "Show beside": the file goes next to what is on screen. */
export function showBeside(id: number): void {
  const list = [...paneTabs.value];
  if (layout.value === 'single') {
    const main = list[0] === id ? mostRecentOther() : list[0];
    commit('cols2', [main, id], 1);
    return;
  }
  if (list.includes(id)) {
    focusPane(list.indexOf(id));
    return;
  }
  const empty = list.indexOf(null);
  const at = empty >= 0 ? empty : list.length - 1;
  list[at] = id;
  commit(layout.value, list, at);
}

/** Drop on the right half of a single editor. */
export function openSideBySide(id: number): void {
  const main = paneTabs.value[0] === id ? mostRecentOther() : paneTabs.value[0];
  commit('cols2', [main, id], 1);
}

// ------------------------------------------------------------------- sizes

export function sizesOf(l: LayoutId): number[] {
  return normaliseSizes(l, settings.value.splitSizes[l]);
}

export function dragDivider(index: number, at: number): void {
  const l = layout.value;
  updateSettings({ splitSizes: { ...settings.value.splitSizes, [l]: moveDivider(l, settings.value.splitSizes[l], index, at) } });
}

export function equalSizes(): void {
  const l = layout.value;
  updateSettings({ splitSizes: { ...settings.value.splitSizes, [l]: [...EQUAL_SIZES[l]] } });
}

export const DEFAULT_SPLIT_SIZES: Record<LayoutId, number[]> = DEFAULT_SIZES;

/** After the session's tabs are back: put the remembered split on screen again. */
export function restoreLayout(): void {
  const saved = settings.value.splitLayout;
  started = true;
  if (!saved || !(saved.layout in ZONES) || saved.layout === 'single') return;
  const ids = saved.uids.map((uid) => tabs.value.find((t) => uid && t.uid === uid)?.id ?? null);
  const present = ids.filter((id) => id != null);
  if (present.length < 2 || new Set(present).size !== present.length) return;
  const focus = Math.max(0, ids.indexOf(activeId.value));
  commit(saved.layout, ids, focus);
}

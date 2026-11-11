// Compare (diff) view state: which two tabs are being compared.
import { signal } from '@preact/signals';
import { docLength } from '../editor/editor';
import { registerLayer } from './commands';
import { toast } from './feedback';
import { isSplit, paneTabs } from './panes';
import { activeId, tabs } from './state';

/** Left and right tab of the comparison on screen. */
export const compare = signal<{ a: number; b: number } | null>(null);
/** The tab for which the "Compare with…" list is open. */
export const comparePick = signal<number | null>(null);
/** Bumped by Next/Previous change; the view listens. */
export const compareStep = signal<{ dir: 1 | -1; tick: number }>({ dir: 1, tick: 0 });

/** Above this the comparison would take too long to be useful. */
const MAX_CHARS = 20_000_000;

function comparable(id: number): string | null {
  const tab = tabs.value.find((t) => t.id === id);
  if (!tab) return 'That file is no longer open.';
  if (tab.big) return `${tab.name} is a large file shown from disk. Compare works on files that are open in the editor (up to 64 MB).`;
  if (tab.locked) return `${tab.name} has not been read yet. Allow access to it first.`;
  if (docLength(id) > MAX_CHARS) return `${tab.name} is too long to compare here.`;
  return null;
}

export function compareTabs(a: number, b: number): void {
  comparePick.value = null;
  if (a === b) return;
  const problem = comparable(a) ?? comparable(b);
  if (problem) {
    toast(problem, { kind: 'error' });
    return;
  }
  compare.value = { a, b };
}

/** "Compare with…": straight to the comparison when the other file is obvious, else a list to pick from. */
export function compareWith(id: number | null = activeId.value): void {
  if (id == null) return;
  const problem = comparable(id);
  if (problem) {
    toast(problem, { kind: 'error' });
    return;
  }
  const others = tabs.value.filter((t) => t.id !== id && !t.big && !t.locked);
  if (!others.length) {
    toast('Open a second file to compare this one with.', { ms: 4000 });
    return;
  }
  // Two files side by side in a split: those are the two.
  const beside = isSplit.value ? paneTabs.value.filter((t): t is number => t != null && t !== id && others.some((o) => o.id === t)) : [];
  if (paneTabs.value.includes(id) && beside.length === 1) compareTabs(id, beside[0]);
  else if (others.length === 1) compareTabs(id, others[0].id);
  else comparePick.value = id;
}

export function swapCompare(): void {
  const c = compare.value;
  if (c) compare.value = { a: c.b, b: c.a };
}

export function closeCompare(): void {
  compare.value = null;
}

export function stepCompare(dir: 1 | -1): void {
  if (!compare.value) {
    toast('Next and previous change work in the compare view. Right-click a tab and choose "Compare with…".', { ms: 4500 });
    return;
  }
  compareStep.value = { dir, tick: compareStep.value.tick + 1 };
}

// Escape: the list first; the view itself only after full screen has been left (full screen is priority 1).
registerLayer({ priority: 95, modal: true, isOpen: () => comparePick.value !== null, close: () => (comparePick.value = null) });
registerLayer({ priority: 0.5, modal: false, isOpen: () => compare.value !== null, close: closeCompare });

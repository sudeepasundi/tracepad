// Find / replace box. It is our own component (not CodeMirror's panel) so that it
// can later drive every split pane at once.
import { SearchQuery, closeSearchPanel, findNext, findPrevious, openSearchPanel, replaceAll, replaceNext, searchPanelOpen, selectMatches, setSearchQuery } from '@codemirror/search';
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { registerLayer } from '../app/commands';
import { bigFindStep, bigSearch, clearBigSearch } from '../app/big';
import { visibleTabs } from '../app/panes';
import { activeId, activeTab, findOpen, tabs } from '../app/state';
import { BigFind } from '../viewer/BigFind';
import { docTick, focusEditor, getView, paneViews } from '../editor/editor';
import { IconChevron, IconClose, IconDown, IconSelectAll, IconUp } from './icons';

export const query = signal('');
const replacement = signal('');
export const caseSensitive = signal(false);
export const wholeWord = signal(false);
export const regexp = signal(false);
export const focusTick = signal(0);
const count = signal<{ total: number; current: number; capped: boolean; invalid: boolean; skipped: boolean }>({ total: 0, current: 0, capped: false, invalid: false, skipped: false });

const COUNT_CAP = 20000;
const COUNT_MAX_DOC = 30_000_000;

function makeQuery(): SearchQuery {
  return new SearchQuery({ search: query.value, replace: replacement.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value, regexp: regexp.value });
}

/** Sends the query to every pane, so matches are marked in all of them. */
function push(): void {
  const q = makeQuery();
  for (const v of paneViews()) {
    v.dispatch({ effects: setSearchQuery.of(q) });
    if (!searchPanelOpen(v.state)) openSearchPanel(v);
  }
}

function recount(): void {
  const v = getView();
  const q = makeQuery();
  if (!query.value || !q.valid) {
    count.value = { total: 0, current: 0, capped: false, invalid: !!query.value && !q.valid, skipped: false };
    return;
  }
  if (v.state.doc.length > COUNT_MAX_DOC) {
    count.value = { total: 0, current: 0, capped: false, invalid: false, skipped: true };
    return;
  }
  const sel = v.state.selection.main;
  const it = q.getCursor(v.state);
  let total = 0;
  let current = 0;
  let capped = false;
  for (let r = it.next(); !r.done; r = it.next()) {
    total++;
    if (r.value.from === sel.from && r.value.to === sel.to) current = total;
    if (total >= COUNT_CAP) {
      capped = true;
      break;
    }
  }
  count.value = { total, current, capped, invalid: false, skipped: false };
}

export function openFind(mode: 'find' | 'replace'): void {
  const v = getView();
  const sel = v.state.selection.main;
  if (!sel.empty && sel.to - sel.from <= 200) {
    const text = v.state.sliceDoc(sel.from, sel.to);
    if (!text.includes('\n')) {
      query.value = text;
      regexp.value = false;
    }
  }
  findOpen.value = mode;
  focusTick.value++;
}

export function closeFind(): void {
  findOpen.value = null;
  for (const v of paneViews()) closeSearchPanel(v);
  focusEditor();
}

export function findStep(dir: 1 | -1): void {
  if (!findOpen.value) {
    openFind('find');
    return;
  }
  if (!query.value) return;
  if (activeTab.value?.big) {
    bigFindStep(activeTab.value.id, dir);
    return;
  }
  push();
  const v = getView();
  (dir === 1 ? findNext : findPrevious)(v);
  recount();
}

registerLayer({ priority: 10, modal: false, isOpen: () => findOpen.value !== null, close: closeFind });

function Toggle({ on, label, text, flip }: { on: boolean; label: string; text: string; flip: () => void }) {
  return (
    <button type="button" class="tp-find-toggle" aria-pressed={on} aria-label={label} title={label} onClick={flip}>
      {text}
    </button>
  );
}

/** The editor's find/replace box, or the large-file one when that kind of tab is on screen. */
export function FindBar() {
  if (!findOpen.value) return null;
  return (
    <>
      <OtherPanes />
      {activeTab.value?.big ? <BigFind /> : <EditorFind />}
    </>
  );
}

/** Keeps the panes that do not have focus searching for the same thing. */
function OtherPanes() {
  const others = visibleTabs.value.filter((id) => id !== activeId.value);
  const big = others.filter((id) => tabs.value.find((t) => t.id === id)?.big);
  const deps = [query.value, caseSensitive.value, wholeWord.value, regexp.value, visibleTabs.value.join(',')];
  useEffect(() => {
    push();
  }, deps);
  useEffect(() => {
    if (!big.length) return;
    const t = setTimeout(() => big.forEach((id) => bigSearch(id, query.value, { regex: regexp.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value })), 280);
    return () => clearTimeout(t);
  }, deps);
  useEffect(() => () => big.forEach((id) => clearBigSearch(id)), [big.join(',')]);
  return null;
}

function EditorFind() {
  const mode = findOpen.value;
  const input = useRef<HTMLInputElement>(null);
  const tick = focusTick.value;
  const deps = [mode, query.value, replacement.value, caseSensitive.value, wholeWord.value, regexp.value, activeId.value];

  // Layout effect: focus must land before the next key press, or the first
  // typed character would go into the document.
  useLayoutEffect(() => {
    if (!mode) return;
    input.current?.focus();
    input.current?.select();
  }, [!!mode, tick]);
  useEffect(() => {
    if (mode) push();
  }, deps);
  useEffect(() => {
    if (!mode) return;
    const t = setTimeout(recount, 90);
    return () => clearTimeout(t);
  }, [...deps, docTick.value]);

  if (!mode) return null;
  const c = count.value;
  const status = c.invalid ? 'Invalid pattern' : !query.value ? '' : c.skipped ? 'Large file' : c.total === 0 ? 'No results' : `${c.current || '?'} of ${c.total.toLocaleString()}${c.capped ? '+' : ''}`;
  const run = (fn: (v: ReturnType<typeof getView>) => unknown) => () => {
    push();
    fn(getView());
    recount();
  };

  return (
    <div class="tp-find" role="search" aria-label="Find and replace">
      <button
        type="button"
        class={`tp-find-expand${mode === 'replace' ? ' is-open' : ''}`}
        aria-label={mode === 'replace' ? 'Hide replace' : 'Show replace'}
        aria-expanded={mode === 'replace'}
        title="Toggle replace"
        onClick={() => (findOpen.value = mode === 'replace' ? 'find' : 'replace')}
      >
        <IconChevron size={14} />
      </button>
      <div class="tp-find-rows">
        <div class="tp-find-row">
          <div class={`tp-find-field${c.invalid ? ' is-invalid' : ''}`}>
            <input
              ref={input}
              type="text"
              class="tp-find-input"
              placeholder="Find"
              aria-label="Find"
              spellcheck={false}
              autocomplete="off"
              value={query.value}
              onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  findStep(e.shiftKey ? -1 : 1);
                }
              }}
            />
            <Toggle on={caseSensitive.value} label="Match case" text="Aa" flip={() => (caseSensitive.value = !caseSensitive.value)} />
            <Toggle on={wholeWord.value} label="Whole word" text="ab" flip={() => (wholeWord.value = !wholeWord.value)} />
            <Toggle on={regexp.value} label="Regular expression" text=".*" flip={() => (regexp.value = !regexp.value)} />
          </div>
          <span class={`tp-find-count${c.invalid || (query.value && !c.total && !c.skipped) ? ' is-none' : ''}`} aria-live="polite">
            {status}
          </span>
          <button type="button" class="tp-btn-icon" aria-label="Previous match" title="Previous match (Shift+F3)" onClick={() => findStep(-1)}>
            <IconUp size={16} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Next match" title="Next match (F3)" onClick={() => findStep(1)}>
            <IconDown size={16} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Select all matches" title="Select all matches (multi-cursor)" onClick={run(selectMatches)}>
            <IconSelectAll size={16} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Close find" title="Close (Esc)" onClick={closeFind}>
            <IconClose size={16} />
          </button>
        </div>
        {mode === 'replace' && (
          <div class="tp-find-row">
            <div class="tp-find-field">
              <input
                type="text"
                class="tp-find-input"
                placeholder="Replace with"
                aria-label="Replace with"
                spellcheck={false}
                autocomplete="off"
                value={replacement.value}
                onInput={(e) => (replacement.value = (e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    run(replaceNext)();
                  }
                }}
              />
            </div>
            <button type="button" class="tp-btn tp-btn-small" onClick={run(replaceNext)}>
              Replace
            </button>
            <button type="button" class="tp-btn tp-btn-small" onClick={run(replaceAll)}>
              Replace all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

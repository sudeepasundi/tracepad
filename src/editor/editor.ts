// The CodeMirror side of the app: one view, one EditorState per tab (so every
// tab keeps its own undo history, selection and scroll position).
import { Compartment, EditorSelection, EditorState, type Extension, type StateEffect, type Text } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { highlightSelectionMatches, search, selectNextOccurrence, selectSelectionMatches } from '@codemirror/search';
import { HighlightStyle, bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { signal } from '@preact/signals';
import { settings } from '../app/settings';
import { activeDocEmpty, activeId, cursor, findOpen, patchTab, tabs } from '../app/state';
import { languageExtension } from './languages';
import { minimap } from './minimap';

const wrapConf = new Compartment();
const numbersConf = new Compartment();
const langConf = new Compartment();

/** Bumped (debounced by consumers) whenever the visible document or tab changes. */
export const docTick = signal(0);

let view: EditorView | null = null;
let currentId: number | null = null;
const states = new Map<number, EditorState>();
const savedDocs = new Map<number, Text>();
const scrolls = new Map<number, StateEffect<unknown>>();

const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--tp-text)', backgroundColor: 'var(--tp-bg)', fontSize: 'var(--tp-font-size)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--tp-mono)', lineHeight: 'var(--tp-line-height)', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--tp-accent-text)', paddingRight: 'var(--tp-minimap-pad, 0px)', paddingBottom: '40vh' },
  '.cm-line': { padding: '0 10px 0 6px' },
  '.cm-cursor, .cm-dropCursor': { borderLeft: '2px solid var(--tp-accent-text)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, & > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
    backgroundColor: 'var(--tp-selection)',
  },
  '.cm-gutters': { backgroundColor: 'var(--tp-bg)', color: 'var(--tp-faint)', border: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 14px', minWidth: '3ch' },
  '.cm-foldGutter .cm-gutterElement': { padding: '0 4px 0 0', cursor: 'pointer', color: 'var(--tp-faint)' },
  '.cm-activeLine': { backgroundColor: 'var(--tp-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--tp-active-line)', color: 'var(--tp-text)' },
  '.cm-searchMatch': { backgroundColor: 'var(--tp-match)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--tp-match-current)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--tp-accent-soft)', borderRadius: '2px' },
  '&.cm-focused .cm-matchingBracket': { backgroundColor: 'var(--tp-accent-soft)', outline: '1px solid var(--tp-border-strong)' },
  '.cm-foldPlaceholder': { backgroundColor: 'var(--tp-surface-2)', border: '1px solid var(--tp-border)', color: 'var(--tp-muted)', padding: '0 6px', borderRadius: '4px' },
  '.cm-panels': { display: 'none' },
  '.cm-specialChar': { color: 'var(--tp-danger)' },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: 'var(--tp-syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--tp-syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--tp-syn-number)' },
  { tag: [t.comment, t.meta], color: 'var(--tp-syn-comment)', fontStyle: 'italic' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--tp-syn-type)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.definition(t.variableName)], color: 'var(--tp-syn-func)' },
  { tag: [t.propertyName, t.attributeName], color: 'var(--tp-syn-prop)' },
  { tag: t.heading, color: 'var(--tp-syn-heading)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: [t.link, t.url], color: 'var(--tp-accent-text)', textDecoration: 'underline' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.monospace, color: 'var(--tp-syn-string)' },
  { tag: t.invalid, color: 'var(--tp-danger)' },
]);

function wrapExt(): Extension {
  return settings.value.wordWrap ? EditorView.lineWrapping : [];
}

function numbersExt(): Extension {
  return settings.value.lineNumbers ? [lineNumbers(), highlightActiveLineGutter(), foldGutter({ openText: '⌄', closedText: '›' })] : [];
}

function extensions(lang: string): Extension {
  return [
    numbersConf.of(numbersExt()),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    EditorState.tabSize.of(4),
    indentUnit.of('    '),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    highlightSelectionMatches({ minSelectionLength: 2 }),
    // The find box is our own component; this hidden panel only switches on
    // CodeMirror's match highlighting.
    search({ top: true, createPanel: () => ({ dom: document.createElement('div'), top: true }) }),
    syntaxHighlighting(highlight),
    wrapConf.of(wrapExt()),
    langConf.of(languageExtension(lang)),
    minimap,
    // Keep jumps (find, go to line) clear of the minimap and the find box.
    EditorView.scrollMargins.of((v) => ({
      right: settings.value.minimap && v.dom.clientWidth >= 720 ? 100 : 0,
      top: findOpen.value === 'replace' ? 92 : findOpen.value ? 56 : 0,
    })),
    theme,
    keymap.of([
      { key: 'Mod-d', run: selectNextOccurrence, preventDefault: true },
      { key: 'Mod-Shift-l', run: selectSelectionMatches, preventDefault: true },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...historyKeymap,
      ...foldKeymap,
      indentWithTab,
    ]),
    EditorView.contentAttributes.of({ 'aria-label': 'Editor', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off' }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        if (currentId != null) {
          const saved = savedDocs.get(currentId);
          const dirty = !saved || !u.state.doc.eq(saved);
          const tab = tabs.value.find((x) => x.id === currentId);
          if (tab && tab.dirty !== dirty) patchTab(currentId, { dirty });
        }
        docTick.value++;
      }
      if (u.docChanged || u.selectionSet) publishCursor(u.state);
    }),
  ];
}

function publishCursor(state: EditorState): void {
  const sel = state.selection;
  const head = sel.main.head;
  const line = state.doc.lineAt(head);
  let selectedChars = 0;
  for (const r of sel.ranges) selectedChars += r.to - r.from;
  cursor.value = { line: line.number, col: head - line.from + 1, lines: state.doc.lines, chars: state.doc.length, selections: sel.ranges.length, selectedChars };
  activeDocEmpty.value = state.doc.length === 0;
}

export function mountEditor(parent: HTMLElement): void {
  view = new EditorView({ parent, state: EditorState.create({ extensions: extensions('Plain text') }) });
}

export function getView(): EditorView {
  if (!view) throw new Error('editor not mounted');
  return view;
}

export function focusEditor(): void {
  view?.focus();
}

function stateOf(id: number): EditorState | undefined {
  return id === currentId && view ? view.state : states.get(id);
}

export function createDoc(id: number, text: string, lang: string): void {
  const state = EditorState.create({ doc: text, extensions: extensions(lang) });
  states.set(id, state);
  savedDocs.set(id, state.doc);
}

export function removeDoc(id: number): void {
  states.delete(id);
  savedDocs.delete(id);
  scrolls.delete(id);
  if (currentId === id) currentId = null;
}

export function showTab(id: number): void {
  if (!view || id === currentId) return;
  if (currentId != null) {
    states.set(currentId, view.state);
    scrolls.set(currentId, view.scrollSnapshot());
  }
  const next = states.get(id);
  if (!next) return;
  currentId = id;
  view.setState(next);
  const snap = scrolls.get(id);
  if (snap) view.dispatch({ effects: snap });
  publishCursor(view.state);
  docTick.value++;
}

/** Document text with the tab's own line endings. */
export function docText(id: number, eol: 'LF' | 'CRLF'): string {
  const s = stateOf(id);
  return s ? s.doc.sliceString(0, undefined, eol === 'CRLF' ? '\r\n' : '\n') : '';
}

export function docLength(id: number): number {
  return stateOf(id)?.doc.length ?? 0;
}

export function markSaved(id: number): void {
  const s = stateOf(id);
  if (!s) return;
  savedDocs.set(id, s.doc);
  patchTab(id, { dirty: false });
}

function reconfigureAll(effectFor: (id: number) => StateEffect<unknown>): void {
  for (const [id, st] of states) {
    if (id === currentId) continue;
    states.set(id, st.update({ effects: effectFor(id) }).state);
  }
  if (view && currentId != null) view.dispatch({ effects: effectFor(currentId) });
}

export function applyEditorSettings(): void {
  reconfigureAll(() => wrapConf.reconfigure(wrapExt()));
  reconfigureAll(() => numbersConf.reconfigure(numbersExt()));
  view?.requestMeasure();
}

export function setTabLanguage(id: number, lang: string): void {
  const effect = langConf.reconfigure(languageExtension(lang));
  if (id === currentId && view) view.dispatch({ effects: effect });
  else {
    const st = states.get(id);
    if (st) states.set(id, st.update({ effects: effect }).state);
  }
}

export function goToLine(line: number, col = 1): void {
  if (!view) return;
  const doc = view.state.doc;
  const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
  const pos = Math.min(l.to, l.from + Math.max(0, col - 1));
  view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
  view.focus();
}

export function selectAll(): void {
  if (!view) return;
  view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
  view.focus();
}

export function currentTabId(): number | null {
  return currentId ?? activeId.value;
}

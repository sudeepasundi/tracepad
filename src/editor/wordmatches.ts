// Outlines the other places where the selected text appears: a word
// (INFO), a name with punctuation (order-service, HikariPool-1, status=503),
// part of a timestamp. The selection itself is drawn as the selection; the
// other places only get a thin outline, so the two never look alike.
//
// A match must be whole at the edges that are letters or digits: selecting
// "Hikari" out of "HikariPool" marks nothing, and "order" does not mark the
// "order" inside "orders".
import { CharCategory, RangeSetBuilder, type EditorState } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

const MATCH = Decoration.mark({ class: 'cm-selectionMatch' });
const MAIN = Decoration.mark({ class: 'cm-selectionMatch cm-selectionMatch-main' });
const MAX_MATCHES = 500;

type Cat = (ch: string) => CharCategory;

/** True when `text` at [from, to) is not glued to letters or digits on a side that starts or ends with one. */
function whole(cat: Cat, word: string, before: string, after: string): boolean {
  if (cat(word[0]) === CharCategory.Word && before && cat(before) === CharCategory.Word) return false;
  if (cat(word[word.length - 1]) === CharCategory.Word && after && cat(after) === CharCategory.Word) return false;
  return true;
}

/** The selected text to look for, or null (empty, several lines, edge spaces, too short or long, or part of a word). */
export function selectedText(state: EditorState): { from: number; to: number; text: string } | null {
  const sel = state.selection;
  if (sel.ranges.length > 1) return null;
  const { from, to } = sel.main;
  if (to - from < 2 || to - from > 200) return null;
  const text = state.sliceDoc(from, to);
  if (text.includes('\n') || text.trim() !== text) return null;
  const cat = state.charCategorizer(from);
  const before = from > 0 ? state.sliceDoc(from - 1, from) : '';
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : '';
  if (!whole(cat, text, before, after)) return null;
  return { from, to, text };
}

function build(view: EditorView): DecorationSet {
  const found = selectedText(view.state);
  if (!found) return Decoration.none;
  const { text: needle, from: selFrom } = found;
  const cat = view.state.charCategorizer(selFrom);
  const b = new RangeSetBuilder<Decoration>();
  let n = 0;
  for (const range of view.visibleRanges) {
    const text = view.state.sliceDoc(range.from, range.to);
    let i = text.indexOf(needle);
    while (i >= 0 && n < MAX_MATCHES) {
      const from = range.from + i;
      const to = from + needle.length;
      const before = i > 0 ? text[i - 1] : from > 0 ? view.state.sliceDoc(from - 1, from) : '';
      const after = i + needle.length < text.length ? text[i + needle.length] : view.state.sliceDoc(to, to + 1);
      if (whole(cat, needle, before, after)) {
        b.add(from, to, from === selFrom ? MAIN : MATCH);
        n++;
      }
      i = text.indexOf(needle, i + needle.length);
    }
  }
  return b.finish();
}

export const wordMatches = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate): void {
      if (u.selectionSet || u.docChanged || u.viewportChanged) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);

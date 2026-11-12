// Marks the other places where the selected word appears. Only a single word
// counts (INFO, HikariPool, orderId): selecting part of a timestamp or any text
// with punctuation in it marks nothing, or every line of a log would light up.
import { CharCategory, RangeSetBuilder, type EditorState } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';

const MATCH = Decoration.mark({ class: 'cm-selectionMatch' });
const MAIN = Decoration.mark({ class: 'cm-selectionMatch cm-selectionMatch-main' });
const MAX_MATCHES = 300;

/** The selected word, or null when the selection is empty, spans lines, or is not exactly one word. */
export function selectedWord(state: EditorState): { from: number; to: number; word: string } | null {
  const sel = state.selection;
  if (sel.ranges.length > 1) return null;
  const { from, to } = sel.main;
  if (to - from < 2 || to - from > 200) return null;
  const word = state.sliceDoc(from, to);
  const cat = state.charCategorizer(from);
  for (const ch of word) if (cat(ch) !== CharCategory.Word) return null;
  // The word must not continue on either side: half of "HikariPool" is not a word.
  const before = from > 0 ? state.sliceDoc(from - 1, from) : '';
  const after = to < state.doc.length ? state.sliceDoc(to, to + 1) : '';
  if ((before && cat(before) === CharCategory.Word) || (after && cat(after) === CharCategory.Word)) return null;
  return { from, to, word };
}

function build(view: EditorView): DecorationSet {
  const found = selectedWord(view.state);
  if (!found) return Decoration.none;
  const { word, from: selFrom } = found;
  const cat = view.state.charCategorizer(selFrom);
  const b = new RangeSetBuilder<Decoration>();
  let n = 0;
  for (const range of view.visibleRanges) {
    const text = view.state.sliceDoc(range.from, range.to);
    let i = text.indexOf(word);
    while (i >= 0 && n < MAX_MATCHES) {
      const from = range.from + i;
      const to = from + word.length;
      const before = i > 0 ? text[i - 1] : from > 0 ? view.state.sliceDoc(from - 1, from) : '';
      const after = i + word.length < text.length ? text[i + word.length] : view.state.sliceDoc(to, to + 1);
      if ((!before || cat(before) !== CharCategory.Word) && (!after || cat(after) !== CharCategory.Word)) {
        b.add(from, to, from === selFrom ? MAIN : MATCH);
        n++;
      }
      i = text.indexOf(word, i + word.length);
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

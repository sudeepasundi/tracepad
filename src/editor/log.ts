// Log features inside CodeMirror: level colours, stack-frame dimming, folding
// of stack traces, user highlight rules, and hiding of filtered-out lines.
// Everything is driven by the parsed index; decorations are built only for the
// lines on screen, so cost does not depend on file size.
import { RangeSetBuilder, StateEffect, StateField, type Extension, type Text } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { foldService } from '@codemirror/language';
import { settings } from '../app/settings';
import type { PageIndex } from '../engine/client';
import { FLAG_CAUSE, FLAG_ENTRY, FLAG_FRAME } from '../engine/logparse';
import { PRESET_RULES, compileRules, findMarks, type CompiledRule, type UserRule } from '../engine/highlights';

export const setLogIndex = StateEffect.define<PageIndex | null>();
/** 1 = shown; null clears the filter. */
export const setHidden = StateEffect.define<Uint8Array | null>();
/** Rebuild decorations after a settings change (own package, highlight rules). */
export const refreshLog = StateEffect.define<null>();

interface Attached {
  index: PageIndex | null;
  /** False between an edit and the next parse: line numbers may have shifted. */
  fresh: boolean;
}

export const logIndexField = StateField.define<Attached>({
  create: () => ({ index: null, fresh: false }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLogIndex)) return { index: e.value, fresh: e.value !== null };
    if (tr.docChanged && value.fresh) return { index: value.index, fresh: false };
    return value;
  },
});

const hide = Decoration.replace({ block: true });

/** Block-replaces every run of hidden lines. */
export function hiddenRanges(doc: Text, mask: Uint8Array): DecorationSet {
  if (mask.length !== doc.lines) return Decoration.none;
  const b = new RangeSetBuilder<Decoration>();
  const n = mask.length;
  let i = 0;
  while (i < n) {
    if (mask[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < n && !mask[j + 1]) j++;
    b.add(doc.line(i + 1).from, doc.line(j + 1).to, hide);
    i = j + 1;
  }
  return b.finish();
}

export const hiddenField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setHidden)) return e.value ? hiddenRanges(tr.state.doc, e.value) : Decoration.none;
    return tr.docChanged ? value.map(tr.changes) : value;
  },
  provide: (f) => [EditorView.decorations.from(f), EditorView.atomicRanges.of((view) => view.state.field(f))],
});

// Frames from well-known libraries are dimmed when no package prefix is set.
const FRAMEWORK = /^(?:[\w.]+\/)?(?:java\.|javax\.|jakarta\.|jdk\.|sun\.|com\.sun\.|kotlin\.|kotlinx\.|scala\.|org\.springframework\.|org\.apache\.|org\.hibernate\.|org\.jboss\.|org\.eclipse\.|org\.junit\.|org\.slf4j\.|ch\.qos\.|com\.zaxxer\.|com\.mysql\.|org\.postgresql\.|com\.fasterxml\.|io\.netty\.|io\.micrometer\.|io\.lettuce\.|reactor\.|feign\.|com\.netflix\.|io\.grpc\.|okhttp3\.|redis\.)/;

export function isOwnFrame(text: string, prefix: string): boolean {
  const m = /^\s*at\s+(\S+)/.exec(text);
  if (!m) return false;
  const name = m[1].replace(/^[\w.]+\//, '');
  return prefix ? name.startsWith(prefix) : !FRAMEWORK.test(m[1]);
}

const levelLine = [null, 'tp-lv-1', 'tp-lv-2', null, 'tp-lv-4', 'tp-lv-5', 'tp-lv-6'].map((c) => (c ? Decoration.line({ class: c }) : null));
const frameLine = Decoration.line({ class: 'tp-frame' });
const ownFrameLine = Decoration.line({ class: 'tp-frame tp-frame-own' });
const causeLine = Decoration.line({ class: 'tp-cause' });
const WORD = /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|CRITICAL)\b/;
const wordMark: Record<string, Decoration> = {};
for (const [w, n] of [['TRACE', 1], ['DEBUG', 2], ['INFO', 3], ['WARN', 4], ['WARNING', 4], ['ERROR', 5], ['SEVERE', 5], ['FATAL', 6], ['CRITICAL', 6]] as const) {
  wordMark[w] = Decoration.mark({ class: `tp-lvword tp-lvword-${n}` });
}
const MAX_LINES_PER_PASS = 2000;

const logColours = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate): void {
      const before = u.startState.field(logIndexField);
      const now = u.state.field(logIndexField);
      const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshLog)));
      if (!now.fresh && now.index) {
        // Stale index: keep what is drawn, moved with the edit, until the next parse.
        this.decorations = this.decorations.map(u.changes);
      } else if (before !== now || u.viewportChanged || refreshed) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const { index, fresh } = view.state.field(logIndexField);
      const doc = view.state.doc;
      if (!index || !fresh || index.level.length !== doc.lines) return Decoration.none;
      const prefix = settings.value.ownPackage.trim();
      const b = new RangeSetBuilder<Decoration>();
      let budget = MAX_LINES_PER_PASS;
      for (const range of view.visibleRanges) {
        let pos = range.from;
        while (pos <= range.to && budget-- > 0) {
          const line = doc.lineAt(pos);
          const i = line.number - 1;
          const flags = index.flags[i];
          const lv = index.level[i];
          if (flags & FLAG_FRAME) b.add(line.from, line.from, isOwnFrame(line.text, prefix) ? ownFrameLine : frameLine);
          else if (flags & FLAG_CAUSE) b.add(line.from, line.from, causeLine);
          else {
            const deco = levelLine[lv];
            if (deco) b.add(line.from, line.from, deco);
            if (flags & FLAG_ENTRY && lv > 0) {
              const m = WORD.exec(line.length > 200 ? line.text.slice(0, 200) : line.text);
              if (m) b.add(line.from + m.index, line.from + m.index + m[0].length, wordMark[m[0]]);
            }
          }
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- user highlight rules -------------------------------------------------

export type HighlightRule = UserRule;

const MARKS = [...Array.from({ length: 6 }, (_, i) => Decoration.mark({ class: `tp-hl tp-hl-${i}` })), Decoration.mark({ class: 'tp-filter-hit' })];

/** The log filter's text, marked in the lines it shows. Set by app/logs.ts. */
let filterMark: CompiledRule | null = null;
export function setFilterMark(rule: CompiledRule | null): void {
  filterMark = rule;
}

/** Compiled rules, rebuilt only when the settings object changes. */
let cache: { key: unknown; all: CompiledRule[]; user: CompiledRule[] } | null = null;
export function currentRules(isLog: boolean, withFilter = false): CompiledRule[] {
  if (withFilter && isLog && filterMark) return [filterMark, ...currentRules(true)];
  const s = settings.value;
  if (!cache || cache.key !== s) {
    const none = Object.fromEntries(PRESET_RULES.map((p) => [p.id, false]));
    cache = { key: s, all: compileRules(s.highlights, s.presetRules), user: compileRules(s.highlights, none) };
  }
  // The ready-made rules are for logs; your own rules apply to every file.
  return isLog ? cache.all : cache.user;
}

const highlightRules = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate): void {
      const refreshed = u.transactions.some((t) => t.effects.some((e) => e.is(refreshLog)));
      const attached = u.startState.field(logIndexField).index !== u.state.field(logIndexField).index;
      if (refreshed || attached || u.docChanged || u.viewportChanged) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const isLog = view.state.field(logIndexField).index !== null;
      // The filter's matches first: they say why a line is shown.
      const rules = isLog && filterMark ? [filterMark, ...currentRules(true)] : currentRules(isLog);
      if (!rules.length) return Decoration.none;
      const b = new RangeSetBuilder<Decoration>();
      for (const range of view.visibleRanges) {
        // Line by line: a match never runs across lines, and the cost stays with what is on screen.
        let pos = range.from;
        while (pos <= range.to) {
          const line = view.state.doc.lineAt(pos);
          const text = line.text.length > 20_000 ? line.text.slice(0, 20_000) : line.text;
          for (const m of findMarks(text, rules, 400)) b.add(line.from + m.from, line.from + m.to, MARKS[m.color]);
          pos = line.to + 1;
        }
      }
      return b.finish();
    }
  },
  { decorations: (v) => v.decorations },
);

// ---- folding: a stack trace folds into the entry it belongs to -------------

const traceFolding = foldService.of((state, lineStart, lineEnd) => {
  const { index, fresh } = state.field(logIndexField);
  if (!index || !fresh || index.level.length !== state.doc.lines) return null;
  const i = state.doc.lineAt(lineStart).number - 1;
  if (!(index.flags[i] & FLAG_ENTRY)) return null;
  let j = i;
  while (j + 1 < index.flags.length && !(index.flags[j + 1] & FLAG_ENTRY)) j++;
  // Trailing blank lines stay outside the fold.
  while (j > i && state.doc.line(j + 1).length === 0) j--;
  return j > i ? { from: lineEnd, to: state.doc.line(j + 1).to } : null;
});

export function logExtension(): Extension {
  return [logIndexField, hiddenField, logColours, highlightRules, traceFolding];
}

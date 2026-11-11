// Side-by-side comparison of two tabs. Read-only: it shows the two files as
// they were when it opened (Refresh takes them again).
import { MergeView, getChunks } from '@codemirror/merge';
import { EditorView } from '@codemirror/view';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { closeCompare, compare, compareStep, swapCompare } from '../app/compare';
import { settings } from '../app/settings';
import { tabs } from '../app/state';
import { docOf, focusEditor, readOnlyExtensions } from '../editor/editor';
import { fullscreen, toggleFullscreen } from './fullscreen';
import { IconClose, IconDown, IconExpand, IconSwap, IconUp } from './icons';

export function Compare() {
  const c = compare.value;
  if (!c) return null;
  const a = tabs.value.find((t) => t.id === c.a);
  const b = tabs.value.find((t) => t.id === c.b);
  // A compared tab was closed: nothing left to show.
  if (!a || !b) {
    queueMicrotask(closeCompare);
    return null;
  }
  return <CompareBody key={`${c.a}:${c.b}`} a={c.a} b={c.b} nameA={a.name} nameB={b.name} langA={a.lang} langB={b.lang} />;
}

function CompareBody({ a, b, nameA, nameB, langA, langB }: { a: number; b: number; nameA: string; nameB: string; langA: string; langB: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MergeView | null>(null);
  const [changes, setChanges] = useState(0);
  const [at, setAt] = useState(-1);
  const [collapse, setCollapse] = useState(true);
  const [version, setVersion] = useState(0);
  const full = fullscreen.value === 'compare';
  const wrap = settings.value.wordWrap;
  const step = compareStep.value;

  useLayoutEffect(() => {
    const mv = new MergeView({
      parent: host.current!,
      a: { doc: docOf(a)?.toString() ?? '', extensions: readOnlyExtensions(langA, `Left: ${nameA}`) },
      b: { doc: docOf(b)?.toString() ?? '', extensions: readOnlyExtensions(langB, `Right: ${nameB}`) },
      highlightChanges: true,
      gutter: true,
      // No revert controls: that is what would add a strip between the two sides.
      collapseUnchanged: collapse ? { margin: 3, minSize: 8 } : undefined,
      diffConfig: { scanLimit: 2000 },
    });
    view.current = mv;
    setChanges(getChunks(mv.b.state)?.chunks.length ?? 0);
    setAt(-1);
    return () => {
      mv.destroy();
      view.current = null;
    };
  }, [a, b, collapse, wrap, version]);

  const go = (dir: 1 | -1) => {
    const mv = view.current;
    const chunks = mv ? (getChunks(mv.b.state)?.chunks ?? []) : [];
    if (!mv || !chunks.length) return;
    const next = at < 0 ? (dir === 1 ? 0 : chunks.length - 1) : (at + dir + chunks.length) % chunks.length;
    setAt(next);
    const pos = Math.min(chunks[next].fromB, mv.b.state.doc.length);
    mv.b.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    // A change that only exists on the left has no height on the right: bring the left side's lines into view too.
    const posA = Math.min(chunks[next].fromA, mv.a.state.doc.length);
    mv.a.dispatch({ selection: { anchor: posA }, effects: EditorView.scrollIntoView(posA, { y: 'center' }) });
  };

  // F7 / Shift+F7 from anywhere.
  useLayoutEffect(() => {
    if (step.tick) go(step.dir);
  }, [step.tick]);

  const status = changes === 0 ? 'No differences' : at < 0 ? `${changes.toLocaleString('en-US')} ${changes === 1 ? 'change' : 'changes'}` : `${at + 1} of ${changes.toLocaleString('en-US')}`;

  return (
    <section class={`tp-compare${full ? ' is-fullscreen' : ''}`} aria-label={`Compare ${nameA} with ${nameB}`}>
      <header class="tp-compare-head" onDblClick={(e) => (e.target as HTMLElement).closest('button') === null && toggleFullscreen('compare')}>
        <span class="tp-preview-kind">Compare</span>
        <span class="tp-compare-status" aria-live="polite">
          {status}
        </span>
        <span class="tp-compare-actions">
          <button type="button" class="tp-btn-icon" aria-label="Previous change" title="Previous change (Shift+F7)" disabled={!changes} onClick={() => go(-1)}>
            <IconUp size={16} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Next change" title="Next change (F7)" disabled={!changes} onClick={() => go(1)}>
            <IconDown size={16} />
          </button>
          <button type="button" class="tp-btn tp-btn-small" aria-pressed={collapse} title="Show only the changes and a few lines around them" onClick={() => setCollapse(!collapse)}>
            Hide unchanged
          </button>
          <button type="button" class="tp-btn tp-btn-small" title="Take both files again, as they are now" onClick={() => setVersion(version + 1)}>
            Refresh
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Swap sides" title="Swap left and right" onClick={swapCompare}>
            <IconSwap size={15} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label={full ? 'Leave full screen' : 'Compare full screen'} aria-pressed={full} title={full ? 'Leave full screen (Esc)' : 'Full screen'} onClick={() => toggleFullscreen('compare')}>
            <IconExpand size={15} />
          </button>
          <button
            type="button"
            class="tp-btn-icon"
            aria-label="Close compare"
            title="Close compare (Esc)"
            onClick={() => {
              if (full) toggleFullscreen('compare');
              closeCompare();
              focusEditor();
            }}
          >
            <IconClose size={15} />
          </button>
        </span>
      </header>
      <div class="tp-compare-names">
        <span class="tp-compare-name" title={nameA}>
          {nameA}
        </span>
        <span class="tp-compare-name" title={nameB}>
          {nameB}
        </span>
      </div>
      <div class="tp-compare-body" ref={host} />
      {changes === 0 && <div class="tp-compare-same">These two files are identical.</div>}
    </section>
  );
}

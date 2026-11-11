// Read-only viewer for large files. Only the rows on screen exist in the DOM;
// their text is fetched from disk through the engine. Scrolling is virtual, and
// scaled when the file has more rows than a browser can lay out.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { bigReveal, bigTick, ensureRows, getBig, lineOfRow, publishCursor, revealLine, rowCount, rowOfLine, selectedText, type BigTab } from '../app/big';
import { copyToClipboard } from '../app/clipboard';
import { toast } from '../app/feedback';
import { settings } from '../app/settings';
import { activeTab, type Tab } from '../app/state';
import { setNavigator } from '../editor/editor';
import { isOwnFrame } from '../editor/log';
import { openFiles } from '../files/fileio';
import { FLAG_CAUSE, FLAG_ENTRY, FLAG_FRAME } from '../engine/logparse';

/** Browsers stop laying out content somewhere above 10-30 million pixels. */
const MAX_HEIGHT = 8_000_000;
const WORD = /\b(TRACE|DEBUG|INFO|WARN(?:ING)?|ERROR|FATAL|SEVERE|CRITICAL)\b/;
const WORD_LEVEL: Record<string, number> = { TRACE: 1, DEBUG: 2, INFO: 3, WARN: 4, WARNING: 4, ERROR: 5, SEVERE: 5, FATAL: 6, CRITICAL: 6 };

export function formatBytes(n: number): string {
  if (n >= 1 << 30) return `${(n / (1 << 30)).toFixed(n >= 10 * (1 << 30) ? 0 : 1)} GB`;
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(n >= 100 * (1 << 20) ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/** Splits a row into plain and marked pieces: find matches first, else the level word. */
function pieces(text: string, find: RegExp | null, entry: boolean): ComponentChildren {
  if (find) {
    const re = new RegExp(find.source, find.flags.includes('g') ? find.flags : `${find.flags}g`);
    const out: ComponentChildren[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 200) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(<mark class="tp-big-hit">{m[0]}</mark>);
      last = m.index + m[0].length;
    }
    if (out.length) {
      if (last < text.length) out.push(text.slice(last));
      return out;
    }
  }
  if (entry) {
    const m = WORD.exec(text.length > 200 ? text.slice(0, 200) : text);
    if (m) return [text.slice(0, m.index), <span class={`tp-lvword tp-lvword-${WORD_LEVEL[m[0]]}`}>{m[0]}</span>, text.slice(m.index + m[0].length)];
  }
  return text;
}

export function BigViewer() {
  const tab = activeTab.value;
  void bigTick.value;
  const b = tab?.big ? getBig(tab.id) : null;
  if (!tab || !b) return null;
  return <Viewer key={tab.id} tab={tab} b={b} />;
}

function Viewer({ tab, b }: { tab: Tab; b: BigTab }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const metrics = useRef({ rowH: 21, charW: 8, viewH: 600 });
  const expected = useRef(0);
  const widest = useRef(120);
  const [, setFrame] = useState(0);
  const repaint = () => setFrame((n) => n + 1);
  // Subscribe here too: with unchanged props, a parent re-render alone does not redraw this component.
  void bigTick.value;
  const reveal = bigReveal.value;
  const prefix = settings.value.ownPackage.trim();

  const { rowH, charW, viewH } = metrics.current;
  const total = rowCount(b);
  const fit = Math.max(1, Math.floor(viewH / rowH));
  const maxTop = Math.max(0, total - fit + 3);
  const fullHeight = (total + 3) * rowH;
  const scaled = fullHeight > MAX_HEIGHT;
  const height = scaled ? MAX_HEIGHT : fullHeight;
  const toScroll = (top: number) => (scaled ? (maxTop ? (top / maxTop) * (height - viewH) : 0) : top * rowH);
  const fromScroll = (px: number) => (scaled ? (height > viewH ? (px / (height - viewH)) * maxTop : 0) : px / rowH);

  const setTop = (top: number) => {
    b.top = Math.max(0, Math.min(maxTop, top));
    const el = scroller.current;
    if (el) {
      expected.current = Math.round(toScroll(b.top));
      el.scrollTop = expected.current;
    }
    repaint();
  };

  const measure = () => {
    const el = scroller.current;
    const p = probe.current;
    if (!el || !p) return;
    const r = p.getBoundingClientRect();
    metrics.current = { rowH: Math.max(12, Math.round(r.height)), charW: r.width / 10 || 8, viewH: el.clientHeight };
    repaint();
  };

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(scroller.current!);
    window.addEventListener('tp-appearance', measure);
    setNavigator({
      goToLine: (line) => revealLine(b.id, line - 1),
      cursorLine: () => b.cursor + 1,
      focus: () => root.current?.focus({ preventScroll: true }),
    });
    root.current?.focus({ preventScroll: true });
    publishCursor(b);
    // Restore where this tab was.
    if (scroller.current) scroller.current.scrollTop = expected.current = Math.round(toScroll(b.top));
    return () => {
      ro.disconnect();
      window.removeEventListener('tp-appearance', measure);
      setNavigator(null);
    };
  }, []);

  // Wheel: exact rows, even when the scrollbar is scaled.
  useEffect(() => {
    const el = scroller.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const m = metrics.current;
      const rows = e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * Math.floor(m.viewH / m.rowH) : e.deltaY / m.rowH;
      setTop(b.top + rows);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  // "Go to line", F8, timeline clicks, find: bring the row into view.
  useLayoutEffect(() => {
    if (!reveal || reveal.id !== b.id) return;
    const row = reveal.row;
    if (row < b.top + 1 || row > b.top + fit - 2) setTop(row - Math.floor(fit / 2));
    else repaint();
  }, [reveal?.tick]);

  // Keep the scrollbar honest when the number of rows changes (filter, growth).
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (b.top > maxTop) b.top = maxTop;
    expected.current = Math.round(toScroll(b.top));
    if (Math.abs(el.scrollTop - expected.current) > 1) el.scrollTop = expected.current;
  }, [total, height]);

  const digits = Math.max(3, String(b.lines).length);
  const gutter = Math.ceil((digits + 2) * charW) + 8;
  const first = Math.max(0, Math.floor(b.top));
  const last = Math.min(total, first + fit + 2);
  useEffect(() => {
    if (b.status === 'ready') ensureRows(b, first - fit, last + fit);
  });

  // After a find step: if the match is off to the side, scroll it into view.
  useLayoutEffect(() => {
    const el = scroller.current;
    const text = b.cache.get(b.cursor);
    if (!b.wantHit || !el || text === undefined || !b.find?.re) return;
    b.wantHit = false;
    const m = b.find.re.exec(text);
    if (!m) return;
    const x = gutter + m.index * charW;
    const w = m[0].length * charW;
    if (x < el.scrollLeft + gutter || x + w > el.scrollLeft + el.clientWidth - 24) el.scrollLeft = Math.max(0, x - el.clientWidth / 2);
  });

  const onScroll = () => {
    const el = scroller.current!;
    if (Math.abs(el.scrollTop - expected.current) > 1) {
      // The user moved the scrollbar.
      b.top = Math.max(0, Math.min(maxTop, fromScroll(el.scrollTop)));
      expected.current = el.scrollTop;
    }
    repaint();
  };

  const moveCursor = (row: number, extend: boolean) => {
    if (!total) return;
    const r = Math.max(0, Math.min(total - 1, row));
    b.cursor = lineOfRow(b, r);
    if (!extend) b.anchor = b.cursor;
    publishCursor(b);
    if (r < b.top + 1) setTop(r - 1);
    else if (r > b.top + fit - 2) setTop(r - fit + 2);
    else repaint();
  };

  const onKey = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const row = rowOfLine(b, b.cursor);
    if (e.key === 'ArrowDown') moveCursor(row + 1, e.shiftKey);
    else if (e.key === 'ArrowUp') moveCursor(row - 1, e.shiftKey);
    else if (e.key === 'PageDown') moveCursor(row + fit - 1, e.shiftKey);
    else if (e.key === 'PageUp') moveCursor(row - fit + 1, e.shiftKey);
    else if (e.key === 'Home' && mod) moveCursor(0, e.shiftKey);
    else if (e.key === 'End' && mod) moveCursor(total - 1, e.shiftKey);
    else if (e.key === 'Home') scroller.current!.scrollLeft = 0;
    else if (mod && e.key.toLowerCase() === 'a') toast('Select all is not available for large files. Click a line, then Shift+click another to select a range.', { ms: 5000 });
    else if (mod && e.key.toLowerCase() === 'c') {
      if (!window.getSelection()?.isCollapsed) return;
      void selectedText(b).then(async (text) => {
        if (text === null) return;
        if (await copyToClipboard({ text })) {
          const n = Math.abs(b.cursor - b.anchor) + 1;
          toast(n === 1 ? 'Copied the current line' : `Copied ${n.toLocaleString()} lines`, { kind: 'ok', ms: 1800 });
        } else toast('The browser did not allow copying.', { kind: 'error' });
      });
    } else return;
    e.preventDefault();
  };

  const selFrom = Math.min(b.cursor, b.anchor);
  const selTo = Math.max(b.cursor, b.anchor);
  const offset = -(b.top - first) * rowH;
  const index = b.index;
  const find = b.find?.re ?? null;
  const rows: ComponentChildren[] = [];
  for (let r = first; r < last; r++) {
    const line = lineOfRow(b, r);
    const text = b.cache.get(line);
    if (text !== undefined && text.length > widest.current) widest.current = Math.min(text.length, 20000);
    const flags = index ? index.flags[line] : 0;
    const lv = index ? index.level[line] : 0;
    let cls = 'tp-big-row';
    if (flags & FLAG_FRAME) cls += text !== undefined && isOwnFrame(text, prefix) ? ' tp-frame tp-frame-own' : ' tp-frame';
    else if (flags & FLAG_CAUSE) cls += ' tp-cause';
    else if (lv && lv !== 3) cls += ` tp-lv-${lv}`;
    if (line === b.cursor) cls += ' is-cursor';
    if (selTo > selFrom && line >= selFrom && line <= selTo) cls += ' is-selected';
    rows.push(
      <div
        key={line}
        class={cls}
        data-line={line + 1}
        style={{ top: `${offset + (r - first) * rowH}px`, height: `${rowH}px` }}
        onClick={(e) => {
          if (!window.getSelection()?.isCollapsed) return;
          b.cursor = line;
          if (!e.shiftKey) b.anchor = line;
          publishCursor(b);
          repaint();
        }}
      >
        <span class="tp-big-no" style={{ width: `${gutter}px` }}>
          {(line + 1).toLocaleString('en-US').replace(/,/g, '')}
        </span>
        <span class="tp-big-text">{text === undefined ? '' : pieces(text, find, !!(flags & FLAG_ENTRY) && lv > 0)}</span>
      </div>,
    );
  }

  return (
    <div class="tp-big" ref={root} tabIndex={0} role="document" aria-label={`${tab.name}, large file, read-only`} aria-busy={b.status === 'indexing'} data-status={b.status} data-lines={b.lines} data-rows={total} onKeyDown={onKey}>
      <span class="tp-big-probe" ref={probe} aria-hidden="true">
        MMMMMMMMMM
      </span>
      <div class="tp-big-scroll" ref={scroller} onScroll={onScroll}>
        <div class="tp-big-layer">{rows}</div>
        <div class="tp-big-spacer" style={{ height: `${height}px`, width: `${gutter + widest.current * charW + 48}px` }} />
      </div>
      {b.busy !== null && (
        <div class="tp-big-busy" role="progressbar" aria-label="Filtering" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.busy * 100)}>
          <i style={{ width: `${Math.max(4, b.busy * 100)}%` }} />
        </div>
      )}
      {b.status === 'ready' && total === 0 && <div class="tp-big-note">{b.rows ? 'No entries match the filters.' : 'This file is empty.'}</div>}
      {b.status === 'indexing' && (
        <div class="tp-big-card" role="status">
          <div class="tp-big-card-title">Reading {tab.name}</div>
          <div class="tp-big-bar" role="progressbar" aria-label="Reading the file" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(b.progress * 100)}>
            <i style={{ width: `${Math.max(2, b.progress * 100)}%` }} />
          </div>
          <div class="tp-big-card-sub">
            {Math.round(b.progress * 100)}% of {formatBytes(b.size - b.start)} · the file stays on disk and is not loaded into memory
          </div>
        </div>
      )}
      {b.status === 'failed' && (
        <div class="tp-big-card" role="alert">
          <div class="tp-big-card-title">{tab.name} could not be read</div>
          <div class="tp-big-card-sub">{b.error}</div>
          <button type="button" class="tp-btn tp-btn-primary" onClick={() => void openFiles()}>
            Pick file again
          </button>
        </div>
      )}
    </div>
  );
}

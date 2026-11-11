// Markdown preview: live, scroll-synced with the editor, safe (see app/markdown.ts).
// Layout rule: the scroll container always spans the whole preview and the
// document column is centred inside it, so however wide the preview is, the
// scrollbar sits at its outer edge and there is never a dead band.
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { toast } from '../app/feedback';
import { PREVIEW_LIMIT, renderMarkdown } from '../app/markdown';
import { settings, updateSettings } from '../app/settings';
import { activeTab, patchTab } from '../app/state';
import { docOf, docTick, focusEditor, getView } from '../editor/editor';
import { parseMarkdownTable } from '../engine/tabletext';
import { fullscreen, toggleFullscreen } from './fullscreen';
import { IconClose, IconExpand } from './icons';

export const PREVIEW_DEFAULT = 50;
export const tableEdit = signal<{ tabId: number; from: number; to: number; rows: string[][] } | null>(null);

const TABLE_CSS = 'border-collapse:collapse;font-family:Segoe UI,Arial,sans-serif;font-size:10pt';
const CELL_CSS = 'border:1px solid #999;padding:4px 8px;text-align:left;vertical-align:top';

/** HTML that keeps its look in Teams, Outlook and Word: borders and fonts are written on each element. */
function richHtml(root: Element): string {
  const copy = root.cloneNode(true) as Element;
  copy.querySelectorAll('.tp-md-tabletools, .tp-md-sort').forEach((el) => el.remove());
  copy.querySelectorAll('table').forEach((t) => t.setAttribute('style', TABLE_CSS));
  copy.querySelectorAll('th').forEach((c) => c.setAttribute('style', `${CELL_CSS};background:#eee;font-weight:600${c.classList.contains('is-num') ? ';text-align:right' : ''}`));
  copy.querySelectorAll('td').forEach((c) => c.setAttribute('style', `${CELL_CSS}${c.classList.contains('is-num') ? ';text-align:right' : ''}`));
  copy.querySelectorAll('pre').forEach((p) => p.setAttribute('style', 'font-family:Consolas,monospace;font-size:9.5pt;background:#f4f4f4;padding:8px;white-space:pre-wrap'));
  copy.querySelectorAll('code').forEach((c) => c.setAttribute('style', 'font-family:Consolas,monospace;font-size:9.5pt'));
  copy.querySelectorAll('[data-line],[data-end],[class],[title]').forEach((el) => {
    el.removeAttribute('data-line');
    el.removeAttribute('data-end');
    el.removeAttribute('class');
    el.removeAttribute('title');
  });
  return `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:11pt">${copy.innerHTML}</div>`;
}

async function writeClipboard(html: string, text: string, done: string): Promise<void> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
    } else await navigator.clipboard.writeText(text);
    toast(done, { kind: 'ok', ms: 2400 });
  } catch {
    toast('The clipboard is not available here.', { kind: 'error' });
  }
}

const cellText = (c: Element) => (c.textContent ?? '').replace(/\s+/g, ' ').trim();
const numeric = (v: string) => /^[-+]?[$€£₹]?\d[\d,]*(?:\.\d+)?\s?(?:%|[a-zA-Zµ]{1,3})?$/.test(v);
const numberOf = (v: string) => Number(v.replace(/[^0-9.+-]/g, ''));

/** Wraps each table with its own small toolbar, marks number columns, and makes headers sortable. */
function decorate(root: HTMLElement): void {
  root.querySelectorAll('table').forEach((table) => {
    const box = document.createElement('div');
    box.className = 'tp-md-tablebox';
    for (const a of ['data-line', 'data-end']) {
      const v = table.getAttribute(a);
      if (v) box.setAttribute(a, v);
    }
    const tools = document.createElement('div');
    tools.className = 'tp-md-tabletools';
    for (const [act, label, title] of [
      ['copy', 'Copy table', 'Copy this table: pastes as a real table into Excel, Outlook, Teams and Word'],
      ['edit', 'Edit as table', 'Edit the cells in a grid'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tp-md-tool';
      b.dataset.act = act;
      b.textContent = label;
      b.title = title;
      tools.appendChild(b);
    }
    const scroll = document.createElement('div');
    scroll.className = 'tp-md-tablescroll';
    table.replaceWith(box);
    scroll.appendChild(table);
    box.append(tools, scroll);

    const rows = Array.from(table.querySelectorAll('tbody tr'));
    rows.forEach((tr, i) => ((tr as HTMLElement).dataset.i = String(i)));
    table.querySelectorAll('thead th').forEach((th, c) => {
      const values = rows.map((tr) => cellText(tr.children[c] ?? tr)).filter(Boolean);
      const isNum = values.length > 0 && values.every(numeric);
      if (isNum) {
        th.classList.add('is-num');
        rows.forEach((tr) => tr.children[c]?.classList.add('is-num'));
      }
      (th as HTMLElement).tabIndex = 0;
      th.setAttribute('role', 'columnheader');
      th.setAttribute('aria-sort', 'none');
      th.setAttribute('title', 'Click to sort');
      const mark = document.createElement('span');
      mark.className = 'tp-md-sort';
      mark.setAttribute('aria-hidden', 'true');
      th.appendChild(mark);
    });
  });
  // "- [ ] task" items become check marks (read-only).
  root.querySelectorAll('li').forEach((li) => {
    const first = li.firstChild?.nodeType === 3 ? li.firstChild : li.firstElementChild?.tagName === 'P' ? li.firstElementChild.firstChild : null;
    const m = first && first.nodeType === 3 ? /^\[( |x|X)\] /.exec(first.nodeValue ?? '') : null;
    if (!m || !first) return;
    first.nodeValue = (first.nodeValue ?? '').slice(4);
    const box = document.createElement('span');
    box.className = `tp-md-check${m[1] === ' ' ? '' : ' is-done'}`;
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', m[1] === ' ' ? 'not done' : 'done');
    first.parentNode!.insertBefore(box, first);
    li.classList.add('tp-md-task');
  });
}

/** Header click: ascending, descending, then back to the order in the document. */
function sortBy(th: HTMLElement): void {
  const table = th.closest('table')!;
  const body = table.querySelector('tbody');
  if (!body) return;
  const col = Array.from(th.parentElement!.children).indexOf(th);
  const next = th.getAttribute('aria-sort') === 'ascending' ? 'descending' : th.getAttribute('aria-sort') === 'descending' ? 'none' : 'ascending';
  table.querySelectorAll('thead th').forEach((h) => h.setAttribute('aria-sort', 'none'));
  th.setAttribute('aria-sort', next);
  const rows = Array.from(body.children) as HTMLElement[];
  const isNum = th.classList.contains('is-num');
  rows.sort((a, b) => {
    if (next === 'none') return Number(a.dataset.i) - Number(b.dataset.i);
    const x = cellText(a.children[col] ?? a);
    const y = cellText(b.children[col] ?? b);
    const d = isNum ? numberOf(x) - numberOf(y) : x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' });
    return (next === 'ascending' ? d : -d) || Number(a.dataset.i) - Number(b.dataset.i);
  });
  rows.forEach((r) => body.appendChild(r));
}

function tableAction(button: HTMLElement, tabId: number): void {
  const box = button.closest('.tp-md-tablebox')!;
  const table = box.querySelector('table')!;
  if (button.dataset.act === 'copy') {
    const tsv = Array.from(table.querySelectorAll('tr'))
      .map((tr) => Array.from(tr.children).map((c) => cellText(c).replace(/\t/g, ' ')).join('\t'))
      .join('\n');
    void writeClipboard(richHtml(box.querySelector('.tp-md-tablescroll')!), tsv, 'Copied the table');
    return;
  }
  const from = Number(box.getAttribute('data-line'));
  const to = Number(box.getAttribute('data-end'));
  const doc = docOf(tabId);
  if (!doc || !from || !to) return;
  const lines: string[] = [];
  for (let n = from; n < to && n <= doc.lines; n++) lines.push(doc.line(n).text);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const parsed = parseMarkdownTable(lines);
  if (!parsed) {
    toast('This table could not be read back from the text. Edit it in the editor instead.', { kind: 'error' });
    return;
  }
  tableEdit.value = { tabId, from, to: from + lines.length, rows: parsed.rows };
}

export function Preview() {
  const tab = activeTab.value;
  if (!tab || !tab.preview || tab.big) return null;
  return <PreviewPane key={tab.id} tabId={tab.id} name={tab.name} />;
}

function PreviewPane({ tabId, name }: { tabId: number; name: string }) {
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const anchors = useRef<{ line: number; top: number }[]>([]);
  const lock = useRef<{ who: 'editor' | 'preview' | null; until: number }>({ who: null, until: 0 });
  const [truncated, setTruncated] = useState(false);
  const full = fullscreen.value === 'preview';
  const width = settings.value.previewWidth;
  const tick = docTick.value;

  const measure = () => {
    const sc = scroller.current;
    if (!sc) return;
    const base = sc.getBoundingClientRect().top - sc.scrollTop;
    anchors.current = Array.from(sc.querySelectorAll<HTMLElement>('[data-line]'))
      .map((el) => ({ line: Number(el.dataset.line), top: el.getBoundingClientRect().top - base }))
      .filter((a) => a.line > 0)
      .sort((a, b) => a.line - b.line);
  };

  /** Preview position that corresponds to a (fractional) editor line. */
  const topForLine = (line: number): number => {
    const a = anchors.current;
    const sc = scroller.current!;
    if (!a.length) return 0;
    let i = 0;
    while (i + 1 < a.length && a[i + 1].line <= line) i++;
    if (line < a[0].line) return (a[0].top * line) / Math.max(1, a[0].line);
    const next = a[i + 1] ?? { line: (docOf(tabId)?.lines ?? a[i].line) + 1, top: sc.scrollHeight };
    const t = next.line > a[i].line ? (line - a[i].line) / (next.line - a[i].line) : 0;
    return a[i].top + (next.top - a[i].top) * Math.min(1, Math.max(0, t));
  };

  const lineForTop = (top: number): number => {
    const a = anchors.current;
    const sc = scroller.current!;
    if (!a.length) return 1;
    let i = 0;
    while (i + 1 < a.length && a[i + 1].top <= top) i++;
    if (top < a[0].top) return 1 + ((a[0].line - 1) * top) / Math.max(1, a[0].top);
    const next = a[i + 1] ?? { line: (docOf(tabId)?.lines ?? a[i].line) + 1, top: sc.scrollHeight };
    const t = next.top > a[i].top ? (top - a[i].top) / (next.top - a[i].top) : 0;
    return a[i].line + (next.line - a[i].line) * Math.min(1, Math.max(0, t));
  };

  const followEditor = () => {
    const sc = scroller.current;
    if (!sc) return;
    if (lock.current.who === 'preview' && performance.now() < lock.current.until) return;
    const view = getView();
    const ed = view.scrollDOM;
    const max = ed.scrollHeight - ed.clientHeight;
    let target: number;
    if (ed.scrollTop <= 1) target = 0;
    else if (max > 0 && ed.scrollTop >= max - 1) target = sc.scrollHeight;
    else {
      const block = view.lineBlockAtHeight(ed.scrollTop);
      const line = view.state.doc.lineAt(block.from).number + (block.height ? (ed.scrollTop - block.top) / block.height : 0);
      target = topForLine(line);
    }
    lock.current = { who: 'editor', until: performance.now() + 120 };
    sc.scrollTop = target;
  };

  // Render (shortly after typing stops), then line up with the editor.
  useEffect(() => {
    const t = setTimeout(
      () => {
        const doc = docOf(tabId);
        const el = body.current;
        if (!doc || !el) return;
        el.innerHTML = renderMarkdown(doc.toString());
        decorate(el);
        setTruncated(doc.length > PREVIEW_LIMIT);
        measure();
        followEditor();
      },
      body.current?.childElementCount ? 110 : 0,
    );
    return () => clearTimeout(t);
  }, [tabId, tick]);

  useLayoutEffect(() => {
    const ed = getView().scrollDOM;
    const onEditor = () => followEditor();
    ed.addEventListener('scroll', onEditor, { passive: true });
    const ro = new ResizeObserver(() => {
      measure();
    });
    if (scroller.current) ro.observe(scroller.current);
    if (body.current) ro.observe(body.current);
    return () => {
      ed.removeEventListener('scroll', onEditor);
      ro.disconnect();
    };
  }, [tabId]);

  const onPreviewScroll = () => {
    const sc = scroller.current!;
    if (lock.current.who === 'editor' && performance.now() < lock.current.until) return;
    if (full) return;
    const view = getView();
    const ed = view.scrollDOM;
    lock.current = { who: 'preview', until: performance.now() + 120 };
    const max = sc.scrollHeight - sc.clientHeight;
    if (sc.scrollTop <= 1) ed.scrollTop = 0;
    else if (max > 0 && sc.scrollTop >= max - 1) ed.scrollTop = ed.scrollHeight;
    else {
      const line = lineForTop(sc.scrollTop);
      const n = Math.max(1, Math.min(view.state.doc.lines, Math.floor(line)));
      const block = view.lineBlockAt(view.state.doc.line(n).from);
      ed.scrollTop = block.top + block.height * (line - Math.floor(line));
    }
  };

  const onClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const tool = target.closest<HTMLElement>('.tp-md-tool');
    if (tool) {
      tableAction(tool, tabId);
      return;
    }
    const th = target.closest<HTMLElement>('thead th');
    if (th && body.current?.contains(th)) sortBy(th);
  };

  const startResize = (e: PointerEvent) => {
    if (full) return;
    const handle = e.currentTarget as HTMLElement;
    const area = handle.closest('.tp-editor-area') as HTMLElement;
    const rect = area.getBoundingClientRect();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add('is-dragging');
    const move = (ev: PointerEvent) => updateSettings({ previewWidth: Math.round(Math.max(20, Math.min(85, ((rect.right - ev.clientX) / rect.width) * 100)) * 10) / 10 });
    const up = () => {
      handle.classList.remove('is-dragging');
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
    e.preventDefault();
  };

  const copyAll = () => {
    const doc = docOf(tabId);
    if (body.current && doc) void writeClipboard(richHtml(body.current), doc.toString(), 'Copied as rich text. Paste it into Teams, Outlook or Word.');
  };

  return (
    <section class={`tp-preview${full ? ' is-fullscreen' : ''}`} style={full ? undefined : { width: `${width}%` }} aria-label="Markdown preview">
      <div class="tp-preview-resize" role="separator" aria-orientation="vertical" aria-label="Resize preview" title="Drag to resize, double-click for half and half" onPointerDown={startResize} onDblClick={() => updateSettings({ previewWidth: PREVIEW_DEFAULT })} />
      <header class="tp-preview-head" onDblClick={(e) => (e.target as HTMLElement).closest('button') === null && toggleFullscreen('preview')}>
        <span class="tp-preview-title">
          <span class="tp-preview-kind">Preview</span>
          <span class="tp-preview-name">{name}</span>
        </span>
        <span class="tp-preview-actions">
          <button type="button" class="tp-btn tp-btn-small" title="Copy with formatting and tables, for Teams, Outlook and Word" onClick={copyAll}>
            Copy as rich text
          </button>
          <button type="button" class="tp-btn-icon" aria-label={full ? 'Leave full screen' : 'Preview full screen'} aria-pressed={full} title={full ? 'Leave full screen (Esc)' : 'Full screen (Alt+Shift+P)'} onClick={() => toggleFullscreen('preview')}>
            <IconExpand size={15} />
          </button>
          <button
            type="button"
            class="tp-btn-icon"
            aria-label="Close preview"
            title="Close preview (Alt+P)"
            onClick={() => {
              if (full) toggleFullscreen('preview');
              patchTab(tabId, { preview: false });
              focusEditor();
            }}
          >
            <IconClose size={15} />
          </button>
        </span>
      </header>
      <div class="tp-preview-scroll" ref={scroller} onScroll={onPreviewScroll} tabIndex={0}>
        <article class="tp-md" ref={body} onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.target as HTMLElement).matches('thead th') && (e.preventDefault(), sortBy(e.target as HTMLElement))} />
        {truncated && <p class="tp-preview-note">This file is very long. The preview shows its first {(PREVIEW_LIMIT / 1_000_000).toFixed(1)} million characters.</p>}
      </div>
    </section>
  );
}

// The editor area: one pane, or up to four in a snap layout. Each pane has its
// own editor (or large-file viewer), preview and, in a split, a small header.
import { signal } from '@preact/signals';
import { useLayoutEffect, useRef } from 'preact/hooks';
import { runCommand } from '../app/commands';
import { SPLIT_LAYOUTS, ZONES, dividers, zoneRects, type Divider, type LayoutId, type Rect } from '../app/layouts';
import { applyLayout, dragDivider, equalSizes, focusPane, focusedPane, isSplit, layout, openSideBySide, paneOf, paneTabs, removeZone, setPaneTab, sizesOf, swapWithMain } from '../app/panes';
import { menu, tabs, type Tab } from '../app/state';
import { focusEditor, mountEditor, showInPane, unmountEditor } from '../editor/editor';
import { BigViewer } from '../viewer/BigViewer';
import { FindBar } from './FindBar';
import { IconChevron, IconClose, IconFolder, IconSwap } from './icons';
import { Preview } from './Preview';
import { Locked, Welcome } from './Welcome';

const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxStyle = (r: Rect) => ({ left: pct(r.x), top: pct(r.y), width: pct(r.w), height: pct(r.h) });

// ---------------------------------------------------------------- dragging

export type SnapTarget = { kind: 'layout'; layout: LayoutId; zone: number } | { kind: 'beside' } | { kind: 'pane'; pane: number };

/** A tab (or a file from the Open files list) being dragged over the editor. */
export const snapDrag = signal<{ tabId: number; target: SnapTarget | null } | null>(null);

const inside = (r: DOMRect, x: number, y: number) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/** True when the pointer is over the editor area: dragging there snaps instead of reordering. */
export function overEditorArea(x: number, y: number): boolean {
  const area = document.querySelector('.tp-editor-area');
  return !!area && inside(area.getBoundingClientRect(), x, y);
}

export function snapTargetAt(x: number, y: number): SnapTarget | null {
  for (const el of document.querySelectorAll<HTMLElement>('.tp-snapbar [data-snap-zone]')) {
    if (inside(el.getBoundingClientRect(), x, y)) return { kind: 'layout', layout: el.dataset.snapLayout as LayoutId, zone: Number(el.dataset.snapZone) };
  }
  const bar = document.querySelector('.tp-snapbar');
  if (bar && inside(bar.getBoundingClientRect(), x, y)) return null;
  for (const el of document.querySelectorAll<HTMLElement>('.tp-pane')) {
    const r = el.getBoundingClientRect();
    if (!inside(r, x, y)) continue;
    if (layout.value === 'single') return x > r.left + r.width / 2 ? { kind: 'beside' } : { kind: 'pane', pane: 0 };
    return { kind: 'pane', pane: Number(el.dataset.pane) };
  }
  return null;
}

export function dropOnTarget(tabId: number, target: SnapTarget | null): void {
  if (!target) return;
  if (target.kind === 'layout') applyLayout(target.layout, target.zone, tabId);
  else if (target.kind === 'beside') openSideBySide(tabId);
  else setPaneTab(target.pane, tabId);
  focusEditor();
}

/** One layout drawn small, each zone a target. Used by the picker and by the snap bar. */
export function LayoutThumb({ id, name, active, hot, onPick }: { id: LayoutId; name: string; active?: boolean; hot?: number | null; onPick?: (zone: number) => void }) {
  return (
    <div class={`tp-thumb${active ? ' is-active' : ''}`} role="group" aria-label={name} title={name}>
      {zoneRects(id).map((r, zone) => {
        const cls = `tp-thumb-zone${hot === zone ? ' is-hot' : ''}`;
        const style = boxStyle(r);
        const label = `${name}, place ${zone + 1} of ${ZONES[id]}`;
        return onPick ? (
          <button key={zone} type="button" class={cls} style={style} aria-label={label} onClick={() => onPick(zone)} />
        ) : (
          <span key={zone} class={cls} style={style} data-snap-layout={id} data-snap-zone={zone} />
        );
      })}
    </div>
  );
}

/** Shown while a tab is dragged over the editor: layouts on top, and an outline where the file will land. */
function SnapOverlay() {
  const drag = snapDrag.value;
  if (!drag) return null;
  const t = drag.target;
  const name = tabs.value.find((x) => x.id === drag.tabId)?.name ?? 'file';
  let outline: Rect | null = null;
  let text = '';
  if (t?.kind === 'layout') {
    outline = zoneRects(t.layout, sizesOf(t.layout))[t.zone];
    text = `${SPLIT_LAYOUTS.find((l) => l.id === t.layout)?.name}: ${name} goes here`;
  } else if (t?.kind === 'beside') {
    outline = { x: 0.5, y: 0, w: 0.5, h: 1 };
    text = `Open ${name} side by side`;
  } else if (t?.kind === 'pane') {
    outline = zoneRects(layout.value, sizesOf(layout.value))[t.pane];
    const there = tabs.value.find((x) => x.id === paneTabs.value[t.pane]);
    text = there && there.id !== drag.tabId ? `Show ${name} here instead of ${there.name}` : `Show ${name} here`;
  }
  return (
    <div class="tp-snap" aria-hidden="true">
      {outline && (
        <div class="tp-snap-outline" style={boxStyle(outline)}>
          <span class="tp-snap-label">{text}</span>
        </div>
      )}
      <div class="tp-snapbar">
        {SPLIT_LAYOUTS.map((l) => (
          <LayoutThumb key={l.id} id={l.id} name={l.name} hot={t?.kind === 'layout' && t.layout === l.id ? t.zone : null} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------- panes

function openPicker(e: MouseEvent, pane: number): void {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
  menu.value = {
    x: r.left,
    y: r.bottom + 4,
    items: tabs.value.map((t) => {
      const at = paneOf(t.id);
      return { label: t.name, hint: at === pane ? 'shown here' : at >= 0 ? `swap with pane ${at + 1}` : '', disabled: at === pane, run: () => setPaneTab(pane, t.id) };
    }),
  };
}

function PaneHead({ pane, tab }: { pane: number; tab: Tab }) {
  return (
    <header class="tp-pane-head">
      <button type="button" class="tp-pane-file" aria-haspopup="menu" aria-label={`Pane ${pane + 1} file: ${tab.name}`} title="Choose the file shown in this pane" onClick={(e) => openPicker(e, pane)}>
        <span class={`tp-file-dot${tab.dirty ? ' is-dirty' : ''}`} aria-hidden="true" />
        <span class="tp-pane-name">{tab.name}</span>
        <IconChevron size={12} />
      </button>
      <span class="tp-pane-tools">
        {pane > 0 && (
          <button type="button" class="tp-btn-icon tp-pane-btn" aria-label={`Swap pane ${pane + 1} with the main pane`} title="Swap with the main pane" onClick={() => swapWithMain(pane)}>
            <IconSwap size={14} />
          </button>
        )}
        <button type="button" class="tp-btn-icon tp-pane-btn" aria-label={`Remove pane ${pane + 1}`} title="Close this pane (the file stays open as a tab)" onClick={() => removeZone(pane)}>
          <IconClose size={14} />
        </button>
      </span>
    </header>
  );
}

/** An empty zone offers the open files that are not on screen yet. */
function SnapAssist({ pane }: { pane: number }) {
  const on = new Set(paneTabs.value);
  const rest = tabs.value.filter((t) => !on.has(t.id)).sort((a, b) => b.lastUsed - a.lastUsed);
  return (
    <div class="tp-assist" role="region" aria-label={`Choose a file for pane ${pane + 1}`}>
      <div class="tp-assist-title">{rest.length ? 'Pick a file for this space' : 'No other files are open'}</div>
      <div class="tp-assist-cards">
        {rest.map((t) => (
          <button key={t.id} type="button" class="tp-assist-card" onClick={() => setPaneTab(pane, t.id)}>
            <span class="tp-assist-name">{t.name}</span>
            <span class="tp-assist-meta">
              {t.big ? 'Large file' : t.isLog ? 'Log' : t.lang}
              {t.dirty ? ' · unsaved' : ''}
            </span>
          </button>
        ))}
        <button type="button" class="tp-assist-card tp-assist-open" onClick={() => runCommand('file.open')}>
          <IconFolder size={18} />
          <span class="tp-assist-name">Open a file…</span>
        </button>
      </div>
      <button type="button" class="tp-btn tp-assist-skip" onClick={() => removeZone(pane)}>
        Leave this space out
      </button>
    </div>
  );
}

function Pane({ index, rect, tabId }: { index: number; rect: Rect; tabId: number | null }) {
  const host = useRef<HTMLDivElement>(null);
  const split = isSplit.value;
  const focused = focusedPane.value === index;
  const tab = tabId == null ? undefined : tabs.value.find((t) => t.id === tabId);

  useLayoutEffect(() => {
    mountEditor(index, host.current!);
    return () => unmountEditor(index);
  }, []);
  useLayoutEffect(() => {
    showInPane(index, tabId);
  }, [tabId]);

  return (
    <section
      class={`tp-pane${split && focused ? ' is-focused' : ''}${tab ? '' : ' is-empty'}`}
      data-pane={index}
      data-tab={tab?.name}
      style={boxStyle(rect)}
      aria-label={split ? `Pane ${index + 1}${tab ? `: ${tab.name}` : ''}` : undefined}
      onPointerDownCapture={() => focusPane(index)}
      onFocusCapture={() => focusPane(index)}
    >
      {split && tab && <PaneHead pane={index} tab={tab} />}
      <div class="tp-pane-body">
        <div class="tp-editor-pane">
          <div class="tp-editor-host" ref={host} />
          {tab?.big && <BigViewer tabId={tab.id} />}
          {focused && <Welcome />}
          {focused && <Locked />}
          {focused && <FindBar />}
        </div>
        {tab && <Preview tabId={tab.id} />}
      </div>
      {split && !tab && <SnapAssist pane={index} />}
    </section>
  );
}

function DividerBar({ d }: { d: Divider }) {
  const start = (e: PointerEvent) => {
    const bar = e.currentTarget as HTMLElement;
    const area = bar.parentElement!.getBoundingClientRect();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add('is-dragging');
    const move = (ev: PointerEvent) => dragDivider(d.index, d.axis === 'x' ? (ev.clientX - area.left) / area.width : (ev.clientY - area.top) / area.height);
    const up = () => {
      bar.classList.remove('is-dragging');
      bar.removeEventListener('pointermove', move);
      bar.removeEventListener('pointerup', up);
      bar.removeEventListener('pointercancel', up);
    };
    bar.addEventListener('pointermove', move);
    bar.addEventListener('pointerup', up);
    bar.addEventListener('pointercancel', up);
    e.preventDefault();
  };
  const style = d.axis === 'x' ? { left: pct(d.at), top: pct(d.from), height: pct(d.to - d.from) } : { top: pct(d.at), left: pct(d.from), width: pct(d.to - d.from) };
  return <div class={`tp-divider is-${d.axis}`} role="separator" aria-orientation={d.axis === 'x' ? 'vertical' : 'horizontal'} aria-label="Resize panes" title="Drag to resize, double-click for equal sizes" style={style} onPointerDown={start} onDblClick={equalSizes} />;
}

export function Panes() {
  const l = layout.value;
  const sizes = sizesOf(l);
  const list = paneTabs.value;
  return (
    <div class={`tp-editor-area tp-panes${l === 'single' ? '' : ' is-split'}`} data-layout={l}>
      {zoneRects(l, sizes).map((r, i) => (
        <Pane key={i} index={i} rect={r} tabId={list[i] ?? null} />
      ))}
      {dividers(l, sizes).map((d) => (
        <DividerBar key={`${d.axis}${d.index}`} d={d} />
      ))}
      <SnapOverlay />
    </div>
  );
}

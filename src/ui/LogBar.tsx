// Shown above a log: the timeline strip and the filter row.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { runCommand } from '../app/commands';
import { clearFilters, filterFocus, indexFor, jumpToTime, logFilter, logInfo, patchFilter, toggleLevel, type LogInfo } from '../app/logs';
import { activeId, tabs, type Tab } from '../app/state';
import { focusPane, paneOf, visibleTabs } from '../app/panes';
import type { PageIndex } from '../engine/client';
import { isEmptyFilter, parseTime } from '../engine/logfilter';
import { LEVEL_NAMES, LV } from '../engine/logparse';
import { IconChevron, IconClose, IconDown, IconUp } from './icons';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** Wall-clock time as written in the log. */
export function formatTime(ms: number, withDate = false, withMs = false): string {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}${withMs ? `.${pad(d.getUTCMilliseconds(), 3)}` : ''}`;
  return withDate && d.getUTCFullYear() > 1970 ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${time}` : time;
}

interface Bucket {
  from: number;
  to: number;
  total: number;
  warn: number;
  error: number;
}

export function buildBuckets(ix: PageIndex, count: number): Bucket[] {
  const first = ix.summary[4];
  const last = ix.summary[5];
  if (!Number.isFinite(first) || !Number.isFinite(last) || count < 1) return [];
  // Entries are not always in time order; find the true range.
  let lo = first;
  let hi = last;
  for (const i of ix.entryLines) {
    const t = ix.ts[i];
    if (t < lo) lo = t;
    else if (t > hi) hi = t;
  }
  const span = Math.max(1, hi - lo);
  const width = span / count;
  const out: Bucket[] = Array.from({ length: count }, (_, k) => ({ from: lo + k * width, to: lo + (k + 1) * width, total: 0, warn: 0, error: 0 }));
  for (const i of ix.entryLines) {
    const t = ix.ts[i];
    if (!(t >= lo)) continue;
    const b = out[Math.min(count - 1, Math.floor((t - lo) / width))];
    b.total++;
    const lv = ix.level[i];
    if (lv >= LV.ERROR) b.error++;
    else if (lv === LV.WARN) b.warn++;
  }
  return out;
}

function Timeline({ ix, info }: { ix: PageIndex; info: LogInfo }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: number; b: number } | null>(null);
  const filter = logFilter.value;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const count = Math.max(12, Math.min(180, Math.floor(width / 7)));
  const buckets = useMemo(() => (width ? buildBuckets(ix, count) : []), [ix, count, width > 0]);
  if (info.stamped < 2) return null;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const lo = buckets[0]?.from ?? 0;
  const hi = buckets[buckets.length - 1]?.to ?? 1;
  const span = hi - lo || 1;
  const from = filter.from.trim() ? parseTime(filter.from, info.firstTs) : null;
  const to = filter.to.trim() ? parseTime(filter.to, info.firstTs, true) : null;
  const selected = from !== null || to !== null;
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - lo) / span) * 100))}%`;

  const bucketAt = (clientX: number): number => {
    const r = box.current!.getBoundingClientRect();
    return Math.max(0, Math.min(buckets.length - 1, Math.floor(((clientX - r.left) / r.width) * buckets.length)));
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !buckets.length) return;
    const el = box.current!;
    const start = bucketAt(e.clientX);
    const startX = e.clientX;
    let moved = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientX - startX) > 4) moved = true;
      if (moved) setDrag({ a: start, b: bucketAt(ev.clientX) });
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag(null);
      const end = bucketAt(ev.clientX);
      if (!moved) {
        // Click: jump to that moment (the first error in the bar, if it has one).
        const b = buckets[start];
        jumpToTime(b.from, b.error > 0, b.to);
        return;
      }
      const a = buckets[Math.min(start, end)];
      const b = buckets[Math.max(start, end)];
      patchFilter({ from: formatTime(Math.floor(a.from / 1000) * 1000, true), to: formatTime(Math.floor(b.to / 1000) * 1000, true) });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    e.preventDefault();
  };

  const h = hover !== null ? buckets[hover] : null;
  const dragRange = drag ? { a: buckets[Math.min(drag.a, drag.b)], b: buckets[Math.max(drag.a, drag.b)] } : null;

  return (
    <div class="tp-timeline">
      <div class="tp-timeline-labels">
        <span>{formatTime(lo, true)}</span>
        <span class="tp-timeline-hint" aria-live="polite">
          {dragRange
            ? `${formatTime(dragRange.a.from)} – ${formatTime(dragRange.b.to)}`
            : h
              ? `${formatTime(h.from)} – ${formatTime(h.to)} · ${h.total.toLocaleString()} ${h.total === 1 ? 'entry' : 'entries'}${h.error ? ` · ${h.error} error${h.error === 1 ? '' : 's'}` : ''}${h.warn ? ` · ${h.warn} warning${h.warn === 1 ? '' : 's'}` : ''}`
              : selected
                ? 'Showing the selected time range · double-click to clear'
                : 'Click a bar to jump there · drag to filter by time'}
        </span>
        <span>{formatTime(hi, true)}</span>
      </div>
      <div
        class="tp-timeline-strip"
        ref={box}
        role="group"
        aria-label="Timeline: errors and warnings over time. Click to jump, drag to filter by time, double-click to clear."
        onPointerDown={onDown}
        onPointerMove={(e) => setHover(buckets.length ? bucketAt(e.clientX) : null)}
        onPointerLeave={() => setHover(null)}
        onDblClick={() => patchFilter({ from: '', to: '' })}
      >
        {buckets.map((b, i) => {
          const scale = (v: number) => (v ? Math.max(8, Math.sqrt(v / max) * 100) : 0);
          const outside = selected && ((from !== null && b.to <= from) || (to !== null && b.from > to));
          return (
            <div key={i} class={`tp-tl-bar${outside ? ' is-dim' : ''}${i === hover ? ' is-hover' : ''}`} data-total={b.total} data-errors={b.error} data-warnings={b.warn}>
              <i class="tp-tl-all" style={{ height: `${scale(b.total)}%` }} />
              <i class="tp-tl-warn" style={{ height: `${scale(b.warn + b.error)}%` }} />
              <i class="tp-tl-error" style={{ height: `${scale(b.error)}%` }} />
            </div>
          );
        })}
        {dragRange && <div class="tp-tl-select" style={{ left: pct(dragRange.a.from), right: `calc(100% - ${pct(dragRange.b.to)})` }} />}
        {!dragRange && selected && <div class="tp-tl-select is-set" style={{ left: pct(from ?? lo), right: `calc(100% - ${pct(to ?? hi)})` }} />}
      </div>
    </div>
  );
}

const CHIP_ORDER = [LV.FATAL, LV.ERROR, LV.WARN, LV.INFO, LV.DEBUG, LV.TRACE, LV.NONE];

function Filters({ info }: { info: LogInfo }) {
  const f = logFilter.value;
  const input = useRef<HTMLInputElement>(null);
  const [more, setMore] = useState(false);
  const tick = filterFocus.value;
  const advanced = [f.patterns.some((p) => p.trim()), !!f.logger.trim(), !!f.trace.trim(), !!f.from.trim(), !!f.to.trim()].filter(Boolean).length;

  useLayoutEffect(() => {
    if (tick > 0) {
      input.current?.focus();
      input.current?.select();
    }
  }, [tick]);
  // Open the extra row when a filter there becomes active from elsewhere (timeline drag, trace command).
  useEffect(() => {
    if (advanced > 0) setMore(true);
  }, [advanced > 0]);

  const empty = isEmptyFilter(f);
  const text = (key: 'logger' | 'trace' | 'from' | 'to', label: string, placeholder: string, mono = false) => (
    <label class="tp-lf-field">
      <span class="tp-lf-label">{label}</span>
      <input
        type="text"
        class={`tp-input tp-lf-input${mono ? ' is-mono' : ''}`}
        placeholder={placeholder}
        spellcheck={false}
        autocomplete="off"
        value={f[key]}
        onInput={(e) => patchFilter({ [key]: (e.target as HTMLInputElement).value })}
      />
    </label>
  );

  return (
    <div class="tp-logfilters" role="search" aria-label="Log filters">
      <div class="tp-lf-row">
        <div class="tp-chips" role="group" aria-label="Levels">
          {CHIP_ORDER.filter((lv) => info.counts[lv] > 0).map((lv) => {
            const on = f.levels !== null && f.levels.includes(lv);
            const name = lv === LV.NONE ? 'OTHER' : LEVEL_NAMES[lv];
            return (
              <button
                key={lv}
                type="button"
                class={`tp-chip tp-chip-${lv}${on ? ' is-on' : ''}${f.levels !== null && !on ? ' is-off' : ''}`}
                aria-pressed={on}
                title={f.levels === null ? `Show only ${name}` : on ? `Stop showing ${name}` : `Also show ${name}`}
                onClick={() => toggleLevel(lv)}
              >
                <span class="tp-chip-name">{name}</span>
                <span class="tp-chip-count">{info.counts[lv].toLocaleString()}</span>
              </button>
            );
          })}
        </div>
        <div class={`tp-find-field tp-lf-text${info.error ? ' is-invalid' : ''}`}>
          <input
            ref={input}
            type="text"
            class="tp-find-input"
            placeholder="Filter entries"
            aria-label="Filter entries by text"
            spellcheck={false}
            autocomplete="off"
            value={f.text}
            onInput={(e) => patchFilter({ text: (e.target as HTMLInputElement).value })}
          />
          <button type="button" class="tp-find-toggle" aria-pressed={f.caseSensitive} aria-label="Case-sensitive filter" title="Case-sensitive" onClick={() => patchFilter({ caseSensitive: !f.caseSensitive })}>
            Aa
          </button>
          <button type="button" class="tp-find-toggle" aria-pressed={f.regex} aria-label="Use regex in filter" title="Regular expression" onClick={() => patchFilter({ regex: !f.regex })}>
            .*
          </button>
        </div>
        <button type="button" class={`tp-btn tp-btn-small tp-lf-more${more ? ' is-open' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>
          <IconChevron size={12} />
          More filters{advanced ? ` (${advanced})` : ''}
        </button>
        <span class={`tp-lf-count${info.error ? ' is-error' : ''}`} aria-live="polite" data-testid="filter-count">
          {info.error ? info.error : info.shown === null ? `${info.entries.toLocaleString()} entries` : `${info.shown.toLocaleString()} of ${info.entries.toLocaleString()} entries`}
        </span>
        {!empty && (
          <button type="button" class="tp-btn tp-btn-small tp-lf-clear" onClick={clearFilters}>
            <IconClose size={12} />
            Clear filters
          </button>
        )}
        <button type="button" class="tp-btn tp-btn-small tp-lf-tables" title="Learn the message patterns in this log and build a table for each (Alt+T)" onClick={() => runCommand('tables.auto')}>
          Auto tables
        </button>
        <span class="tp-lf-nav">
          <button type="button" class="tp-btn-icon" aria-label="Previous error" title="Previous error (Shift+F8)" onClick={() => runCommand('log.prevError')}>
            <IconUp size={15} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Next error" title="Next error (F8)" onClick={() => runCommand('log.nextError')}>
            <IconDown size={15} />
          </button>
        </span>
      </div>
      {more && (
        <div class="tp-lf-row tp-lf-advanced">
          <label class="tp-lf-field tp-lf-patterns">
            <span class="tp-lf-label">
              Lines matching
              <select class="tp-lf-mode" aria-label="Match any or all patterns" value={f.patternsMode} onChange={(e) => patchFilter({ patternsMode: (e.target as HTMLSelectElement).value as 'any' | 'all' })}>
                <option value="any">any of</option>
                <option value="all">all of</option>
              </select>
            </span>
            <textarea
              class="tp-input tp-lf-area"
              rows={2}
              placeholder={'one pattern per line\ntext or /regex/'}
              aria-label="Patterns, one per line"
              spellcheck={false}
              value={f.patterns.join('\n')}
              onInput={(e) => patchFilter({ patterns: (e.target as HTMLTextAreaElement).value.split('\n') })}
            />
          </label>
          {text('logger', 'Logger or thread', 'OrderService, exec-3')}
          {text('trace', 'Trace ID', '6f1c2a9b…', true)}
          {text('from', 'From', '10:15 or 2026-03-14 10:15', true)}
          {text('to', 'To', '10:20:30', true)}
        </div>
      )}
    </div>
  );
}

export function LogBar() {
  // The focused pane's log; with a split, another pane's log when the focused file is not one.
  // The bar must not come and go as focus moves between panes: that would shift every pane.
  const shown = visibleTabs.value.map((id) => tabs.value.find((t) => t.id === id)).filter((t): t is Tab => !!t?.isLog && !!logInfo.value[t.id]);
  const tab = shown.find((t) => t.id === activeId.value) ?? shown[0];
  const info = tab ? logInfo.value[tab.id] : undefined;
  if (!tab || !info) return null;
  const ix = indexFor(tab.id);
  const own = tab.id === activeId.value;
  return (
    <div class="tp-logbar" data-log-version={info.version} data-log-status={info.status} data-log-tab={tab.name} onPointerDownCapture={own ? undefined : () => focusPane(paneOf(tab.id))}>
      {ix && <Timeline ix={ix} info={info} />}
      <Filters info={info} />
    </div>
  );
}

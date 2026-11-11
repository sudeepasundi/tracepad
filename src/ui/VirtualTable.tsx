// A table that only draws the rows on screen, so 200,000 rows scroll smoothly.
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fmt } from '../app/results';
import type { Table } from '../engine/tables';

const ROW = 24;

/** Column widths in characters, from the header and a sample of the rows. */
function widths(table: Table): number[] {
  const sample = table.rows.length > 400 ? [...table.rows.slice(0, 300), ...table.rows.slice(-100)] : table.rows;
  return table.columns.map((c, i) => {
    let w = c.name.length + 1;
    // The two statistics lines are set in smaller type (about 0.9 of a character each).
    if (c.stats) w = Math.max(w, Math.ceil(0.9 * Math.max(`min ${fmt(c.stats.min)} avg ${fmt(c.stats.avg)}`.length, `p95 ${fmt(c.stats.p95)} max ${fmt(c.stats.max)}`.length)));
    for (const r of sample) if (r[i].length > w) w = r[i].length;
    return Math.max(4, Math.min(72, w)) + 3;
  });
}

export function VirtualTable({ table, selected, onRow }: { table: Table; selected: number | null; onRow: (row: number) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(300);
  const cols = useMemo(() => widths(table), [table]);
  const hasStats = table.columns.some((c) => c.stats);
  const head = hasStats ? 64 : 28;
  const template = cols.map((w) => `${w}ch`).join(' ');

  useLayoutEffect(() => {
    const el = scroller.current!;
    const measure = () => setHeight(el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setTop(0);
  }, [table]);

  const first = Math.max(0, Math.floor(top / ROW) - 4);
  const last = Math.min(table.rows.length, Math.ceil((top + height) / ROW) + 4);
  const rows = [];
  for (let i = first; i < last; i++) {
    const r = table.rows[i];
    rows.push(
      <div key={i} role="row" aria-rowindex={i + 2} class={`tp-vt-row${i === selected ? ' is-selected' : ''}${table.lines[i] ? ' is-link' : ''}`} style={{ top: `${head + i * ROW}px`, gridTemplateColumns: template }} onClick={() => onRow(i)}>
        {r.map((v, c) => (
          <span key={c} role="cell" class={`tp-vt-cell${table.columns[c].numeric ? ' is-num' : ''}`} title={v.length > cols[c] - 3 ? v : undefined}>
            {v}
          </span>
        ))}
      </div>,
    );
  }

  return (
    <div class="tp-vt" ref={scroller} role="table" aria-label={table.title} aria-rowcount={table.rows.length + 1} onScroll={(e) => setTop((e.currentTarget as HTMLElement).scrollTop)}>
      <div class="tp-vt-inner" style={{ height: `${head + table.rows.length * ROW}px`, width: `calc(${cols.reduce((a, b) => a + b, 0)}ch + 16px)` }}>
        <div class="tp-vt-head" role="row" style={{ gridTemplateColumns: template, height: `${head}px` }}>
          {table.columns.map((c, i) => (
            <span key={i} role="columnheader" class={`tp-vt-th${c.numeric ? ' is-num' : ''}`}>
              <span class="tp-vt-name">{c.name}</span>
              {c.stats && (
                <span class="tp-vt-stats">
                  <span>
                    min <b>{fmt(c.stats.min)}</b> avg <b>{fmt(c.stats.avg)}</b>
                  </span>
                  <span>
                    p95 <b>{fmt(c.stats.p95)}</b> max <b>{fmt(c.stats.max)}</b>
                  </span>
                </span>
              )}
            </span>
          ))}
        </div>
        {rows}
      </div>
    </div>
  );
}

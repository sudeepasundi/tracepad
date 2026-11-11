// "Edit as table": the cells of one Markdown table in a grid. Saving writes the
// table back, aligned, in place of the old one.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { registerLayer } from '../app/commands';
import { replaceLines } from '../editor/editor';
import { toMarkdownTable } from '../engine/tabletext';
import { tableEdit } from './Preview';

registerLayer({ priority: 96, modal: true, isOpen: () => tableEdit.value !== null, close: () => (tableEdit.value = null) });

export function TableEditor() {
  const spec = tableEdit.value;
  return spec ? <Grid key={`${spec.tabId}:${spec.from}`} /> : null;
}

function Grid() {
  const spec = tableEdit.value!;
  const [rows, setRows] = useState<string[][]>(() => spec.rows.map((r) => [...r]));
  const box = useRef<HTMLDivElement>(null);
  const cols = Math.max(1, ...rows.map((r) => r.length));

  // Columns are as wide as their longest value (within reason), so cells can be read without clicking into them.
  const widths = Array.from({ length: cols }, (_, c) => `${Math.min(46, Math.max(12, ...rows.map((r) => (r[c] ?? '').length + 5)))}ch`);

  useLayoutEffect(() => {
    box.current?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);

  const set = (r: number, c: number, v: string) => setRows((old) => old.map((row, i) => (i === r ? Array.from({ length: cols }, (_, k) => (k === c ? v : (row[k] ?? ''))) : row)));
  const save = () => {
    const clean = rows.map((r) => Array.from({ length: cols }, (_, c) => (r[c] ?? '').trim()));
    replaceLines(spec.tabId, spec.from, spec.to, toMarkdownTable(clean));
    tableEdit.value = null;
  };
  /** Enter moves down a row (adding one at the end); arrow keys at the edge of a cell move across. */
  const onKey = (e: KeyboardEvent, r: number, c: number) => {
    const go = (rr: number, cc: number) => {
      const el = box.current?.querySelector<HTMLInputElement>(`input[data-r="${rr}"][data-c="${cc}"]`);
      if (el) {
        e.preventDefault();
        el.focus();
        el.select();
      }
    };
    if (e.key === 'Enter') {
      e.preventDefault();
      if (r === rows.length - 1) {
        setRows((old) => [...old, Array<string>(cols).fill('')]);
        setTimeout(() => go(r + 1, c), 0);
      } else go(r + 1, c);
    } else if (e.key === 'ArrowDown') go(r + 1, c);
    else if (e.key === 'ArrowUp') go(r - 1, c);
  };

  return (
    <div class="tp-scrim" onMouseDown={(e) => e.target === e.currentTarget && (tableEdit.value = null)}>
      <div class="tp-dialog tp-tedit" role="dialog" aria-modal="true" aria-labelledby="tp-tedit-title" ref={box}>
        <h2 class="tp-dialog-title" id="tp-tedit-title">
          Edit table
          <span class="tp-tedit-size">
            {rows.length - 1} {rows.length === 2 ? 'row' : 'rows'}, {cols} {cols === 1 ? 'column' : 'columns'}
          </span>
        </h2>
        <div class="tp-tedit-scroll">
          <table class="tp-tedit-grid">
            <tbody>
              {rows.map((row, r) => (
                <tr key={r} class={r === 0 ? 'is-head' : undefined}>
                  {Array.from({ length: cols }, (_, c) => (
                    <td key={c} style={{ minWidth: widths[c] }}>
                      <input type="text" class="tp-tedit-cell" data-r={r} data-c={c} aria-label={r === 0 ? `Header ${c + 1}` : `Row ${r}, column ${c + 1}`} spellcheck={false} autocomplete="off" value={row[c] ?? ''} onInput={(e) => set(r, c, (e.target as HTMLInputElement).value)} onKeyDown={(e) => onKey(e, r, c)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div class="tp-tedit-tools">
          <button type="button" class="tp-btn tp-btn-small" onClick={() => setRows((old) => [...old, Array<string>(cols).fill('')])}>
            Add row
          </button>
          <button type="button" class="tp-btn tp-btn-small" onClick={() => setRows((old) => old.map((r) => [...Array.from({ length: cols }, (_, c) => r[c] ?? ''), '']))}>
            Add column
          </button>
          <button type="button" class="tp-btn tp-btn-small" disabled={rows.length <= 2} onClick={() => setRows((old) => old.slice(0, -1))}>
            Remove last row
          </button>
          <button type="button" class="tp-btn tp-btn-small" disabled={cols <= 1} onClick={() => setRows((old) => old.map((r) => r.slice(0, cols - 1)))}>
            Remove last column
          </button>
        </div>
        <div class="tp-dialog-buttons">
          <button type="button" class="tp-btn" onClick={() => (tableEdit.value = null)}>
            Cancel
          </button>
          <button type="button" class="tp-btn tp-btn-primary" onClick={save}>
            Save table
          </button>
        </div>
      </div>
    </div>
  );
}

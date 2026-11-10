// Find box for large files: the search runs over the file on disk, in the worker.
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { bigFindStep, bigSearch, bigTick, clearBigSearch, findPosition, getBig } from '../app/big';
import { activeId } from '../app/state';
import { caseSensitive, closeFind, focusTick, query, regexp, wholeWord } from '../ui/FindBar';
import { IconClose, IconDown, IconUp } from '../ui/icons';

export function BigFind() {
  const id = activeId.value;
  const input = useRef<HTMLInputElement>(null);
  const tick = focusTick.value;
  void bigTick.value;
  const b = getBig(id);
  const deps = [id, query.value, caseSensitive.value, wholeWord.value, regexp.value];

  useLayoutEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [tick]);
  // Searching a big file takes a moment: wait for a pause in typing.
  useEffect(() => {
    if (id == null) return;
    const t = setTimeout(() => bigSearch(id, query.value, { regex: regexp.value, caseSensitive: caseSensitive.value, wholeWord: wholeWord.value }), 280);
    return () => clearTimeout(t);
  }, deps);
  useEffect(() => () => void (id != null && clearBigSearch(id)), [id]);

  if (!b || id == null) return null;
  const f = b.find;
  const at = findPosition(b);
  const status = !query.value
    ? ''
    : !f
      ? '…'
      : f.error
        ? f.error
        : f.progress !== null
          ? `Searching ${Math.round(f.progress * 100)}%`
          : f.total === 0
            ? 'No results'
            : `${at ? `${at.toLocaleString()} of ` : ''}${f.total.toLocaleString()} line${f.total === 1 ? '' : 's'}${f.total > f.lines.length ? ' (first 50,000 reachable)' : ''}`;
  const bad = !!f && (!!f.error || (f.progress === null && f.total === 0));
  const toggle = (on: boolean, label: string, text: string, flip: () => void) => (
    <button type="button" class="tp-find-toggle" aria-pressed={on} aria-label={label} title={label} onClick={flip}>
      {text}
    </button>
  );

  return (
    <div class="tp-find tp-find-big" role="search" aria-label="Find in large file">
      <div class="tp-find-rows">
        <div class="tp-find-row">
          <div class={`tp-find-field${f?.error ? ' is-invalid' : ''}`}>
            <input
              ref={input}
              type="text"
              class="tp-find-input"
              placeholder="Find"
              aria-label="Find"
              spellcheck={false}
              autocomplete="off"
              value={query.value}
              onInput={(e) => (query.value = (e.target as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  bigFindStep(id, e.shiftKey ? -1 : 1);
                }
              }}
            />
            {toggle(caseSensitive.value, 'Match case', 'Aa', () => (caseSensitive.value = !caseSensitive.value))}
            {toggle(wholeWord.value, 'Whole word', 'ab', () => (wholeWord.value = !wholeWord.value))}
            {toggle(regexp.value, 'Regular expression', '.*', () => (regexp.value = !regexp.value))}
          </div>
          <span class={`tp-find-count${bad ? ' is-none' : ''}`} aria-live="polite">
            {status}
          </span>
          <button type="button" class="tp-btn-icon" aria-label="Previous match" title="Previous match (Shift+F3)" onClick={() => bigFindStep(id, -1)}>
            <IconUp size={16} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Next match" title="Next match (F3)" onClick={() => bigFindStep(id, 1)}>
            <IconDown size={16} />
          </button>
          <button type="button" class="tp-btn-icon" aria-label="Close find" title="Close (Esc)" onClick={closeFind}>
            <IconClose size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

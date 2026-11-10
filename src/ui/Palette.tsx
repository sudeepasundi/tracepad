import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { allCommands, registerLayer, runCommand, shortcutLabel, type Command } from '../app/commands';
import { paletteOpen } from '../app/state';
import { focusEditor } from '../editor/editor';
import { IconSearch } from './icons';

/** Higher is better; -1 means no match. Substring beats scattered letters. */
export function score(title: string, q: string): number {
  if (!q) return 0;
  const t = title.toLowerCase();
  const at = t.indexOf(q);
  if (at >= 0) return 1000 - at - (at === 0 || t[at - 1] === ' ' ? 0 : 50);
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return 400 - gaps;
}

function closePalette(refocus = true): void {
  paletteOpen.value = false;
  if (refocus) focusEditor();
}

registerLayer({ priority: 90, modal: true, isOpen: () => paletteOpen.value, close: () => closePalette() });

export function Palette() {
  return paletteOpen.value ? <PaletteBody /> : null;
}

function PaletteBody() {
  const [text, setText] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = closePalette;

  useLayoutEffect(() => {
    input.current?.focus();
  }, []);

  const results = useMemo<Command[]>(() => {
    const q = text.trim().toLowerCase();
    const cmds = allCommands();
    if (!q) return cmds;
    return cmds
      .map((c) => ({ c, s: Math.max(score(c.title, q), score(`${c.category} ${c.title}`, q) - 100) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c);
  }, [text]);

  useEffect(() => {
    list.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [index, results]);


  const choose = (c: Command | undefined) => {
    if (!c) return;
    close(false);
    focusEditor();
    runCommand(c.id);
  };

  return (
    <div class="tp-scrim tp-scrim-top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div class="tp-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div class="tp-palette-search">
          <IconSearch size={16} />
          <input
            ref={input}
            type="text"
            class="tp-palette-input"
            placeholder="Search commands"
            aria-label="Search commands"
            role="combobox"
            aria-expanded="true"
            aria-controls="tp-palette-list"
            aria-activedescendant={results[index] ? `tp-cmd-${results[index].id}` : undefined}
            spellcheck={false}
            autocomplete="off"
            value={text}
            onInput={(e) => {
              setText((e.target as HTMLInputElement).value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIndex((i) => Math.min(results.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                choose(results[index]);
              }
            }}
          />
          <kbd class="tp-kbd">Esc</kbd>
        </div>
        <div class="tp-palette-list" id="tp-palette-list" role="listbox" ref={list}>
          {results.length === 0 && <div class="tp-palette-none">No matching commands</div>}
          {results.map((c, i) => (
            <div
              key={c.id}
              id={`tp-cmd-${c.id}`}
              role="option"
              aria-selected={i === index}
              class={`tp-palette-item${i === index ? ' is-active' : ''}`}
              onMouseMove={() => i !== index && setIndex(i)}
              onClick={() => choose(c)}
            >
              <span class="tp-palette-cat">{c.category}</span>
              <span class="tp-palette-title">{c.title}</span>
              {shortcutLabel(c) && <kbd class="tp-kbd">{shortcutLabel(c)}</kbd>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// In-place name editor used by tabs and by the Open files list.
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { registerLayer } from '../app/commands';
import { renaming } from '../app/state';
import { nameProblem, renameTabTo } from '../app/tabs';
import { focusEditor } from '../editor/editor';

registerLayer({ priority: 80, modal: true, isOpen: () => renaming.value !== null, close: () => (renaming.value = null) });

export function RenameInput({ id, name }: { id: number; name: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(name);
  const done = useRef(false);
  const problem = value.trim() === name ? null : nameProblem(value);

  // Select the name without its extension, as file managers do.
  useLayoutEffect(() => {
    const el = input.current!;
    el.focus();
    const dot = name.lastIndexOf('.');
    el.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, []);

  const commit = async () => {
    if (done.current) return;
    done.current = true;
    renaming.value = null;
    if (!nameProblem(value)) await renameTabTo(id, value);
    focusEditor();
  };

  return (
    <input
      ref={input}
      type="text"
      class={`tp-rename${problem ? ' is-invalid' : ''}`}
      aria-label={`New name for ${name}`}
      aria-invalid={!!problem}
      title={problem ?? 'Enter to rename, Esc to cancel'}
      spellcheck={false}
      autocomplete="off"
      value={value}
      size={Math.max(8, value.length + 1)}
      onInput={(e) => setValue((e.target as HTMLInputElement).value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onDblClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          if (problem) return;
          void commit();
        }
      }}
      onBlur={() => {
        // Leaving the box keeps a valid new name; Esc (the layer) discards it.
        if (renaming.value?.id === id) void commit();
      }}
    />
  );
}

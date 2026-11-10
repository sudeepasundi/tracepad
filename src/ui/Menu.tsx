// Context menu (right-click on a tab or a row in the Open files list).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { registerLayer } from '../app/commands';
import { menu, type MenuItem } from '../app/state';
import { focusEditor } from '../editor/editor';

function closeMenu(): void {
  menu.value = null;
}

registerLayer({ priority: 95, modal: true, isOpen: () => menu.value !== null, close: closeMenu });

export function MenuHost() {
  const m = menu.value;
  return m ? <MenuBody key={`${m.x}:${m.y}`} x={m.x} y={m.y} items={m.items} /> : null;
}

function MenuBody({ x, y, items }: { x: number; y: number; items: MenuItem[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const usable = items.map((it, i) => (!it.separator && !it.disabled ? i : -1)).filter((i) => i >= 0);
  const [index, setIndex] = useState(usable[0] ?? -1);

  // Keep the whole menu on screen, then take focus for the arrow keys.
  useLayoutEffect(() => {
    const el = box.current!;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)),
    });
    el.focus();
  }, []);

  const choose = (it: MenuItem | undefined) => {
    if (!it || it.disabled || it.separator) return;
    closeMenu();
    focusEditor();
    it.run?.();
  };

  const onKey = (e: KeyboardEvent) => {
    const at = usable.indexOf(index);
    if (e.key === 'ArrowDown') setIndex(usable[(at + 1) % usable.length]);
    else if (e.key === 'ArrowUp') setIndex(usable[(at - 1 + usable.length) % usable.length]);
    else if (e.key === 'Home') setIndex(usable[0]);
    else if (e.key === 'End') setIndex(usable[usable.length - 1]);
    else if (e.key === 'Enter' || e.key === ' ') choose(items[index]);
    else if (e.key === 'Tab') closeMenu();
    else return;
    e.preventDefault();
  };

  return (
    <div
      class="tp-menu-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && closeMenu()}
      onContextMenu={(e) => {
        e.preventDefault();
        closeMenu();
      }}
    >
      <div class="tp-menu" role="menu" tabIndex={-1} ref={box} style={{ left: `${pos.left}px`, top: `${pos.top}px` }} onKeyDown={onKey}>
        {items.map((it, i) =>
          it.separator ? (
            <div key={i} class="tp-menu-sep" role="separator" />
          ) : (
            <div
              key={i}
              role="menuitem"
              aria-disabled={it.disabled || undefined}
              class={`tp-menu-item${i === index ? ' is-active' : ''}${it.disabled ? ' is-disabled' : ''}`}
              onMouseMove={() => !it.disabled && i !== index && setIndex(i)}
              onClick={() => choose(it)}
            >
              <span class="tp-menu-label">{it.label}</span>
              {it.hint && <kbd class="tp-kbd">{it.hint}</kbd>}
            </div>
          ),
        )}
      </div>
    </div>
  );
}

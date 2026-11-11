// Pointer-based drag to reorder (tabs: sideways, Open files list: up/down).
// Items shift live as the pointer crosses the middle of a neighbour. Works with
// mouse, pen and touch, and never starts on a plain click.
import { moveTab } from '../app/tabs';
import { tabs } from '../app/state';
import { dropOnTarget, overEditorArea, snapDrag, snapTargetAt } from './Panes';

interface Options {
  event: PointerEvent;
  id: number;
  axis: 'x' | 'y';
  container: HTMLElement;
  /** Elements carrying data-tab-id, in display order. */
  itemSelector: string;
}

let justDragged = false;

/** True right after a drag, so the click that ends it does not also activate. */
export function consumeDragClick(): boolean {
  const v = justDragged;
  justDragged = false;
  return v;
}

export function startReorder({ event, id, axis, container, itemSelector }: Options): void {
  if (event.button !== 0 || !event.isPrimary) return;
  const start = axis === 'x' ? event.clientX : event.clientY;
  let dragging = false;
  let scrollTimer = 0;
  let last = start;

  const step = () => {
    const box = container.getBoundingClientRect();
    const lo = axis === 'x' ? box.left : box.top;
    const hi = axis === 'x' ? box.right : box.bottom;
    const edge = 36;
    const delta = last < lo + edge ? -10 : last > hi - edge ? 10 : 0;
    if (delta) {
      if (axis === 'x') container.scrollLeft += delta;
      else container.scrollTop += delta;
      place();
    }
  };

  const place = () => {
    const order = tabs.value.map((t) => t.id);
    const from = order.indexOf(id);
    for (const el of container.querySelectorAll<HTMLElement>(itemSelector)) {
      const other = Number(el.dataset.tabId);
      if (other === id) continue;
      const r = el.getBoundingClientRect();
      const a = axis === 'x' ? r.left : r.top;
      const size = axis === 'x' ? r.width : r.height;
      if (last < a || last > a + size) continue;
      const to = order.indexOf(other);
      const mid = a + size / 2;
      if ((to > from && last > mid) || (to < from && last < mid)) moveTab(id, to);
      return;
    }
  };

  const move = (e: PointerEvent) => {
    last = axis === 'x' ? e.clientX : e.clientY;
    if (!dragging) {
      if (Math.abs(last - start) < 6) return;
      dragging = true;
      document.documentElement.classList.add('tp-dragging');
      container.querySelector<HTMLElement>(`${itemSelector}[data-tab-id="${id}"]`)?.classList.add('is-dragging');
      scrollTimer = window.setInterval(step, 30);
    }
    e.preventDefault();
    // Over the editor the drag snaps the file into a pane instead of reordering.
    if (overEditorArea(e.clientX, e.clientY)) {
      snapDrag.value = { tabId: id, target: snapTargetAt(e.clientX, e.clientY) };
      return;
    }
    if (snapDrag.value) snapDrag.value = null;
    place();
  };

  const end = (e: PointerEvent) => {
    if (snapDrag.value) {
      const target = e.type === 'pointerup' && overEditorArea(e.clientX, e.clientY) ? snapTargetAt(e.clientX, e.clientY) : null;
      snapDrag.value = null;
      dropOnTarget(id, target);
    }
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.clearInterval(scrollTimer);
    if (!dragging) return;
    justDragged = true;
    setTimeout(() => (justDragged = false), 0);
    document.documentElement.classList.remove('tp-dragging');
    container.querySelectorAll('.is-dragging').forEach((el) => el.classList.remove('is-dragging'));
  };

  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

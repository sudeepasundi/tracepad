// A small canvas minimap: every line is a 2px strip, the visible range is a
// translucent slider, click or drag to scroll. It only ever draws the lines
// that fit in the strip, so its cost does not grow with the document.
import { ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view';
import { settings } from '../app/settings';
import { logIndexField } from './log';

const WIDTH = 84;
const LINE_H = 2;
const CHAR_W = 0.6;
const MAX_COLS = Math.floor(WIDTH / CHAR_W);
const MIN_EDITOR_WIDTH = 720;

class Minimap {
  private readonly box: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private frame = 0;
  private dragging = false;
  private capacity = 0;
  private readonly onScroll = () => this.schedule();
  private readonly onAppearance = () => this.schedule();
  private readonly resize: ResizeObserver;

  constructor(private readonly view: EditorView) {
    this.box = document.createElement('div');
    this.box.className = 'tp-minimap';
    this.box.setAttribute('aria-hidden', 'true');
    this.canvas = document.createElement('canvas');
    this.box.appendChild(this.canvas);
    view.dom.appendChild(this.box);
    view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
    window.addEventListener('tp-appearance', this.onAppearance);
    this.resize = new ResizeObserver(() => this.schedule());
    this.resize.observe(view.dom);
    this.box.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.box.setPointerCapture(e.pointerId);
      this.scrollTo(e);
      e.preventDefault();
    });
    this.box.addEventListener('pointermove', (e) => {
      if (this.dragging) this.scrollTo(e);
    });
    const stop = () => (this.dragging = false);
    this.box.addEventListener('pointerup', stop);
    this.box.addEventListener('pointercancel', stop);
    this.schedule();
  }

  update(u: ViewUpdate): void {
    if (u.docChanged || u.viewportChanged || u.geometryChanged || u.heightChanged) this.schedule();
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
    window.removeEventListener('tp-appearance', this.onAppearance);
    this.resize.disconnect();
    this.box.remove();
    this.view.dom.style.removeProperty('--tp-minimap-pad');
  }

  private schedule(): void {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.draw());
  }

  private scrollTo(e: PointerEvent): void {
    const sc = this.view.scrollDOM;
    const rect = this.box.getBoundingClientRect();
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    const doc = this.view.state.doc;
    if (doc.lines > this.capacity) {
      sc.scrollTop = (y / rect.height) * (sc.scrollHeight - sc.clientHeight);
    } else {
      const line = Math.max(1, Math.min(doc.lines, Math.floor(y / LINE_H) + 1));
      sc.scrollTop = this.view.lineBlockAt(doc.line(line).from).top - sc.clientHeight / 2;
    }
  }

  private draw(): void {
    const view = this.view;
    const sc = view.scrollDOM;
    const enabled = settings.value.minimap && view.dom.clientWidth >= MIN_EDITOR_WIDTH;
    this.box.style.display = enabled ? '' : 'none';
    view.dom.style.setProperty('--tp-minimap-pad', enabled ? `${WIDTH + 10}px` : '0px');
    if (!enabled) return;

    const height = sc.clientHeight;
    if (height <= 0) return;
    this.box.style.right = `${sc.offsetWidth - sc.clientWidth}px`;
    this.box.style.height = `${height}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.canvas.width !== WIDTH * dpr || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = WIDTH * dpr;
      this.canvas.height = Math.round(height * dpr);
      this.canvas.style.width = `${WIDTH}px`;
      this.canvas.style.height = `${height}px`;
    }
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, WIDTH, height);

    const css = getComputedStyle(view.dom);
    const text = css.getPropertyValue('--tp-text').trim() || '#888';
    const accent = css.getPropertyValue('--tp-accent-text').trim() || '#48f';
    const danger = css.getPropertyValue('--tp-danger').trim() || '#f55';
    const warn = css.getPropertyValue('--tp-warn').trim() || '#fa0';
    const log = view.state.field(logIndexField, false);
    const levels = log?.index && log.fresh && log.index.level.length === view.state.doc.lines ? log.index.level : null;

    const doc = view.state.doc;
    const total = doc.lines;
    const capacity = (this.capacity = Math.max(1, Math.floor(height / LINE_H)));
    const maxScroll = sc.scrollHeight - sc.clientHeight;
    const frac = maxScroll > 0 ? sc.scrollTop / maxScroll : 0;
    const first = total > capacity ? Math.round(frac * (total - capacity)) : 0;
    const last = Math.min(total, first + capacity);

    ctx.fillStyle = text;
    ctx.globalAlpha = 0.42;
    let row = 0;
    for (const line of doc.iterLines(first + 1, last + 1)) {
      const y = row * LINE_H;
      const lv = levels ? levels[first + row] : 0;
      ctx.fillStyle = lv >= 5 ? danger : lv === 4 ? warn : text;
      ctx.globalAlpha = lv >= 4 ? 0.85 : 0.42;
      row++;
      const len = Math.min(line.length, MAX_COLS);
      let run = -1;
      for (let i = 0; i <= len; i++) {
        const c = i < len ? line.charCodeAt(i) : 32;
        const blank = c === 32 || c === 9;
        if (!blank && run < 0) run = i;
        else if (blank && run >= 0) {
          ctx.fillRect(run * CHAR_W, y, Math.max(1, (i - run) * CHAR_W), LINE_H - 0.5);
          run = -1;
        }
      }
    }

    // Slider for the lines currently on screen.
    const top = doc.lineAt(view.lineBlockAtHeight(sc.scrollTop).from).number;
    const bottom = doc.lineAt(view.lineBlockAtHeight(sc.scrollTop + height).from).number;
    const y0 = (top - 1 - first) * LINE_H;
    const h = Math.max(10, (bottom - top + 1) * LINE_H);
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = accent;
    ctx.fillRect(0, y0, WIDTH, h);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(0, y0, 2, h);
    ctx.globalAlpha = 1;
  }
}

export const minimap = ViewPlugin.fromClass(Minimap);

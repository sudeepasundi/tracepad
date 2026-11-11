import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZES, EQUAL_SIZES, MIN_SHARE, SPLIT_LAYOUTS, ZONES, dividers, layoutWithout, moveDivider, normaliseSizes, zoneRects, type LayoutId, type Rect } from '../../src/app/layouts';
import { lineAtTime, timeAtLine } from '../../src/engine/timesync';

const ALL: LayoutId[] = ['single', 'cols2', 'rows2', 'cols3', 'main2', 'grid4'];
const area = (r: Rect) => r.w * r.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.h - 1e-9 && b.y < a.y + a.h - 1e-9;

function tiles(rects: Rect[]): void {
  expect(rects.reduce((s, r) => s + area(r), 0)).toBeCloseTo(1, 9);
  for (const [i, r] of rects.entries()) {
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.y + r.h).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.w).toBeGreaterThanOrEqual(MIN_SHARE - 1e-9);
    expect(r.h).toBeGreaterThanOrEqual(MIN_SHARE - 1e-9);
    for (const other of rects.slice(i + 1)) expect(overlap(r, other)).toBe(false);
  }
}

describe('split layouts', () => {
  it('offers five layouts, of two to four files', () => {
    expect(SPLIT_LAYOUTS.map((l) => l.id)).toEqual(['cols2', 'rows2', 'cols3', 'main2', 'grid4']);
    expect(SPLIT_LAYOUTS.map((l) => ZONES[l.id])).toEqual([2, 2, 3, 3, 4]);
    expect(Math.max(...Object.values(ZONES))).toBe(4);
  });

  it('every layout tiles the area exactly, with default, equal and odd sizes', () => {
    for (const id of ALL) {
      expect(zoneRects(id)).toHaveLength(ZONES[id]);
      tiles(zoneRects(id));
      tiles(zoneRects(id, EQUAL_SIZES[id]));
      tiles(zoneRects(id, [0.01, 0.99]));
      tiles(zoneRects(id, [0.99, 0.01]));
      tiles(zoneRects(id, [Number.NaN, -5]));
      tiles(zoneRects(id, []));
    }
  });

  it('the main zone is first: left, top, or the large one', () => {
    for (const id of ALL) expect(zoneRects(id)[0]).toMatchObject({ x: 0, y: 0 });
    const main = zoneRects('main2');
    expect(area(main[0])).toBeGreaterThan(area(main[1]));
    expect(main[1].x).toBe(main[2].x);
    expect(main[2].y).toBeCloseTo(main[1].h, 9);
  });

  it('there is a divider for every size, lying on a pane edge', () => {
    for (const id of ALL) {
      const d = dividers(id);
      expect(d).toHaveLength(DEFAULT_SIZES[id].length);
      expect(d.map((x) => x.index).sort()).toEqual(DEFAULT_SIZES[id].map((_, i) => i));
      const rects = zoneRects(id);
      for (const bar of d) {
        const edge = rects.some((r) => (bar.axis === 'x' ? Math.abs(r.x - bar.at) < 1e-9 : Math.abs(r.y - bar.at) < 1e-9));
        expect(edge).toBe(true);
        expect(bar.to).toBeGreaterThan(bar.from);
      }
    }
    // The stacked pair's divider only spans the right-hand column.
    expect(dividers('main2')[1]).toMatchObject({ axis: 'y', from: 0.6, to: 1 });
  });

  it('dragging a divider moves it, within limits, and columns cannot cross', () => {
    expect(moveDivider('cols2', undefined, 0, 0.7)).toEqual([0.7]);
    expect(moveDivider('cols2', undefined, 0, 0)).toEqual([MIN_SHARE]);
    expect(moveDivider('rows2', [0.5], 0, 2)).toEqual([1 - MIN_SHARE]);
    expect(moveDivider('grid4', [0.5, 0.5], 1, 0.3)).toEqual([0.5, 0.3]);
    const pushed = moveDivider('cols3', [0.3, 0.5], 0, 0.9);
    expect(pushed[0]).toBeCloseTo(0.5 - MIN_SHARE, 9);
    expect(pushed[1]).toBe(0.5);
    expect(moveDivider('cols3', [0.3, 0.5], 1, 0.1)[1]).toBeCloseTo(0.3 + MIN_SHARE, 9);
    for (const id of ALL) for (let i = 0; i < DEFAULT_SIZES[id].length; i++) for (const at of [-1, 0.2, 0.5, 0.8, 3]) tiles(zoneRects(id, moveDivider(id, undefined, i, at)));
  });

  it('sizes are repaired, never trusted', () => {
    expect(normaliseSizes('cols2', undefined)).toEqual([0.5]);
    expect(normaliseSizes('cols2', [0.4, 0.9, 0.1])).toEqual([0.4]);
    expect(normaliseSizes('cols3', [0.9, 0.1])).toEqual([1 - 2 * MIN_SHARE, 1 - MIN_SHARE]);
  });

  it('taking a zone away steps down to the next smaller layout', () => {
    expect(layoutWithout('grid4')).toBe('main2');
    expect(layoutWithout('main2')).toBe('cols2');
    expect(layoutWithout('cols3')).toBe('cols2');
    expect(layoutWithout('cols2')).toBe('single');
    expect(layoutWithout('rows2')).toBe('single');
    for (const id of ALL) if (id !== 'single') expect(ZONES[layoutWithout(id)]).toBe(ZONES[id] - 1);
  });
});

describe('lining logs up by time', () => {
  // Lines: 0 entry t=100, 1-2 stack lines, 3 entry t=200, 4 entry without a time, 5 entry t=200, 6 entry t=500.
  const N = Number.NaN;
  const ix = { ts: Float64Array.from([100, N, N, 200, N, 200, 500]), entryLines: Uint32Array.from([0, 3, 4, 5, 6]) };

  it('a line has the time of the entry it belongs to', () => {
    expect(timeAtLine(ix, 0)).toBe(100);
    expect(timeAtLine(ix, 2)).toBe(100);
    expect(timeAtLine(ix, 3)).toBe(200);
    expect(timeAtLine(ix, 4)).toBe(200);
    expect(timeAtLine(ix, 6)).toBe(500);
    expect(timeAtLine(ix, 99)).toBe(500);
    expect(timeAtLine({ ts: new Float64Array(0), entryLines: new Uint32Array(0) }, 3)).toBeNaN();
    expect(timeAtLine({ ts: Float64Array.from([N, N]), entryLines: Uint32Array.from([0, 1]) }, 1)).toBeNaN();
  });

  it('a moment maps to the first entry at or after it', () => {
    expect(lineAtTime(ix, 0)).toBe(0);
    expect(lineAtTime(ix, 100)).toBe(0);
    expect(lineAtTime(ix, 101)).toBe(3);
    expect(lineAtTime(ix, 200)).toBe(3);
    expect(lineAtTime(ix, 201)).toBe(6);
    expect(lineAtTime(ix, 500)).toBe(6);
    // Later than everything: the last entry.
    expect(lineAtTime(ix, 9999)).toBe(6);
    expect(lineAtTime({ ts: new Float64Array(0), entryLines: new Uint32Array(0) }, 5)).toBe(0);
  });

  it('agrees with a plain scan on a long log with gaps', () => {
    const n = 5000;
    const ts = new Float64Array(n).fill(N);
    const entries: number[] = [];
    let t = 1000;
    for (let i = 0; i < n; i++) {
      if (i % 3 === 1) continue;
      entries.push(i);
      t += i % 7 === 0 ? 0 : (i % 11) * 5;
      if (i % 13 !== 0) ts[i] = t;
    }
    const big = { ts, entryLines: Uint32Array.from(entries) };
    for (const ms of [0, 1000, 1001, 25000, 60000, 123456, t, t + 1]) {
      const want = entries.find((l) => ts[l] >= ms);
      const got = lineAtTime(big, ms);
      if (want === undefined) expect(got).toBe(entries[entries.length - 1]);
      else expect(ts[got]).toBe(ts[want]);
    }
  });
});

// Split layouts as pure geometry (no DOM), so they can be unit-tested.
// Every layout is described in fractions of the editor area.

export type LayoutId = 'single' | 'cols2' | 'rows2' | 'cols3' | 'main2' | 'grid4';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Divider {
  /** 'x' = a vertical bar dragged sideways; 'y' = a horizontal bar dragged up and down. */
  axis: 'x' | 'y';
  /** Which number in the layout's sizes this divider changes. */
  index: number;
  /** Position along its axis, and its extent across. */
  at: number;
  from: number;
  to: number;
}

/** The five layouts offered in the picker, in order. */
export const SPLIT_LAYOUTS: { id: LayoutId; name: string }[] = [
  { id: 'cols2', name: 'Side by side' },
  { id: 'rows2', name: 'Top and bottom' },
  { id: 'cols3', name: 'Three columns' },
  { id: 'main2', name: 'One large and two stacked' },
  { id: 'grid4', name: 'Two by two' },
];

export const ZONES: Record<LayoutId, number> = { single: 1, cols2: 2, rows2: 2, cols3: 3, main2: 3, grid4: 4 };

export const DEFAULT_SIZES: Record<LayoutId, number[]> = {
  single: [],
  cols2: [0.5],
  rows2: [0.5],
  cols3: [1 / 3, 2 / 3],
  main2: [0.6, 0.5],
  grid4: [0.5, 0.5],
};

/** "Equal sizes", used by a double-click on a divider. */
export const EQUAL_SIZES: Record<LayoutId, number[]> = { ...DEFAULT_SIZES, main2: [0.5, 0.5] };

/** No pane may get narrower or shorter than this share of the area. */
export const MIN_SHARE = 0.15;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Sizes made valid for a layout: right count, inside the limits, in order. */
export function normaliseSizes(layout: LayoutId, sizes: readonly number[] | undefined): number[] {
  const d = DEFAULT_SIZES[layout];
  const s = d.map((v, i) => (sizes && Number.isFinite(sizes[i]) ? sizes[i] : v));
  if (layout === 'cols3') {
    const a = clamp(s[0], MIN_SHARE, 1 - 2 * MIN_SHARE);
    return [a, clamp(s[1], a + MIN_SHARE, 1 - MIN_SHARE)];
  }
  return s.map((v) => clamp(v, MIN_SHARE, 1 - MIN_SHARE));
}

/** Where each zone sits. Zone 0 is the main one (left, top, or the large one). */
export function zoneRects(layout: LayoutId, sizes?: readonly number[]): Rect[] {
  const s = normaliseSizes(layout, sizes);
  switch (layout) {
    case 'single':
      return [{ x: 0, y: 0, w: 1, h: 1 }];
    case 'cols2':
      return [
        { x: 0, y: 0, w: s[0], h: 1 },
        { x: s[0], y: 0, w: 1 - s[0], h: 1 },
      ];
    case 'rows2':
      return [
        { x: 0, y: 0, w: 1, h: s[0] },
        { x: 0, y: s[0], w: 1, h: 1 - s[0] },
      ];
    case 'cols3':
      return [
        { x: 0, y: 0, w: s[0], h: 1 },
        { x: s[0], y: 0, w: s[1] - s[0], h: 1 },
        { x: s[1], y: 0, w: 1 - s[1], h: 1 },
      ];
    case 'main2':
      return [
        { x: 0, y: 0, w: s[0], h: 1 },
        { x: s[0], y: 0, w: 1 - s[0], h: s[1] },
        { x: s[0], y: s[1], w: 1 - s[0], h: 1 - s[1] },
      ];
    case 'grid4':
      return [
        { x: 0, y: 0, w: s[0], h: s[1] },
        { x: s[0], y: 0, w: 1 - s[0], h: s[1] },
        { x: 0, y: s[1], w: s[0], h: 1 - s[1] },
        { x: s[0], y: s[1], w: 1 - s[0], h: 1 - s[1] },
      ];
  }
}

export function dividers(layout: LayoutId, sizes?: readonly number[]): Divider[] {
  const s = normaliseSizes(layout, sizes);
  switch (layout) {
    case 'single':
      return [];
    case 'cols2':
      return [{ axis: 'x', index: 0, at: s[0], from: 0, to: 1 }];
    case 'rows2':
      return [{ axis: 'y', index: 0, at: s[0], from: 0, to: 1 }];
    case 'cols3':
      return [
        { axis: 'x', index: 0, at: s[0], from: 0, to: 1 },
        { axis: 'x', index: 1, at: s[1], from: 0, to: 1 },
      ];
    case 'main2':
      return [
        { axis: 'x', index: 0, at: s[0], from: 0, to: 1 },
        { axis: 'y', index: 1, at: s[1], from: s[0], to: 1 },
      ];
    case 'grid4':
      return [
        { axis: 'x', index: 0, at: s[0], from: 0, to: 1 },
        { axis: 'y', index: 1, at: s[1], from: 0, to: 1 },
      ];
  }
}

/** Sizes after dragging divider `index` to `at` (a fraction of the area). */
export function moveDivider(layout: LayoutId, sizes: readonly number[] | undefined, index: number, at: number): number[] {
  const s = normaliseSizes(layout, sizes);
  if (layout === 'cols3') {
    if (index === 0) s[0] = clamp(at, MIN_SHARE, s[1] - MIN_SHARE);
    else s[1] = clamp(at, s[0] + MIN_SHARE, 1 - MIN_SHARE);
    return s;
  }
  s[index] = at;
  return normaliseSizes(layout, s);
}

/** The layout left when one zone of a layout is taken away. */
export function layoutWithout(layout: LayoutId): LayoutId {
  if (layout === 'grid4') return 'main2';
  if (layout === 'main2' || layout === 'cols3') return 'cols2';
  return 'single';
}

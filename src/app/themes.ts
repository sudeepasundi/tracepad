// Themes, accents and the contrast maths that keeps every combination readable.
// Pure module (no DOM) so the unit tests can check all 36 combinations.

export interface Theme {
  id: string;
  name: string;
  dark: boolean;
  bg: string; // editor background
  surface: string; // bars, sidebar
  surface2: string; // inputs, hover
  raised: string; // menus, dialogs
  border: string;
  text: string;
  muted: string;
  faint: string; // line numbers, placeholders
}

export interface Accent {
  id: string;
  name: string;
  base: string;
}

export const THEMES: Theme[] = [
  { id: 'midnight', name: 'Midnight', dark: true, bg: '#0f1419', surface: '#151b23', surface2: '#1f2732', raised: '#1a212b', border: '#2a3441', text: '#d7dde5', muted: '#93a0b0', faint: '#5f6b7a' },
  { id: 'graphite', name: 'Graphite', dark: true, bg: '#18181b', surface: '#1f1f23', surface2: '#2a2a30', raised: '#242428', border: '#37373f', text: '#e4e4e7', muted: '#a1a1aa', faint: '#6e6e78' },
  { id: 'fjord', name: 'Fjord', dark: true, bg: '#272c36', surface: '#2e3440', surface2: '#3a4252', raised: '#343b49', border: '#465064', text: '#e5e9f0', muted: '#b0bac9', faint: '#7c879a' },
  { id: 'paper', name: 'Paper', dark: false, bg: '#ffffff', surface: '#f5f6f8', surface2: '#e9ecf0', raised: '#ffffff', border: '#d8dce2', text: '#1f2328', muted: '#57606a', faint: '#8b949e' },
  { id: 'dawn', name: 'Dawn', dark: false, bg: '#fbf8f3', surface: '#f2ede4', surface2: '#e7dfd2', raised: '#fffdf9', border: '#d9cfbf', text: '#2b2620', muted: '#62594d', faint: '#94897a' },
  { id: 'mist', name: 'Mist', dark: false, bg: '#f3f5f8', surface: '#e8ecf1', surface2: '#dbe1e9', raised: '#ffffff', border: '#c8d0da', text: '#1c2430', muted: '#525d6c', faint: '#8490a0' },
];

export const ACCENTS: Accent[] = [
  { id: 'blue', name: 'Blue', base: '#3b82f6' },
  { id: 'teal', name: 'Teal', base: '#14a89a' },
  { id: 'violet', name: 'Violet', base: '#8b5cf6' },
  { id: 'amber', name: 'Amber', base: '#f59e0b' },
  { id: 'rose', name: 'Rose', base: '#f43f5e' },
  { id: 'green', name: 'Green', base: '#22a559' },
];

type RGB = [number, number, number];

export function parseHex(hex: string): RGB {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function toHex([r, g, b]: RGB): string {
  return '#' + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2 contrast ratio between two opaque colours. */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/**
 * Moves `color` towards white (on dark backgrounds) or black (on light ones)
 * until it reaches `target` contrast against every colour in `against`.
 */
export function ensureContrast(color: string, against: string[], target = 4.5): string {
  const ok = (c: string) => against.every((bg) => contrast(c, bg) >= target);
  if (ok(color)) return color;
  const darkBg = against.reduce((s, bg) => s + luminance(bg), 0) / against.length < 0.4;
  const pole = darkBg ? '#ffffff' : '#000000';
  for (let t = 0.04; t <= 1.0001; t += 0.04) {
    const c = mix(color, pole, t);
    if (ok(c)) return c;
  }
  return pole;
}

/** Final CSS variables for one theme + accent. */
export function buildPalette(theme: Theme, accent: Accent): Record<string, string> {
  const fills = [theme.bg, theme.surface, theme.surface2, theme.raised];
  // Solid accent used as a button background: darken until white text is readable,
  // except for light hues (amber) where dark text reads better.
  const whiteWorks = contrast(accent.base, '#ffffff') >= 2.6;
  const solid = whiteWorks ? ensureContrast(accent.base, ['#ffffff'], 4.6) : accent.base;
  const onAccent = whiteWorks ? '#ffffff' : ensureContrast('#1b1400', [solid], 4.6);
  const soft = mix(theme.bg, accent.base, theme.dark ? 0.22 : 0.14);
  // Accent-coloured text also appears on the soft accent fill (selected rows).
  const accentText = ensureContrast(accent.base, [...fills, soft], 4.6);
  const softer = mix(theme.bg, accent.base, theme.dark ? 0.11 : 0.07);
  const lvl = (c: string) => ensureContrast(c, [...fills, soft], 4.6);
  const syn = (dark: string, light: string) => ensureContrast(theme.dark ? dark : light, [theme.bg], 4.6);
  return {
    '--tp-bg': theme.bg,
    '--tp-surface': theme.surface,
    '--tp-surface-2': theme.surface2,
    '--tp-raised': theme.raised,
    '--tp-border': theme.border,
    '--tp-border-strong': mix(theme.border, theme.text, 0.18),
    '--tp-text': theme.text,
    '--tp-muted': ensureContrast(theme.muted, [...fills, soft], 4.6),
    '--tp-faint': ensureContrast(theme.faint, [theme.bg, theme.surface], 3.1),
    '--tp-accent': solid,
    '--tp-on-accent': onAccent,
    '--tp-accent-text': accentText,
    '--tp-accent-soft': soft,
    '--tp-accent-softer': softer,
    '--tp-focus': ensureContrast(accent.base, fills, 3.1),
    '--tp-selection': mix(theme.bg, accent.base, theme.dark ? 0.38 : 0.26),
    '--tp-active-line': mix(theme.bg, theme.text, theme.dark ? 0.045 : 0.035),
    '--tp-match': mix(theme.bg, '#f5a524', theme.dark ? 0.38 : 0.42),
    '--tp-match-current': mix(theme.bg, '#f5a524', theme.dark ? 0.72 : 0.8),
    '--tp-danger': lvl(theme.dark ? '#ff6b6b' : '#c62828'),
    '--tp-warn': lvl(theme.dark ? '#f0b429' : '#9a5b00'),
    '--tp-ok': lvl(theme.dark ? '#4cc38a' : '#1a7f4b'),
    '--tp-info': lvl(theme.dark ? '#58a6ff' : '#0b62c4'),
    '--tp-shadow': theme.dark ? 'rgba(0,0,0,.55)' : 'rgba(20,30,50,.18)',
    '--tp-scrim': theme.dark ? 'rgba(0,0,0,.5)' : 'rgba(30,40,60,.28)',
    '--tp-syn-keyword': syn('#c792ea', '#8a3fd1'),
    '--tp-syn-string': syn('#a5d6a7', '#1a7f37'),
    '--tp-syn-number': syn('#f6b26b', '#b25000'),
    '--tp-syn-comment': syn('#7f8b99', '#6a737d'),
    '--tp-syn-type': syn('#7fd1e0', '#0b6e84'),
    '--tp-syn-func': syn('#82aaff', '#1f5fd0'),
    '--tp-syn-prop': syn('#f29e9e', '#b3344a'),
    '--tp-syn-heading': syn('#82aaff', '#1f5fd0'),
  };
}

export function findTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function findAccent(id: string): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}

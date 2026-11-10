import { describe, expect, it } from 'vitest';
import { ACCENTS, THEMES, buildPalette, contrast, ensureContrast } from '../../src/app/themes';

describe('contrast maths', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });

  it('ensureContrast leaves passing colours alone and fixes failing ones', () => {
    expect(ensureContrast('#ffffff', ['#000000'])).toBe('#ffffff');
    const fixed = ensureContrast('#3b82f6', ['#0f1419', '#1f2732'], 4.5);
    expect(contrast(fixed, '#1f2732')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('every theme x accent combination (6 x 6)', () => {
  it('has 6 themes (3 dark, 3 light) and 6 accents', () => {
    expect(THEMES).toHaveLength(6);
    expect(THEMES.filter((t) => t.dark)).toHaveLength(3);
    expect(ACCENTS).toHaveLength(6);
  });

  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      it(`${theme.name} + ${accent.name} is readable`, () => {
        const p = buildPalette(theme, accent);
        const fills = [p['--tp-bg'], p['--tp-surface'], p['--tp-surface-2'], p['--tp-raised']];

        // Text on accent buttons.
        expect(contrast(p['--tp-on-accent'], p['--tp-accent'])).toBeGreaterThanOrEqual(4.5);
        // Accent-coloured text on every surface it can appear on.
        for (const bg of fills) expect(contrast(p['--tp-accent-text'], bg)).toBeGreaterThanOrEqual(4.5);
        // Body and secondary text.
        for (const bg of [...fills, p['--tp-accent-soft']]) {
          expect(contrast(p['--tp-text'], bg)).toBeGreaterThanOrEqual(7);
          expect(contrast(p['--tp-muted'], bg)).toBeGreaterThanOrEqual(4.5);
        }
        // Status colours and syntax colours on the editor background.
        for (const key of ['--tp-danger', '--tp-warn', '--tp-ok', '--tp-info']) {
          for (const bg of fills) expect(contrast(p[key], bg), key).toBeGreaterThanOrEqual(4.5);
        }
        for (const key of Object.keys(p).filter((k) => k.startsWith('--tp-syn-'))) {
          expect(contrast(p[key], p['--tp-bg']), key).toBeGreaterThanOrEqual(4.5);
        }
        // Focus ring is a non-text indicator: 3:1.
        for (const bg of fills) expect(contrast(p['--tp-focus'], bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});

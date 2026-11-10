import { describe, expect, it } from 'vitest';
import { EMPTY_FILTER, applyFilter, groupErrors, normaliseMessage, parseTime, type FilterSpec } from '../../src/engine/logfilter';
import { LV, parseLogTs, toMs } from '../../src/engine/logparse';
import * as F from '../fixtures/logs';
import { readFileSync } from 'node:fs';

const enc = (s: string) => new TextEncoder().encode(s);
const sample = readFileSync('src/assets/sample-spring.log', 'utf8');

function run(text: string, patch: Partial<FilterSpec>) {
  const bytes = enc(text);
  const ix = parseLogTs(bytes, 2026);
  const r = applyFilter(bytes, ix, { ...EMPTY_FILTER, ...patch });
  const shown = text.split('\n').filter((_, i) => r.mask[i] === 1);
  return { ...r, shown, ix };
}

describe('parseTime', () => {
  const day = toMs(2026, 3, 14, 0, 0, 0, 0);
  it('reads times on the day the log starts', () => {
    expect(parseTime('10:15', day + 5000)).toBe(toMs(2026, 3, 14, 10, 15, 0, 0));
    expect(parseTime('10:15:30', day)).toBe(toMs(2026, 3, 14, 10, 15, 30, 0));
    expect(parseTime(' 10:15:30.25 ', day)).toBe(toMs(2026, 3, 14, 10, 15, 30, 250));
    expect(parseTime('9:05', day)).toBe(toMs(2026, 3, 14, 9, 5, 0, 0));
  });
  it('reads full dates and date-times', () => {
    expect(parseTime('2026-03-15 08:00', day)).toBe(toMs(2026, 3, 15, 8, 0, 0, 0));
    expect(parseTime('2026-03-15T08:00:01', day)).toBe(toMs(2026, 3, 15, 8, 0, 1, 0));
    expect(parseTime('2026/03/15', day)).toBe(toMs(2026, 3, 15, 0, 0, 0, 0));
  });
  it('an end time covers the whole stated minute or second', () => {
    expect(parseTime('10:15', day, true)).toBe(toMs(2026, 3, 14, 10, 15, 59, 999));
    expect(parseTime('10:15:30', day, true)).toBe(toMs(2026, 3, 14, 10, 15, 30, 999));
    expect(parseTime('2026-03-14', day, true)).toBe(toMs(2026, 3, 14, 23, 59, 59, 999));
  });
  it('rejects nonsense', () => {
    for (const bad of ['soon', '25:00', '10:61', '2026-13-01', '10', '10:15:30:40']) expect(parseTime(bad, day)).toBeNull();
    expect(parseTime('', day)).toBeNull();
  });
});

describe('applyFilter', () => {
  it('an empty filter shows everything', () => {
    const r = run(F.LOGBACK, {});
    expect(r.mask.every((v) => v === 1)).toBe(true);
    expect(r.shownEntries).toBe(7);
  });

  it('levels: an entry keeps its stack trace', () => {
    const r = run(F.LOGBACK, { levels: [LV.ERROR] });
    expect(r.shownEntries).toBe(2);
    expect(r.shown).toHaveLength(8 + 3);
    expect(r.shown[0]).toContain('Unhandled exception for GET /api/orders/90002');
    expect(r.shown.filter((l) => l.startsWith('\tat ')).length).toBe(5);
    expect(r.shown.some((l) => l.includes('INFO'))).toBe(false);
  });

  it('text search looks inside the stack trace too, case-insensitively by default', () => {
    expect(run(F.LOGBACK, { text: 'discountservice' }).shownEntries).toBe(2);
    expect(run(F.LOGBACK, { text: 'discountservice', caseSensitive: true }).shownEntries).toBe(0);
    expect(run(F.LOGBACK, { text: 'took \\d{4}ms', regex: true }).shown).toEqual([expect.stringContaining('Slow query took 2140ms')]);
  });

  it('several "lines matching" patterns combine with any or all', () => {
    const any = run(F.LOGBACK, { patterns: ['slow query', '/status=5\\d\\d/'], patternsMode: 'any' });
    expect(any.shownEntries).toBe(2);
    const all = run(F.LOGBACK, { patterns: ['orders', 'took', 'status=', ''], patternsMode: 'all' });
    expect(all.shown).toEqual([expect.stringContaining('status=500 took 311ms')]);
  });

  it('logger or thread, and trace id', () => {
    expect(run(F.LOGBACK, { logger: 'exec-1' }).shownEntries).toBe(2);
    expect(run(F.LOGBACK, { logger: 'GlobalExceptionHandler' }).shownEntries).toBe(2);
    const trace = '6f1c2a9b4d3e4f10a1b2c3d4e5f60718';
    expect(run(F.JSON_LINES, { trace }).shownEntries).toBe(2);
    expect(run(F.GENERIC, { trace }).shownEntries).toBe(1);
    expect(run(F.K8S, { trace: '6F1C2A9B' }).shownEntries).toBe(1);
  });

  it('time range: From and To accept short times and are inclusive', () => {
    expect(run(F.LOGBACK, { from: '10:15:04', to: '10:15:05' }).shownEntries).toBe(2);
    expect(run(F.LOGBACK, { from: '10:16' }).shownEntries).toBe(1);
    expect(run(F.LOGBACK, { to: '10:15:02' }).shownEntries).toBe(1);
    expect(run(F.LOGBACK, { from: '2026-03-14 10:15:06', to: '2026-03-14 10:15:06' }).shownEntries).toBe(1);
    expect(run(F.ACCESS, { from: '10:15:03', to: '10:15:04' }).shownEntries).toBe(2);
  });

  it('filters combine with AND', () => {
    const r = run(F.LOGBACK, { levels: [LV.ERROR, LV.WARN], text: 'orders', from: '10:15:04' });
    expect(r.shownEntries).toBe(2);
    expect(run(F.LOGBACK, { levels: [LV.INFO], text: 'exception' }).shownEntries).toBe(0);
  });

  it('a banner before the first entry is hidden by a level filter, kept by a matching text filter', () => {
    expect(run(sample, { levels: [LV.ERROR] }).shown.some((l) => l.includes('Spring Boot ::'))).toBe(false);
    expect(run(sample, { text: 'Spring Boot ::' }).shown.some((l) => l.includes('Spring Boot ::'))).toBe(true);
  });

  it('bad input is reported and hides nothing', () => {
    const bad = run(F.LOGBACK, { text: '([', regex: true });
    expect(bad.error).toMatch(/Invalid pattern/);
    expect(bad.mask.every((v) => v === 1)).toBe(true);
    expect(run(F.LOGBACK, { from: 'yesterday' }).error).toMatch(/not a time/);
    expect(run(F.LOGBACK, { patterns: ['/(/'] }).error).toMatch(/Invalid pattern/);
  });

  it('CRLF files filter the same way', () => {
    const lf = run(F.LOGBACK, { levels: [LV.ERROR], text: 'customer' });
    const crlf = run(F.LOGBACK.replace(/\n/g, '\r\n'), { levels: [LV.ERROR], text: 'customer' });
    expect([...crlf.mask]).toEqual([...lf.mask]);
  });
});

describe('repeated errors', () => {
  it('normalises ids, numbers and quoted text', () => {
    expect(normaliseMessage('Failed to reserve stock for orderId=90042 sku=SKU-1234 attempt=3')).toBe(normaliseMessage('Failed to reserve stock for orderId=7 sku=SKU-99 attempt=1'));
    expect(normaliseMessage("Duplicate entry 'ORD-1' for key 'k'")).toBe(normaliseMessage("Duplicate entry 'ORD-2222' for key 'k'"));
    expect(normaliseMessage('event 1eb49e33-a11f-90f5-ed4a-9adfbb6102aa ignored')).toBe('event <id> ignored');
    expect(normaliseMessage('user deadbeefcafe1234 ok')).toBe('user <hex> ok');
    expect(normaliseMessage('added a feedback')).toBe('added a feedback');
  });

  it('groups repeats with counts and remembers where they are', () => {
    const bytes = enc(F.LOGBACK);
    const groups = groupErrors(bytes, parseLogTs(bytes, 2026));
    const npe = groups.find((g) => g.exception.endsWith('NullPointerException'))!;
    expect(npe.count).toBe(2);
    expect(npe.level).toBe(LV.ERROR);
    expect(npe.firstLine).toBe(4);
    expect(npe.lastLine).toBe(13);
    expect(npe.lines).toEqual([4, 13]);
    expect(npe.sample).toContain('Unhandled exception for GET /api/orders/90002');
    // Errors come before warnings.
    expect(groups[0].level).toBe(LV.ERROR);
    expect(groups.some((g) => g.level === LV.WARN && g.sample.includes('Slow query'))).toBe(true);
    expect(groups.some((g) => g.level === LV.INFO)).toBe(false);
  });

  it('the sample log collapses many lines into a few groups', () => {
    const bytes = enc(sample.repeat(5));
    const ix = parseLogTs(bytes, 2026);
    const groups = groupErrors(bytes, ix);
    const total = groups.reduce((s, g) => s + g.count, 0);
    expect(total).toBe(ix.summary[6 + LV.WARN] + ix.summary[6 + LV.ERROR] + ix.summary[6 + LV.FATAL]);
    expect(groups.length).toBeLessThan(20);
    expect(groups[0].count).toBeGreaterThanOrEqual(5);
  });
});

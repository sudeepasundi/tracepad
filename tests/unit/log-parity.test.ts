// Log parsing: the Rust/WASM engine and the TypeScript twin must agree exactly,
// and both must get each format right.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { FIELD_STRIDE, FLAG_CAUSE, FLAG_ENTRY, FLAG_FRAME, FORMAT_NAMES, LV, parseLogTs, toMs, type LogIndex } from '../../src/engine/logparse';
import { WasmEngine } from '../../src/engine/wasm';
import * as F from '../fixtures/logs';

let wasm: WasmEngine;
beforeAll(async () => {
  wasm = await WasmEngine.create(readFileSync('src/engine/engine.wasm'));
});

const enc = (s: string) => new TextEncoder().encode(s);
const sample = readFileSync('src/assets/sample-spring.log', 'utf8');

function parse(text: string): { ix: LogIndex; bytes: Uint8Array } {
  const bytes = enc(text);
  return { ix: parseLogTs(bytes, 2026), bytes };
}

function field(bytes: Uint8Array, ix: LogIndex, entry: number, which: 'thread' | 'logger' | 'trace'): string {
  const o = entry * FIELD_STRIDE + { thread: 1, logger: 3, trace: 5 }[which];
  return new TextDecoder().decode(bytes.subarray(ix.fields[o], ix.fields[o] + ix.fields[o + 1]));
}

function message(bytes: Uint8Array, ix: LogIndex, entry: number): string {
  const line = ix.fields[entry * FIELD_STRIDE];
  const end = line + 1 < ix.lineStart.length ? ix.lineStart[line + 1] - 1 : bytes.length;
  return new TextDecoder().decode(bytes.subarray(ix.fields[entry * FIELD_STRIDE + 7], end));
}

const format = (ix: LogIndex) => FORMAT_NAMES[ix.summary[2]];
const entryLevels = (ix: LogIndex) => [...ix.level].filter((_, i) => ix.flags[i] & FLAG_ENTRY);

describe('Rust and TypeScript produce identical indexes', () => {
  const cases: [string, string][] = [
    ...Object.entries(F.ALL),
    ...Object.entries(F.ALL).map(([k, v]) => [`${k} (CRLF)`, v.replace(/\n/g, '\r\n')] as [string, string]),
    ['sample Spring Boot log', sample],
    ['sample (CRLF)', sample.replace(/\n/g, '\r\n')],
    ['empty', ''],
    ['only newlines', '\n\n\n'],
    ['no trailing newline', '2026-03-14 10:15:02 INFO a.B - x'],
    ['truncated stamps', '2026-03-14 10:15\n2026-03-1\n10:15:0\nMar 14\n1773483302\n{"level":"info"\n{"message":"unterminated'],
    ['odd bytes', 'café ₹ 2026-03-14 10:15:02 ERROR 日本語 - x\n\t\u0000\u0001 at weird'],
    ['brackets', '2026-03-14 10:15:02 [ERROR] [] [ a ] [unterminated x.Y - z: q\n2026-03-14 10:15:02 INFO [t] [6f1c2a9b4d3e4f10a1b2c3d4e5f60718] a.B: m'],
  ];
  for (const [name, text] of cases) {
    it(name, () => {
      const bytes = enc(text);
      const a = wasm.parseLog(bytes, 2026);
      const b = parseLogTs(bytes, 2026);
      expect([...a.lineStart]).toEqual([...b.lineStart]);
      expect([...a.level]).toEqual([...b.level]);
      expect([...a.flags]).toEqual([...b.flags]);
      expect([...a.ts]).toEqual([...b.ts]);
      expect([...a.fields]).toEqual([...b.fields]);
      expect([...a.summary]).toEqual([...b.summary]);
    });
  }

  it('agrees on a large generated log, line for line', () => {
    const big = sample.repeat(40);
    const bytes = enc(big);
    const a = wasm.parseLog(bytes, 2026);
    const b = parseLogTs(bytes, 2026);
    expect(a.level.length).toBe(b.level.length);
    expect(Buffer.from(a.level.buffer).equals(Buffer.from(b.level.buffer))).toBe(true);
    expect(Buffer.from(a.flags.buffer).equals(Buffer.from(b.flags.buffer))).toBe(true);
    expect(Buffer.from(a.ts.buffer).equals(Buffer.from(b.ts.buffer))).toBe(true);
    expect(Buffer.from(a.fields.buffer).equals(Buffer.from(b.fields.buffer))).toBe(true);
  });
});

describe('formats', () => {
  it('Spring Boot: level, thread, logger, trace id, zone, stack traces', () => {
    const { ix, bytes } = parse(sample);
    expect(format(ix)).toBe('Spring Boot');
    expect(ix.summary[13]).toBe(330);
    expect(ix.summary[6 + LV.ERROR]).toBeGreaterThanOrEqual(3);
    expect(ix.summary[6 + LV.WARN]).toBeGreaterThan(5);
    // Line 10 is the first real entry (after the banner).
    const first = [...ix.flags].findIndex((f) => f & FLAG_ENTRY);
    expect(first).toBe(9);
    expect(ix.ts[first]).toBe(toMs(2026, 3, 14, 10, 15, 2, 171));
    expect(field(bytes, ix, 0, 'thread')).toBe('main');
    expect(field(bytes, ix, 0, 'logger')).toBe('com.acme.orders.OrderServiceApplication');
    // Every stack frame is a continuation line carrying its entry's level.
    const frames = [...ix.flags].map((f, i) => (f & FLAG_FRAME ? i : -1)).filter((i) => i >= 0);
    expect(frames.length).toBeGreaterThan(30);
    for (const i of frames) expect(ix.level[i]).toBe(LV.ERROR);
    expect([...ix.flags].filter((f) => f & FLAG_CAUSE).length).toBeGreaterThanOrEqual(1);
    // A request's lines share one trace id.
    const traces = new Set<string>();
    for (let e = 0; e < ix.fields.length / FIELD_STRIDE; e++) traces.add(field(bytes, ix, e, 'trace'));
    expect(traces.size).toBeGreaterThan(30);
    expect([...traces].filter(Boolean).every((t) => /^[0-9a-f]{32}-[0-9a-f]{16}$/.test(t))).toBe(true);
  });

  it('Logback: comma milliseconds, thread in brackets, logger before " - "', () => {
    const { ix, bytes } = parse(F.LOGBACK);
    expect(format(ix)).toBe('Logback / Log4j');
    expect(ix.summary[1]).toBe(7);
    expect(entryLevels(ix)).toEqual([LV.INFO, LV.DEBUG, LV.WARN, LV.ERROR, LV.INFO, LV.ERROR, LV.INFO]);
    expect(ix.ts[0]).toBe(toMs(2026, 3, 14, 10, 15, 2, 118));
    expect(field(bytes, ix, 1, 'thread')).toBe('http-nio-8080-exec-1');
    expect(field(bytes, ix, 1, 'logger')).toBe('com.acme.orders.web.OrderController');
    expect(message(bytes, ix, 1)).toBe('GET /api/orders/90001 for user ravi');
    expect([...ix.flags].slice(3, 11)).toEqual([FLAG_ENTRY, 0, FLAG_FRAME, FLAG_FRAME, FLAG_FRAME, FLAG_FRAME, FLAG_CAUSE, FLAG_FRAME]);
    expect(Number.isNaN(ix.summary[13])).toBe(true);
  });

  it('Log4j pattern with the thread before the level', () => {
    const { ix, bytes } = parse(F.LOG4J);
    expect(entryLevels(ix)).toEqual([LV.INFO, LV.ERROR, LV.FATAL]);
    expect(field(bytes, ix, 1, 'thread')).toBe('worker-3');
    expect(field(bytes, ix, 1, 'logger')).toBe('com.acme.Billing');
    expect(message(bytes, ix, 1)).toBe('charge failed for invoice 77121');
  });

  it('JSON lines: top-level keys only, escaped quotes, numeric levels, epoch seconds', () => {
    const { ix, bytes } = parse(F.JSON_LINES);
    expect(format(ix)).toBe('JSON lines');
    expect(entryLevels(ix)).toEqual([LV.INFO, LV.WARN, LV.ERROR, LV.INFO, LV.DEBUG]);
    expect(ix.ts[0]).toBe(toMs(2026, 3, 14, 10, 15, 2, 118));
    expect(ix.ts[3]).toBe(1773483305000);
    expect(ix.ts[4]).toBe(toMs(2026, 3, 14, 10, 15, 6, 500));
    expect(field(bytes, ix, 1, 'logger')).toBe('com.acme.orders.cache.OrderCache');
    expect(field(bytes, ix, 1, 'thread')).toBe('exec-2');
    expect(field(bytes, ix, 2, 'trace')).toBe('6f1c2a9b4d3e4f10a1b2c3d4e5f60718');
    expect(message(bytes, ix, 2).startsWith('Unhandled \\"quoted\\" failure')).toBe(true);
  });

  it('access logs: level from the status code', () => {
    const { ix, bytes } = parse(F.ACCESS);
    expect(format(ix)).toBe('Access log');
    expect(entryLevels(ix)).toEqual([LV.INFO, LV.INFO, LV.WARN, LV.ERROR]);
    expect(ix.ts[3]).toBe(toMs(2026, 3, 14, 10, 15, 9, 0));
    expect(ix.summary[13]).toBe(330);
    expect(message(bytes, ix, 0).startsWith('GET /api/orders/90001 HTTP/1.1"')).toBe(true);
  });

  it('syslog: program name as the logger, default year, single-digit days', () => {
    const { ix, bytes } = parse(F.SYSLOG);
    expect(format(ix)).toBe('Syslog');
    expect(ix.summary[1]).toBe(4);
    expect(field(bytes, ix, 0, 'logger')).toBe('sshd');
    expect(field(bytes, ix, 2, 'logger')).toBe('nginx');
    expect(entryLevels(ix)).toEqual([LV.NONE, LV.WARN, LV.ERROR, LV.NONE]);
    expect(ix.ts[3]).toBe(toMs(2026, 3, 4, 1, 2, 3, 0));
  });

  it('java.util.logging: the level comes from the second line; AM/PM', () => {
    const { ix } = parse(F.JUL);
    expect(format(ix)).toBe('java.util.logging');
    expect(ix.summary[1]).toBe(3);
    expect([...ix.level].slice(0, 8)).toEqual([LV.INFO, LV.INFO, LV.ERROR, LV.ERROR, LV.ERROR, LV.ERROR, LV.WARN, LV.WARN]);
    expect(ix.ts[0]).toBe(toMs(2026, 3, 14, 10, 15, 2, 0));
    expect(ix.ts[6]).toBe(toMs(2026, 3, 14, 12, 0, 0, 0));
    expect(ix.summary[6 + LV.NONE]).toBe(0);
  });

  it('epoch timestamps: milliseconds, seconds and fractional seconds', () => {
    const { ix } = parse(F.EPOCH);
    expect(format(ix)).toBe('Epoch timestamps');
    expect(ix.summary[1]).toBe(4);
    expect([...ix.ts]).toEqual([1773483302118, 1773483303120, 1773483303120, 1773483304000, 1773483305250, 1773483305250]);
    expect(entryLevels(ix)).toEqual([LV.INFO, LV.ERROR, LV.WARN, LV.INFO]);
  });

  it('Kubernetes prefixes: entries are not collapsed into one', () => {
    const { ix, bytes } = parse(F.K8S);
    expect(ix.summary[1]).toBe(4);
    expect(ix.summary[3]).toBe(4);
    expect(format(ix)).toBe('Spring Boot');
    expect(entryLevels(ix)).toEqual([LV.INFO, LV.ERROR, LV.WARN, LV.ERROR]);
    // The two prefixed stack lines stay with the ERROR entry.
    expect([...ix.level].slice(1, 4)).toEqual([LV.ERROR, LV.ERROR, LV.ERROR]);
    expect(field(bytes, ix, 1, 'thread')).toBe('exec-1');
    expect(field(bytes, ix, 1, 'trace')).toBe('6f1c2a9b4d3e4f10a1b2c3d4e5f60718-9a8b7c6d5e4f3a2b');
    expect(ix.ts[5]).toBe(1773483305118);
  });

  it('generic fallback: any line with a timestamp starts an entry', () => {
    const { ix, bytes } = parse(F.GENERIC);
    expect(format(ix)).toBe('Generic');
    expect(ix.summary[1]).toBe(5);
    expect([...ix.flags]).toEqual([1, 1, 1, 1, 0, 1, 0]);
    expect(ix.ts[1]).toBe(toMs(1970, 1, 1, 10, 15, 3, 250));
    expect(ix.ts[3]).toBe(toMs(2026, 3, 14, 10, 15, 5, 0));
    expect(field(bytes, ix, 4, 'trace')).toBe('6f1c2a9b4d3e4f10a1b2c3d4e5f60718');
  });

  it('prose is not mistaken for a log', () => {
    const { ix } = parse(F.PROSE);
    expect(ix.summary[1]).toBeLessThanOrEqual(1);
  });

  it('a timestamp further in than 64 characters does not start an entry', () => {
    const pad = 'x'.repeat(70);
    const { ix } = parse(`${pad} 2026-03-14 10:15:02 ERROR late\n[${'p'.repeat(40)} c] 2026-03-14 10:15:02 ERROR ok`);
    expect([...ix.flags]).toEqual([0, 1]);
  });
});

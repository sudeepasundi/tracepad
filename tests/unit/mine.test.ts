// Template mining and tables: Rust/TypeScript parity, masking, merging,
// column naming, table contents, access logs, JSON fields and extraction.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BigIndex } from '../../src/engine/bigindex';
import { parseLogTs } from '../../src/engine/logparse';
import { KIND_LITERAL, KIND_MERGED, KIND_PATH, KIND_VAR, Miner, maskMessage, messageSpans, mineSpans, type Mined } from '../../src/engine/mine';
import { accessTable, countBy, extractTable, mineLog, nameColumns, routeOf, templateTable, templateTitle, toCsv, toHtml, toTsv, type Table, type Walk } from '../../src/engine/tables';
import { WasmEngine } from '../../src/engine/wasm';
import * as F from '../fixtures/logs';

const enc = (s: string) => new TextEncoder().encode(s);
const sample = readFileSync('src/assets/sample-spring.log', 'utf8');
let wasm: WasmEngine;
beforeAll(async () => {
  wasm = await WasmEngine.create(readFileSync('src/engine/engine.wasm'));
});

const mask = (s: string) => {
  const b = enc(s);
  return maskMessage(b, 0, b.length).map((t) => t.text).join(' ');
};

function walkOf(text: string): Walk {
  const bytes = enc(text);
  const ix = parseLogTs(bytes, 2026);
  return async (fn) => fn({ bytes, ix, lineBase: 0, entryBase: 0 });
}

function both(text: string): { rust: Mined; ts: Mined } {
  const bytes = enc(text);
  const ix = parseLogTs(bytes, 2026);
  const spans = messageSpans(bytes, ix);
  wasm.mineBegin();
  wasm.mineChunk(bytes, spans);
  const rust = wasm.mineFinish();
  const m = new Miner();
  mineSpans(m, bytes, spans);
  return { rust, ts: m.finish() };
}

async function tableFor(text: string, match: (title: string) => boolean): Promise<Table> {
  const walk = walkOf(text);
  const result = await mineLog(walk, null);
  const t = result.templates.find((x) => match(templateTitle(x.tokens)));
  if (!t) throw new Error(`no template matched; have:\n${result.templates.map((x) => templateTitle(x.tokens)).join('\n')}`);
  return templateTable(walk, result, t.id);
}

const col = (t: Table, name: string) => {
  const i = t.columns.findIndex((c) => c.name === name);
  if (i < 0) throw new Error(`no column "${name}" in ${t.columns.map((c) => c.name).join(', ')}`);
  return t.rows.map((r) => r[i]);
};

describe('masking', () => {
  it('masks numbers, ids, addresses, quoted text and key=value values', () => {
    expect(mask('GET /api/orders/{id} status=200 took 84ms')).toBe('GET /api/orders/{id} status=<*> took <*>ms');
    expect(mask('GET /api/orders/90001 requested by ravi')).toBe('GET /api/orders/{id} requested by ravi');
    expect(mask('Heartbeat CPU_USAGE=64% HEAP_USED=512MB redis=10.24.3.17:6379')).toBe('Heartbeat CPU_USAGE=<*>% HEAP_USED=<*>MB redis=<*>');
    expect(mask('Duplicate entry \'ORD-1\' for key "uk order"')).toBe('Duplicate entry <*> for key <*>');
    expect(mask('Started in 6.412 seconds (process running for 7.03)')).toBe('Started in <*> seconds (process running for <*>)');
    expect(mask('[InventoryClient#reserve] <--- HTTP/1.1 200 (52ms)')).toBe('[InventoryClient#reserve] <--- <*> <*> (<*>ms)');
    expect(mask('event 1eb49e33-a11f-90f5-ed4a-9adfbb6102aa ignored, trace 6f1c2a9b4d3e4f10.')).toBe('event <*> ignored, trace <*>.');
    expect(mask('msg="hello world" user=ravi total=1,299.50')).toBe('msg=<*> user=<*> total=<*>');
    expect(mask('GET /search?q=boots&page=2 done')).toBe('GET /search done');
  });

  it('leaves plain words and prose alone', () => {
    expect(mask('Tomcat started on port with context path')).toBe('Tomcat started on port with context path');
    expect(mask('HikariPool-1 - Start completed.')).toBe('<*> - Start completed.');
    const b = enc('Nothing here is variable at all');
    expect(maskMessage(b, 0, b.length).every((t) => t.kind === KIND_LITERAL)).toBe(true);
  });

  it('marks kinds', () => {
    const b = enc('GET /api/orders/7 took 5ms');
    expect(maskMessage(b, 0, b.length).map((t) => t.kind)).toEqual([KIND_LITERAL, KIND_PATH, KIND_LITERAL, KIND_VAR]);
  });
});

describe('Rust and TypeScript mine identically', () => {
  const cases: [string, string][] = [
    ...Object.entries(F.ALL),
    ['sample', sample],
    ['sample x5', sample.repeat(5)],
    ['sample CRLF', sample.replace(/\n/g, '\r\n')],
    ['unicode', '2026-03-14 10:15:02 INFO a.B - café ₹42 für Zoë id=7\n2026-03-14 10:15:03 INFO a.B - café ₹43 für Zoë id=8\n'],
    ['long line', `2026-03-14 10:15:02 INFO a.B - ${'word 12 '.repeat(200)}\n`],
    ['empty messages', '2026-03-14 10:15:02 INFO a.B - \n2026-03-14 10:15:03 INFO a.B -\n'],
  ];
  for (const [name, text] of cases) {
    it(name, () => {
      const { rust, ts } = both(text);
      expect([...rust.ids]).toEqual([...ts.ids]);
      expect(rust.templates).toEqual(ts.templates);
    });
  }
});

describe('grouping and merging', () => {
  it('lines of one shape share a template; counts add up', () => {
    const { ts } = both(sample);
    const total = ts.templates.reduce((s, t) => s + t.count, 0);
    expect(total).toBe(ts.ids.length);
    expect(ts.ids.length).toBe(370);
    // 370 entries collapse into a few dozen patterns.
    expect(ts.templates.length).toBeLessThan(60);
    expect(ts.templates.length).toBeGreaterThan(20);
  });

  it('templates that differ in a few words are merged, and those words become variables', () => {
    const { ts } = both(sample);
    const moved = ts.templates.find((t) => t.tokens.some((k) => k.text === 'moved'))!;
    expect(templateTitle(moved.tokens)).toBe('Order <*> moved from <*> to <*> by <*>');
    expect(moved.tokens.filter((k) => k.kind === KIND_MERGED)).toHaveLength(3);
    expect(moved.count).toBeGreaterThan(10);
    // Different messages are not thrown together.
    expect(ts.templates.filter((t) => t.tokens[0].text === 'Tomcat').length).toBeGreaterThanOrEqual(2);
  });

  it('gives the same templates whether the log is mined whole or in chunks', async () => {
    const text = sample.repeat(6);
    const bytes = enc(text);
    const whole = await mineLog(walkOf(text), null);
    const ix = new BigIndex(async (a, b) => bytes.slice(a, b), (b) => parseLogTs(b, 2026), 0, 30_000);
    await ix.build(bytes.length);
    const chunked = await mineLog((fn, p) => ix.walk(fn, p), null);
    const rust = await mineLog((fn, p) => ix.walk(fn, p), wasm);
    expect(chunked.templates).toEqual(whole.templates);
    expect(rust.templates).toEqual(whole.templates);
    expect([...chunked.mined.ids]).toEqual([...whole.mined.ids]);
  });

  it('mines 100,000 entries well inside the time budget', async () => {
    const text = sample.repeat(271);
    const walk = walkOf(text);
    const t0 = performance.now();
    const r = await mineLog(walk, wasm);
    const ms = performance.now() - t0;
    expect(r.mined.ids.length).toBeGreaterThan(100_000);
    console.log(`mined ${r.mined.ids.length.toLocaleString('en-US')} entries into ${r.templates.length} templates in ${ms.toFixed(0)} ms (Rust)`);
    expect(ms).toBeLessThan(2000);
  });
});

describe('column names come from the surrounding words', () => {
  const names = (msg: string, sample: string[] = []) => {
    const b = enc(msg);
    return nameColumns(maskMessage(b, 0, b.length), sample).map((c) => c.name);
  };
  it('names from the brief', () => {
    expect(names('request took 84ms')).toEqual(['took (ms)']);
    expect(names('Created order orderId=90001 items=3')).toEqual(['orderId', 'items']);
    expect(names('Reserved stock for order 42')).toEqual(['order']);
    expect(names('Heartbeat CPU_USAGE=64% HEAP_USED=512MB')).toEqual(['CPU_USAGE (%)', 'HEAP_USED (MB)']);
    expect(names('connected to db-1.internal:5432 ok', ['db-1.internal:5432'])).toEqual(['host']);
  });
  it('merged words take the word before them: from / to / by', () => {
    const { ts } = both(sample);
    const moved = ts.templates.find((t) => t.tokens.some((k) => k.text === 'moved'))!;
    expect(nameColumns(moved.tokens).map((c) => c.name)).toEqual(['Order', 'from', 'to', 'by']);
  });
  it('paths, repeats and values with nothing before them', () => {
    expect(names('GET /api/orders/7 done')).toEqual(['path']);
    expect(names('retry 1 retry 2')).toEqual(['retry', 'retry 2']);
    expect(names('42 items shipped')).toEqual(['items']);
    expect(names('7 8')).toEqual(['value', 'value 2']);
  });
});

describe('template tables', () => {
  it('one row per entry in file order, with named columns and number statistics', async () => {
    const t = await tableFor(sample, (s) => s.startsWith('Created order orderId='));
    expect(t.columns.map((c) => c.name)).toEqual(['line', 'time', 'thread', 'orderId', 'customerId', 'items', 'total', 'trace']);
    expect(t.rows.length).toBe(t.total);
    expect(t.rows.length).toBeGreaterThan(15);
    const lines = col(t, 'line').map(Number);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
    expect(lines).toEqual(t.lines);
    expect(col(t, 'orderId')[0]).toBe('90002');
    expect(col(t, 'time')[0]).toMatch(/^10:15:\d\d\.\d{3}$/);
    expect(col(t, 'trace')[0]).toMatch(/^[0-9a-f]{32}-[0-9a-f]{16}$/);
    // Level never varies in this table, so it is not a column.
    expect(t.columns.some((c) => c.name === 'level')).toBe(false);
    const items = t.columns.find((c) => c.name === 'items')!;
    expect(items.numeric).toBe(true);
    const values = col(t, 'items').map(Number);
    expect(items.stats!.min).toBe(Math.min(...values));
    expect(items.stats!.max).toBe(Math.max(...values));
    expect(items.stats!.avg).toBeCloseTo(values.reduce((a, b) => a + b, 0) / values.length, 6);
    expect(items.stats!.p95).toBeLessThanOrEqual(items.stats!.max);
    expect(items.stats!.p95).toBeGreaterThanOrEqual(items.stats!.avg);
    expect(t.columns[0].numeric).toBe(false);
  });

  it('units are stripped from values and shown in the column name', async () => {
    const t = await tableFor(sample, (s) => /status=<\*> took <\*>ms$/.test(s) && s.startsWith('GET'));
    expect(t.columns.map((c) => c.name)).toContain('took (ms)');
    expect(col(t, 'took (ms)').every((v) => /^\d+$/.test(v))).toBe(true);
    expect(t.columns.find((c) => c.name === 'took (ms)')!.numeric).toBe(true);
    const hb = await tableFor(sample, (s) => s.startsWith('Heartbeat'));
    expect(hb.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['CPU_USAGE (%)', 'HEAP_USED (MB)', 'activeConnections', 'redis']));
    expect(col(hb, 'CPU_USAGE (%)').every((v) => /^\d+$/.test(v))).toBe(true);
    expect(col(hb, 'redis')[0]).toBe('10.24.3.17:6379');
  });

  it('merged words appear as columns: from / to / by', async () => {
    const t = await tableFor(sample, (s) => s.includes('moved from'));
    expect(t.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['from', 'to', 'by']));
    expect(new Set(col(t, 'from')).size).toBeGreaterThan(1);
    expect(col(t, 'by').every((v) => /^[a-z.]+$/.test(v))).toBe(true);
    for (const v of col(t, 'to')) expect(['PAID', 'PACKED', 'SHIPPED', 'DELIVERED']).toContain(v);
  });

  it('errors get "exception" and "caused by" columns', async () => {
    const t = await tableFor(sample, (s) => s.startsWith('Failed to reserve stock'));
    expect(t.columns.map((c) => c.name)).toEqual(expect.arrayContaining(['orderId', 'sku', 'attempt', 'exception', 'caused by']));
    expect(col(t, 'exception')[0]).toBe('feign.RetryableException');
    expect(col(t, 'caused by')[0]).toBe('java.net.SocketTimeoutException: Read timed out');
  });

  it('quoted values lose their quotes', async () => {
    const log = Array.from({ length: 5 }, (_, i) => `2026-03-14 10:15:0${i} INFO a.B - saved name="Order ${i}" as 'draft ${i}'`).join('\n');
    const t = await tableFor(log, (s) => s.startsWith('saved'));
    expect(col(t, 'name')).toEqual(['Order 0', 'Order 1', 'Order 2', 'Order 3', 'Order 4']);
    expect(col(t, 'as')[2]).toBe('draft 2');
  });

  it('JSON logs: the other fields become columns', async () => {
    const log = Array.from({ length: 6 }, (_, i) => JSON.stringify({ '@timestamp': `2026-03-14T10:15:0${i}.000Z`, level: i % 2 ? 'WARN' : 'INFO', logger_name: 'c.a.OrderService', message: `Created order ${90000 + i}`, orderId: 90000 + i, customerId: 4000 + i, region: 'ap-south-1' })).join('\n');
    const t = await tableFor(log, (s) => s.startsWith('Created order'));
    expect(t.columns.map((c) => c.name)).toEqual(['line', 'time', 'level', 'order', 'orderId', 'customerId', 'region']);
    expect(col(t, 'orderId')).toEqual(['90000', '90001', '90002', '90003', '90004', '90005']);
    expect(col(t, 'region')[3]).toBe('ap-south-1');
    expect(col(t, 'level')).toEqual(['INFO', 'WARN', 'INFO', 'WARN', 'INFO', 'WARN']);
  });

  it('"Filter log to these lines" pattern matches exactly the rows of the table', async () => {
    const walk = walkOf(sample);
    const result = await mineLog(walk, null);
    for (const tpl of result.templates.slice(0, 12)) {
      const t = await templateTable(walk, result, tpl.id);
      const re = new RegExp(t.pattern!);
      const lines = sample.split('\n');
      for (const n of t.lines) expect(re.test(lines[n - 1]), `${t.title} :: ${lines[n - 1]}`).toBe(true);
    }
  });
});

describe('access logs', () => {
  it('route: ids in the path become {id}; the query is dropped', () => {
    expect(routeOf('/api/orders/90001')).toBe('/api/orders/{id}');
    expect(routeOf('/api/orders/90001/status?x=1')).toBe('/api/orders/{id}/status');
    expect(routeOf('/health')).toBe('/health');
    expect(routeOf('/u/6f1c2a9b/items/12')).toBe('/u/{id}/items/{id}');
  });

  it('one request table with a route column', async () => {
    const walk = walkOf(F.ACCESS);
    const result = await mineLog(walk, null);
    expect(result.accessEntries).toBe(4);
    expect(result.templates).toHaveLength(0);
    const t = await accessTable(walk);
    expect(t.title).toBe('Requests');
    expect(t.columns.map((c) => c.name)).toEqual(['line', 'time', 'ip', 'user', 'method', 'route', 'path', 'status', 'bytes', 'referrer', 'agent']);
    expect(col(t, 'route')).toEqual(['/api/orders/{id}', '/api/orders', '/api/orders/{id}', '/api/orders/{id}/status']);
    expect(col(t, 'status')).toEqual(['200', '201', '404', '503']);
    expect(col(t, 'user')).toEqual(['ravi', '', 'meera', '']);
    expect(t.columns.find((c) => c.name === 'bytes')!.numeric).toBe(true);
    expect(t.columns.find((c) => c.name === 'status')!.numeric).toBe(false);
  });
});

describe('extract presets', () => {
  it('response times, normalised to milliseconds', async () => {
    const t = await extractTable(walkOf(sample), { preset: 'times' });
    expect(t.columns.map((c) => c.name)).toEqual(['line', 'time', 'level', 'ms', 'what', 'text']);
    expect(t.rows.length).toBeGreaterThan(50);
    expect(t.columns.find((c) => c.name === 'ms')!.numeric).toBe(true);
    const started = t.rows.find((r) => r[5].includes('6.412 seconds'))!;
    expect(started[3]).toBe('6412');
    expect(t.rows.some((r) => r[5].includes('(52ms)') && r[3] === '52')).toBe(true);
  });

  it('SQL statements with operation and table', async () => {
    const t = await extractTable(walkOf(sample), { preset: 'sql' });
    const ops = new Set(t.rows.map((r) => r[3]));
    expect(ops).toEqual(new Set(['SELECT', 'INSERT', 'UPDATE']));
    expect(new Set(t.rows.map((r) => r[4]))).toEqual(new Set(['orders', 'order_items']));
    expect(t.rows.every((r) => /^(select|insert|update)/i.test(r[5]))).toBe(true);
  });

  it('Kafka topics, partitions and offsets', async () => {
    const t = await extractTable(walkOf(sample), { preset: 'kafka' });
    expect(t.columns.map((c) => c.name)).toEqual(['line', 'time', 'level', 'topic', 'partition', 'offset', 'key', 'text']);
    expect(new Set(t.rows.map((r) => r[3]))).toEqual(new Set(['payments.events', 'orders.events']));
    expect(t.rows.every((r) => /^\d+$/.test(r[5]) && /^[0-2]$/.test(r[4]))).toBe(true);
    expect(t.columns.find((c) => c.name === 'offset')!.numeric).toBe(true);
  });

  it('IP addresses, several per line, with ports', async () => {
    const t = await extractTable(walkOf('10:15:02 from 10.24.3.17:6379 to 192.168.0.9, not 999.1.1.1 or 1.2.3\n10:15:03 nothing\n'), { preset: 'ips' });
    expect(t.rows.map((r) => [r[2], r[3]])).toEqual([['10.24.3.17', '6379'], ['192.168.0.9', '']]);
  });

  it('timestamps: one row per entry', async () => {
    const t = await extractTable(walkOf(F.LOGBACK), { preset: 'timestamps' });
    expect(t.rows).toHaveLength(7);
    expect(t.rows[0].slice(0, 3)).toEqual(['1', '10:15:02.118', 'INFO']);
  });

  it('custom pattern: named groups become columns; bad patterns are explained', async () => {
    const t = await extractTable(walkOf(sample), { preset: 'custom', regex: 'orderId=(?<order>\\d+) customerId=(?<customer>\\d+)' });
    expect(t.columns.map((c) => c.name)).toEqual(['line', 'time', 'level', 'order', 'customer']);
    expect(t.rows[0].slice(3)).toEqual(['90002', '8762']);
    const numbered = await extractTable(walkOf(sample), { preset: 'custom', regex: 'partition=(\\d) offset=(\\d+)' });
    expect(numbered.columns.map((c) => c.name).slice(3)).toEqual(['group 1', 'group 2']);
    const whole = await extractTable(walkOf(sample), { preset: 'custom', regex: 'SKU-\\d+' });
    expect(whole.columns.map((c) => c.name).slice(3)).toEqual(['match']);
    expect(whole.rows[0][3]).toMatch(/^SKU-\d+$/);
    await expect(extractTable(walkOf(sample), { preset: 'custom', regex: '([' })).rejects.toThrow();
    await expect(extractTable(walkOf(sample), { preset: 'custom', regex: 'x*' })).rejects.toThrow(/every line/);
  });
});

describe('count by value and export', () => {
  it('counts values, most frequent first', async () => {
    const t = await tableFor(sample, (s) => s.includes('moved from'));
    const c = countBy(t, t.columns.findIndex((x) => x.name === 'to'));
    expect(c.title).toBe('Count by to');
    expect(c.columns.map((x) => x.name)).toEqual(['to', 'count', 'share']);
    const counts = c.rows.map((r) => Number(r[1]));
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(t.rows.length);
    expect(c.rows[0][2]).toMatch(/^\d+\.\d%$/);
  });

  it('CSV, TSV and HTML escape what they must', () => {
    const t: Table = { title: 'x', columns: [{ name: 'a,b', numeric: false }, { name: 'n', numeric: true }], rows: [['say "hi"', '1'], ['<b>&\ttab\nline', '2']], lines: [], total: 2 };
    expect(toCsv(t)).toBe('"a,b",n\r\n"say ""hi""",1\r\n"<b>&\ttab\nline",2\r\n');
    expect(toTsv(t)).toBe('a,b\tn\nsay "hi"\t1\n<b>& tab line\t2');
    const html = toHtml(t);
    expect(html).toContain('&lt;b&gt;&amp;');
    expect(html).not.toContain('<b>&');
    expect(html.match(/<tr>/g)).toHaveLength(3);
    expect(html).toContain('text-align:right');
  });
});

// The chunked, disk-backed index must give the same answer as parsing the whole
// file at once, whatever the chunk size, and must handle a file that grows.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { BigIndex } from '../../src/engine/bigindex';
import { EMPTY_FILTER, applyFilter, groupErrors } from '../../src/engine/logfilter';
import { FIELD_STRIDE, LV, parseLogTs } from '../../src/engine/logparse';
import { WasmEngine } from '../../src/engine/wasm';
import * as F from '../fixtures/logs';

const enc = (s: string) => new TextEncoder().encode(s);
const sample = readFileSync('src/assets/sample-spring.log', 'utf8');
let wasm: WasmEngine;
beforeAll(async () => {
  wasm = await WasmEngine.create(readFileSync('src/engine/engine.wasm'));
});

/** A "file" that can be replaced, like a log being written to. */
function disk(initial: string) {
  let bytes = enc(initial);
  let reads = 0;
  return {
    read: async (a: number, b: number) => {
      reads++;
      return bytes.slice(a, b);
    },
    set: (text: string) => (bytes = enc(text)),
    get size() {
      return bytes.length;
    },
    get reads() {
      return reads;
    },
  };
}

async function build(text: string, chunk: number, engine: 'ts' | 'wasm' = 'ts') {
  const d = disk(text);
  const ix = new BigIndex(d.read, engine === 'ts' ? (b) => parseLogTs(b, 2026) : (b) => wasm.parseLog(b, 2026), 0, chunk);
  await ix.build(d.size);
  return { ix, d };
}

/** What a single whole-file parse says, without the empty line after a final line break. */
function whole(text: string) {
  const bytes = enc(text);
  const ix = parseLogTs(bytes, 2026);
  const n = text.endsWith('\n') ? ix.level.length - 1 : ix.level.length;
  const entryLines = [];
  for (let e = 0; e < ix.fields.length / FIELD_STRIDE; e++) entryLines.push(ix.fields[e * FIELD_STRIDE]);
  return { level: [...ix.level.subarray(0, n)], flags: [...ix.flags.subarray(0, n)], ts: [...ix.ts.subarray(0, n)], entryLines, counts: [...ix.summary.subarray(6, 13)], format: ix.summary[2], bytes, ix };
}

describe('chunked index equals a whole-file parse', () => {
  const texts: [string, string][] = [
    ['sample', sample],
    ['sample CRLF', sample.replace(/\n/g, '\r\n')],
    ['sample without final line break', sample.trimEnd()],
    ['logback', F.LOGBACK],
    ['k8s', F.K8S],
    ['json', F.JSON_LINES],
    ['epoch', F.EPOCH],
    ['prose', F.PROSE],
  ];
  for (const [name, text] of texts) {
    for (const chunk of [97, 1024, 7000, 1 << 20]) {
      it(`${name}, ${chunk}-byte chunks`, async () => {
        const { ix } = await build(text, chunk);
        const w = whole(text);
        expect([...ix.level.view()]).toEqual(w.level);
        expect([...ix.flags.view()]).toEqual(w.flags);
        expect([...ix.ts.view()]).toEqual(w.ts);
        expect([...ix.entryLine.view()]).toEqual(w.entryLines);
        const s = ix.summary();
        expect([...s.subarray(6, 13)]).toEqual(w.counts);
        expect(s[2]).toBe(w.format);
        expect(s[0]).toBe(w.level.length);
      });
    }
  }

  it('the Rust engine and the TypeScript twin give the same chunked index', async () => {
    const big = sample.repeat(30);
    const a = (await build(big, 50_000, 'wasm')).ix;
    const b = (await build(big, 50_000, 'ts')).ix;
    expect(a.lines).toBe(b.lines);
    expect(Buffer.from(a.level.view()).equals(Buffer.from(b.level.view()))).toBe(true);
    expect([...a.entryFields.view()]).toEqual([...b.entryFields.view()]);
    expect([...a.summary()]).toEqual([...b.summary()]);
  });

  it('a line longer than a chunk is still one line', async () => {
    const text = `2026-03-14 10:15:02 INFO a.B - ${'x'.repeat(5000)}\n2026-03-14 10:15:03 ERROR a.B - short\n`;
    const { ix } = await build(text, 256);
    expect(ix.lines).toBe(2);
    expect([...ix.level.view()]).toEqual([LV.INFO, LV.ERROR]);
  });

  it('can start part-way into a file (the "last N MB" view)', async () => {
    const start = sample.indexOf('\n', 20_000) + 1;
    const d = disk(sample);
    const ix = new BigIndex(d.read, (b) => parseLogTs(b, 2026), start, 4096);
    await ix.build(d.size);
    expect(ix.lines).toBe(sample.slice(start).split('\n').length - 1);
    expect((await ix.text(0, 1, 'utf-8'))[0]).toBe(sample.slice(start).split('\n')[0]);
  });
});

describe('reading text back', () => {
  it('returns exact lines without line breaks, for LF and CRLF', async () => {
    for (const text of [sample, sample.replace(/\n/g, '\r\n')]) {
      const { ix } = await build(text, 3000);
      const lines = sample.split('\n');
      expect(await ix.text(0, 3, 'utf-8')).toEqual(lines.slice(0, 3));
      expect(await ix.text(200, 205, 'utf-8')).toEqual(lines.slice(200, 205));
      expect(await ix.text(ix.lines - 1, ix.lines + 10, 'utf-8')).toEqual([lines[ix.lines - 1]]);
    }
  });

  it('decodes UTF-8 and Latin-1', async () => {
    const { ix } = await build('2026-03-14 10:15:02 INFO a.B - café ₹ 日本\nnext\n', 64);
    expect((await ix.text(0, 1, 'utf-8'))[0]).toContain('café ₹ 日本');
    const d = disk('');
    const latin = Uint8Array.from([...enc('10:15:02 caf'), 0xe9, 10]);
    const ix2 = new BigIndex(async (a, b) => latin.slice(a, b), (b) => parseLogTs(b, 2026), 0, 64);
    await ix2.build(latin.length);
    expect((await ix2.text(0, 1, 'iso-8859-1'))[0]).toBe('10:15:02 café');
    expect(d.size).toBe(0);
  });
});

describe('filter, find and groups over chunks', () => {
  it('filters like the in-memory filter, for every kind of filter', async () => {
    const text = sample.repeat(4);
    const w = whole(text);
    const { ix } = await build(text, 20_000);
    const specs = [
      { levels: [LV.ERROR] },
      { levels: [LV.WARN, LV.ERROR], from: '10:15:30' },
      { text: 'paymentcaptured' },
      { text: 'took \\d{4,}ms', regex: true },
      { text: 'Tomcat', caseSensitive: true },
      { patterns: ['Slow query', '/status=5\\d\\d/'] },
      { logger: 'SlowQueryLogger' },
      { trace: '7650177b3a5d927e' },
      { to: '10:15:10' },
      { text: 'Spring Boot ::' },
    ];
    for (const patch of specs) {
      const spec = { ...EMPTY_FILTER, ...patch };
      const expected = applyFilter(w.bytes, w.ix, spec);
      const got = await ix.filter(spec);
      expect([...got.mask], JSON.stringify(patch)).toEqual([...expected.mask.subarray(0, ix.lines)]);
      expect(got.shownEntries).toBe(expected.shownEntries);
    }
  });

  it('level and time filters do not read the file at all', async () => {
    const { ix, d } = await build(sample.repeat(4), 20_000);
    const before = d.reads;
    await ix.filter({ ...EMPTY_FILTER, levels: [LV.ERROR], from: '10:15:10' });
    expect(d.reads).toBe(before);
    await ix.filter({ ...EMPTY_FILTER, text: 'order' });
    expect(d.reads).toBeGreaterThan(before);
  });

  it('reports a bad pattern and hides nothing', async () => {
    const { ix } = await build(sample, 5000);
    const r = await ix.filter({ ...EMPTY_FILTER, text: '([', regex: true });
    expect(r.error).toMatch(/Invalid pattern/);
    expect(r.mask.every((v) => v === 1)).toBe(true);
  });

  it('finds matching lines in order, with a total beyond the limit', async () => {
    const text = sample.repeat(3);
    const { ix } = await build(text, 9000);
    const expected = text.split('\n').map((l, i) => (/ERROR/.test(l) ? i : -1)).filter((i) => i >= 0);
    const all = await ix.find(/ERROR/, 1000);
    expect([...all.lines]).toEqual(expected);
    expect(all.total).toBe(expected.length);
    const few = await ix.find(/ERROR/, 2);
    expect([...few.lines]).toEqual(expected.slice(0, 2));
    expect(few.total).toBe(expected.length);
    // ^ and $ work per line; case-insensitive flag is honoured.
    expect((await ix.find(/^\tat com\.acme/, 5000)).total).toBe(text.split('\n').filter((l) => l.startsWith('\tat com.acme')).length);
    expect((await ix.find(/tomcat started/i, 10)).total).toBe(3);
    // Non-ASCII text takes the slower path and still works.
    const uni = await build('2026-03-14 10:15:02 INFO a.B - café\nplain\n2026-03-14 10:15:03 INFO a.B - café again\n', 40);
    expect([...(await uni.ix.find(/café/, 10)).lines]).toEqual([0, 2]);
  });

  it('groups repeated errors across chunks with file-wide line numbers', async () => {
    const text = sample.repeat(3);
    const w = whole(text);
    const { ix } = await build(text, 15_000);
    const expected = groupErrors(w.bytes, w.ix);
    const got = await ix.groups();
    expect(got.map((g) => [g.level, g.count, g.firstLine, g.lastLine, g.exception])).toEqual(expected.map((g) => [g.level, g.count, g.firstLine, g.lastLine, g.exception]));
  });
});

describe('a file that grows (follow)', () => {
  const lines = sample.split('\n').filter(Boolean);

  it('indexes only the new bytes and matches a fresh index', async () => {
    const first = lines.slice(0, 200).join('\n') + '\n';
    const d = disk(first);
    const ix = new BigIndex(d.read, (b) => parseLogTs(b, 2026), 0, 4096);
    await ix.build(d.size);
    const full = lines.slice(0, 330).join('\n') + '\n';
    d.set(full);
    const readsBefore = d.reads;
    const delta = (await ix.append(d.size))!;
    expect(delta.fromLine).toBe(200);
    expect(delta.level.length).toBe(130);
    // Only the tail (plus a small signature check) was read.
    expect(d.reads - readsBefore).toBeLessThan(12);
    const fresh = (await build(full, 4096)).ix;
    expect([...ix.level.view()]).toEqual([...fresh.level.view()]);
    expect([...ix.ts.view()]).toEqual([...fresh.ts.view()]);
    expect([...ix.entryLine.view()]).toEqual([...fresh.entryLine.view()]);
    expect([...ix.summary()]).toEqual([...fresh.summary()]);
    expect([...delta.entryLines]).toEqual([...fresh.entryLine.view()].slice(delta.keepEntries));
  });

  it('a half-written last line is completed, not duplicated', async () => {
    const whole1 = lines.slice(0, 50).join('\n') + '\n';
    const half = lines[50].slice(0, 60);
    const d = disk(whole1 + half);
    const ix = new BigIndex(d.read, (b) => parseLogTs(b, 2026), 0, 2048);
    await ix.build(d.size);
    expect(ix.lines).toBe(51);
    expect((await ix.text(50, 51, 'utf-8'))[0]).toBe(half);
    const full = lines.slice(0, 53).join('\n') + '\n';
    d.set(full);
    const delta = (await ix.append(d.size))!;
    expect(delta.fromLine).toBe(50);
    expect(ix.lines).toBe(53);
    expect((await ix.text(50, 51, 'utf-8'))[0]).toBe(lines[50]);
    const fresh = (await build(full, 2048)).ix;
    expect([...ix.level.view()]).toEqual([...fresh.level.view()]);
    expect([...ix.summary()]).toEqual([...fresh.summary()]);
  });

  it('many small appends stay consistent', async () => {
    const d = disk('');
    const ix = new BigIndex(d.read, (b) => parseLogTs(b, 2026), 0, 1024);
    await ix.build(0);
    let text = '';
    for (let i = 0; i < lines.length; i += 37) {
      text += lines.slice(i, i + 37).join('\n') + (i % 2 ? '\n' : '');
      if (!text.endsWith('\n') && i + 37 < lines.length) text += '\n';
      d.set(text);
      expect(await ix.append(d.size)).not.toBeNull();
    }
    const fresh = (await build(text, 1024)).ix;
    expect(ix.lines).toBe(fresh.lines);
    expect([...ix.level.view()]).toEqual([...fresh.level.view()]);
    expect([...ix.summary()]).toEqual([...fresh.summary()]);
  });

  it('a rewritten or truncated file is reported, not appended to', async () => {
    const d = disk(lines.slice(0, 100).join('\n') + '\n');
    const ix = new BigIndex(d.read, (b) => parseLogTs(b, 2026), 0, 4096);
    await ix.build(d.size);
    d.set(lines.slice(0, 40).join('\n') + '\n');
    expect(await ix.append(d.size)).toBeNull();
    const ix2 = new BigIndex(d.read, (b) => parseLogTs(b, 2026), 0, 4096);
    await ix2.build(d.size);
    // Same length or longer, but different content before the old end: a new file.
    d.set(lines.slice(100, 300).join('\n') + '\n');
    expect(await ix2.append(d.size)).toBeNull();
  });
});

// The Rust/WASM engine and its TypeScript twin must agree on every input.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { scanTs } from '../../src/engine/scan';
import { WasmEngine } from '../../src/engine/wasm';

let wasm: WasmEngine;
beforeAll(async () => {
  wasm = await WasmEngine.create(readFileSync('src/engine/engine.wasm'));
});

const enc = (s: string) => new TextEncoder().encode(s);
const sample = readFileSync('src/assets/sample-spring.log');

function pseudoRandom(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  let s = seed >>> 0;
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    // Bias towards line-break bytes so every branch is exercised.
    const r = s >>> 24;
    out[i] = r < 24 ? 10 : r < 48 ? 13 : r < 56 ? 0 : r;
  }
  return out;
}

const cases: [string, Uint8Array][] = [
  ['empty', new Uint8Array(0)],
  ['no newline', enc('single line')],
  ['LF', enc('a\nbb\nccc\n')],
  ['CRLF', enc('a\r\nbb\r\nccc\r\n')],
  ['lone CR', enc('a\rbb\rccc')],
  ['mixed', enc('a\nbb\r\nccc\rdddd\n\n\r\n')],
  ['CR at end', enc('abc\r')],
  ['unicode', enc('naïve — ₹ 日本語\nsecond\n')],
  ['control + NUL', new Uint8Array([1, 2, 0, 9, 27, 12, 10, 0x80, 0xff])],
  ['sample Spring Boot log', new Uint8Array(sample)],
  ['sample as CRLF', enc(sample.toString('utf8').replace(/\n/g, '\r\n'))],
  ['random 64 KB', pseudoRandom(65536, 42)],
  ['random 1 MB', pseudoRandom(1 << 20, 7)],
];

describe('scan: wasm and TypeScript agree', () => {
  for (const [name, bytes] of cases) {
    it(name, () => {
      expect(wasm.scan(bytes)).toEqual(scanTs(bytes));
    });
  }
});

describe('scan: values', () => {
  it('counts line breaks by kind', () => {
    expect(scanTs(enc('a\nbb\r\nccc\rdddd'))).toMatchObject({ lines: 4, lf: 1, crlf: 1, cr: 1, maxLine: 4 });
  });

  it('a CRLF file has the same line count as its LF twin', () => {
    const lf = scanTs(new Uint8Array(sample));
    const crlf = wasm.scan(enc(sample.toString('utf8').replace(/\n/g, '\r\n')));
    expect(crlf.lines).toBe(lf.lines);
    expect(crlf.crlf).toBe(lf.lf);
    expect(crlf.lf).toBe(0);
    expect(crlf.maxLine).toBe(lf.maxLine);
  });

  it('survives many calls without leaking or corrupting memory', () => {
    const data = pseudoRandom(200_000, 99);
    const first = wasm.scan(data);
    for (let i = 0; i < 200; i++) expect(wasm.scan(data)).toEqual(first);
  });
});

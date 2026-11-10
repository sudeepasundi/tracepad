import { describe, expect, it } from 'vitest';
import { decodeBytes, detectEncoding, encodeText, type Encoding } from '../../src/files/encoding';

const bytes = (...b: number[]) => new Uint8Array(b);
const utf8 = (s: string) => new TextEncoder().encode(s);
const TEXT = 'Order café — ₹1,299 für Zoë\r\nline two\r\n';

describe('detectEncoding', () => {
  it('detects plain ASCII and UTF-8', () => {
    expect(detectEncoding(utf8('hello world\n'))).toEqual({ encoding: 'UTF-8', binary: false });
    expect(detectEncoding(utf8(TEXT))).toEqual({ encoding: 'UTF-8', binary: false });
    expect(detectEncoding(new Uint8Array(0))).toEqual({ encoding: 'UTF-8', binary: false });
  });

  it('detects the three byte order marks', () => {
    expect(detectEncoding(bytes(0xef, 0xbb, 0xbf, 0x61)).encoding).toBe('UTF-8 BOM');
    expect(detectEncoding(bytes(0xff, 0xfe, 0x61, 0x00)).encoding).toBe('UTF-16 LE');
    expect(detectEncoding(bytes(0xfe, 0xff, 0x00, 0x61)).encoding).toBe('UTF-16 BE');
  });

  it('detects UTF-16 without a BOM from the NUL pattern', () => {
    const le = encodeText('2026-03-14 INFO started\n', 'UTF-16 LE').bytes.subarray(2);
    const be = encodeText('2026-03-14 INFO started\n', 'UTF-16 BE').bytes.subarray(2);
    expect(detectEncoding(le)).toEqual({ encoding: 'UTF-16 LE', binary: false });
    expect(detectEncoding(be)).toEqual({ encoding: 'UTF-16 BE', binary: false });
  });

  it('falls back to Latin-1 when bytes are not valid UTF-8', () => {
    expect(detectEncoding(bytes(0x63, 0x61, 0x66, 0xe9, 0x0a))).toEqual({ encoding: 'Latin-1', binary: false });
  });

  it('flags binary data', () => {
    expect(detectEncoding(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49)).binary).toBe(true);
    const noise = new Uint8Array(4096).map((_, i) => (i * 7) % 32);
    expect(detectEncoding(noise).binary).toBe(true);
  });

  it('does not misjudge a UTF-8 sample cut in the middle of a character', () => {
    const big = utf8('é'.repeat(200_000));
    expect(detectEncoding(big.subarray(0, 256 * 1024 + 1)).encoding).toBe('UTF-8');
  });
});

describe('round trips', () => {
  const cases: Encoding[] = ['UTF-8', 'UTF-8 BOM', 'UTF-16 LE', 'UTF-16 BE'];
  for (const enc of cases) {
    it(`${enc}: encode -> detect -> decode gives the same text`, () => {
      const { bytes: out, lossy } = encodeText(TEXT, enc);
      expect(lossy).toBe(0);
      expect(detectEncoding(out).encoding).toBe(enc);
      expect(decodeBytes(out, enc)).toBe(TEXT);
    });
  }

  it('Latin-1 keeps every byte value', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    const text = decodeBytes(all, 'Latin-1');
    expect(text).toHaveLength(256);
    expect([...encodeText(text, 'Latin-1').bytes]).toEqual([...all]);
  });

  it('Latin-1 reports characters it cannot store', () => {
    const r = encodeText('ok ₹ €', 'Latin-1');
    expect(r.lossy).toBe(2);
    expect(decodeBytes(r.bytes, 'Latin-1')).toBe('ok ? ?');
  });
});

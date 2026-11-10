// Encoding detection and round-tripping. Pure module, unit tested.

export type Encoding = 'UTF-8' | 'UTF-8 BOM' | 'UTF-16 LE' | 'UTF-16 BE' | 'Latin-1';

export interface Detected {
  encoding: Encoding;
  /** True when the bytes do not look like text in any supported encoding. */
  binary: boolean;
}

const SAMPLE = 256 * 1024;

export function detectEncoding(bytes: Uint8Array): Detected {
  const n = bytes.length;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'UTF-8 BOM', binary: false };
  if (n >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'UTF-16 LE', binary: false };
  if (n >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'UTF-16 BE', binary: false };

  const sample = n > SAMPLE ? bytes.subarray(0, SAMPLE) : bytes;
  let nulEven = 0;
  let nulOdd = 0;
  let control = 0;
  for (let i = 0; i < sample.length; i++) {
    const b = sample[i];
    if (b === 0) {
      if (i & 1) nulOdd++;
      else nulEven++;
    } else if (b < 0x20 && b !== 9 && b !== 10 && b !== 13 && b !== 12 && b !== 27) control++;
  }
  const nul = nulEven + nulOdd;
  if (nul > 0) {
    // UTF-16 without a BOM: ASCII text has a NUL in every other byte, all on one side.
    const half = sample.length / 2;
    if (sample.length >= 4 && nulOdd > half * 0.6 && nulEven < half * 0.05) return { encoding: 'UTF-16 LE', binary: false };
    if (sample.length >= 4 && nulEven > half * 0.6 && nulOdd < half * 0.05) return { encoding: 'UTF-16 BE', binary: false };
    return { encoding: 'UTF-8', binary: true };
  }
  if (sample.length > 0 && control / sample.length > 0.1) return { encoding: 'UTF-8', binary: true };

  if (isValidUtf8(sample, sample.length < n)) return { encoding: 'UTF-8', binary: false };
  return { encoding: 'Latin-1', binary: false };
}

/** `truncated` tolerates a multi-byte sequence cut off at the end of a sample. */
function isValidUtf8(bytes: Uint8Array, truncated: boolean): boolean {
  let i = 0;
  const n = bytes.length;
  while (i < n) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) need = 2;
    else if (b >= 0xf0 && b <= 0xf4) need = 3;
    else return false;
    if (i + need >= n) return truncated && i + need >= n && bytes.subarray(i + 1).every((c) => (c & 0xc0) === 0x80);
    for (let k = 1; k <= need; k++) if ((bytes[i + k] & 0xc0) !== 0x80) return false;
    i += need + 1;
  }
  return true;
}

export function decodeBytes(bytes: Uint8Array, encoding: Encoding): string {
  switch (encoding) {
    case 'UTF-8':
      return new TextDecoder('utf-8').decode(bytes);
    case 'UTF-8 BOM':
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    case 'UTF-16 LE':
      return new TextDecoder('utf-16le').decode(hasBom16(bytes) ? bytes.subarray(2) : bytes);
    case 'UTF-16 BE':
      return new TextDecoder('utf-16be').decode(hasBom16(bytes) ? bytes.subarray(2) : bytes);
    case 'Latin-1': {
      // True ISO-8859-1: byte value == code point, so every byte round-trips.
      let out = '';
      const step = 0x8000;
      for (let i = 0; i < bytes.length; i += step) out += String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[]);
      return out;
    }
  }
}

function hasBom16(b: Uint8Array): boolean {
  return b.length >= 2 && ((b[0] === 0xff && b[1] === 0xfe) || (b[0] === 0xfe && b[1] === 0xff));
}

export interface Encoded {
  bytes: Uint8Array;
  /** Characters that the encoding cannot represent (Latin-1 only); written as "?". */
  lossy: number;
}

export function encodeText(text: string, encoding: Encoding): Encoded {
  switch (encoding) {
    case 'UTF-8':
      return { bytes: new TextEncoder().encode(text), lossy: 0 };
    case 'UTF-8 BOM': {
      const body = new TextEncoder().encode(text);
      const out = new Uint8Array(body.length + 3);
      out.set([0xef, 0xbb, 0xbf]);
      out.set(body, 3);
      return { bytes: out, lossy: 0 };
    }
    case 'UTF-16 LE':
    case 'UTF-16 BE': {
      const le = encoding === 'UTF-16 LE';
      const out = new Uint8Array(text.length * 2 + 2);
      out[0] = le ? 0xff : 0xfe;
      out[1] = le ? 0xfe : 0xff;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        out[2 + i * 2] = le ? c & 0xff : c >> 8;
        out[3 + i * 2] = le ? c >> 8 : c & 0xff;
      }
      return { bytes: out, lossy: 0 };
    }
    case 'Latin-1': {
      const out = new Uint8Array(text.length);
      let lossy = 0;
      for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        if (c > 0xff) {
          out[i] = 0x3f;
          lossy++;
        } else out[i] = c;
      }
      return { bytes: out, lossy };
    }
  }
}

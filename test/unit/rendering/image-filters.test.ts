import { PDFDict, PDFDocument, PDFName, PDFStream } from 'pdf-lib';
import {
  decodeRunLength,
  decodeLzw,
  jpxDimensions,
  buildImageXObject,
} from '../../../src/rendering/image-filters';

function ascii(text: string): number[] {
  return [...text].map((c) => c.charCodeAt(0));
}

function be32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** Pack fixed-width codes MSB-first (test helper). */
function packCodes(codes: number[], width: number): Uint8Array {
  const bits: number[] = [];
  for (const code of codes) {
    for (let i = width - 1; i >= 0; i--) bits.push((code >> i) & 1);
  }
  while (bits.length % 8 !== 0) bits.push(0);
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
    out[i] = b;
  }
  return out;
}

describe('G14 — RunLengthDecode', () => {
  it('decodes literal runs, repeat runs and EOD', () => {
    // literal 3 ("ABC"), repeat 3× "X", EOD
    const data = Uint8Array.from([2, ...ascii('ABC'), 254, 0x58, 128]);
    expect(new TextDecoder().decode(decodeRunLength(data))).toBe('ABCXXX');
  });

  it('stops at end of input without an EOD marker', () => {
    expect(new TextDecoder().decode(decodeRunLength(Uint8Array.from([0, 0x41])))).toBe('A');
  });
});

describe('G14 — LZWDecode', () => {
  it('decodes a fixed-width code stream', () => {
    const packed = packCodes([65, 65, 65, 65], 9);
    expect(new TextDecoder().decode(decodeLzw(packed))).toBe('AAAA');
  });

  it('honours the CLEAR code', () => {
    // CLEAR, 'A', 'B', EOD
    const packed = packCodes([256, 65, 66, 257], 9);
    expect(new TextDecoder().decode(decodeLzw(packed))).toBe('AB');
  });
});

describe('G14 — JPEG 2000 dimensions', () => {
  it('reads width/height from a JP2 ihdr box', () => {
    const data = Uint8Array.from([
      0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50, 0x20, 0x20, 0x0d, 0x0a, 0x87, 0x0a,
      ...be32(22), ...ascii('ihdr'), ...be32(480), ...be32(640), 0, 0, 0, 0,
    ]);
    expect(jpxDimensions(data)).toEqual({ width: 640, height: 480 });
  });

  it('reads dimensions from a raw codestream SIZ segment', () => {
    const data = Uint8Array.from([
      0xff, 0x4f, 0xff, 0x51, 0, 41, 0, 0,
      ...be32(800), ...be32(600), ...be32(0), ...be32(0),
    ]);
    expect(jpxDimensions(data)).toEqual({ width: 800, height: 600 });
  });

  it('returns null for non-JPEG2000 data', () => {
    expect(jpxDimensions(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('G14 — direct-filter image XObject', () => {
  it('registers a JPXDecode image XObject', async () => {
    const doc = await PDFDocument.create();
    const ref = buildImageXObject(doc, {
      width: 640,
      height: 480,
      filter: 'JPXDecode',
      data: Uint8Array.from([0xff, 0x4f, 0xff, 0x51]),
    });
    const stream = doc.context.lookup(ref) as PDFStream;
    expect(String(stream.dict.get(PDFName.of('Subtype')))).toBe('/Image');
    expect(String(stream.dict.get(PDFName.of('Filter')))).toBe('/JPXDecode');
    expect(String(stream.dict.get(PDFName.of('Width')))).toBe('640');
  });

  it('registers a CCITTFaxDecode image with DecodeParms', async () => {
    const doc = await PDFDocument.create();
    const ref = buildImageXObject(doc, {
      width: 1728,
      height: 2200,
      bitsPerComponent: 1,
      colorSpace: 'DeviceGray',
      filter: 'CCITTFaxDecode',
      decodeParms: { K: -1, Columns: 1728, Rows: 2200 },
      data: Uint8Array.from([0x00, 0x01, 0x02]),
    });
    const stream = doc.context.lookup(ref) as PDFStream;
    expect(String(stream.dict.get(PDFName.of('Filter')))).toBe('/CCITTFaxDecode');
    const parms = stream.dict.get(PDFName.of('DecodeParms')) as PDFDict;
    expect(String(parms.get(PDFName.of('K')))).toBe('-1');
    expect(String(parms.get(PDFName.of('Columns')))).toBe('1728');
  });
});

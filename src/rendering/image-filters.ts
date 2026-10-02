import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';

/**
 * PDF image stream filters (G14): RunLength and LZW decoding, JPEG 2000
 * dimension parsing, and direct-filter image XObject construction.
 *
 * Rather than re-encoding every input as Flate, we support embedding streams
 * that are already coded with a PDF filter (JPXDecode, CCITTFaxDecode) and
 * decode the simple byte-oriented filters (RunLength, LZW) when needed.
 */

// ─── RunLengthDecode (PDF 32000-1 §7.4.5) ────────────────────────────────────

export function decodeRunLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const length = data[i++];
    if (length === 128) break; // EOD
    if (length <= 127) {
      // Copy the next length + 1 bytes literally.
      for (let j = 0; j < length + 1 && i < data.length; j++) out.push(data[i++]);
    } else {
      // Repeat the next byte 257 - length times.
      const count = 257 - length;
      const value = data[i++] ?? 0;
      for (let j = 0; j < count; j++) out.push(value);
    }
  }
  return Uint8Array.from(out);
}

// ─── LZWDecode (PDF 32000-1 §7.4.4, TIFF early-change) ───────────────────────

export function decodeLzw(data: Uint8Array, earlyChange = 1): Uint8Array {
  const CLEAR = 256;
  const EOD = 257;

  // Code width grows from 9 bits; dictionary starts with 258 entries.
  let dictionary: number[][] = [];
  const resetDictionary = (): void => {
    dictionary = [];
    for (let i = 0; i < 256; i++) dictionary.push([i]);
    dictionary.push([], []); // 256 CLEAR, 257 EOD placeholders
  };
  resetDictionary();

  let bitBuffer = 0;
  let bitCount = 0;
  let codeWidth = 9;
  let previous: number[] | null = null;
  const out: number[] = [];
  let bytePos = 0;

  const readCode = (): number | null => {
    while (bitCount < codeWidth) {
      if (bytePos >= data.length) return null;
      bitBuffer = (bitBuffer << 8) | data[bytePos++];
      bitCount += 8;
    }
    bitCount -= codeWidth;
    return (bitBuffer >> bitCount) & ((1 << codeWidth) - 1);
  };

  while (true) {
    const code = readCode();
    if (code === null) break;
    if (code === CLEAR) {
      resetDictionary();
      codeWidth = 9;
      previous = null;
      continue;
    }
    if (code === EOD) break;

    let entry: number[];
    if (code < dictionary.length) {
      entry = dictionary[code];
    } else if (previous) {
      entry = [...previous, previous[0]];
    } else {
      break; // malformed
    }
    out.push(...entry);

    if (previous) {
      dictionary.push([...previous, entry[0]]);
      // Width increases once the next code would not fit (early change).
      if (dictionary.length + earlyChange === 1 << codeWidth && codeWidth < 12) {
        codeWidth++;
      }
    }
    previous = entry;
  }
  return Uint8Array.from(out);
}

// ─── JPEG 2000 dimensions ────────────────────────────────────────────────────

/** Width/height of a JP2 file or raw JPEG 2000 codestream, or null. */
export function jpxDimensions(data: Uint8Array): { width: number; height: number } | null {
  // JP2 container: find the `ihdr` box (always the first box after signature).
  if (
    data.length > 12 &&
    data[0] === 0x00 && data[1] === 0x00 && data[2] === 0x00 && data[3] === 0x0c &&
    data[4] === 0x6a && data[5] === 0x50 && data[6] === 0x20 && data[7] === 0x20
  ) {
    for (let i = 0; i + 12 < data.length; i++) {
      if (data[i] === 0x69 && data[i + 1] === 0x68 && data[i + 2] === 0x64 && data[i + 3] === 0x72) {
        const height = readU32(data, i + 4);
        const width = readU32(data, i + 8);
        return { width, height };
      }
    }
    return null;
  }

  // Raw codestream: SOC (FF4F) then SIZ (FF51).
  if (data.length > 2 && data[0] === 0xff && data[1] === 0x4f) {
    for (let i = 0; i + 2 < data.length; i++) {
      if (data[i] === 0xff && data[i + 1] === 0x51) {
        const xsiz = readU32(data, i + 6);
        const ysiz = readU32(data, i + 10);
        const xosiz = readU32(data, i + 14);
        const yosiz = readU32(data, i + 18);
        return { width: xsiz - xosiz, height: ysiz - yosiz };
      }
    }
  }
  return null;
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0
  );
}

// ─── Direct-filter image XObject construction ────────────────────────────────

export interface ImageXObjectSpec {
  width: number;
  height: number;
  bitsPerComponent?: number;
  /** PDF colour space name, e.g. `DeviceRGB`, `DeviceGray`, `DeviceCMYK`. */
  colorSpace?: string;
  /** PDF filter name, e.g. `JPXDecode`, `CCITTFaxDecode`, `FlateDecode`. */
  filter: string;
  /** Optional `/DecodeParms` entries (e.g. CCITT `K`, `Columns`, `Rows`). */
  decodeParms?: Record<string, number>;
  data: Uint8Array;
}

/**
 * Register a direct-filter image XObject (bypassing pdf-lib's PNG/JPEG
 * decoders) so JPX or CCITT data can be embedded verbatim. Returns the ref.
 */
export function buildImageXObject(doc: PDFDocument, spec: ImageXObjectSpec): PDFRef {
  const context = doc.context;
  const stream = context.stream(spec.data);
  const dict = stream.dict;
  dict.set(PDFName.of('Type'), PDFName.of('XObject'));
  dict.set(PDFName.of('Subtype'), PDFName.of('Image'));
  dict.set(PDFName.of('Width'), PDFNumber.of(spec.width));
  dict.set(PDFName.of('Height'), PDFNumber.of(spec.height));
  dict.set(PDFName.of('BitsPerComponent'), PDFNumber.of(spec.bitsPerComponent ?? 8));
  dict.set(PDFName.of('ColorSpace'), PDFName.of(spec.colorSpace ?? 'DeviceRGB'));
  dict.set(PDFName.of('Filter'), PDFName.of(spec.filter));
  if (spec.decodeParms) {
    const parms = PDFDict.withContext(context);
    for (const [key, value] of Object.entries(spec.decodeParms)) {
      parms.set(PDFName.of(key), PDFNumber.of(value));
    }
    dict.set(PDFName.of('DecodeParms'), parms);
  }
  return context.register(stream);
}

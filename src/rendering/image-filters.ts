import { PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef } from 'pdf-lib';

export function decodeRunLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const length = data[i++];
    if (length === 128) break;
    if (length <= 127) {
      for (let j = 0; j < length + 1 && i < data.length; j++) out.push(data[i++]);
    } else {
      const count = 257 - length;
      const value = data[i++] ?? 0;
      for (let j = 0; j < count; j++) out.push(value);
    }
  }
  return Uint8Array.from(out);
}

export function decodeLzw(data: Uint8Array, earlyChange = 1): Uint8Array {
  const CLEAR = 256;
  const EOD = 257;

  let dictionary: number[][] = [];
  const resetDictionary = (): void => {
    dictionary = [];
    for (let i = 0; i < 256; i++) dictionary.push([i]);
    dictionary.push([], []);
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
      break;
    }
    out.push(...entry);

    if (previous) {
      dictionary.push([...previous, entry[0]]);
      if (dictionary.length + earlyChange === 1 << codeWidth && codeWidth < 12) {
        codeWidth++;
      }
    }
    previous = entry;
  }
  return Uint8Array.from(out);
}

export function jpxDimensions(data: Uint8Array): { width: number; height: number } | null {
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

export interface ImageXObjectSpec {
  width: number;
  height: number;
  bitsPerComponent?: number;
  colorSpace?: string;
  filter: string;
  decodeParms?: Record<string, number>;
  data: Uint8Array;
}

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

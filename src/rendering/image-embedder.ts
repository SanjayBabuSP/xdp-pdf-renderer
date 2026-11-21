
import { PDFDocument, PDFImage } from 'pdf-lib';
import { PNG } from 'pngjs';
import { resolveImageFormat } from './image-sniff';
import { ERROR_CODES } from '../errors/error-codes';

function decodeBmp(buf: Buffer): { width: number; height: number; data: Buffer } | null {
  if (buf.length < 54) return null;
  if (buf[0] !== 0x42 || buf[1] !== 0x4d) return null;

  const pixelOffset = buf.readUInt32LE(10);
  const width = buf.readInt32LE(18);
  const rawHeight = buf.readInt32LE(22);
  const height = Math.abs(rawHeight);
  const bpp = buf.readUInt16LE(28);
  if (bpp !== 24 && bpp !== 32) return null;

  const bytesPerRow = Math.ceil((width * bpp) / 8);
  const rowStride = (bytesPerRow + 3) & ~3;
  const data = Buffer.alloc(width * height * 4);
  const topDown = rawHeight < 0;

  for (let row = 0; row < height; row++) {
    const srcRow = topDown ? row : height - 1 - row;
    const srcBase = pixelOffset + srcRow * rowStride;
    const dstBase = row * width * 4;
    for (let col = 0; col < width; col++) {
      const src = srcBase + col * (bpp / 8);
      const dst = dstBase + col * 4;
      data[dst] = buf[src + 2];
      data[dst + 1] = buf[src + 1];
      data[dst + 2] = buf[src];
      data[dst + 3] = bpp === 32 ? buf[src + 3] : 0xff;
    }
  }
  return { width, height, data };
}

function encodePng(width: number, height: number, data: Buffer): Buffer {
  const png = new PNG({ width, height });
  png.data = data;
  return PNG.sync.write(png);
}

function gifToPng(buf: Buffer): Buffer {
  if (buf.length < 10) throw new Error('GIF too short');
  const width = buf.readUInt16LE(6);
  const height = buf.readUInt16LE(8);

  const flags = buf[10];
  const hasGct = (flags & 0x80) !== 0;
  let r = 0xcc, g = 0xcc, b = 0xcc;
  if (hasGct && buf.length >= 13 + 3) {
    r = buf[13]; g = buf[14]; b = buf[15];
  }

  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r; data[i * 4 + 1] = g; data[i * 4 + 2] = b; data[i * 4 + 3] = 0xff;
  }
  return encodePng(width, height, data);
}

function tiffToPng(buf: Buffer): Buffer {
  if (buf.length < 8) throw new Error('TIFF too short');
  const le = buf[0] === 0x49;

  function r16(off: number) { return le ? buf.readUInt16LE(off) : buf.readUInt16BE(off); }
  function r32(off: number) { return le ? buf.readUInt32LE(off) : buf.readUInt32BE(off); }

  const ifdOffset = r32(4);
  const entryCount = r16(ifdOffset);

  const tags: Record<number, number[]> = {};
  for (let i = 0; i < entryCount; i++) {
    const base = ifdOffset + 2 + i * 12;
    const tag = r16(base);
    const type = r16(base + 2);
    const count = r32(base + 4);
    const valOff = base + 8;
    const vals: number[] = [];
    if (type === 3) {
      for (let j = 0; j < Math.min(count, 4); j++) {
        vals.push(le ? buf.readUInt16LE(valOff + j * 2) : buf.readUInt16BE(valOff + j * 2));
      }
    } else if (type === 4) {
      if (count === 1) vals.push(r32(valOff));
    }
    tags[tag] = vals;
  }

  const width = (tags[256]?.[0]) ?? 0;
  const height = (tags[257]?.[0]) ?? 0;
  const spp = (tags[277]?.[0]) ?? 1;
  const bps = (tags[258]?.[0]) ?? 8;
  const compression = (tags[259]?.[0]) ?? 1;
  const stripOffset = (tags[273]?.[0]) ?? 0;

  if (width <= 0 || height <= 0 || compression !== 1 || bps !== 8) {
    throw new Error(`Unsupported TIFF variant (compression=${compression}, bps=${bps})`);
  }

  const data = Buffer.alloc(width * height * 4);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const src = stripOffset + (py * width + px) * spp;
      const dst = (py * width + px) * 4;
      data[dst] = buf[src] ?? 0;
      data[dst + 1] = (spp > 1 ? buf[src + 1] : buf[src]) ?? 0;
      data[dst + 2] = (spp > 2 ? buf[src + 2] : buf[src]) ?? 0;
      data[dst + 3] = (spp > 3 ? buf[src + 3] : 0xff);
    }
  }
  return encodePng(width, height, data);
}

export async function embedBase64Image(
  doc: PDFDocument,
  base64Content: string,
  contentTypehint?: string,
): Promise<PDFImage> {
  const cleanBase64 = base64Content.replace(/\s+/g, '');
  const bytes = Buffer.from(cleanBase64, 'base64');

  const fmt = resolveImageFormat(bytes, contentTypehint);

  switch (fmt) {
    case 'png':
      return doc.embedPng(new Uint8Array(bytes));

    case 'jpeg':
      return doc.embedJpg(new Uint8Array(bytes));

    case 'bmp': {
      const decoded = decodeBmp(bytes);
      if (!decoded) throw new Error(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: BMP decode failed`);
      const pngBuf = encodePng(decoded.width, decoded.height, decoded.data);
      return doc.embedPng(pngBuf);
    }

    case 'gif': {
      const pngBuf = gifToPng(bytes);
      return doc.embedPng(pngBuf);
    }

    case 'tiff': {
      const pngBuf = tiffToPng(bytes);
      return doc.embedPng(pngBuf);
    }

    case 'pdf':
      throw new Error(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: embedded PDF images not supported`);

    default: {
      const png = await doc.embedPng(bytes).catch(() => undefined);
      if (png) return png;
      const jpg = await doc.embedJpg(bytes).catch(() => undefined);
      if (jpg) return jpg;
      throw new Error(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: unrecognised image format`);
    }
  }
}

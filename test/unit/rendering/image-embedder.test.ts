import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';
import { PNG } from 'pngjs';
import { embedBase64Image } from '../../../src/rendering/image-embedder';
import { ERROR_CODES } from '../../../src/errors/error-codes';

function pngBytes(): Buffer {
  const png = new PNG({ width: 2, height: 2 });
  for (let i = 0; i < 4; i++) {
    png.data[i * 4] = 255;
    png.data[i * 4 + 1] = 0;
    png.data[i * 4 + 2] = 0;
    png.data[i * 4 + 3] = 255;
  }
  return PNG.sync.write(png);
}

function jpegBytes(): Buffer {
  const canvas = createCanvas(3, 2);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(0, 0, 3, 2);
  return canvas.toBuffer('image/jpeg');
}

function bmpBytes(bitsPerPixel: number): Buffer {
  const width = 2;
  const height = 2;
  const pixelOffset = 54;
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);
  const rowStride = (bytesPerRow + 3) & ~3;
  const buf = Buffer.alloc(pixelOffset + rowStride * height);
  buf[0] = 0x42;
  buf[1] = 0x4d;
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(pixelOffset, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bitsPerPixel, 28);
  buf.writeUInt32LE(rowStride * height, 34);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const offset = pixelOffset + (height - 1 - row) * rowStride + col * (bitsPerPixel / 8);
      buf[offset] = 0;
      buf[offset + 1] = 0;
      buf[offset + 2] = 255;
      if (bitsPerPixel === 32) buf[offset + 3] = 0xff;
    }
  }
  return buf;
}

function gifBytes(): Buffer {
  const buf = Buffer.alloc(17);
  buf.write('GIF89a', 0, 'ascii');
  buf.writeUInt16LE(2, 6);
  buf.writeUInt16LE(3, 8);
  buf[10] = 0x80;
  buf[13] = 10;
  buf[14] = 20;
  buf[15] = 30;
  return buf;
}

function tiffBytes(compression: number): Buffer {
  const width = 2;
  const height = 2;
  const ifdOffset = 8;
  const entries: Array<[number, number, number]> = [
    [256, 3, width],
    [257, 3, height],
    [258, 3, 8],
    [259, 3, compression],
    [273, 4, ifdOffset + 2 + 6 * 12 + 4],
    [277, 3, 3],
  ];
  const pixelOffset = ifdOffset + 2 + entries.length * 12 + 4;
  const buf = Buffer.alloc(pixelOffset + width * height * 3);
  buf.write('II', 0, 'ascii');
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(ifdOffset, 4);
  buf.writeUInt16LE(entries.length, ifdOffset);
  entries.forEach(([tag, type, value], i) => {
    const base = ifdOffset + 2 + i * 12;
    buf.writeUInt16LE(tag, base);
    buf.writeUInt16LE(type, base + 2);
    buf.writeUInt32LE(1, base + 4);
    if (type === 3) buf.writeUInt16LE(value, base + 8);
    else buf.writeUInt32LE(value, base + 8);
  });
  for (let i = 0; i < width * height; i++) {
    buf[pixelOffset + i * 3] = 1;
    buf[pixelOffset + i * 3 + 1] = 2;
    buf[pixelOffset + i * 3 + 2] = 3;
  }
  return buf;
}

describe('embedBase64Image', () => {
  it('embeds PNG bytes', async () => {
    const doc = await PDFDocument.create();
    const image = await embedBase64Image(doc, pngBytes().toString('base64'));
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
  });

  it('embeds JPEG bytes', async () => {
    const doc = await PDFDocument.create();
    const image = await embedBase64Image(doc, jpegBytes().toString('base64'), 'image/png');
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);
  });

  it('converts a 24-bit BMP to an embedded PNG', async () => {
    const doc = await PDFDocument.create();
    const image = await embedBase64Image(doc, bmpBytes(24).toString('base64'), 'image/bmp');
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
  });

  it('converts a 32-bit BMP to an embedded PNG', async () => {
    const doc = await PDFDocument.create();
    const image = await embedBase64Image(doc, bmpBytes(32).toString('base64'));
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
  });

  it('converts a GIF to an embedded PNG', async () => {
    const doc = await PDFDocument.create();
    const image = await embedBase64Image(doc, gifBytes().toString('base64'));
    expect(image.width).toBe(2);
    expect(image.height).toBe(3);
  });

  it('converts an uncompressed TIFF to an embedded PNG', async () => {
    const doc = await PDFDocument.create();
    const image = await embedBase64Image(doc, tiffBytes(1).toString('base64'));
    expect(image.width).toBe(2);
    expect(image.height).toBe(2);
  });

  it('strips whitespace from base64 content', async () => {
    const doc = await PDFDocument.create();
    const base64 = pngBytes().toString('base64');
    const spaced = `${base64.slice(0, 12)}\n ${base64.slice(12)}`;
    const image = await embedBase64Image(doc, spaced);
    expect(image.width).toBe(2);
  });

  it('rejects embedded PDF data', async () => {
    const doc = await PDFDocument.create();
    await expect(embedBase64Image(doc, Buffer.from('%PDF-1.7').toString('base64'))).rejects.toThrow(
      `${ERROR_CODES.IMAGE_LOAD_FAILED.message}: embedded PDF images not supported`
    );
  });

  it('rejects bytes that neither sniff nor decode as an image', async () => {
    const doc = await PDFDocument.create();
    await expect(
      embedBase64Image(doc, Buffer.from('not an image').toString('base64'))
    ).rejects.toThrow(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: unrecognised image format`);
  });

  it('rejects BMP data with an unsupported bit depth', async () => {
    const doc = await PDFDocument.create();
    await expect(embedBase64Image(doc, bmpBytes(8).toString('base64'))).rejects.toThrow(
      `${ERROR_CODES.IMAGE_LOAD_FAILED.message}: BMP decode failed`
    );
  });

  it('rejects truncated GIF data', async () => {
    const doc = await PDFDocument.create();
    await expect(embedBase64Image(doc, Buffer.from('GIF89a').toString('base64'))).rejects.toThrow(
      'GIF too short'
    );
  });

  it('rejects compressed TIFF data', async () => {
    const doc = await PDFDocument.create();
    await expect(embedBase64Image(doc, tiffBytes(5).toString('base64'))).rejects.toThrow(
      'Unsupported TIFF variant'
    );
  });
});

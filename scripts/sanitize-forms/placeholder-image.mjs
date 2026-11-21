
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import canvasPkg from '@napi-rs/canvas';
import pngjs from 'pngjs';

const { createCanvas, GlobalFonts } = canvasPkg;
const { PNG } = pngjs;

export const MARKER = 'sanitize-forms placeholder';
const BMP_MARKER = 'XSPH';
const FONT_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'assets',
  'fonts',
  'DejaVuSans.ttf'
);
const MAX_SIDE = 8000;
let fontRegistered = false;

export function sniffImage(buf) {
  if (buf.length >= 26 && buf.readUInt32BE(0) === 0x89504e47) return sniffPng(buf);
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) return sniffJpeg(buf);
  if (buf.length >= 46 && buf.toString('latin1', 0, 2) === 'BM') {
    return {
      format: 'bmp',
      width: Math.abs(buf.readInt32LE(18)),
      height: Math.abs(buf.readInt32LE(22)),
      bitCount: buf.readUInt16LE(28),
      ppm: [buf.readInt32LE(38), buf.readInt32LE(42)],
    };
  }
  if (buf.length >= 10 && buf.toString('latin1', 0, 3) === 'GIF') {
    return { format: 'gif', width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  return null;
}

function sniffPng(buf) {
  const colorType = buf[25];
  const info = {
    format: 'png',
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    alpha: colorType === 4 || colorType === 6,
    alphaMode: 'none',
    phys: null,
  };
  let transparency = info.alpha;
  for (let pos = 8; pos + 8 <= buf.length; ) {
    const length = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (type === 'tRNS') transparency = true;
    if (type === 'pHYs') info.phys = Buffer.from(buf.subarray(pos, pos + 12 + length));
    if (type === 'IDAT' || type === 'IEND') break;
    pos += 12 + length;
  }
  if (transparency) info.alphaMode = alphaUsage(buf);
  return info;
}

function alphaUsage(buf) {
  try {
    const { data } = PNG.sync.read(buf);
    let binary = false;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] === 0) binary = true;
      else if (data[i] < 255) return 'partial';
    }
    return binary ? 'binary' : 'none';
  } catch {
    return 'partial';
  }
}

const SOF_MARKERS = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function sniffJpeg(buf) {
  const info = { format: 'jpeg', width: 0, height: 0, density: null };
  let pos = 2;
  while (pos + 4 <= buf.length) {
    if (buf[pos] !== 0xff) {
      pos++;
      continue;
    }
    const marker = buf[pos + 1];
    if (marker === 0xff) {
      pos++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      pos += 2;
      continue;
    }
    const length = buf.readUInt16BE(pos + 2);
    if (marker === 0xe0 && buf.toString('latin1', pos + 4, pos + 9) === 'JFIF\0') {
      info.density = Buffer.from(buf.subarray(pos + 11, pos + 16));
    }
    if (SOF_MARKERS.has(marker)) {
      info.height = buf.readUInt16BE(pos + 5);
      info.width = buf.readUInt16BE(pos + 7);
      break;
    }
    if (marker === 0xda) break;
    pos += 2 + length;
  }
  return info;
}

export function makePlaceholder(info) {
  const width = clampSide(info?.width);
  const height = clampSide(info?.height);
  const format = ['png', 'jpeg', 'bmp'].includes(info?.format) ? info.format : 'png';
  const isPng = info?.format === 'png';
  const canvas = draw(width, height, isPng ? info.alphaMode : 'none');
  if (format === 'jpeg') return { format, contentType: 'image/jpeg', data: jpeg(canvas, info) };
  if (format === 'bmp') return { format, contentType: 'image/bmp', data: bmp(canvas, info) };
  const alphaChannel = isPng ? info.alpha || info.alphaMode !== 'none' : false;
  return { format, contentType: 'image/png', data: png(canvas, alphaChannel, isPng ? info : null) };
}

export function hasMarker(buf) {
  const info = sniffImage(buf);
  if (!info) return false;
  if (info.format === 'bmp') return buf.toString('latin1', 6, 10) === BMP_MARKER;
  return buf.subarray(0, 4096).includes(MARKER, 0, 'latin1');
}

function clampSide(n) {
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), MAX_SIDE) : 100;
}

function draw(width, height, alphaMode) {
  if (!fontRegistered) {
    GlobalFonts.registerFromPath(FONT_FILE, 'SanitizePlaceholder');
    fontRegistered = true;
  }
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;
  if (alphaMode === 'binary' && width > 4 && height > 4) {
    const inset = Math.max(1, Math.round(Math.min(width, height) * 0.08));
    [x, y, w, h] = [inset, inset, width - 2 * inset, height - 2 * inset];
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
  }
  ctx.fillStyle = alphaMode === 'partial' ? 'rgba(200, 200, 200, 0.6)' : '#e4e4e4';
  ctx.fillRect(x, y, w, h);

  const line = Math.max(1, Math.round(Math.min(w, h) / 60));
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = line;
  ctx.strokeRect(x + line / 2, y + line / 2, w - line, h - line);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w, y + h);
  ctx.moveTo(x + w, y);
  ctx.lineTo(x, y + h);
  ctx.stroke();

  const label = `PLACEHOLDER ${width}×${height}`;
  const size = Math.floor(Math.min(h * 0.35, (w * 0.9) / (label.length * 0.62)));
  if (size >= 6) {
    ctx.font = `${size}px SanitizePlaceholder`;
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x + (w - textWidth) / 2 - size * 0.3, y + h / 2 - size * 0.7, textWidth + size * 0.6, size * 1.4);
    ctx.fillStyle = '#505050';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2);
  }
  return canvas;
}

function rgba(canvas) {
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

function png(canvas, transparent, original) {
  const image = new PNG({ width: canvas.width, height: canvas.height });
  image.data = rgba(canvas);
  const encoded = PNG.sync.write(image, { colorType: transparent ? 6 : 2 });
  const extra = [chunk('tEXt', Buffer.from(`Software\0${MARKER}`, 'latin1'))];
  if (original?.phys) extra.push(original.phys);
  const afterIhdr = 8 + 25;
  return Buffer.concat([encoded.subarray(0, afterIhdr), ...extra, encoded.subarray(afterIhdr)]);
}

function jpeg(canvas, original) {
  const encoded = Buffer.from(canvas.encodeSync('jpeg', 70));
  let insertAt = 2;
  let head = encoded.subarray(0, 2);
  let rest = encoded.subarray(2);
  if (encoded[2] === 0xff && encoded[3] === 0xe0) {
    insertAt = 4 + encoded.readUInt16BE(4);
    if (original?.density && encoded.toString('latin1', 6, 11) === 'JFIF\0') original.density.copy(encoded, 13);
    head = encoded.subarray(0, insertAt);
    rest = encoded.subarray(insertAt);
  } else if (original?.density) {
    head = Buffer.concat([
      head,
      Buffer.from([0xff, 0xe0, 0x00, 0x10]),
      Buffer.from('JFIF\0', 'latin1'),
      Buffer.from([0x01, 0x01]),
      original.density,
      Buffer.from([0x00, 0x00]),
    ]);
  }
  const text = Buffer.from(MARKER, 'latin1');
  const length = Buffer.alloc(2);
  length.writeUInt16BE(text.length + 2);
  return Buffer.concat([head, Buffer.from([0xff, 0xfe]), length, text, rest]);
}

function bmp(canvas, original) {
  const { width, height } = canvas;
  const pixels = rgba(canvas);
  const bytesPerPixel = original?.bitCount === 32 ? 4 : 3;
  const row = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const buf = Buffer.alloc(54 + row * height);
  buf.write('BM', 0, 'latin1');
  buf.writeUInt32LE(buf.length, 2);
  buf.write(BMP_MARKER, 6, 'latin1');
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(width, 18);
  buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(bytesPerPixel * 8, 28);
  buf.writeUInt32LE(row * height, 34);
  const [xppm, yppm] = original?.ppm ?? [2835, 2835];
  buf.writeInt32LE(xppm, 38);
  buf.writeInt32LE(yppm, 42);
  for (let y = 0; y < height; y++) {
    const rowStart = 54 + (height - 1 - y) * row;
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const d = rowStart + x * bytesPerPixel;
      buf[d] = pixels[s + 2];
      buf[d + 1] = pixels[s + 1];
      buf[d + 2] = pixels[s];
      if (bytesPerPixel === 4) buf[d + 3] = pixels[s + 3];
    }
  }
  return buf;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, crc]);
}

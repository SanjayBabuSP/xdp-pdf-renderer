import { resolveImageFormat, sniffImageFormat } from '../../../src/rendering/image-sniff';

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('sniffImageFormat', () => {
  it('returns unknown for short input', () => {
    expect(sniffImageFormat(bytes([]))).toBe('unknown');
    expect(sniffImageFormat(bytes([0x89, 0x50, 0x4e]))).toBe('unknown');
  });

  it('detects PNG, JPEG, GIF and BMP signatures', () => {
    expect(sniffImageFormat(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffImageFormat(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageFormat(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('gif');
    expect(sniffImageFormat(bytes([0x42, 0x4d, 0x00, 0x00]))).toBe('bmp');
  });

  it('detects both TIFF byte orders', () => {
    expect(sniffImageFormat(bytes([0x49, 0x49, 0x2a, 0x00]))).toBe('tiff');
    expect(sniffImageFormat(bytes([0x4d, 0x4d, 0x00, 0x2a]))).toBe('tiff');
  });

  it('detects JPEG 2000 signatures', () => {
    expect(sniffImageFormat(bytes([0x00, 0x00, 0x00, 0x0c, 0x6a, 0x50]))).toBe('jpx');
    expect(sniffImageFormat(bytes([0xff, 0x4f, 0xff, 0x51]))).toBe('jpx');
    expect(sniffImageFormat(bytes([0x00, 0x00, 0x00, 0x0c, 0x00, 0x00]))).toBe('unknown');
  });

  it('detects PDF and accepts Buffer input', () => {
    expect(sniffImageFormat(Buffer.from('%PDF-1.7'))).toBe('pdf');
    expect(sniffImageFormat(Buffer.from('GIF89a'))).toBe('gif');
  });

  it('returns unknown for unrecognised bytes', () => {
    expect(sniffImageFormat(bytes([0x01, 0x02, 0x03, 0x04]))).toBe('unknown');
  });
});

describe('resolveImageFormat', () => {
  it('prefers sniffed bytes over a conflicting content-type hint', () => {
    expect(resolveImageFormat(bytes([0x89, 0x50, 0x4e, 0x47]), 'image/jpeg')).toBe('png');
    expect(resolveImageFormat(Buffer.from('%PDF-1.7'), 'image/png')).toBe('pdf');
  });

  it.each([
    { hint: 'image/png', expected: 'png' },
    { hint: 'IMAGE/JPEG', expected: 'jpeg' },
    { hint: 'image/jpg', expected: 'jpeg' },
    { hint: 'image/gif', expected: 'gif' },
    { hint: 'image/bmp', expected: 'bmp' },
    { hint: 'image/tiff', expected: 'tiff' },
    { hint: 'image/jp2', expected: 'jpx' },
    { hint: 'image/jpx', expected: 'jpx' },
    { hint: 'image/jpeg2000', expected: 'jpeg' },
  ])('falls back to the $hint hint', ({ hint, expected }) => {
    expect(resolveImageFormat(bytes([0, 0, 0, 0]), hint)).toBe(expected);
  });

  it('returns unknown when neither bytes nor hint identify the image', () => {
    expect(resolveImageFormat(bytes([0, 0, 0, 0]))).toBe('unknown');
    expect(resolveImageFormat(bytes([0, 0, 0, 0]), 'application/octet-stream')).toBe('unknown');
    expect(resolveImageFormat(bytes([0, 0, 0, 0]), '')).toBe('unknown');
  });
});

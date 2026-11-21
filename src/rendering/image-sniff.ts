export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'jpx' | 'pdf' | 'unknown';

export function sniffImageFormat(bytes: Uint8Array | Buffer): ImageFormat {
  if (bytes.length < 4) return 'unknown';

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';

  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';

  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38)
    return 'gif';

  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';

  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  )
    return 'tiff';

  if (
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x0c) ||
    (bytes[0] === 0xff && bytes[1] === 0x4f)
  ) {
    if (bytes[4] === 0x6a && bytes[5] === 0x50) return 'jpx';
    if (bytes[0] === 0xff && bytes[1] === 0x4f) return 'jpx';
  }

  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46)
    return 'pdf';

  return 'unknown';
}

export function resolveImageFormat(
  bytes: Uint8Array | Buffer,
  contentTypehint?: string
): ImageFormat {
  const sniffed = sniffImageFormat(bytes);
  if (sniffed !== 'unknown') return sniffed;

  const ct = (contentTypehint ?? '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('bmp')) return 'bmp';
  if (ct.includes('tiff')) return 'tiff';
  if (ct.includes('jp2') || ct.includes('jpx') || ct.includes('jpeg2000')) return 'jpx';
  return 'unknown';
}

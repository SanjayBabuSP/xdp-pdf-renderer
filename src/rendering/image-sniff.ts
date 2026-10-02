/**
 * Image format sniffing by magic bytes.
 *
 * Adobe's renderer uses magic-byte detection rather than trusting the
 * contentType attribute (`jfgraphic_disasm.c:17878` FUN_1980f8b0).
 * This avoids rendering failures caused by incorrect MIME declarations in XDP.
 *
 * Magic bytes (jfgraphic:19577 importer table):
 *   PNG  : 89 50 4E 47 0D 0A 1A 0A
 *   JPEG : FF D8
 *   GIF  : 47 49 46 38 (GIF8)
 *   BMP  : 42 4D (BM)
 *   TIFF : 49 49 2A 00 (LE) or 4D 4D 00 2A (BE)
 *   PDF  : 25 50 44 46 (%PDF) — kept in unsupported list
 */

/** Format detected by magic-byte sniffing. */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'bmp' | 'tiff' | 'jpx' | 'pdf' | 'unknown';

/**
 * Detect the image format from the raw byte content.
 * evidence: jfgraphic_disasm.c:17878 — sniffs before consulting contentType.
 */
export function sniffImageFormat(bytes: Uint8Array | Buffer): ImageFormat {
  if (bytes.length < 4) return 'unknown';

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) return 'png';

  // JPEG: FF D8
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpeg';

  // GIF: GIF8 (GIF87a or GIF89a)
  if (
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) return 'gif';

  // BMP: BM
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';

  // TIFF: little-endian (II\x2a\x00) or big-endian (MM\x00\x2a)
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) return 'tiff';

  // JPEG 2000: JP2 signature box (00 00 00 0C 6A 50 20 20) or raw codestream (FF 4F).
  if (
    (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x00 && bytes[3] === 0x0c) ||
    (bytes[0] === 0xff && bytes[1] === 0x4f)
  ) {
    // Distinguish from other length-prefixed containers by the `jP` marker.
    if (bytes[4] === 0x6a && bytes[5] === 0x50) return 'jpx';
    if (bytes[0] === 0xff && bytes[1] === 0x4f) return 'jpx';
  }

  // PDF: %PDF
  if (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  ) return 'pdf';

  return 'unknown';
}

/**
 * Resolve the effective image format, preferring magic-byte detection
 * (jfgraphic:17878) and falling back to the contentType hint.
 */
export function resolveImageFormat(bytes: Uint8Array | Buffer, contentTypehint?: string): ImageFormat {
  const sniffed = sniffImageFormat(bytes);
  if (sniffed !== 'unknown') return sniffed;

  // Fall back to contentType
  const ct = (contentTypehint ?? '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpeg';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('bmp')) return 'bmp';
  if (ct.includes('tiff')) return 'tiff';
  if (ct.includes('jp2') || ct.includes('jpx') || ct.includes('jpeg2000')) return 'jpx';
  return 'unknown';
}

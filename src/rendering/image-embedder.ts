import { PDFDocument, PDFImage } from 'pdf-lib';
import { ERROR_CODES } from '../errors/error-codes';

/** Embed a base64-encoded image into a pdf-lib PDFDocument. */
export async function embedBase64Image(
  doc: PDFDocument,
  base64Content: string,
  contentType: string
): Promise<PDFImage> {
  const cleanBase64 = base64Content.replace(/\s+/g, '');
  const bytes = Buffer.from(cleanBase64, 'base64');

  if (contentType === 'image/png' || contentType.includes('png')) {
    return doc.embedPng(bytes);
  }
  if (contentType === 'image/jpeg' || contentType === 'image/jpg' || contentType.includes('jpeg')) {
    return doc.embedJpg(bytes);
  }

  // BMP, GIF, TIFF and other non-embeddable formats — pdf-lib has no native support
  if (contentType === 'image/bmp' || contentType.includes('bmp') ||
      contentType === 'image/gif' || contentType.includes('gif') ||
      contentType === 'image/tiff' || contentType.includes('tiff')) {
    throw new Error(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: ${contentType} is not supported by pdf-lib`);
  }

  // Attempt PNG as fallback for unknown types
  try {
    return doc.embedPng(bytes);
  } catch {
    throw new Error(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: unsupported contentType ${contentType}`);
  }
}

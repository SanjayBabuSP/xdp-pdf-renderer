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

  // Attempt PNG as default
  try {
    return doc.embedPng(bytes);
  } catch {
    throw new Error(`${ERROR_CODES.IMAGE_LOAD_FAILED.message}: unsupported contentType ${contentType}`);
  }
}

import type { PDFPage } from 'pdf-lib';
import type { DrawNode } from '../../types';
import { embedBase64Image } from '../image-embedder';
import { computeImageRect } from '../image-scaler';

export async function renderImage(
  pdfPage: PDFPage,
  value: NonNullable<DrawNode['value']>,
  x: number,
  y: number,
  w: number,
  h: number
): Promise<void> {
  if (!value.content) return;
  const doc = pdfPage.doc;
  try {
    const image = await embedBase64Image(doc, value.content, value.contentType);

    const rect = computeImageRect(
      value.aspectMode,
      w,
      h,
      {
        pixelW: image.width,
        pixelH: image.height,
        xdpi: value.xdpi,
        ydpi: value.ydpi,
      },
      { hAlign: value.hAlign, vAlign: value.vAlign }
    );

    pdfPage.drawImage(image, {
      x: x + rect.offsetX,
      y: y + rect.offsetY,
      width: rect.drawW,
      height: rect.drawH,
    });
  } catch {
    return;
  }
}

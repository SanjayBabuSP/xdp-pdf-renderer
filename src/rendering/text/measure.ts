
import type { PDFFont } from 'pdf-lib';

export interface MeasureOptions {
  charSpacing?: number;
  wordSpacing?: number;
  kerning?: boolean;
  horizontalScale?: number;
}

export const APPROX_CHAR_WIDTH_FACTOR = 0.5;

export function quantizeAdvance(widthPt: number): number {
  if (!Number.isFinite(widthPt)) return widthPt;
  const scaled = Math.trunc(widthPt * 1000);
  const nudged = scaled + (scaled < 0 || widthPt < 0 ? -1.75 : 1.75);
  return Math.trunc(nudged) / 1000;
}

export function measureText(
  text: string,
  fontSize: number,
  font?: PDFFont,
  opts: MeasureOptions = {}
): number {
  if (!text) return 0;

  let width: number;
  if (font && typeof font.widthOfTextAtSize === 'function') {
    try {
      if (opts.kerning === false) {
        width = 0;
        for (const ch of text) width += quantizeAdvance(font.widthOfTextAtSize(ch, fontSize));
      } else {
        width = quantizeAdvance(font.widthOfTextAtSize(text, fontSize));
      }
    } catch {
      width = NaN;
    }
    if (Number.isNaN(width) || width < 0) width = NaN;
  } else {
    width = NaN;
  }
  if (!Number.isFinite(width)) {
    width = text.length * fontSize * APPROX_CHAR_WIDTH_FACTOR;
  }

  const hScale = opts.horizontalScale;
  if (hScale !== undefined && hScale !== 1) width *= hScale;

  const charSpacing = opts.charSpacing ?? 0;
  if (charSpacing !== 0) {
    width += charSpacing * Math.max([...text].length - 1, 0);
  }
  const wordSpacing = opts.wordSpacing ?? 0;
  if (wordSpacing !== 0) {
    const spaces = [...text].filter((ch) => ch === ' ').length;
    width += wordSpacing * spaces;
  }
  return width;
}

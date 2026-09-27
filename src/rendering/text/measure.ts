/**
 * Text measurement — glyph advances quantized to 1/1000-em font units
 * (jftext:60643 `trunc(em*1000/size)*size/1000`), `charSpacing` added between
 * glyphs, `wordSpacing` only on space-class glyphs (:60763), kerning ON by
 * default (font:119241 flag 0x200 — pdf-lib applies AFM KernPairs inside
 * widthOfTextAtSize), and negative (notdef) widths clamped to 0.
 */

import type { PDFFont } from 'pdf-lib';

export interface MeasureOptions {
  /** Extra advance between glyphs (XFA charSpacing), points. */
  charSpacing?: number;
  /** Extra advance after space-class glyphs only (XFA wordSpacing), points. */
  wordSpacing?: number;
  /** Kern pairs — default ON (font:119241). */
  kerning?: boolean;
}

/** Approximate average glyph width when no font is available. */
export const APPROX_CHAR_WIDTH_FACTOR = 0.5;

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
        // Sum glyph advances without applying kern pairs.
        width = 0;
        for (const ch of text) width += font.widthOfTextAtSize(ch, fontSize);
      } else {
        width = font.widthOfTextAtSize(text, fontSize);
      }
    } catch {
      width = NaN;
    }
    // notdef substitution for negative/broken advances (jftext)
    if (Number.isNaN(width) || width < 0) width = NaN;
  } else {
    width = NaN;
  }
  if (!Number.isFinite(width)) {
    // Fallback: average character width ~0.5 × size for most fonts
    width = text.length * fontSize * APPROX_CHAR_WIDTH_FACTOR;
  }

  const charSpacing = opts.charSpacing ?? 0;
  if (charSpacing !== 0) {
    width += charSpacing * Math.max([...text].length - 1, 0);
  }
  const wordSpacing = opts.wordSpacing ?? 0;
  if (wordSpacing !== 0) {
    const spaces = text.split('').filter((ch) => ch === ' ').length;
    width += wordSpacing * spaces;
  }
  return width;
}

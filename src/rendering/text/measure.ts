/**
 * Text measurement — glyph advances from the font's own width table,
 * `charSpacing` added between glyphs, `wordSpacing` only on space-class
 * glyphs, kerning ON by default (font:119241 flag 0x200 — pdf-lib applies AFM
 * KernPairs inside widthOfTextAtSize), and negative (notdef) widths clamped
 * to 0.
 *
 * An optional horizontal scale condenses the result. This is how a condensed
 * face is represented when no condensed font file is available: Adobe scales a
 * condensed face rather than giving it its own base-14 slot (no `Arial Narrow`
 * entry exists in `Designer.xdc`'s `<seq>` table), and the scale must be
 * applied identically at measure time and at draw time or text overflows its
 * own box.
 */

import type { PDFFont } from 'pdf-lib';

export interface MeasureOptions {
  /** Extra advance between glyphs (XFA charSpacing), points. */
  charSpacing?: number;
  /** Extra advance after space-class glyphs only (XFA wordSpacing), points. */
  wordSpacing?: number;
  /** Kern pairs — default ON (font:119241). */
  kerning?: boolean;
  /**
   * Horizontal scale applied to the total advance, 1 = none. Used for
   * condensed faces resolved to a full-width font (see `standard-fonts.ts`).
   */
  horizontalScale?: number;
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

  // Glyph advances scale with the face; `charSpacing`/`wordSpacing` are
  // absolute point distances in XFA and must not be condensed. So the scale is
  // applied to the font's advance only, before the spacings are added.
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

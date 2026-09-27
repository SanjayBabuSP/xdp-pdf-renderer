/**
 * Line metrics — Adobe default line advance is 1.2 × fontSize
 * (jfFontItem::getDefaultSpacing, font:10517) and the first baseline of a
 * top-aligned block sits one ascent below the box top.
 *
 * Model: every line occupies a box of height `advance`; `ascent` is measured
 * from the top of that box to the baseline, the remainder (advance − ascent)
 * is the descent below the baseline. Stacked blocks therefore have
 * blockHeight = count × advance and baselines step downward by `advance`.
 */

import type { PDFFont } from 'pdf-lib';

/** Default line advance factor (font:10517). */
export const DEFAULT_LINE_ADVANCE_FACTOR = 1.2;

/** Fallback ascent factor when the font exposes no metrics (≈ Helvetica). */
export const DEFAULT_ASCENT_FACTOR = 0.8;

export function defaultLineAdvance(fontSize: number): number {
  return fontSize * DEFAULT_LINE_ADVANCE_FACTOR;
}

/** Fallback ascent (0.8 × size) when no font metrics are available. */
export function defaultAscent(fontSize: number): number {
  return fontSize * DEFAULT_ASCENT_FACTOR;
}

/**
 * Ascent for `font` at `fontSize`: standard (AFM) fonts publish Ascender in
 * 1/1000 units; otherwise fall back to 0.8 × size.
 */
export function fontAscent(font: PDFFont | undefined, fontSize: number): number {
  const afm = (font as unknown as { embedder?: { font?: { Ascender?: number } } })
    ?.embedder?.font;
  if (afm && typeof afm.Ascender === 'number' && Number.isFinite(afm.Ascender)) {
    return (afm.Ascender / 1000) * fontSize;
  }
  return defaultAscent(fontSize);
}

/**
 * Descent for `font` at `fontSize` — derived from the font's total height
 * (ascender − descender) minus the ascent; fallback 0.2 × size.
 */
export function fontDescent(font: PDFFont | undefined, fontSize: number): number {
  if (font && typeof font.heightAtSize === 'function') {
    try {
      const total = font.heightAtSize(fontSize);
      const descent = total - fontAscent(font, fontSize);
      if (Number.isFinite(descent) && descent >= 0) return descent;
    } catch {
      // fall through to default
    }
  }
  return fontSize * 0.2;
}

export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface LineLayout {
  /** n × advance — the height of the laid-out block. */
  blockHeight: number;
  /** Baseline y per line; index 0 is the FIRST (topmost) line. */
  baselines: number[];
}

/**
 * Lay `count` lines of `fontSize` inside the vertical span
 * [box.bottom, box.top]. The block is positioned per `align` (top: block top
 * at box.top; bottom: block bottom at box.bottom; middle: centered) and
 * baselines run downward from blockTop − ascent.
 */
export function layoutLines(
  count: number,
  fontSize: number,
  box: { top: number; bottom: number },
  align: VerticalAlign = 'top',
  font?: PDFFont
): LineLayout {
  const advance = defaultLineAdvance(fontSize);
  const ascent = fontAscent(font, fontSize);
  const blockHeight = count * advance;
  const boxHeight = box.top - box.bottom;

  let blockTop: number;
  if (align === 'bottom') {
    blockTop = box.bottom + blockHeight;
  } else if (align === 'middle') {
    blockTop = box.bottom + (boxHeight + blockHeight) / 2;
  } else {
    blockTop = box.top;
  }

  const baselines: number[] = [];
  for (let i = 0; i < count; i++) {
    baselines.push(blockTop - ascent - i * advance);
  }
  return { blockHeight, baselines };
}

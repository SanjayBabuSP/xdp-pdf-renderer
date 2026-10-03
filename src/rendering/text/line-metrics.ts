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
import type { ParaSpec } from '../../types';

/** Default line advance factor (font:10517). */
export const DEFAULT_LINE_ADVANCE_FACTOR = 1.2;

/** Resolved `<para>` metrics applied to a text block. */
export interface ParaMetrics {
  /** Line advance in points (`lineHeight` override, else 1.2 × size). */
  lineAdvance: number;
  spaceAbove: number;
  spaceBelow: number;
  textIndent: number;
  marginLeft: number;
  marginRight: number;
}

/**
 * Resolve `<para>` metrics for a font size. `lineHeight` (points) overrides the
 * 1.2 × size default; the remaining values are direct point offsets.
 * evidence: xfa.dll atoms `lineHeight`/`spaceAbove`/`spaceBelow`/`textIndent`/
 * `marginLeft`/`marginRight`; jfTextAttr::Spacing/MarginL/MarginR/SpaceBefore/
 * SpaceAfter (jftext_disasm.c:3920/2888/2957/3852/3782).
 */
export function paraMetrics(para: ParaSpec | undefined, fontSize: number): ParaMetrics {
  return {
    lineAdvance: para?.lineHeight ?? defaultLineAdvance(fontSize),
    spaceAbove: para?.spaceAbove ?? 0,
    spaceBelow: para?.spaceBelow ?? 0,
    textIndent: para?.textIndent ?? 0,
    marginLeft: para?.marginLeft ?? 0,
    marginRight: para?.marginRight ?? 0,
  };
}

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

export interface LineLayoutOptions {
  /**
   * `<para lineHeight>` override for the per-line advance, in points.
   * evidence: xfa.dll atom `lineHeight`; jfTextAttr::Spacing (jftext:3920).
   */
  lineAdvance?: number;
  /** `<para spaceAbove>` — padding above the block, points. */
  paddingTop?: number;
  /** `<para spaceBelow>` — padding below the block, points. */
  paddingBottom?: number;
}

/**
 * Lay `count` lines of `fontSize` inside the vertical span
 * [box.bottom, box.top]. The block is positioned per `align` (top: block top
 * at box.top; bottom: block bottom at box.bottom; middle: centered) and
 * baselines run downward from blockTop − ascent.
 *
 * `opts.paddingTop`/`paddingBottom` shrink the usable box before alignment
 * (Adobe `spaceAbove`/`spaceBelow`), and `opts.lineAdvance` replaces the
 * default 1.2 × size advance (`<para lineHeight>`).
 */
export function layoutLines(
  count: number,
  fontSize: number,
  box: { top: number; bottom: number },
  align: VerticalAlign = 'top',
  font?: PDFFont,
  opts: LineLayoutOptions = {}
): LineLayout {
  const advance = opts.lineAdvance ?? defaultLineAdvance(fontSize);
  const ascent = fontAscent(font, fontSize);
  const blockHeight = count * advance;
  const boxTop = box.top - (opts.paddingTop ?? 0);
  const boxBottom = box.bottom + (opts.paddingBottom ?? 0);
  const boxHeight = boxTop - boxBottom;

  let blockTop: number;
  if (align === 'bottom') {
    blockTop = boxBottom + blockHeight;
  } else if (align === 'middle') {
    blockTop = boxBottom + (boxHeight + blockHeight) / 2;
  } else {
    blockTop = boxTop;
  }

  const baselines: number[] = [];
  for (let i = 0; i < count; i++) {
    baselines.push(blockTop - ascent - i * advance);
  }
  return { blockHeight, baselines };
}

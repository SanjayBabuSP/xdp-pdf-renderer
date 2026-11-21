import type { PDFFont } from 'pdf-lib';
import type { ParaSpec } from '../../types';

export const DEFAULT_LINE_ADVANCE_FACTOR = 1.2;

export interface ParaMetrics {
  lineAdvance: number;
  spaceAbove: number;
  spaceBelow: number;
  textIndent: number;
  marginLeft: number;
  marginRight: number;
}

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

export const DEFAULT_ASCENT_FACTOR = 0.8;

export function defaultLineAdvance(fontSize: number): number {
  return fontSize * DEFAULT_LINE_ADVANCE_FACTOR;
}

export function defaultAscent(fontSize: number): number {
  return fontSize * DEFAULT_ASCENT_FACTOR;
}

function rawAfmAscentEm(font: PDFFont | undefined): number | undefined {
  const afm = (font as unknown as { embedder?: { font?: { Ascender?: number } } })?.embedder?.font;
  if (afm && typeof afm.Ascender === 'number' && Number.isFinite(afm.Ascender)) {
    return afm.Ascender / 1000;
  }
  return undefined;
}

function rawAfmDescentEm(font: PDFFont | undefined, fontSize: number): number | undefined {
  if (font && typeof font.heightAtSize === 'function') {
    try {
      const rawA = rawAfmAscentEm(font);
      if (rawA !== undefined) {
        const total = font.heightAtSize(fontSize) / fontSize;
        const descent = total - rawA;
        if (Number.isFinite(descent) && descent >= 0) return descent;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export function fontAscent(font: PDFFont | undefined, fontSize: number): number {
  const rawA = rawAfmAscentEm(font);
  if (rawA === undefined) return defaultAscent(fontSize);
  const rawD = rawAfmDescentEm(font, fontSize) ?? 0.2;
  return Math.max(rawA, 1 - rawD) * fontSize;
}

export function fontDescent(font: PDFFont | undefined, fontSize: number): number {
  const rawD = rawAfmDescentEm(font, fontSize);
  if (rawD !== undefined) return rawD * fontSize;
  return fontSize * 0.2;
}

export type VerticalAlign = 'top' | 'middle' | 'bottom';

export interface LineLayout {
  blockHeight: number;
  baselines: number[];
}

export interface LineLayoutOptions {
  lineAdvance?: number;
  paddingTop?: number;
  paddingBottom?: number;
}

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
  const descent = fontDescent(font, fontSize);
  const tightSingle = ascent + descent;
  const useTight = count === 1 && (align === 'middle' || align === 'bottom');
  const blockHeight = useTight ? tightSingle : count * advance;
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

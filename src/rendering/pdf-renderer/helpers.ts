import {
  PDFNumber,
  PDFOperator,
  PDFOperatorNames,
  clip,
  endPath,
  grayscale,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
} from 'pdf-lib';
import type { PDFPage, PDFFont, PDFPageDrawTextOptions, RGB } from 'pdf-lib';
import type { MarginSpec, RgbColor } from '../../types';
import { grayLevel, isGray } from '../fill-paint';
import { sanitizeTextForFont } from '../text/glyph-coverage';
import { breakLines } from '../text/line-breaker';
import { measureText } from '../text/measure';
import { isCondensedFamily, NARROW_SCALE } from '../standard-fonts';

export function toPdfColor(color?: RgbColor): RGB {
  if (!color) return rgb(0, 0, 0);
  if (isGray(color)) return grayscale(grayLevel(color)) as unknown as RGB;
  return rgb(color.r / 255, color.g / 255, color.b / 255);
}

export function flipY(y: number, h: number, pageH: number): number {
  return pageH - y - h;
}

export function clipOverflow(
  pdfPage: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  exceeds: boolean
): boolean {
  if (!exceeds) return false;
  pdfPage.pushOperators(pushGraphicsState(), rectangle(x, y, w, h), clip(), endPath());
  return true;
}

export function endOverflowClip(pdfPage: PDFPage, active: boolean): void {
  if (active) pdfPage.pushOperators(popGraphicsState());
}

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

export function getMargins(margin?: MarginSpec): {
  top: number;
  right: number;
  bottom: number;
  left: number;
} {
  if (!margin) return { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    top: margin.topInset ?? 0,
    right: margin.rightInset ?? 0,
    bottom: margin.bottomInset ?? 0,
    left: margin.leftInset ?? 0,
  };
}

export function measureTextWidth(
  text: string,
  fontSize: number,
  font?: PDFFont,
  horizontalScale?: number
): number {
  return measureText(text, fontSize, font, { horizontalScale });
}

export function scaleForFamily(family: string | undefined): number | undefined {
  return isCondensedFamily(family) ? NARROW_SCALE : undefined;
}

function setTextHorizontalScale(percent: number): PDFOperator {
  return PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(percent)]);
}

export function drawScaledText(
  pdfPage: PDFPage,
  text: string,
  options: PDFPageDrawTextOptions,
  horizontalScale?: number
): void {
  const font = options.font;
  const safeText = font === undefined ? text : sanitizeTextForFont(text, font);
  if (!safeText) return;

  if (horizontalScale === undefined || horizontalScale === 1) {
    pdfPage.drawText(safeText, options);
    return;
  }
  pdfPage.pushOperators(setTextHorizontalScale(Math.round(horizontalScale * 100)));
  try {
    pdfPage.drawText(safeText, options);
  } finally {
    pdfPage.pushOperators(setTextHorizontalScale(100));
  }
}

export function wrapText(
  text: string,
  fontSize: number,
  maxWidth: number,
  font?: PDFFont,
  opts: { firstLineIndent?: number; horizontalScale?: number } = {}
): string[] {
  if (!text) return [text];
  if (maxWidth <= 0) return text.split(/\r\n|\r|\n/);
  const measure = (s: string): number => measureTextWidth(s, fontSize, font, opts.horizontalScale);
  return breakLines(text, maxWidth, measure, { firstLineIndent: opts.firstLineIndent });
}

export function captionTrailingSymbol(
  text: string | undefined,
  richHtml: string | undefined
): { label: string; spacer: string; symbol: string; underline: boolean } | undefined {
  if (!text || !richHtml || !/xfa-spacerun|spacerun/i.test(richHtml)) return undefined;
  const trimmed = text.trimEnd();
  const m = trimmed.match(/^(.*\S)(\s*)([+\-±])$/);
  if (!m) return undefined;
  const label = m[1];
  const spacer = m[2];
  const symbol = m[3];
  if (!label) return undefined;
  return { label, spacer, symbol, underline: /underline/i.test(richHtml) };
}

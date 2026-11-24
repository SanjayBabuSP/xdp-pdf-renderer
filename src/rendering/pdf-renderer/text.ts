import { rgb } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type { DrawNode } from '../../types';
import { PAGE_NUMBER_TOKEN } from '../../domain/mapping/resolve-embeds';
import { effectiveRichFontSize } from '../../domain/layout/position-engine';
import type { FontManager } from '../font-manager';
import { parseRichText } from '../rich-text-parser';
import { sanitizeTextForFont } from '../text/glyph-coverage';
import { breakLinesInfo } from '../text/line-breaker';
import { alignFragmentBand, fontDescent, layoutLines, paraMetrics } from '../text/line-metrics';
import { measureText } from '../text/measure';
import { horizontalOffsetX, mapJustH, mapJustV } from '../text/justifier';
import {
  layoutRunBaselines,
  layoutRunLines,
  runBlockHeight,
  type StyledRun,
} from '../text/run-flow';
import {
  clipOverflow,
  drawScaledText,
  endOverflowClip,
  measureTextWidth,
  scaleForFamily,
  stripHtml,
  toPdfColor,
} from './helpers';

export async function renderRichText(
  pdfPage: PDFPage,
  node: DrawNode,
  x: number,
  y: number,
  fontManager: FontManager,
  width?: number,
  height?: number,
  pageIndex = 0
): Promise<void> {
  const content = (node.value?.content ?? '').replace(
    new RegExp(PAGE_NUMBER_TOKEN, 'g'),
    String(pageIndex + 1)
  );
  const runs = parseRichText(content);
  const boxH = height ?? 0;
  const anchor = node.originalBox;
  const boxTop = anchor ? y + boxH - anchor.topOffset : y + boxH;
  const boxBottom = anchor ? boxTop - anchor.height : y;

  if (runs.length === 0) {
    const text = stripHtml(content);
    if (!text) return;
    const fontSize = node.font?.size ?? 10;
    const baseFamily = node.font?.family ?? 'Helvetica';
    const drawScale = scaleForFamily(baseFamily);
    const font = await fontManager.getSafeFont(
      text,
      baseFamily,
      node.font?.weight,
      node.font?.posture
    );
    const safeText = sanitizeTextForFont(text, font);
    if (!safeText) return;
    const wrapWidth = width ?? 500;
    const pm = paraMetrics(node.para, fontSize);
    const justH = mapJustH(node.para?.hAlign);
    const justV = mapJustV(node.para?.vAlign);
    const verticalAlign: 'top' | 'middle' | 'bottom' =
      justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';
    const textX = x + pm.marginLeft;
    const textW = Math.max(wrapWidth - pm.marginLeft - pm.marginRight, 0);
    const wrapped = breakLinesInfo(
      safeText,
      textW,
      (s) => measureTextWidth(s, fontSize, font, drawScale),
      { firstLineIndent: pm.textIndent }
    );
    const lines = wrapped.map((line) => line.text);
    const firstLine = Math.min(lines.length, Math.max(0, node.textLineRange?.start ?? 0));
    const lastLine = Math.min(
      lines.length,
      Math.max(firstLine, node.textLineRange?.end ?? lines.length)
    );
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: boxTop, bottom: boxBottom },
      verticalAlign,
      font,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const clipped = clipOverflow(
      pdfPage,
      textX,
      y,
      textW,
      boxH,
      node.textLineRange != null ||
        lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > boxH + 0.5
    );

    for (let i = firstLine; i < lastLine; i++) {
      const line = lines[i];
      const lineY = baselines[i];
      const indent = i === 0 || wrapped[i - 1].paragraphEnd ? pm.textIndent : 0;
      const lineAvail = Math.max(textW - indent, 0);
      const lineWidth = measureTextWidth(line, fontSize, font, drawScale);
      drawScaledText(
        pdfPage,
        line,
        {
          x: textX + indent + horizontalOffsetX(justH, lineAvail, lineWidth),
          y: lineY,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        },
        drawScale
      );
    }
    endOverflowClip(pdfPage, clipped);
    return;
  }

  const baseFontSize = effectiveRichFontSize(node.font, runs);
  const baseFontFamily = node.font?.family ?? 'Helvetica';
  const wrapWidth = width ?? 500;
  const pm = paraMetrics(node.para, baseFontSize);
  const justH = mapJustH(node.para?.hAlign);
  const justV = mapJustV(node.para?.vAlign);
  const verticalAlign: 'top' | 'middle' | 'bottom' =
    justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';
  const textX = x + pm.marginLeft;
  const textW = Math.max(wrapWidth - pm.marginLeft - pm.marginRight, 0);

  const styled: StyledRun[] = [];
  for (const run of runs) {
    const family = run.fontFamily ?? baseFontFamily;
    const font = await fontManager.getSafeFont(
      run.text,
      family,
      run.bold ? 'bold' : node.font?.weight,
      run.italic ? 'italic' : node.font?.posture
    );
    const text = sanitizeTextForFont(run.text, font);
    if (!text) continue;
    styled.push({
      text,
      size: run.fontSize ?? baseFontSize,
      font,
      color: run.color,
      underline: run.underline,
      scale: scaleForFamily(family),
      lineAdvance: run.lineAdvance,
      marginTop: run.marginTop,
      marginBottom: run.marginBottom,
      spacerOnly: run.spacerOnly,
    });
  }

  const lines = layoutRunLines(styled, {
    maxWidth: wrapWidth,
    baseSize: baseFontSize,
    measure: (text, run) =>
      measureText(text, styled[run].size, styled[run].font, {
        horizontalScale: styled[run].scale,
      }),
    paragraph: {
      marginLeft: pm.marginLeft,
      marginRight: pm.marginRight,
      firstLineIndent: pm.textIndent,
      justify: justH,
    },
  });

  const firstLine = Math.min(lines.length, Math.max(0, node.textLineRange?.start ?? 0));
  const lastLine = Math.min(
    lines.length,
    Math.max(firstLine, node.textLineRange?.end ?? lines.length)
  );
  const baselines = layoutRunBaselines(
    lines,
    { top: boxTop - pm.spaceAbove, bottom: boxBottom + pm.spaceBelow },
    verticalAlign
  );
  let clipY = y;
  let clipH = boxH;
  if (node.textLineRange != null && verticalAlign === 'top' && lastLine > firstLine) {
    const firstTop = baselines[firstLine] + lines[firstLine].ascent;
    const lastSegments = lines[lastLine - 1].segments;
    const lastDescent = lastSegments.reduce(
      (max, segment) =>
        Math.max(max, fontDescent(styled[segment.run].font, styled[segment.run].size)),
      0
    );
    const lastBottom = baselines[lastLine - 1] - lastDescent;
    const aligned = alignFragmentBand(firstTop, lastBottom, y + boxH, y);
    if (aligned.shift !== 0 || aligned.clipBottom !== y) {
      for (let i = firstLine; i < lastLine; i++) baselines[i] -= aligned.shift;
      clipY = aligned.clipBottom;
      clipH = y + boxH - aligned.clipBottom;
    }
  }
  const clipped = clipOverflow(
    pdfPage,
    textX,
    clipY,
    textW,
    clipH,
    node.textLineRange != null || runBlockHeight(lines) + pm.spaceAbove + pm.spaceBelow > boxH + 0.5
  );

  for (let i = firstLine; i < lastLine; i++) {
    const lineY = baselines[i];
    const lineAvail = Math.max(textW - lines[i].indent, 0);
    const lineOriginX =
      textX + lines[i].indent + horizontalOffsetX(justH, lineAvail, lines[i].width);
    for (const segment of lines[i].segments) {
      const run = styled[segment.run];
      drawScaledText(
        pdfPage,
        segment.text,
        {
          x: lineOriginX + segment.x,
          y: lineY,
          size: run.size,
          font: run.font,
          color: run.color ? toPdfColor(run.color) : toPdfColor(node.font?.color),
        },
        run.scale
      );
      if (run.underline) {
        const segW = measureText(segment.text, run.size, run.font, {
          horizontalScale: run.scale,
        });
        const uy = lineY - Math.max(0.5, run.size * 0.12);
        pdfPage.drawLine({
          start: { x: lineOriginX + segment.x, y: uy },
          end: { x: lineOriginX + segment.x + segW, y: uy },
          thickness: Math.max(0.25, run.size * 0.05),
          color: run.color ? toPdfColor(run.color) : toPdfColor(node.font?.color),
        });
      }
    }
  }
  endOverflowClip(pdfPage, clipped);
}

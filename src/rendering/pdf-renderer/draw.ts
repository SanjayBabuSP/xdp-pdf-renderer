import { degrees, popGraphicsState, pushGraphicsState, setLineJoin } from 'pdf-lib';
import type { PDFPage } from 'pdf-lib';
import type { DrawNode } from '../../types';
import { drawValueHeight } from '../../domain/layout/position-engine';
import type { FontManager } from '../font-manager';
import {
  DEFAULT_EDGE_THICKNESS_PT,
  dashArrayForStyle,
  effectiveStrokeWidth,
  quantizeStrokeWidth,
  xfaCapToPdf,
  xfaJoinToPdf,
} from '../border-style';
import { beginOpacityScope, endOpacityScope } from '../pdf-lowlevel';
import { sanitizeTextForFont } from '../text/glyph-coverage';
import { breakLinesInfo } from '../text/line-breaker';
import {
  alignFragmentBand,
  fontAscent,
  fontDescent,
  layoutLines,
  paraMetrics,
} from '../text/line-metrics';
import { alignClassOf, horizontalOffsetX, mapJustH, mapJustV } from '../text/justifier';
import { isVerticalRotation, normalizeRotation, rotatedAnchor } from '../text/rotation';
import { drawBorderBox } from './border-fill';
import {
  clipOverflow,
  drawScaledText,
  endOverflowClip,
  flipY,
  getMargins,
  measureTextWidth,
  scaleForFamily,
  stripHtmlTags,
  toPdfColor,
  wrapText,
} from './helpers';
import { renderImage } from './image';
import { renderRichText } from './text';

export async function renderDraw(
  pdfPage: PDFPage,
  node: DrawNode,
  pageH: number,
  fontManager: FontManager,
  pageIndex = 0
): Promise<void> {
  const pos = node.position;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const margins = getMargins(node.margin);
  const width = Math.max((pos.w ?? pos.minW ?? 0) - margins.left - margins.right, 0);
  const measuredHeight =
    pos.h == null &&
    pos.minH == null &&
    (node.value?.type === 'richText' || node.value?.type === 'text')
      ? drawValueHeight(node, width)
      : undefined;
  const outerHeight = pos.h ?? pos.minH ?? measuredHeight ?? 18;
  const x = pos.x + margins.left;
  const y = flipY(pos.y, outerHeight, pageH) + margins.bottom;
  const height = Math.max(outerHeight - margins.top - margins.bottom, 0);

  const borderRotate = normalizeRotation(pos.rotate ?? 0);
  const borderPos =
    (borderRotate === 90 || borderRotate === 270) && pos.w != null && pos.h != null
      ? { ...pos, w: pos.h, h: pos.w }
      : pos;
  if (node.border) drawBorderBox(pdfPage, node.border, borderPos, pageH);

  if (!node.value) return;

  if (node.value.type === 'image' && node.value.content) {
    await renderImage(pdfPage, node.value, x, y, width, height);
    return;
  }

  if (node.value.type === 'rectangle' || node.value.type === 'line') {
    if (node.value.shapeBorder) drawBorderBox(pdfPage, node.value.shapeBorder, borderPos, pageH);
    return;
  }

  if (node.value.type === 'arc' || node.value.type === 'circle') {
    renderArcOrCircle(pdfPage, node, x, y, width, height);
    return;
  }

  if (node.value.type === 'richText') {
    await renderRichText(pdfPage, node, x, y, fontManager, width, height, pageIndex);
    return;
  }

  if (node.value.type === 'text') {
    const rawText = stripHtmlTags(node.value.content ?? '');
    if (!rawText) return;
    const fontSize = node.font?.size ?? 10;
    const fontColor = toPdfColor(node.font?.color);
    const font = await fontManager.getSafeFont(
      rawText,
      node.font?.family ?? 'Helvetica',
      node.font?.weight,
      node.font?.posture
    );
    const text = sanitizeTextForFont(rawText, font);
    if (!text) return;
    const rotate = normalizeRotation(node.position?.rotate ?? 0);
    const rotation = rotate !== 0 ? degrees(rotate) : undefined;
    const pm = paraMetrics(node.para, fontSize);
    const justH = mapJustH(node.para?.hAlign);
    const justV = mapJustV(node.para?.vAlign);
    const verticalAlign: 'top' | 'middle' | 'bottom' =
      justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';
    const baseFamily = node.font?.family ?? 'Helvetica';
    const drawScale = scaleForFamily(baseFamily);

    if (isVerticalRotation(rotate)) {
      const lines = wrapText(text, fontSize, width, font, { horizontalScale: drawScale });
      const advance = pm.lineAdvance;
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, font, drawScale)),
        0
      );
      const rotatedY = flipY(pos.y ?? 0, width, pageH) - margins.top;
      const anchor = rotatedAnchor({
        rotate,
        box: { x, y: rotatedY, w: height, h: width },
        align: alignClassOf(justH),
        valign: verticalAlign,
        lineLen: longest,
        ascent: fontAscent(font, fontSize),
        descent: fontDescent(font, fontSize),
        advance,
        lineCount: lines.length,
      });
      if (anchor) {
        if (lines.length > 1) pdfPage.setLineHeight(advance);
        drawScaledText(
          pdfPage,
          lines.join('\n'),
          {
            x: anchor.x,
            y: anchor.y,
            size: fontSize,
            font,
            color: fontColor,
            rotate: rotation,
          },
          drawScale
        );
      }
      return;
    }

    const textX = x + pm.marginLeft;
    const textW = Math.max(width - pm.marginLeft - pm.marginRight, 0);
    const wrapped = breakLinesInfo(
      text,
      textW,
      (s) => measureTextWidth(s, fontSize, font, drawScale),
      { firstLineIndent: pm.textIndent }
    );
    const lines = wrapped.map((line) => line.text);
    const firstFragLine = Math.min(lines.length, Math.max(0, node.textLineRange?.start ?? 0));
    const lastFragLine = Math.min(
      lines.length,
      Math.max(firstFragLine, node.textLineRange?.end ?? lines.length)
    );
    const { baselines } = layoutLines(
      lines.length,
      fontSize,
      { top: y + height, bottom: y },
      verticalAlign,
      font,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const verticalOverflow =
      lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > height + 0.5;
    const horizontalOverflow = lines.some(
      (line) => measureTextWidth(line, fontSize, font, drawScale) > textW + 0.5
    );
    let clipY = y;
    let clipH = height;
    if (node.textLineRange != null && verticalAlign === 'top' && lastFragLine > firstFragLine) {
      const ascent = fontAscent(font, fontSize);
      const descent = fontDescent(font, fontSize);
      const aligned = alignFragmentBand(
        baselines[firstFragLine] + ascent,
        baselines[lastFragLine - 1] - descent,
        y + height,
        y
      );
      if (aligned.shift !== 0 || aligned.clipBottom !== y) {
        for (let i = firstFragLine; i < lastFragLine; i++) baselines[i] -= aligned.shift;
        clipY = aligned.clipBottom;
        clipH = y + height - aligned.clipBottom;
      }
    }
    const clipped = clipOverflow(
      pdfPage,
      textX,
      clipY,
      textW,
      clipH,
      node.textLineRange != null || verticalOverflow || horizontalOverflow
    );

    for (let i = 0; i < lines.length; i++) {
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
          color: fontColor,
          rotate: rotation,
        },
        drawScale
      );
    }
    endOverflowClip(pdfPage, clipped);
  }
}

function renderArcOrCircle(
  pdfPage: PDFPage,
  node: DrawNode,
  x: number,
  y: number,
  w: number,
  h: number
): void {
  const rx = w / 2;
  const ry = h / 2;
  const cx = x + rx;
  const cy = y;

  const edge = node.value?.shapeBorder?.edges?.[0] ?? {};
  const fillColor = node.value?.shapeBorder?.fill?.color;
  const authoredThickness = quantizeStrokeWidth(edge.thickness ?? DEFAULT_EDGE_THICKNESS_PT);
  const thickness = effectiveStrokeWidth(edge);
  const strokeVisible =
    edge.presence !== 'hidden' && edge.presence !== 'invisible' && edge.style !== 'none';

  const dashArray = strokeVisible ? dashArrayForStyle(edge.style, authoredThickness) : undefined;
  const lineJoin = xfaJoinToPdf(edge.join);
  const lineCap = xfaCapToPdf(edge.cap);

  const drawOptions: Parameters<PDFPage['drawEllipse']>[0] = {
    x: cx,
    y: cy,
    xScale: rx,
    yScale: ry,
    color: fillColor ? toPdfColor(fillColor) : undefined,
    borderColor: strokeVisible ? toPdfColor(edge?.color) : undefined,
    borderWidth: strokeVisible ? thickness : 0,
  };
  if (dashArray) drawOptions.borderDashArray = dashArray;
  if (edge?.cap) drawOptions.borderLineCap = lineCap;

  const started = beginOpacityScope(pdfPage, {
    fill: node.value?.shapeBorder?.fill?.opacity,
    stroke: edge?.opacity,
  });
  pdfPage.pushOperators(pushGraphicsState(), setLineJoin(lineJoin));
  pdfPage.drawEllipse(drawOptions);
  pdfPage.pushOperators(popGraphicsState());
  endOpacityScope(pdfPage, started);
}

import { degrees } from 'pdf-lib';
import type { PDFPage, RGB } from 'pdf-lib';
import type { FieldNode } from '../../types';
import { formatValue } from '../../lib/value-format';
import type { FontManager } from '../font-manager';
import { resolveButtonLabel, resolveChoiceText } from '../ui-values';
import { isBottomUnderlineOnly } from '../border-style';
import { sanitizeTextForFont } from '../text/glyph-coverage';
import { breakLinesInfo } from '../text/line-breaker';
import {
  alignFragmentBand,
  fontAscent,
  fontDescent,
  layoutLines,
  paraMetrics,
} from '../text/line-metrics';
import {
  alignClassOf,
  horizontalOffsetX,
  justifyLine,
  mapJustH,
  mapJustV,
} from '../text/justifier';
import { isVerticalRotation, normalizeRotation, rotatedAnchor } from '../text/rotation';
import { renderBarcodeValue } from './barcode';
import { drawBorderBox, drawUnderlineInValueArea } from './border-fill';
import {
  captionTrailingSymbol,
  clipOverflow,
  drawScaledText,
  endOverflowClip,
  flipY,
  getMargins,
  measureTextWidth,
  scaleForFamily,
  toPdfColor,
  wrapText,
} from './helpers';
import { renderImage } from './image';

export async function renderField(
  pdfPage: PDFPage,
  node: FieldNode,
  pageH: number,
  fontManager: FontManager,
  locale?: string
): Promise<void> {
  const pos = node.position;
  if (pos?.x === undefined || pos?.y === undefined) return;

  const margins = getMargins(node.margin);
  const x = pos.x + margins.left;
  const width = Math.max((pos.w ?? pos.minW ?? 0) - margins.left - margins.right, 0);
  const height = pos.h ?? pos.minH ?? 18;
  const y = flipY(pos.y, height, pageH) + margins.bottom;
  const innerHeight = Math.max(height - margins.top - margins.bottom, 0);
  const fontSize = node.font?.size ?? 10;
  const fontColor = toPdfColor(node.font?.color);
  const valueText =
    node.ui?.type === 'choiceList'
      ? resolveChoiceText(node.resolvedValue, node.ui.items)
      : formatValue(node.resolvedValue, node.formatPicture, node.locale ?? locale);
  const justH = mapJustH(node.para?.hAlign ?? node.ui?.hAlign);
  const valueAlign = alignClassOf(justH);
  const justV = mapJustV(node.para?.vAlign ?? node.ui?.vAlign);
  const verticalAlign: 'top' | 'middle' | 'bottom' =
    justV === 2 ? 'middle' : justV === 3 ? 'bottom' : 'top';

  if (node.ui?.type === 'checkButton') {
    return renderCheckButton(
      pdfPage,
      node,
      pos.x,
      flipY(pos.y, height, pageH),
      pos.w ?? 0,
      height,
      fontSize,
      fontManager,
      fontColor
    );
  }

  if (node.imageValue?.type === 'image' && node.imageValue.content) {
    if (node.border) drawBorderBox(pdfPage, node.border, pos, pageH);
    await renderImage(pdfPage, node.imageValue, x, y, width, innerHeight);
    return;
  }

  if (node.border) {
    const placement = node.caption?.placement ?? 'left';
    const reserve = node.caption?.reserve ?? 0;
    if (
      (placement === 'left' || placement === 'right') &&
      reserve > 0 &&
      isBottomUnderlineOnly(node.border.edges)
    ) {
      drawUnderlineInValueArea(pdfPage, node.border, pos, reserve, placement, pageH);
    } else {
      drawBorderBox(pdfPage, node.border, pos, pageH);
    }
  }

  if (node.ui?.type === 'button') {
    await renderButton(
      pdfPage,
      node,
      x,
      y,
      width,
      innerHeight,
      fontSize,
      fontManager,
      fontColor,
      valueText
    );
    return;
  }
  if (node.ui?.type === 'signature') {
    return;
  }

  const anchor = node.originalBox;
  const contentTop = y + innerHeight;
  const boxTop = anchor ? contentTop - anchor.topOffset : contentTop;
  const boxBottom = anchor ? boxTop - anchor.height : y;

  const rotate = normalizeRotation(node.position?.rotate ?? 0);
  const rotation = rotate !== 0 ? degrees(rotate) : undefined;
  const verticalRot = isVerticalRotation(rotate);
  const innerBox = { x, y, w: width, h: innerHeight };

  const reserve = node.caption?.reserve ?? 0;
  const valueFamily = node.font?.family ?? 'Helvetica';
  const valueScale = scaleForFamily(valueFamily);
  const valueFont = await fontManager.getSafeFont(
    valueText,
    valueFamily,
    node.font?.weight,
    node.font?.posture
  );
  const safeValueText = sanitizeTextForFont(valueText, valueFont);

  if (node.caption?.text) {
    const captionFamily = node.caption.font?.family ?? node.font?.family ?? 'Helvetica';
    const captionFont = node.caption.font
      ? await fontManager.getSafeFont(
          node.caption.text,
          captionFamily,
          node.caption.font.weight,
          node.caption.font.posture
        )
      : await fontManager.getFont(captionFamily, node.font?.weight, node.font?.posture);
    const captionText = sanitizeTextForFont(node.caption.text, captionFont);
    const captionSize = node.caption.font?.size ?? fontSize;
    const captionColor = toPdfColor(node.caption.font?.color);
    const captionScale = scaleForFamily(captionFamily);
    const captionPara = node.caption.para ?? node.para;
    const captionPM = paraMetrics(captionPara, captionSize);
    const captionJustH = mapJustH(captionPara?.hAlign);
    const captionJustV = mapJustV(captionPara?.vAlign);
    const captionVerticalAlign: 'top' | 'middle' | 'bottom' =
      captionJustV === 2 ? 'middle' : captionJustV === 3 ? 'bottom' : 'top';
    const captionAlign =
      captionPara?.hAlign !== undefined ? alignClassOf(captionJustH) : valueAlign;
    const placement = node.caption?.placement ?? 'left';
    let captionX = x;
    let captionY = y;

    const captionWidth = measureTextWidth(captionText, captionSize, captionFont, captionScale);
    const captionStrip =
      placement === 'left' || placement === 'right'
        ? Math.max(Math.min(reserve || captionWidth, width), 0)
        : width;

    const richSymbol = captionTrailingSymbol(captionText, node.caption.richHtml);
    let captionPainted = false;
    if (
      richSymbol &&
      (placement === 'left' || placement === 'right') &&
      reserve > 0 &&
      !verticalRot
    ) {
      const captionAdvance = captionPM.lineAdvance;
      const { baselines: symBaselines } = layoutLines(
        1,
        captionSize,
        { top: y + innerHeight, bottom: y },
        captionVerticalAlign,
        valueFont,
        { lineAdvance: captionAdvance }
      );
      const symY = symBaselines[0];
      const labelW = measureTextWidth(richSymbol.label, captionSize, captionFont, captionScale);
      const spacerW = measureTextWidth(richSymbol.spacer, captionSize, captionFont, captionScale);
      const symW = measureTextWidth(richSymbol.symbol, captionSize, captionFont, captionScale);
      const captionBaseX = placement === 'right' ? x + width - captionStrip : x;
      const captionContentW = Math.max(
        captionStrip - captionPM.marginLeft - captionPM.marginRight,
        0
      );
      const labelX =
        captionBaseX +
        captionPM.marginLeft +
        horizontalOffsetX(captionJustH, captionContentW, labelW + spacerW + symW);
      const symX = labelX + labelW + spacerW;
      const clipped = clipOverflow(
        pdfPage,
        placement === 'left' ? x : x + width - captionStrip,
        y,
        captionStrip,
        innerHeight,
        labelW + spacerW + symW > captionStrip + 0.01
      );
      drawScaledText(
        pdfPage,
        richSymbol.label,
        {
          x: labelX,
          y: symY,
          size: captionSize,
          font: captionFont,
          color: captionColor,
          rotate: rotation,
        },
        captionScale
      );
      drawScaledText(
        pdfPage,
        richSymbol.symbol,
        {
          x: symX,
          y: symY,
          size: captionSize,
          font: captionFont,
          color: captionColor,
          rotate: rotation,
        },
        captionScale
      );
      if (richSymbol.underline) {
        const uy = symY - Math.max(0.5, captionSize * 0.12);
        pdfPage.drawLine({
          start: { x: symX, y: uy },
          end: { x: symX + symW, y: uy },
          thickness: Math.max(0.25, captionSize * 0.05),
          color: captionColor,
        });
      }
      endOverflowClip(pdfPage, clipped);
      captionPainted = true;
    } else if (verticalRot) {
      const anchor = rotatedAnchor({
        rotate,
        box: innerBox,
        align: placement === 'right' ? 'right' : captionAlign,
        valign: captionVerticalAlign,
        lineLen: captionWidth,
        ascent: fontAscent(valueFont, captionSize),
        descent: fontDescent(valueFont, captionSize),
      });
      if (anchor) {
        captionX = anchor.x;
        captionY = anchor.y;
      }
    } else {
      const captionAdvance = captionPM.lineAdvance;
      const { baselines: captionBaselines } = layoutLines(
        1,
        captionSize,
        { top: y + innerHeight, bottom: y },
        captionVerticalAlign,
        valueFont,
        { lineAdvance: captionAdvance }
      );
      captionY = captionBaselines[0];
      const captionBaseX = placement === 'right' ? x + width - captionStrip : x;
      const captionContentW = Math.max(
        captionStrip - captionPM.marginLeft - captionPM.marginRight,
        0
      );
      captionX =
        captionBaseX +
        captionPM.marginLeft +
        horizontalOffsetX(captionJustH, captionContentW, captionWidth);
    }

    if (!captionPainted) {
      const captionContentW = Math.max(
        captionStrip - captionPM.marginLeft - captionPM.marginRight,
        0
      );
      const captionClip =
        placement === 'left' || placement === 'right'
          ? clipOverflow(
              pdfPage,
              (placement === 'left' ? x : x + width - captionStrip) + captionPM.marginLeft,
              y,
              captionContentW,
              innerHeight,
              captionWidth > captionContentW + 0.01
            )
          : false;

      drawScaledText(
        pdfPage,
        captionText,
        {
          x: captionX,
          y: captionY,
          size: captionSize,
          font: captionFont,
          color: captionColor,
          rotate: rotation,
        },
        captionScale
      );
      endOverflowClip(pdfPage, captionClip);
    }
  }

  if (node.ui?.type === 'barcode') {
    await renderBarcodeValue(
      pdfPage,
      node,
      valueText,
      {
        x,
        y,
        w: width,
        h: innerHeight,
      },
      fontManager,
      { fontSize, fontColor, align: valueAlign }
    );
    return;
  }

  if (safeValueText) {
    const valueAreaWidth = Math.max(width - reserve, 0);
    const pm = paraMetrics(node.para, fontSize, node.inheritedFontSize);

    if (verticalRot) {
      const valueBox = { x: x + reserve, y, w: valueAreaWidth, h: innerHeight };
      const lines = wrapText(safeValueText, fontSize, innerHeight, valueFont, {
        horizontalScale: valueScale,
      });
      const advance = pm.lineAdvance;
      const ascent = fontAscent(valueFont, fontSize);
      const descent = fontDescent(valueFont, fontSize);
      const longest = lines.reduce(
        (m, l) => Math.max(m, measureTextWidth(l, fontSize, valueFont, valueScale)),
        0
      );
      const anchor = rotatedAnchor({
        rotate,
        box: valueBox,
        align: valueAlign,
        valign: verticalAlign,
        lineLen: longest,
        ascent,
        descent,
        advance,
        lineCount: lines.length,
      });
      if (anchor) {
        if (lines.length > 1) {
          pdfPage.setLineHeight(advance);
        }
        drawScaledText(
          pdfPage,
          lines.join('\n'),
          {
            x: anchor.x,
            y: anchor.y,
            size: fontSize,
            font: valueFont,
            color: fontColor,
            rotate: rotation,
          },
          valueScale
        );
      }
      return;
    }

    const textX = x + reserve + pm.marginLeft;
    const textW = Math.max(valueAreaWidth - pm.marginLeft - pm.marginRight, 0);
    const measure = (s: string): number => measureTextWidth(s, fontSize, valueFont, valueScale);
    const wrapWidth = node.ui?.multiLine === true ? textW : Number.POSITIVE_INFINITY;
    const lines = breakLinesInfo(safeValueText, wrapWidth, measure, {
      firstLineIndent: pm.textIndent,
    });
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
      valueFont,
      { lineAdvance: pm.lineAdvance, paddingTop: pm.spaceAbove, paddingBottom: pm.spaceBelow }
    );

    const verticalOverflow =
      lines.length * pm.lineAdvance + pm.spaceAbove + pm.spaceBelow > innerHeight + 0.5;
    const horizontalOverflow = lines.some((line) => measure(line.text) > textW + 0.5);
    let clipY = y;
    let clipH = innerHeight;
    if (node.textLineRange != null && verticalAlign === 'top' && lastLine > firstLine) {
      const ascent = fontAscent(valueFont, fontSize);
      const descent = fontDescent(valueFont, fontSize);
      const aligned = alignFragmentBand(
        baselines[firstLine] + ascent,
        baselines[lastLine - 1] - descent,
        y + innerHeight,
        y
      );
      if (aligned.shift !== 0 || aligned.clipBottom !== y) {
        for (let i = firstLine; i < lastLine; i++) baselines[i] -= aligned.shift;
        clipY = aligned.clipBottom;
        clipH = y + innerHeight - aligned.clipBottom;
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

    for (let i = firstLine; i < lastLine; i++) {
      const { text: line, paragraphEnd } = lines[i];
      const lineY = baselines[i];
      const lineWidth = measure(line);
      const indent = i === 0 || lines[i - 1].paragraphEnd ? pm.textIndent : 0;
      const lineAvail = Math.max(textW - indent, 0);
      const baseX = textX + indent + horizontalOffsetX(justH, lineAvail, lineWidth);

      const segments = justifyLine(line, lineAvail, lineWidth, measure, {
        code: justH,
        paragraphLast: paragraphEnd,
      });

      if (segments) {
        for (const segment of segments) {
          drawScaledText(
            pdfPage,
            segment.text,
            {
              x: textX + indent + segment.x,
              y: lineY,
              size: fontSize,
              font: valueFont,
              color: fontColor,
              rotate: rotation,
            },
            valueScale
          );
        }
        continue;
      }

      drawScaledText(
        pdfPage,
        line,
        {
          x: baseX,
          y: lineY,
          size: fontSize,
          font: valueFont,
          color: fontColor,
          rotate: rotation,
        },
        valueScale
      );
    }
    endOverflowClip(pdfPage, clipped);
  }
}

async function renderButton(
  pdfPage: PDFPage,
  node: FieldNode,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
  fontManager: FontManager,
  fontColor: RGB,
  valueText: string
): Promise<void> {
  const label = resolveButtonLabel(node.ui?.label, valueText, node.caption?.text);
  if (!label) return;

  const family = node.font?.family ?? 'Helvetica';
  const font = await fontManager.getSafeFont(label, family, node.font?.weight, node.font?.posture);
  const safeLabel = sanitizeTextForFont(label, font);
  if (!safeLabel) return;
  const scale = scaleForFamily(family);
  const textWidth = measureTextWidth(safeLabel, fontSize, font, scale);
  const { baselines } = layoutLines(1, fontSize, { top: y + height, bottom: y }, 'middle', font);
  drawScaledText(
    pdfPage,
    safeLabel,
    {
      x: x + Math.max((width - textWidth) / 2, 0),
      y: baselines[0],
      size: fontSize,
      font,
      color: fontColor,
    },
    scale
  );
}

async function renderCheckButton(
  pdfPage: PDFPage,
  node: FieldNode,
  x: number,
  y: number,
  _width: number,
  height: number,
  fontSize: number,
  fontManager: FontManager,
  fontColor: RGB
): Promise<void> {
  const checked = String(node.resolvedValue) === (node.ui?.checkedValue ?? '1');
  const checkChar = checked ? '☑' : '☐';
  const family = node.font?.family ?? 'Helvetica';
  const weight = node.font?.weight;
  const posture = node.font?.posture;
  const scale = scaleForFamily(family);

  const font = await fontManager.getSafeFont(checkChar, family, weight, posture);
  const safeCheckChar = sanitizeTextForFont(checkChar, font);

  const { baselines } = layoutLines(1, fontSize, { top: y + height, bottom: y }, 'middle', font);

  drawScaledText(
    pdfPage,
    safeCheckChar,
    { x, y: baselines[0], size: fontSize, font, color: fontColor },
    scale
  );

  if (node.caption?.text) {
    const captionFont = await fontManager.getSafeFont(node.caption.text, family, weight, posture);
    drawScaledText(
      pdfPage,
      sanitizeTextForFont(node.caption.text, captionFont),
      {
        x: x + fontSize * 1.5,
        y: baselines[0],
        size: fontSize,
        font: captionFont,
        color: fontColor,
      },
      scale
    );
  }
}

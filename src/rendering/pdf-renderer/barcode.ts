import { rgb } from 'pdf-lib';
import type { PDFPage, RGB } from 'pdf-lib';
import type { FieldNode } from '../../types';
import { toPointsOrZero } from '../../lib/unit-converter';
import type { FontManager } from '../font-manager';
import { measureTextWidth } from './helpers';

export async function renderBarcodeValue(
  pdfPage: PDFPage,
  node: FieldNode,
  data: string,
  box: { x: number; y: number; w: number; h: number },
  fontManager: FontManager,
  opts: { fontSize: number; fontColor?: RGB; align: 'left' | 'center' | 'right' }
): Promise<void> {
  const ui = node.ui;
  if (!ui || box.w <= 0 || box.h <= 0) return;

  const symbology = ui.symbology ?? ui.encodeHint ?? 'code39';
  const textLocation = (ui.textLocation ?? 'none').toLowerCase();
  const hasHri = textLocation !== 'none' && textLocation !== '';
  const hriSize = Math.max(Math.min(opts.fontSize, box.h / 3), 4);
  const hriH = hasHri ? hriSize + 3 : 0;
  const above = textLocation.startsWith('above');

  const barBox = {
    x: box.x,
    y: above ? box.y : box.y + hriH,
    w: box.w,
    h: Math.max(box.h - hriH, 1),
  };

  const moduleW = Math.max(toPointsOrZero(ui.moduleWidth) || 1, 0.1);
  const ratio = parseWideNarrowRatio(ui.wideNarrowRatio);

  const { renderBarcode } = await import('../barcode-renderer');
  renderBarcode(
    pdfPage,
    symbology,
    data,
    barBox.x,
    barBox.y,
    barBox.w,
    barBox.h,
    moduleW,
    opts.align,
    ratio,
    { errorCorrectionLevel: parseErrorCorrectionLevel(ui.errorCorrectionLevel) }
  );

  if (hasHri && data) {
    const hriFont = await fontManager.getSafeFont(data, node.font?.family ?? 'Helvetica');
    const textW = measureTextWidth(data, hriSize, hriFont);
    const slack = Math.max(box.w - textW, 0);
    const hriX =
      opts.align === 'center' ? box.x + slack / 2 : opts.align === 'right' ? box.x + slack : box.x;
    const hriY = above ? box.y + box.h - hriSize : box.y;
    pdfPage.drawText(data, {
      x: hriX,
      y: hriY,
      size: hriSize,
      font: hriFont,
      color: opts.fontColor ?? rgb(0, 0, 0),
    });
  }
}

function parseErrorCorrectionLevel(raw?: string): number | undefined {
  if (raw == null || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0 || n > 8) return undefined;
  return n;
}

function parseWideNarrowRatio(raw?: string): number {
  if (!raw) return 2.5;
  const nums = raw.match(/\d+(?:\.\d+)?/g);
  if (!nums || nums.length === 0) return 2.5;
  if (nums.length === 1) return Math.min(Math.max(parseFloat(nums[0]), 2), 3);
  const lo = parseFloat(nums[0]);
  const hi = parseFloat(nums[1]);
  if (!isFinite(lo) || !isFinite(hi) || hi <= lo) return 2.5;
  return Math.min(Math.max((lo + hi) / 2, 2), 3);
}

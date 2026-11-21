
export type AspectMode = 'none' | 'fit' | 'actual' | 'width' | 'height';

export interface ImageDimensions {
  pixelW: number;
  pixelH: number;
  xdpi?: number;
  ydpi?: number;
}

export interface ScaleResult {
  drawW: number;
  drawH: number;
  offsetX: number;
  offsetY: number;
}

export interface AlignOptions {
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
}

export function computeImageRect(
  mode: string | undefined,
  boxW: number,
  boxH: number,
  img: ImageDimensions,
  align: AlignOptions = {},
  rotated = false,
): ScaleResult {
  const effW = rotated ? boxH : boxW;
  const effH = rotated ? boxW : boxH;

  if (img.pixelW <= 0 || img.pixelH <= 0 || effW <= 0 || effH <= 0) {
    return { drawW: effW, drawH: effH, offsetX: 0, offsetY: 0 };
  }

  const xdpi = img.xdpi ?? 96;
  const ydpi = img.ydpi ?? xdpi;

  let drawW: number;
  let drawH: number;

  switch (mode) {
    case 'none':
      drawW = effW;
      drawH = effH;
      break;

    case 'actual':
      drawW = (img.pixelW * 72) / xdpi;
      drawH = (img.pixelH * 72) / ydpi;
      break;

    case 'width':
      drawW = effW;
      drawH = (img.pixelH / img.pixelW) * effW;
      break;

    case 'height':
      drawH = effH;
      drawW = (img.pixelW / img.pixelH) * effH;
      break;

    case 'fit':
    default: {
      const scaleX = effW / img.pixelW;
      const scaleY = effH / img.pixelH;
      const scale = Math.min(scaleX, scaleY);
      drawW = img.pixelW * scale;
      drawH = img.pixelH * scale;
      break;
    }
  }

  const spareX = Math.max(effW - drawW, 0);
  const spareY = Math.max(effH - drawH, 0);

  let offsetX = 0;
  let offsetY = 0;

  switch (align.hAlign ?? 'left') {
    case 'center': offsetX = spareX / 2; break;
    case 'right':  offsetX = spareX;     break;
    default:       offsetX = 0;          break;
  }

  switch (align.vAlign ?? 'top') {
    case 'middle': offsetY = spareY / 2; break;
    case 'bottom': offsetY = 0;          break;
    default:       offsetY = spareY;     break;
  }

  return { drawW, drawH, offsetX, offsetY };
}

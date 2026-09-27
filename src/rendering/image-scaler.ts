/**
 * Image aspect-ratio scaling math — Phase 6.
 *
 * Implements the five aspect modes from `xfaimageservice_disasm.c:9324-9379`:
 *   none   = stretch to fill box (no aspect preservation)
 *   fit    = uniform scale: min(scaleX, scaleY) so image fits inside box
 *   actual = render at native DPI: size = pixelWidth * 72 / xdpi
 *   width  = scale to fit width, preserve aspect (height may overflow)
 *   height = scale to fit height, preserve aspect (width may overflow)
 *
 * Alignment offsets (xfaimageservice:9281): only applied when the scaled
 * image is SMALLER than the box (to centre/align within spare space).
 * When the image equals or exceeds the box dimension, offset is 0.
 *
 * Box swap for 90°/270° rotation: xfaimageservice_disasm.c equivalent of
 * pdfldriver:45806 — swap w and h before computing the scale, then swap
 * the resulting draw dimensions back.
 */

export type AspectMode = 'none' | 'fit' | 'actual' | 'width' | 'height';

export interface ImageDimensions {
  /** Pixel width of the source image. */
  pixelW: number;
  /** Pixel height of the source image. */
  pixelH: number;
  /** Horizontal DPI (dots per inch). Defaults to 96 when absent. */
  xdpi?: number;
  /** Vertical DPI. Defaults to xdpi when absent. */
  ydpi?: number;
}

export interface ScaleResult {
  /** Draw width in PDF points. */
  drawW: number;
  /** Draw height in PDF points. */
  drawH: number;
  /** X offset from box origin (for alignment within spare space). */
  offsetX: number;
  /** Y offset from box origin (for alignment within spare space). */
  offsetY: number;
}

export interface AlignOptions {
  hAlign?: 'left' | 'center' | 'right';
  vAlign?: 'top' | 'middle' | 'bottom';
}

/**
 * Compute the draw rectangle for an image inside a layout box.
 *
 * evidence: xfaimageservice_disasm.c:9324–9379 (aspect scale),
 *           xfaimageservice_disasm.c:9281 (alignment offsets).
 *
 * @param mode    Aspect mode string (defaults to 'fit' when unrecognised)
 * @param boxW    Box width in PDF points
 * @param boxH    Box height in PDF points
 * @param img     Source image pixel dimensions and optional DPI
 * @param align   Horizontal/vertical alignment within spare space
 * @param rotated When true, swap box dimensions before scaling (pdfldriver:45806)
 */
export function computeImageRect(
  mode: string | undefined,
  boxW: number,
  boxH: number,
  img: ImageDimensions,
  align: AlignOptions = {},
  rotated = false,
): ScaleResult {
  // Box swap for 90°/270° rotation.
  // evidence: pdfldriver:45806 — dimensions are swapped before aspect math.
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
      // Stretch: fill the entire box regardless of native aspect.
      drawW = effW;
      drawH = effH;
      break;

    case 'actual':
      // Native DPI sizing: 72pt = 1 inch.
      // evidence: xfaimageservice:9324 — actual mode uses xres/yres.
      drawW = (img.pixelW * 72) / xdpi;
      drawH = (img.pixelH * 72) / ydpi;
      break;

    case 'width':
      // Scale to box width, preserve aspect.
      drawW = effW;
      drawH = (img.pixelH / img.pixelW) * effW;
      break;

    case 'height':
      // Scale to box height, preserve aspect.
      drawH = effH;
      drawW = (img.pixelW / img.pixelH) * effH;
      break;

    case 'fit':
    default: {
      // Uniform scale: min(scaleX, scaleY) so entire image fits inside box.
      // evidence: xfaimageservice:9324 — fit = min() of both scale factors.
      const scaleX = effW / img.pixelW;
      const scaleY = effH / img.pixelH;
      const scale = Math.min(scaleX, scaleY);
      drawW = img.pixelW * scale;
      drawH = img.pixelH * scale;
      break;
    }
  }

  // Alignment offsets — only when scaled image is smaller than the box.
  // evidence: xfaimageservice:9281 — offsets applied only when scaled < box.
  const spareX = Math.max(effW - drawW, 0);
  const spareY = Math.max(effH - drawH, 0);

  let offsetX = 0;
  let offsetY = 0;

  switch (align.hAlign ?? 'left') {
    case 'center': offsetX = spareX / 2; break;
    case 'right':  offsetX = spareX;     break;
    default:       offsetX = 0;          break;
  }

  // PDF y-axis is bottom-up; 'top' alignment = largest y offset.
  switch (align.vAlign ?? 'top') {
    case 'middle': offsetY = spareY / 2; break;
    case 'bottom': offsetY = 0;          break;
    default:       offsetY = spareY;     break; // top
  }

  return { drawW, drawH, offsetX, offsetY };
}

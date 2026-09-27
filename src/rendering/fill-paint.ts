/**
 * Fill paint helpers — Phase 5: gradients and gray collapse.
 *
 * Gradients: XFA fill types `toRight`/`toBottom`/`toLeft`/`toTop` → PDF axial
 * shading dict; `radial` → PDF radial shading dict.
 * evidence: renderer:35845, renderer:36519, pdfldriver:40203.
 *
 * Gray collapse: when r == g == b use the more compact `g/G` DeviceGray
 * operators instead of `rg/RG` DeviceRGB.
 * evidence: pdfldriver:10496.
 *
 * Implementation: pdf-lib has no gradient API so we manipulate the raw PDF
 * context directly (PDFDict, PDFName, PDFNumber, PDFOperator) in the same
 * pattern as pdf-lowlevel.ts for ExtGState.
 */

import {
  PDFPage,
  PDFName,
  PDFNumber,
  PDFDict,
  PDFOperator,
  PDFOperatorNames as Ops,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  rectangle,
  clip,
  endPath,
} from 'pdf-lib';
import { RgbColor } from '../types';

// ─── Gray collapse helper ─────────────────────────────────────────────────────

/**
 * Return `true` when the colour is a grayscale value (r == g == b).
 * evidence: pdfldriver:10496 — uses `g`/`G` operators when all three
 * components are equal, saving 5+ bytes per colour op.
 */
export function isGray(color: RgbColor): boolean {
  return color.r === color.g && color.g === color.b;
}

/**
 * Return the 0-1 gray value for a grayscale RGB triple.
 * Only call this after `isGray()` returns true.
 */
export function grayLevel(color: RgbColor): number {
  return color.r / 255;
}

// ─── Shading resource helpers ─────────────────────────────────────────────────

/** Per-document shading resource cache to avoid duplicate /Shading entries. */
const shadingCache = new WeakMap<PDFPage['doc'], Map<string, string>>();

function getDocCache(doc: PDFPage['doc']): Map<string, string> {
  let cache = shadingCache.get(doc);
  if (!cache) {
    cache = new Map();
    shadingCache.set(doc, cache);
  }
  return cache;
}

/**
 * Register a /Shading resource on the page's Resource dict and return the
 * assigned name string.
 *
 * pdf-lib's PDFPageLeaf does not expose a `setShading()` method so we access
 * the Resources dict directly.  The Resources dict is always present after
 * `normalize()` is called, which happens on the first draw operation.
 *
 * evidence: pdfldriver:40203 — `sh` operator uses a /Shading resource entry.
 */
function registerShading(pdfPage: PDFPage, shadingDict: PDFDict): string {
  const doc = pdfPage.doc;
  const cache = getDocCache(doc);
  const name = `Sh${cache.size}`;

  // Ensure the page is normalised (pdf-lib does this lazily).
  pdfPage.node.normalize();

  const resDictOrRef = pdfPage.node.getInheritableAttribute(PDFName.of('Resources'));
  const resDict = doc.context.lookupMaybe(resDictOrRef, PDFDict);
  if (!resDict) return name; // Guard: should not happen after normalize.

  // Ensure /Shading sub-dict exists in Resources.
  let shadingResDict = resDict.lookupMaybe(PDFName.of('Shading'), PDFDict);
  if (!shadingResDict) {
    shadingResDict = doc.context.obj({}) as PDFDict;
    resDict.set(PDFName.of('Shading'), shadingResDict);
  }

  const shadingRef = doc.context.register(shadingDict);
  shadingResDict.set(PDFName.of(name), shadingRef);
  return name;
}

// ─── Shading dict builders ────────────────────────────────────────────────────

/** Build a PDF FunctionType 2 (exponential) interpolating between c0 and c1. */
function buildColorFunction(doc: PDFPage['doc'], c0: RgbColor, c1: RgbColor) {
  return doc.context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [c0.r / 255, c0.g / 255, c0.b / 255],
    C1: [c1.r / 255, c1.g / 255, c1.b / 255],
    N: 1,
  });
}

/**
 * Build a normalised shading dict ([0,1]×[0,1] domain).
 * The caller applies a `cm` CTM to map into the actual fill box.
 *
 * fillType → gradient axis (PDF y-axis: 0 = bottom, 1 = top):
 *   toRight:  left → right   (0,0.5 → 1,0.5)
 *   toLeft:   right → left   (1,0.5 → 0,0.5)
 *   toTop:    bottom → top   (0.5,0 → 0.5,1)
 *   toBottom: top → bottom   (0.5,1 → 0.5,0)
 *   radial:   centre → edge  (ShadingType 3)
 *
 * evidence: renderer:35845 (axial), renderer:36519 (radial).
 */
function buildNormalisedShading(
  doc: PDFPage['doc'],
  fillType: string,
  c0: RgbColor,
  c1: RgbColor,
): PDFDict {
  const fn = buildColorFunction(doc, c0, c1);
  const fnRef = doc.context.register(fn);

  switch (fillType) {
    case 'toRight':
      return doc.context.obj({
        ShadingType: 2,
        ColorSpace: PDFName.of('DeviceRGB'),
        Coords: [0, 0.5, 1, 0.5],
        Function: fnRef,
        Extend: [true, true],
      }) as PDFDict;

    case 'toLeft':
      return doc.context.obj({
        ShadingType: 2,
        ColorSpace: PDFName.of('DeviceRGB'),
        Coords: [1, 0.5, 0, 0.5],
        Function: fnRef,
        Extend: [true, true],
      }) as PDFDict;

    case 'toTop':
      return doc.context.obj({
        ShadingType: 2,
        ColorSpace: PDFName.of('DeviceRGB'),
        Coords: [0.5, 0, 0.5, 1],
        Function: fnRef,
        Extend: [true, true],
      }) as PDFDict;

    case 'radial':
      // Circular radial: r0=0 (point at centre) → r1=0.5 (edge of unit circle).
      // evidence: renderer:36519.
      return doc.context.obj({
        ShadingType: 3,
        ColorSpace: PDFName.of('DeviceRGB'),
        Coords: [0.5, 0.5, 0, 0.5, 0.5, 0.5],
        Function: fnRef,
        Extend: [true, true],
      }) as PDFDict;

    case 'toBottom':
    default:
      return doc.context.obj({
        ShadingType: 2,
        ColorSpace: PDFName.of('DeviceRGB'),
        // PDF y: 1 = top of normalised box, 0 = bottom.
        Coords: [0.5, 1, 0.5, 0],
        Function: fnRef,
        Extend: [true, true],
      }) as PDFDict;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** True if a fill type requires gradient shading instead of a solid colour. */
export function isGradientFill(fillType: string | undefined): boolean {
  return (
    fillType === 'toRight' ||
    fillType === 'toBottom' ||
    fillType === 'toLeft' ||
    fillType === 'toTop' ||
    fillType === 'radial'
  );
}

/**
 * Emit a PDF shading fill for gradient fill types.
 *
 * Sequence emitted (evidence: pdfldriver:40203):
 *   q                      — save graphics state
 *   x y w h re W n        — clip to fill box
 *   w 0 0 h x y cm        — map [0,1]² normalised shading → fill box
 *   sh <ShadingName>       — paint shading
 *   Q                      — restore graphics state
 *
 * @param pdfPage  Target page
 * @param fillType 'toRight'|'toBottom'|'toLeft'|'toTop'|'radial'
 * @param c0       Start colour (XFA `<color>` element)
 * @param c1       End colour (XFA `color2`, defaults to white when absent)
 * @param x        Left edge of fill box (PDF coords, y-flipped)
 * @param y        Bottom edge of fill box (PDF coords)
 * @param w        Box width (points)
 * @param h        Box height (points)
 */
export function drawGradientFill(
  pdfPage: PDFPage,
  fillType: string,
  c0: RgbColor,
  c1: RgbColor,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (w <= 0 || h <= 0) return;

  const doc = pdfPage.doc;
  const cache = getDocCache(doc);

  // Cache per (fillType, c0, c1) — identical combos share a shading object.
  const key = `${fillType}|${c0.r},${c0.g},${c0.b}|${c1.r},${c1.g},${c1.b}`;
  let shadingName = cache.get(key);
  if (!shadingName) {
    const sd = buildNormalisedShading(doc, fillType, c0, c1);
    shadingName = registerShading(pdfPage, sd);
    cache.set(key, shadingName);
  }

  // CTM maps [0,1]×[0,1] → fill box [x,x+w]×[y,y+h]:
  //   x' = w*xn + x,  y' = h*yn + y
  //   PDF cm matrix [a b c d e f]: a=w b=0 c=0 d=h e=x f=y
  pdfPage.pushOperators(
    pushGraphicsState(),
    // Clip to fill box (in user space BEFORE the CTM).
    rectangle(x, y, w, h),
    clip(),
    endPath(),
    // Apply CTM.
    concatTransformationMatrix(w, 0, 0, h, x, y),
    // Paint shading.
    PDFOperator.of(Ops.ShadingFill, [PDFName.of(shadingName)]),
    popGraphicsState(),
  );
}

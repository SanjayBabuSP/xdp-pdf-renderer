
import {
  PDFPage,
  PDFName,
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

export function isGray(color: RgbColor): boolean {
  return color.r === color.g && color.g === color.b;
}

export function grayLevel(color: RgbColor): number {
  return color.r / 255;
}

const shadingCache = new WeakMap<PDFPage['doc'], Map<string, string>>();

function getDocCache(doc: PDFPage['doc']): Map<string, string> {
  let cache = shadingCache.get(doc);
  if (!cache) {
    cache = new Map();
    shadingCache.set(doc, cache);
  }
  return cache;
}

function registerShading(pdfPage: PDFPage, shadingDict: PDFDict): string {
  const doc = pdfPage.doc;
  const cache = getDocCache(doc);
  const name = `Sh${cache.size}`;

  pdfPage.node.normalize();

  const resDictOrRef = pdfPage.node.getInheritableAttribute(PDFName.of('Resources'));
  const resDict = doc.context.lookupMaybe(resDictOrRef, PDFDict);
  if (!resDict) return name;

  let shadingResDict = resDict.lookupMaybe(PDFName.of('Shading'), PDFDict);
  if (!shadingResDict) {
    shadingResDict = doc.context.obj({}) as PDFDict;
    resDict.set(PDFName.of('Shading'), shadingResDict);
  }

  const shadingRef = doc.context.register(shadingDict);
  shadingResDict.set(PDFName.of(name), shadingRef);
  return name;
}

function buildColorFunction(doc: PDFPage['doc'], c0: RgbColor, c1: RgbColor) {
  return doc.context.obj({
    FunctionType: 2,
    Domain: [0, 1],
    C0: [c0.r / 255, c0.g / 255, c0.b / 255],
    C1: [c1.r / 255, c1.g / 255, c1.b / 255],
    N: 1,
  });
}

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
        Coords: [0.5, 1, 0.5, 0],
        Function: fnRef,
        Extend: [true, true],
      }) as PDFDict;
  }
}

export function isGradientFill(fillType: string | undefined): boolean {
  return (
    fillType === 'toRight' ||
    fillType === 'toBottom' ||
    fillType === 'toLeft' ||
    fillType === 'toTop' ||
    fillType === 'radial'
  );
}

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

  const key = `${fillType}|${c0.r},${c0.g},${c0.b}|${c1.r},${c1.g},${c1.b}`;
  let shadingName = cache.get(key);
  if (!shadingName) {
    const sd = buildNormalisedShading(doc, fillType, c0, c1);
    shadingName = registerShading(pdfPage, sd);
    cache.set(key, shadingName);
  }

  pdfPage.pushOperators(
    pushGraphicsState(),
    rectangle(x, y, w, h),
    clip(),
    endPath(),
    concatTransformationMatrix(w, 0, 0, h, x, y),
    PDFOperator.of(Ops.ShadingFill, [PDFName.of(shadingName)]),
    popGraphicsState(),
  );
}

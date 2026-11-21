import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
} from 'pdf-lib';

export interface OpacityOptions {
  fill?: number;
  stroke?: number;
}

const extGStateCache = new WeakMap<PDFDocument, Map<string, string>>();
const groupPages = new WeakSet<PDFPage>();

const dedupedPages = new WeakSet<PDFPage>();

export function dedupePageFontResources(pdfPage: PDFPage): void {
  if (dedupedPages.has(pdfPage)) return;
  dedupedPages.add(pdfPage);

  const original = pdfPage.setFont.bind(pdfPage);
  const seen = new Map<unknown, string>();

  pdfPage.setFont = (font: unknown): void => {
    const existing = seen.get(font);
    if (existing !== undefined) {
      (pdfPage as unknown as { font: unknown }).font = font;
      (pdfPage as unknown as { fontKey: string }).fontKey = existing;
      return;
    }
    original(font as Parameters<typeof original>[0]);
    const key = (pdfPage as unknown as { fontKey: string }).fontKey;
    if (key) seen.set(font, key);
  };
}

function isTransparent(alpha: number | undefined): boolean {
  return alpha != null && alpha > 0 && alpha < 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

export function beginOpacityScope(pdfPage: PDFPage, options: OpacityOptions): boolean {
  const ca = isTransparent(options.fill) ? clamp01(options.fill!) : undefined;
  const CA = isTransparent(options.stroke) ? clamp01(options.stroke!) : undefined;
  if (ca == null && CA == null) return false;

  const doc = pdfPage.doc;
  const key = `${ca ?? '-'}|${CA ?? '-'}`;
  let cache = extGStateCache.get(doc);
  if (!cache) {
    cache = new Map();
    extGStateCache.set(doc, cache);
  }
  let name = cache.get(key);
  if (!name) {
    const extGState = doc.context.obj({ Type: 'ExtGState', BM: 'Normal' });
    if (ca != null) extGState.set(PDFName.of('ca'), PDFNumber.of(ca));
    if (CA != null) extGState.set(PDFName.of('CA'), PDFNumber.of(CA));
    const ref = doc.context.register(extGState);
    name = `GS${cache.size}`;
    pdfPage.node.setExtGState(PDFName.of(name), ref);
    cache.set(key, name);
  }

  pdfPage.pushOperators(pushGraphicsState(), setGraphicsState(name));
  groupPages.add(pdfPage);
  return true;
}

export function endOpacityScope(pdfPage: PDFPage, started: boolean): void {
  if (started) pdfPage.pushOperators(popGraphicsState());
}

export function pageUsesTransparency(pdfPage: PDFPage): boolean {
  return groupPages.has(pdfPage);
}

export function applyPageTransparencyGroup(pdfPage: PDFPage): void {
  if (!pageUsesTransparency(pdfPage)) return;
  const doc = pdfPage.doc;
  if (pdfPage.node.get(PDFName.of('Group'))) return;
  pdfPage.node.set(
    PDFName.of('Group'),
    doc.context.obj({ Type: 'Group', S: 'Transparency', CS: PDFName.of('DeviceRGB') })
  );
}

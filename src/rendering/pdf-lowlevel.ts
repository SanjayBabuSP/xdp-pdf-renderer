import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFPage,
  popGraphicsState,
  pushGraphicsState,
  setGraphicsState,
} from 'pdf-lib';

/**
 * Low-level PDF graphics-state helpers: transparency (ExtGState) and the
 * page-level transparency group.
 *
 * Adobe emits alpha through the PDF ExtGState dictionary:
 *   - fill opacity     → `/ca`   (pdfdocument:144010-144012 PDEExtGStateCreateNew
 *                                  + PDEExtGStateSetOpacityFill)
 *   - stroke opacity   → `/CA`   (pdfdocument:138444-138447 PDEExtGStateSetOpacityStroke)
 *   - page group       → `/Group << /S /Transparency /CS /DeviceRGB >>`
 *                                  (pdfldriver:61272-61300 FUN_19750570)
 */

export interface OpacityOptions {
  /** 0..1 fill alpha (`/ca`). */
  fill?: number;
  /** 0..1 stroke alpha (`/CA`). */
  stroke?: number;
}

/** Alpha values already registered, per document, to avoid duplicate resources. */
const extGStateCache = new WeakMap<PDFDocument, Map<string, string>>();
const groupPages = new WeakSet<PDFPage>();

function isTransparent(alpha: number | undefined): boolean {
  return alpha != null && alpha > 0 && alpha < 1;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Begin a transparency scope: push `q` and select an ExtGState holding the
 * requested alphas. Returns true when a state was pushed (caller must call
 * [[endOpacityScope]]).
 */
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

/** Close a scope opened by [[beginOpacityScope]]. */
export function endOpacityScope(pdfPage: PDFPage, started: boolean): void {
  if (started) pdfPage.pushOperators(popGraphicsState());
}

/** True when alpha was used on this page (its transparency group is required). */
export function pageUsesTransparency(pdfPage: PDFPage): boolean {
  return groupPages.has(pdfPage);
}

/**
 * Mark the page as a transparency group (Adobe sets this for every page that
 * contains alpha). Idempotent — safe to call once per page.
 */
export function applyPageTransparencyGroup(pdfPage: PDFPage): void {
  if (!pageUsesTransparency(pdfPage)) return;
  const doc = pdfPage.doc;
  if (pdfPage.node.get(PDFName.of('Group'))) return;
  pdfPage.node.set(
    PDFName.of('Group'),
    doc.context.obj({ Type: 'Group', S: 'Transparency', CS: PDFName.of('DeviceRGB') })
  );
}

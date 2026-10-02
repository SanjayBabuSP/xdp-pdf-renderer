import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

/**
 * PDF catalog metadata driven by the XDP `<config><present><pdf>` block.
 *
 * `pdfVersion` and `adobeExtensionLevel` were parsed by `parse-xdp.ts:993-994`
 * but never written to the output PDF (G16).
 */

const VERSION_PATTERN = /^\d+\.\d+$/;

/**
 * Write `/Version` into the document catalog. pdf-lib always emits the `%PDF-1.7`
 * header, so this only *names* the effective version (harmless for ≤ 1.7 and the
 * correct way to advertise a lower version). Unparseable values are ignored.
 */
export function applyPdfVersion(doc: PDFDocument, version: string): void {
  const normalized = version.trim();
  if (!VERSION_PATTERN.test(normalized)) return;
  doc.catalog.set(PDFName.of('Version'), PDFName.of(normalized));
}

/**
 * Write the Adobe extension dictionary the PDF spec defines for vendor
 * extensions: `/Extensions << /ADBE << /BaseVersion /1.7 /ExtensionLevel N >> >>`.
 * Levels ≤ 0 are ignored.
 */
export function applyAdobeExtensionLevel(
  doc: PDFDocument,
  extensionLevel: number,
  baseVersion = '1.7',
): void {
  if (!Number.isFinite(extensionLevel) || extensionLevel <= 0) return;
  const base = VERSION_PATTERN.test(baseVersion.trim()) ? baseVersion.trim() : '1.7';

  const extensions = doc.context.obj({
    ADBE: doc.context.obj({
      BaseVersion: PDFName.of(base),
      ExtensionLevel: PDFNumber.of(extensionLevel),
    }),
  });
  doc.catalog.set(PDFName.of('Extensions'), extensions);
}

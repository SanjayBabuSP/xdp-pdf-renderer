import { PDFDocument, PDFName, PDFNumber } from 'pdf-lib';

const VERSION_PATTERN = /^\d+\.\d+$/;

export function applyPdfVersion(doc: PDFDocument, version: string): void {
  const normalized = version.trim();
  if (!VERSION_PATTERN.test(normalized)) return;
  doc.catalog.set(PDFName.of('Version'), PDFName.of(normalized));
}

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

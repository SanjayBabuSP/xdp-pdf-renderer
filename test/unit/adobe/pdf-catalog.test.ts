import { PDFDocument, PDFName, PDFDict } from 'pdf-lib';
import { applyPdfVersion, applyAdobeExtensionLevel } from '../../../src/adobe/pdf-catalog';

describe('G16 — PDF catalog metadata', () => {
  it('writes /Version and the Adobe /Extensions dictionary', async () => {
    const doc = await PDFDocument.create();
    applyPdfVersion(doc, '1.6');
    applyAdobeExtensionLevel(doc, 8, '1.7');

    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.catalog.get(PDFName.of('Version'))?.toString()).toBe('/1.6');

    const extensions = reloaded.catalog.get(PDFName.of('Extensions')) as PDFDict;
    const adbe = extensions.get(PDFName.of('ADBE')) as PDFDict;
    expect(adbe.get(PDFName.of('BaseVersion'))?.toString()).toBe('/1.7');
    expect(adbe.get(PDFName.of('ExtensionLevel'))?.toString()).toBe('8');
  });

  it('ignores unparseable versions and non-positive levels', async () => {
    const doc = await PDFDocument.create();
    applyPdfVersion(doc, 'not-a-version');
    applyAdobeExtensionLevel(doc, 0);

    const reloaded = await PDFDocument.load(await doc.save());
    expect(reloaded.catalog.get(PDFName.of('Version'))).toBeUndefined();
    expect(reloaded.catalog.get(PDFName.of('Extensions'))).toBeUndefined();
  });
});

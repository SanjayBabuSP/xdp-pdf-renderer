import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRawStream,
  PDFStream,
  PDFBool,
  decodePDFRawStream,
} from 'pdf-lib';
import {
  applyDocumentMetadata,
  setNeedsRendering,
  preserveInfoOverrides,
} from '../../../src/adobe/pdf-metadata';

const PRODUCER = 'xdp-pdf-renderer (Adobe LiveCycle Designer compatible)';
const CREATOR = 'Adobe LiveCycle Designer 11.0';

const metadataStream = (doc: PDFDocument): PDFRawStream =>
  doc.catalog.lookup(PDFName.of('Metadata'), PDFStream) as PDFRawStream;
const xmpOf = (doc: PDFDocument): string =>
  new TextDecoder().decode(decodePDFRawStream(metadataStream(doc)).decode());

describe('G16 — document metadata', () => {
  it('writes info fields, XMP metadata and viewer preferences', async () => {
    const doc = await PDFDocument.create();

    applyDocumentMetadata(
      doc,
      { title: 'A & B <C>', description: 'Desc', author: 'Alice' },
      { producer: 'MyProducer', creatorTool: 'MyTool' }
    );

    expect(doc.getTitle()).toBe('A & B <C>');
    expect(doc.getAuthor()).toBe('Alice');
    expect(doc.getProducer()).toBe('MyProducer');
    expect(doc.getCreator()).toBe('MyTool');
    const xml = xmpOf(doc);
    expect(xml.includes('A &amp; B &lt;C&gt;')).toBe(true);
    expect(xml.includes('Desc')).toBe(true);
    expect(xml.includes('Alice')).toBe(true);
    expect(xml.includes('<xmp:CreatorTool>MyTool</xmp:CreatorTool>')).toBe(true);
    expect(xml.includes('<pdf:Producer>MyProducer</pdf:Producer>')).toBe(true);
    expect(
      /<xmp:MetadataDate>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z<\/xmp:MetadataDate>/.test(xml)
    ).toBe(true);
    expect(/uuid:[0-9a-f]{20}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{16}-[0-9a-f]{32}/.test(xml)).toBe(
      true
    );

    const metadata = metadataStream(doc).dict;
    expect(metadata.get(PDFName.of('Type'))?.toString()).toBe('/Metadata');
    expect(metadata.get(PDFName.of('Subtype'))?.toString()).toBe('/XML');
    const prefs = doc.catalog.lookup(PDFName.of('ViewerPreferences'), PDFDict);
    expect((prefs.get(PDFName.of('DisplayDocTitle')) as PDFBool).asBoolean()).toBe(true);
  });

  it('uses defaults and omits viewer preferences when there is no title', async () => {
    const doc = await PDFDocument.create();

    applyDocumentMetadata(doc, undefined);

    expect(doc.getTitle()).toBeUndefined();
    expect(doc.getProducer()).toBe(PRODUCER);
    expect(doc.getCreator()).toBe(CREATOR);
    expect(doc.catalog.get(PDFName.of('ViewerPreferences'))).toBeUndefined();
    expect(xmpOf(doc).includes(`x:xmptk="${PRODUCER}"`)).toBe(true);
  });

  it('sets the NeedsRendering catalog flag', async () => {
    const doc = await PDFDocument.create();

    setNeedsRendering(doc);

    expect((doc.catalog.get(PDFName.of('NeedsRendering')) as PDFBool).asBoolean()).toBe(true);
  });

  it('overrides producer and creator when the info dictionary is updated', async () => {
    const doc = await PDFDocument.create();
    const patchable = doc as unknown as { updateInfoDict: () => void };

    preserveInfoOverrides(doc, { producer: 'OverrideProducer', creatorTool: 'OverrideTool' });
    patchable.updateInfoDict();

    expect(doc.getProducer()).toBe('OverrideProducer');
    expect(doc.getCreator()).toBe('OverrideTool');
  });

  it('uses default producer and creator for the info override patch', async () => {
    const doc = await PDFDocument.create();
    const patchable = doc as unknown as { updateInfoDict: () => void };

    preserveInfoOverrides(doc);
    patchable.updateInfoDict();

    expect(doc.getProducer()).toBe(PRODUCER);
    expect(doc.getCreator()).toBe(CREATOR);
  });
});

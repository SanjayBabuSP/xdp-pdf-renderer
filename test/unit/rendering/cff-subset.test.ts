import fs from 'fs';
import path from 'path';
import { decodePDFRawStream, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { createPatchedFontkit } from '../../../src/rendering/cff-subset-patch';

describe('CFF font subsets', () => {
  it('emits a valid CFF header offSize for embedded CFF fonts', async () => {
    const fontPath = path.resolve(__dirname, '../../../assets/fonts/adobe/LetterGothicStd.otf');
    const doc = await PDFDocument.create();
    doc.registerFontkit(createPatchedFontkit());
    const font = await doc.embedFont(fs.readFileSync(fontPath), { subset: true });
    doc.addPage().drawText('A', { x: 10, y: 10, size: 12, font });

    await doc.save();
    const subtype = PDFName.of('Subtype');
    const fontStreams = doc.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj)
      .filter((obj): obj is PDFRawStream => obj instanceof PDFRawStream)
      .filter((stream) => {
        const value = stream.dict.lookup(subtype);
        return value instanceof PDFName && value.decodeText() === 'CIDFontType0C';
      });

    expect(fontStreams.length).toBeGreaterThan(0);
    for (const stream of fontStreams) {
      const bytes = decodePDFRawStream(stream).decode();
      expect(bytes[0]).toBe(1);
      expect(bytes[1]).toBe(0);
      expect(bytes[2]).toBe(4);
      expect([1, 2, 3, 4]).toContain(bytes[3]);
    }
  });

  it('leaves non-CFF subsets unmodified', async () => {
    const fontPath = path.resolve(__dirname, '../../../assets/fonts/DejaVuSans.ttf');
    const doc = await PDFDocument.create();
    doc.registerFontkit(createPatchedFontkit());
    const font = await doc.embedFont(fs.readFileSync(fontPath), { subset: true });
    doc.addPage().drawText('Test', { x: 10, y: 10, size: 12, font });

    const saved = Buffer.from(await doc.save({ useObjectStreams: false })).toString('latin1');
    expect(saved).toContain('/FontFile2');
    expect(saved).not.toContain('/FontFile3');
  });
});

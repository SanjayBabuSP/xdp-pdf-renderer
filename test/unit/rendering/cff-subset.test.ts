import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { createPatchedFontkit } from '../../../src/rendering/cff-subset-patch';

describe('non-CFF font subsets', () => {
  it('leaves TrueType subsets unmodified', async () => {
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

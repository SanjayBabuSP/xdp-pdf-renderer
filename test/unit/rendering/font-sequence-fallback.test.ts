import { PDFDocument } from 'pdf-lib';
import { FontManager } from '../../../src/rendering/font-manager';

/**
 * G16 — `font-sequences.ts` fallback chains: a family with no embedded face and
 * no base-14 counterpart should follow its Adobe `<seq>` chain (here to Times)
 * instead of dropping straight to the bundled Unicode font.
 */
describe('G16 — FontManager font-sequence fallback', () => {
  it('resolves a serif family through its sequence to a base-14 font', async () => {
    const doc = await PDFDocument.create();
    const manager = new FontManager(doc);

    const garamond = await manager.getFont('Garamond');
    const times = await manager.getFont('Times New Roman');
    expect(garamond.name).toBe(times.name);
    expect(garamond.name).toContain('Times');
  });

  it('does not change families that already resolve directly', async () => {
    const doc = await PDFDocument.create();
    const manager = new FontManager(doc);
    const helvetica = await manager.getFont('Helvetica');
    expect(helvetica.name).toContain('Helvetica');
  });
});

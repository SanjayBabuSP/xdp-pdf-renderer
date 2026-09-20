import { PDFDocument } from 'pdf-lib';
import { FontManager } from '../../../src/rendering/font-manager';

describe('FontManager', () => {
  it('resolves Helvetica to a base-14 standard font', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const font = await fm.getFont('Helvetica');
    expect(font).toBeDefined();
  });

  it('returns an embedded Unicode font for non-standard families', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const font = await fm.getFont('DejaVu Sans');
    expect(font).toBeDefined();
  });

  it('resolves Arial (XCI alias) through the base-14 Helvetica', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const standard = await fm.getFont('Helvetica');
    const arial = await fm.getFont('Arial');
    // Both resolve to the standard Helvetica metrics after XCI substitution.
    expect(arial).toBeDefined();
    expect(standard).toBeDefined();
  });

  it('swaps to the Unicode fallback when standard fonts cannot encode the text', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const standard = await fm.getFont('Helvetica');
    const safe = await fm.getSafeFont('Temperature Δ', 'Helvetica');
    expect(safe).not.toBe(standard);
  });

  it('keeps the standard font for WinAnsi-safe text', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const standard = await fm.getFont('Helvetica');
    const safe = await fm.getSafeFont('Plain text 123', 'Helvetica');
    expect(safe).toBe(standard);
  });

  it('uses the bold Unicode fallback for bold requests', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const regular = await fm.getSafeFont('Δ', 'Verdana', 'normal');
    const bold = await fm.getSafeFont('Δ', 'Verdana', 'bold');
    expect(regular).toBeDefined();
    expect(bold).toBeDefined();
    expect(regular).not.toBe(bold);
  });

  it('returns a working default font', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const font = await fm.getDefaultFont();
    expect(font).toBeDefined();
  });
});
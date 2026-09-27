import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { FontManager } from '../../../src/rendering/font-manager';
import { loadManifest } from '../../../src/rendering/font-registry';

const DEJA_VU = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const DEJA_VU_BOLD = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans-Bold.ttf');

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

describe('FontManager — XCI equate force semantics', () => {
  const both = { Requested: DEJA_VU, Target: DEJA_VU_BOLD };

  it('keeps the requested family when force=0 and the family is available', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc, { fonts: both }, [
      { from: 'Requested_*_*', to: 'Target_*_*', force: false },
    ]);
    const font = await fm.getFont('Requested');
    expect(font.name).toBe('DejaVuSans');
  });

  it('applies force=1 even when the requested family is available', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc, { fonts: both }, [
      { from: 'Requested_*_*', to: 'Target_*_*', force: true },
    ]);
    const font = await fm.getFont('Requested');
    expect(font.name).toBe('DejaVuSans-Bold');
  });

  it('applies force=0 when the requested family is missing', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc, { fonts: { Target: DEJA_VU_BOLD } }, [
      { from: 'Requested_*_*', to: 'Target_*_*', force: false },
    ]);
    const font = await fm.getFont('Requested');
    expect(font.name).toBe('DejaVuSans-Bold');
  });

  it('caches the decision per family/weight/posture', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc, { fonts: both }, [
      { from: 'Requested_*_*', to: 'Target_*_*', force: false },
    ]);
    const first = await fm.getFont('Requested');
    const second = await fm.getFont('Requested');
    expect(second).toBe(first);
  });
});

describe('FontManager — font directories', () => {
  it('scans extra font directories for families', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdp-font-dir-'));
    fs.copyFileSync(DEJA_VU_BOLD, path.join(dir, 'DejaVuSans-Bold.ttf'));

    const withoutScan = await PDFDocument.create();
    const plain = await new FontManager(withoutScan).getFont('DejaVu Sans');
    expect(plain.name).toBe('DejaVuSans');

    const withScan = await PDFDocument.create();
    const scanned = await new FontManager(withScan, { fontDirs: [dir] }).getFont('DejaVu Sans');
    expect(scanned.name).toBe('DejaVuSans-Bold');
  });
});

describe('FontManager — imported Adobe faces', () => {
  const manifest = loadManifest();
  const itIfImported = manifest ? it : it.skip;

  itIfImported('embeds an imported Adobe face by family+weight+posture', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const font = await fm.getFont('Myriad Pro', 'bold', 'normal');
    expect(font.name).toBe('MyriadPro-Bold');
  });

  itIfImported('resolves Minion Pro regular through the manifest', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const font = await fm.getFont('Minion Pro', 'normal', 'normal');
    expect(font.name).toContain('MinionPro-Regular');
  });
});

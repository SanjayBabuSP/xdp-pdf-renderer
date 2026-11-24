import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PDFDocument } from 'pdf-lib';
import { FontFileNotFoundError, FontManager } from '../../../src/rendering/font-manager';
import { loadManifest } from '../../../src/rendering/font-registry';
import { sanitizeTextForFont } from '../../../src/rendering/text/glyph-coverage';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual<typeof import('fs/promises')>('fs/promises');
  return { ...actual, readFile: jest.fn(actual.readFile) };
});

const DEJA_VU = path.join(__dirname, '..', '..', '..', 'assets', 'fonts', 'DejaVuSans.ttf');
const DEJA_VU_BOLD = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'assets',
  'fonts',
  'DejaVuSans-Bold.ttf'
);

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

  it('resolves Arial to the bundled subset instead of the base-14 Helvetica', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const arial = await fm.getFont('Arial');
    expect(arial.name).toBe('ArialMT');
    expect(arial.name).not.toMatch(/DejaVu|Helvetica/);
  });

  it('uses metric-compatible base-14 variants for bold and italic Arial', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    expect((await fm.getFont('Arial')).name).toBe('ArialMT');
    expect((await fm.getFont('Arial', 'bold')).name).toBe('Helvetica-Bold');
    expect((await fm.getFont('Arial', 'normal', 'italic')).name).toBe('Helvetica-Oblique');
    expect((await fm.getFont('Arial', 'bold', 'italic')).name).toBe('Helvetica-BoldOblique');
  });

  it('keeps the resolved font when text contains unmappable glyphs', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc);
    const standard = await fm.getFont('Helvetica');
    const safe = await fm.getSafeFont('Temperature Δ', 'Helvetica');
    expect(safe).toBe(standard);
    expect(sanitizeTextForFont('Temperature Δ', safe)).toBe('Temperature ');
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

describe('FontManager — font file handling', () => {
  it('reports a missing font file as FONT_NOT_FOUND', async () => {
    const doc = await PDFDocument.create();
    const fm = new FontManager(doc, { fonts: { Missing: '/no/such/font.ttf' } });
    await expect(fm.getFont('Missing')).rejects.toBeInstanceOf(FontFileNotFoundError);
    await expect(fm.getFont('Missing')).rejects.toMatchObject({ code: 'REN_5001' });
  });

  it('reuses font bytes across manager instances', async () => {
    jest.mocked(fsp.readFile).mockClear();
    for (let i = 0; i < 2; i++) {
      const doc = await PDFDocument.create();
      const fm = new FontManager(doc, { fonts: { Cached: DEJA_VU } });
      const font = await fm.getFont('Cached');
      expect(font.name).toBe('DejaVuSans');
    }
    const reads = jest.mocked(fsp.readFile).mock.calls.filter(([filePath]) => filePath === DEJA_VU);
    expect(reads.length).toBeLessThanOrEqual(1);
  });

  it('shares one default font read across concurrent preloads', async () => {
    jest.mocked(fsp.readFile).mockClear();
    const docs = await Promise.all([PDFDocument.create(), PDFDocument.create()]);
    const managers = docs.map((doc) => new FontManager(doc));
    await Promise.all(managers.map((fm) => fm.preload()));
    const reads = jest
      .mocked(fsp.readFile)
      .mock.calls.filter(([filePath]) => String(filePath).includes('DejaVuSans.ttf'));
    expect(reads.length).toBeLessThanOrEqual(1);
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

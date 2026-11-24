import { PDFDocument } from 'pdf-lib';
import { measureLayoutText } from '../../../src/domain/layout/text-measure';
import { FontManager } from '../../../src/rendering/font-manager';
import { familyKey } from '../../../src/rendering/font-registry';
import { isCondensedFamily, NARROW_SCALE } from '../../../src/rendering/standard-fonts';
import { itWithImportedFaces } from '../../helpers/adobe-fonts';

async function newManager(): Promise<FontManager> {
  return new FontManager(await PDFDocument.create(), {}, []);
}

async function backingPsName(family: string, weight?: string, posture?: string): Promise<string> {
  const font = await (await newManager()).getFont(family, weight, posture);
  return font.embedder?.font?.PostScriptName ?? font.name ?? 'unknown';
}

describe('font resolution — metric compatibility', () => {
  it('resolves Arial to the bundled subset and ArialMT to the base-14 alias', async () => {
    expect(await backingPsName('Arial')).toBe('ArialMT');
    expect(await backingPsName('ArialMT')).toBe('Helvetica');
    expect(await backingPsName('Arial')).not.toMatch(/DejaVu/i);
  });

  it('resolves the Windows metric clones to their expected faces', async () => {
    expect(await backingPsName('Arial')).toBe('ArialMT');
    expect(await backingPsName('Times New Roman')).toBe('Times-Roman');
    expect(await backingPsName('Courier New')).toBe('Courier');
  });

  it('gives Arial and Helvetica identical advance widths for shared Latin glyphs', async () => {
    const arial = await (await newManager()).getFont('Arial');
    const helvetica = await (await newManager()).getFont('Helvetica');
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ') {
      expect(arial.widthOfTextAtSize(ch, 1000)).toBeCloseTo(
        helvetica.widthOfTextAtSize(ch, 1000),
        0
      );
    }
  });

  it('resolves Arial Narrow to a base-14 stand-in, not the Unicode fallback', async () => {
    expect(await backingPsName('Arial Narrow')).toBe('Helvetica');
    expect(await backingPsName('Arial Narrow')).not.toMatch(/DejaVu/i);
  });

  it('resolves Arial Narrow bold to the base-14 bold face', async () => {
    expect(await backingPsName('Arial Narrow', 'bold')).toBe('Helvetica-Bold');
  });

  it('keeps condensed scaling separate from bold face selection', () => {
    const text = 'Ruvlviqd Rjcfqtk:';
    expect(isCondensedFamily('Arial Narrow')).toBe(true);
    expect(isCondensedFamily('Helvetica')).toBe(false);
    expect(measureLayoutText(text, 10, { family: 'Arial Narrow', weight: 'bold' })).toBeCloseTo(
      measureLayoutText(text, 10, { family: 'Helvetica', weight: 'bold' }) * NARROW_SCALE,
      5
    );
  });

  it('keeps genuinely unknown families on the Unicode fallback', async () => {
    expect(await backingPsName('NoSuchFontXYZ')).toMatch(/DejaVu/i);
  });
});

describe('font resolution — substitution rules', () => {
  it('applies force=0 equates only when the requested font is unavailable', async () => {
    const fm = await newManager();
    expect(await fm.getFont('Helvetica')).toBe(await fm.getFont('Helvetica'));
    expect(await backingPsName('Helvetica')).toBe('Helvetica');
  });

  itWithImportedFaces(['Myriad Pro'])(
    'embeds the imported Adobe faces when a manifest is present',
    async () => {
      const ps = await backingPsName('Myriad Pro');
      expect(ps).toMatch(/MyriadPro/i);
    }
  );

  itWithImportedFaces(['Minion Pro'])(
    'resolves Adobe-provided Minion Pro rather than substituting',
    async () => {
      expect(await backingPsName('Minion Pro')).toMatch(/MinionPro/i);
    }
  );
});

describe('familyKey', () => {
  it('is case- and whitespace-insensitive so cache lookups match', () => {
    expect(familyKey('Arial')).toBe(familyKey('  arial '));
  });
});

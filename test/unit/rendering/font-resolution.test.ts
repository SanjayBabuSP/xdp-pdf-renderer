import { PDFDocument } from 'pdf-lib';
import { FontManager } from '../../../src/rendering/font-manager';
import { familyKey } from '../../../src/rendering/font-registry';
import { itWithImportedFaces } from '../../helpers/adobe-fonts';

async function newManager(): Promise<FontManager> {
  return new FontManager(await PDFDocument.create(), {}, []);
}

async function backingPsName(family: string): Promise<string> {
  const font = await (await newManager()).getFont(family);
  return font.embedder?.font?.PostScriptName ?? font.name ?? 'unknown';
}

async function avgAdvanceEm(family: string): Promise<number> {
  const font = await (await newManager()).getFont(family);
  let sum = 0;
  let n = 0;
  for (let c = 32; c <= 126; c++) {
    const w = font.widthOfTextAtSize(String.fromCharCode(c), 1000);
    if (Number.isFinite(w)) {
      sum += w;
      n++;
    }
  }
  return sum / n;
}

describe('font resolution — metric compatibility', () => {
  it('resolves ArialMT to the same face as Arial, not the Unicode fallback', async () => {
    expect(await backingPsName('ArialMT')).toBe(await backingPsName('Arial'));
    expect(await backingPsName('ArialMT')).not.toMatch(/DejaVu/i);
  });

  it('resolves the Windows metric clones to their base-14 counterparts', async () => {
    expect(await backingPsName('Arial')).toBe('Helvetica');
    expect(await backingPsName('Times New Roman')).toBe('Times-Roman');
    expect(await backingPsName('Courier New')).toBe('Courier');
  });

  it('gives Arial and Helvetica identical advance widths', async () => {
    expect(await avgAdvanceEm('Arial')).toBeCloseTo(await avgAdvanceEm('Helvetica'), 3);
  });

  it('resolves Arial Narrow to a condensed face, not full-width Helvetica', async () => {
    const narrow = await avgAdvanceEm('Arial Narrow');
    const full = await avgAdvanceEm('Arial');
    expect(narrow).toBeCloseTo(full, 3);
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

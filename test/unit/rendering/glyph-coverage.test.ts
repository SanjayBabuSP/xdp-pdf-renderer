import * as fs from 'fs';
import * as path from 'path';
import { PDFDocument, type PDFFont } from 'pdf-lib';
import { createPatchedFontkit } from '../../../src/rendering/cff-subset-patch';
import { hasGlyph, sanitizeTextForFont } from '../../../src/rendering/text/glyph-coverage';

const FONT_DIR = path.join(__dirname, '..', '..', '..', 'assets', 'fonts');

async function embedFont(relativePath: string): Promise<PDFFont> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(createPatchedFontkit());
  return doc.embedFont(fs.readFileSync(path.join(FONT_DIR, relativePath)), { subset: true });
}

describe('sanitizeTextForFont', () => {
  it('omits Greek code points absent from the Arial subset', async () => {
    const font = await embedFont('Arial-Regular.ttf');

    expect(sanitizeTextForFont('ΞF mqx', font)).toBe('F mqx');
  });

  it('keeps full printable ASCII including ampersand in the bundled Arial subset', async () => {
    const font = await embedFont('Arial-Regular.ttf');
    const printable = Array.from({ length: 0x5f }, (_, i) => String.fromCharCode(0x20 + i)).join(
      ''
    );

    expect(sanitizeTextForFont('A&B', font)).toBe('A&B');
    expect(sanitizeTextForFont(printable, font)).toBe(printable);
    expect(hasGlyph(font, 0x26)).toBe(true);
  });

  it('preserves tabs and newlines but swaps uncovered blank separators for spaces', async () => {
    const font = await embedFont('Arial-Regular.ttf');

    expect(sanitizeTextForFont('a\tb\nc  d', font)).toBe('a\tb\nc  d');
    expect(sanitizeTextForFont('a b', font)).toBe('a b');
    expect(sanitizeTextForFont('a b', font)).toBe('a b');
  });

  it('keeps non-breaking spaces covered by the font', async () => {
    const font = await embedFont('DejaVuSans.ttf');

    expect(sanitizeTextForFont('a b', font)).toBe('a b');
  });

  it('drops astral code points while keeping supported BMP characters', async () => {
    const font = await embedFont('Arial-Regular.ttf');

    expect(sanitizeTextForFont('A😀B', font)).toBe('AB');
  });

  it('returns an empty string when nothing is representable', async () => {
    const font = await embedFont('Arial-Regular.ttf');

    expect(sanitizeTextForFont('Ξξ😀', font)).toBe('');
  });

  it('is idempotent for the same font', async () => {
    const font = await embedFont('Arial-Regular.ttf');
    const once = sanitizeTextForFont('ΞF  mqx', font);

    expect(sanitizeTextForFont(once, font)).toBe(once);
  });

  it('preserves Chinese text supported by an embedded AdobeSongStd face', async () => {
    const font = await embedFont('adobe/AdobeSongStd-Light.otf');

    expect(sanitizeTextForFont('中文测试', font)).toBe('中文测试');
  });

  it('leaves text unchanged when the font exposes no character set', () => {
    const fontLike = { widthOfTextAtSize: () => 1 } as unknown as PDFFont;

    expect(sanitizeTextForFont('ΞF', fontLike)).toBe('ΞF');
  });
});

describe('hasGlyph', () => {
  it('reports coverage from the cached character set', async () => {
    const font = await embedFont('Arial-Regular.ttf');

    expect(hasGlyph(font, 0x039e)).toBe(false);
    expect(hasGlyph(font, 0x41)).toBe(true);
  });
});

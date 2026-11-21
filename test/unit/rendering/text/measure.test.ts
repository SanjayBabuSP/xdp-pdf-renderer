import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import {
  APPROX_CHAR_WIDTH_FACTOR,
  measureText,
  quantizeAdvance,
} from '../../../../src/rendering/text/measure';

describe('quantizeAdvance', () => {
  it('nudges positive advances by +1.75/1000 pt', () => {
    expect(quantizeAdvance(10.0004)).toBe(10.001);
    expect(quantizeAdvance(10)).toBe(10.001);
    expect(quantizeAdvance(0)).toBe(0.001);
  });

  it('nudges negative advances by -1.75/1000 pt', () => {
    expect(quantizeAdvance(-10.0004)).toBe(-10.001);
    expect(quantizeAdvance(-0.0004)).toBe(-0.001);
  });

  it('passes through non-finite advances', () => {
    expect(quantizeAdvance(Number.NaN)).toBeNaN();
    expect(quantizeAdvance(Number.POSITIVE_INFINITY)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('measureText', () => {
  it('returns zero for empty text', () => {
    expect(measureText('', 10)).toBe(0);
  });

  it('falls back to the approximate width when no font is supplied', () => {
    expect(measureText('Hello', 12)).toBe(5 * 12 * APPROX_CHAR_WIDTH_FACTOR);
  });

  it('falls back when the font has no widthOfTextAtSize function', () => {
    const fontLike = {} as PDFFont;
    expect(measureText('Hi', 10, fontLike)).toBe(2 * 10 * APPROX_CHAR_WIDTH_FACTOR);
  });

  it('falls back when the font throws while measuring', () => {
    const throwingFont = {
      widthOfTextAtSize: () => {
        throw new Error('bad font');
      },
    } as unknown as PDFFont;
    expect(measureText('Hello', 10, throwingFont)).toBe(5 * 10 * APPROX_CHAR_WIDTH_FACTOR);
  });

  it('falls back when the measured width is negative', () => {
    const negativeFont = { widthOfTextAtSize: () => -5 } as unknown as PDFFont;
    expect(measureText('Hi', 10, negativeFont)).toBe(2 * 10 * APPROX_CHAR_WIDTH_FACTOR);
  });

  it('quantizes the whole string advance by default', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont(StandardFonts.Helvetica);
    expect(measureText('Hi', 10, font)).toBe(quantizeAdvance(font.widthOfTextAtSize('Hi', 10)));
  });

  it('quantizes each glyph separately when kerning is disabled', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont(StandardFonts.Helvetica);
    const expected = [...'Hi'].reduce(
      (sum, ch) => sum + quantizeAdvance(font.widthOfTextAtSize(ch, 10)),
      0
    );
    expect(measureText('Hi', 10, font, { kerning: false })).toBe(expected);
    expect(measureText('Hi', 10, font, { kerning: true })).toBe(measureText('Hi', 10, font));
  });

  it('applies horizontal scale before the absolute spacing values', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont(StandardFonts.Helvetica);
    const base = measureText('a b', 10, font);
    expect(measureText('a b', 10, font, { horizontalScale: 0.5 })).toBeCloseTo(base * 0.5, 6);
    expect(measureText('a b', 10, font, { charSpacing: 2, wordSpacing: 3 })).toBeCloseTo(
      base + 2 * 2 + 3 * 1,
      6
    );
    expect(
      measureText('a b', 10, font, { charSpacing: 2, wordSpacing: 3, horizontalScale: 0.5 })
    ).toBeCloseTo(base * 0.5 + 2 * 2 + 3 * 1, 6);
  });

  it('ignores spacing options set to zero', async () => {
    const font = await (await PDFDocument.create()).embedStandardFont(StandardFonts.Helvetica);
    expect(measureText('a b', 10, font, { charSpacing: 0, wordSpacing: 0 })).toBe(
      measureText('a b', 10, font)
    );
  });
});

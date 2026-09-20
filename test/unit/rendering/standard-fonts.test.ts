import { StandardFonts } from 'pdf-lib';
import {
  mapToStandardPdfFont,
  base14Family,
  isBase14Family,
  isBoldWeight,
  isItalicPosture,
  isWinAnsiSafe,
} from '../../../src/rendering/standard-fonts';

describe('standard-fonts (Designer.xdc <seq> mapping)', () => {
  describe('mapToStandardPdfFont', () => {
    it('maps Helvetica to its base font', () => {
      expect(mapToStandardPdfFont('Helvetica')).toBe(StandardFonts.Helvetica);
    });

    it('maps Helvetica bold', () => {
      expect(mapToStandardPdfFont('Helvetica', 'bold')).toBe(StandardFonts.HelveticaBold);
    });

    it('maps Helvetica italic', () => {
      expect(mapToStandardPdfFont('Helvetica', undefined, 'italic')).toBe(StandardFonts.HelveticaOblique);
    });

    it('maps Helvetica bold italic → BoldOblique (xdc seq)', () => {
      expect(mapToStandardPdfFont('Helvetica', 'bold', 'italic')).toBe(StandardFonts.HelveticaBoldOblique);
    });

    it('maps Arial → Helvetica (metric-compatible alias)', () => {
      expect(mapToStandardPdfFont('Arial')).toBe(StandardFonts.Helvetica);
    });

    it('maps Times New Roman → Times-Roman', () => {
      expect(mapToStandardPdfFont('Times New Roman')).toBe(StandardFonts.TimesRoman);
    });

    it('maps Times bold italic', () => {
      expect(mapToStandardPdfFont('Times', 'bold', 'italic')).toBe(StandardFonts.TimesRomanBoldItalic);
    });

    it('maps Courier New bold → Courier-Bold (xdc seq)', () => {
      expect(mapToStandardPdfFont('Courier New', 'bold')).toBe(StandardFonts.CourierBold);
    });

    it('maps Symbol', () => {
      expect(mapToStandardPdfFont('Symbol')).toBe(StandardFonts.Symbol);
    });

    it('maps ITC Zapf Dingbats → ZapfDingbats (xdc seq)', () => {
      expect(mapToStandardPdfFont('ITC Zapf Dingbats')).toBe(StandardFonts.ZapfDingbats);
    });

    it('returns undefined for non base-14 families', () => {
      expect(mapToStandardPdfFont('Calibri')).toBeUndefined();
    });

    it('returns undefined for missing family', () => {
      expect(mapToStandardPdfFont(undefined)).toBeUndefined();
      expect(mapToStandardPdfFont('')).toBeUndefined();
    });
  });

  describe('base14Family', () => {
    it('normalizes family names', () => {
      expect(base14Family('courier new')).toBe('courier');
      expect(base14Family('ARIAL')).toBe('helvetica');
    });

    it('returns undefined for unknown families', () => {
      expect(base14Family('Verdana')).toBeUndefined();
    });

    it('isBase14Family reflects the mapping', () => {
      expect(isBase14Family('Helvetica')).toBe(true);
      expect(isBase14Family('Georgia')).toBe(false);
    });
  });

  describe('isBoldWeight / isItalicPosture', () => {
    it('recognizes bold variants', () => {
      expect(isBoldWeight('bold')).toBe(true);
      expect(isBoldWeight('Bold')).toBe(true);
      expect(isBoldWeight('black')).toBe(true);
      expect(isBoldWeight('normal')).toBe(false);
      expect(isBoldWeight(undefined)).toBe(false);
    });

    it('recognizes italic and oblique', () => {
      expect(isItalicPosture('italic')).toBe(true);
      expect(isItalicPosture('Italic')).toBe(true);
      expect(isItalicPosture('oblique')).toBe(true);
      expect(isItalicPosture('normal')).toBe(false);
      expect(isItalicPosture(undefined)).toBe(false);
    });
  });

  describe('isWinAnsiSafe', () => {
    it('accepts ASCII and Latin-1', () => {
      expect(isWinAnsiSafe('Hello, Wörld! 123')).toBe(true);
      expect(isWinAnsiSafe('OEM Name')).toBe(true);
    });

    it('rejects non-WinAnsi characters (Δ)', () => {
      expect(isWinAnsiSafe('Temp Δ')).toBe(false);
    });

    it('rejects CJK characters', () => {
      expect(isWinAnsiSafe('テスト')).toBe(false);
    });

    it('accepts empty string', () => {
      expect(isWinAnsiSafe('')).toBe(true);
    });
  });
});
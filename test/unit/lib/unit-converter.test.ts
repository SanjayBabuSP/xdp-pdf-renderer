import { toPoints, toPointsOrZero, stockSizePoints } from '../../../src/lib/unit-converter';

describe('unit-converter', () => {
  describe('toPoints', () => {
    it('converts mm to points', () => {
      const result = toPoints('25.4mm');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBeCloseTo(72, 0);
    });

    it('converts inches to points', () => {
      const result = toPoints('1in');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(72);
    });

    it('converts pt to points (passthrough)', () => {
      const result = toPoints('72pt');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(72);
    });

    it('converts cm to points', () => {
      const result = toPoints('1cm');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBeCloseTo(28.3465, 2);
    });

    it('converts px to points', () => {
      const result = toPoints('96px');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(72);
    });

    it('returns failure for unknown unit', () => {
      const result = toPoints('10em');
      expect(result.success).toBe(false);
    });

    it('parses plain number as points', () => {
      const result = toPoints('36');
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toBe(36);
    });
  });

  describe('toPointsOrZero', () => {
    it('returns 0 for undefined', () => {
      expect(toPointsOrZero(undefined)).toBe(0);
    });

    it('returns 0 for empty string', () => {
      expect(toPointsOrZero('')).toBe(0);
    });

    it('converts valid dimension', () => {
      expect(toPointsOrZero('10mm')).toBeCloseTo(28.3465, 2);
    });
  });

  describe('stockSizePoints', () => {
    it('returns A4 dimensions', () => {
      const size = stockSizePoints('a4');
      expect(size).toBeDefined();
      expect(size!.short).toBeCloseTo(595.28, 1);
      expect(size!.long).toBeCloseTo(841.89, 1);
    });

    it('is case-insensitive', () => {
      const size = stockSizePoints('A4');
      expect(size).toBeDefined();
    });

    it('returns undefined for unknown stock', () => {
      expect(stockSizePoints('a99')).toBeUndefined();
    });
  });
});

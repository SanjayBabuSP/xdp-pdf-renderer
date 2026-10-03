import { LineCapStyle, LineJoinStyle } from 'pdf-lib';
import {
  dashArrayForStyle,
  xfaCapToPdf,
  xfaJoinToPdf,
  clampCornerRadius,
} from '../../../src/rendering/border-style';

describe('border-style', () => {
  describe('dashArrayForStyle (adobepdf.xdc:187-191)', () => {
    it('treats solid / [1,0] as no dash', () => {
      expect(dashArrayForStyle('solid', 2)).toBeUndefined();
      expect(dashArrayForStyle(undefined, 2)).toBeUndefined();
    });

    it('scales the bit patterns by thickness', () => {
      expect(dashArrayForStyle('dotted', 1)).toEqual([1, 2]);
      expect(dashArrayForStyle('dashed', 1)).toEqual([4, 2]);
      expect(dashArrayForStyle('dashDot', 2)).toEqual([6, 4, 2, 4]);
      expect(dashArrayForStyle('dashDotDot', 1)).toEqual([3, 2, 1, 2, 1, 2]);
    });

    it('clamps very thin strokes so dash segments stay visible', () => {
      // 0.2pt clamps to 0.5pt.
      expect(dashArrayForStyle('dashed', 0.2)).toEqual([2, 1]);
    });

    it('renders emboss/etch/raise/lower as solid', () => {
      expect(dashArrayForStyle('embossed', 1)).toBeUndefined();
      expect(dashArrayForStyle('etched', 1)).toBeUndefined();
      expect(dashArrayForStyle('raised', 1)).toBeUndefined();
      expect(dashArrayForStyle('lowered', 1)).toBeUndefined();
    });
  });

  describe('cap / join enums (designrenderer:6182)', () => {
    it('maps cap 0x50000/1/2 → J 0/1/2', () => {
      expect(xfaCapToPdf(undefined)).toBe(LineCapStyle.Butt);
      expect(xfaCapToPdf('square')).toBe(LineCapStyle.Butt);
      expect(xfaCapToPdf('round')).toBe(LineCapStyle.Round);
      expect(xfaCapToPdf('butt')).toBe(LineCapStyle.Projecting);
    });

    it('maps join 0x60000/1/2 → j 0/1/2', () => {
      expect(xfaJoinToPdf(undefined)).toBe(LineJoinStyle.Miter);
      expect(xfaJoinToPdf('miter')).toBe(LineJoinStyle.Miter);
      expect(xfaJoinToPdf('round')).toBe(LineJoinStyle.Round);
      expect(xfaJoinToPdf('bevel')).toBe(LineJoinStyle.Bevel);
    });
  });

  describe('clampCornerRadius (renderer:24402)', () => {
    it('clamps to half the shortest side', () => {
      expect(clampCornerRadius(50, 100, 40)).toBe(20);
      expect(clampCornerRadius(5, 100, 40)).toBe(5);
      expect(clampCornerRadius(-1, 100, 40)).toBe(0);
    });
  });
});

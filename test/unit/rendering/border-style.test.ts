import { LineCapStyle, LineJoinStyle } from 'pdf-lib';
import {
  dashArrayForStyle,
  xfaCapToPdf,
  xfaJoinToPdf,
  clampCornerRadius,
  cornerRadiiOf,
  hasRoundedCorners,
  rotateEdgesForAngle,
  rotateCornersForAngle,
  isBottomUnderlineOnly,
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

  describe('corner radius selection', () => {
    it('returns four undefined radii when no radius is authored', () => {
      expect(cornerRadiiOf({})).toEqual([undefined, undefined, undefined, undefined]);
      expect(cornerRadiiOf({ cornerRadius: 0, cornerRadii: [0, undefined, 0, undefined] })).toEqual(
        [undefined, undefined, undefined, undefined]
      );
    });

    it('expands a single radius to all four corners', () => {
      expect(cornerRadiiOf({ cornerRadius: 5 })).toEqual([5, 5, 5, 5]);
    });

    it('prefers explicit per-corner radii when any is positive', () => {
      expect(cornerRadiiOf({ cornerRadius: 5, cornerRadii: [1, 2, 3, 4] })).toEqual([1, 2, 3, 4]);
      expect(cornerRadiiOf({ cornerRadii: [1, undefined, 3] })).toEqual([
        1,
        undefined,
        3,
        undefined,
      ]);
    });

    it('detects corners that survive clamping', () => {
      expect(hasRoundedCorners([5, undefined, undefined, undefined], 100, 40)).toBe(true);
      expect(hasRoundedCorners([50, undefined, undefined, undefined], 10, 4)).toBe(true);
      expect(hasRoundedCorners([0, 0, 0, 0], 10, 4)).toBe(false);
    });
  });

  describe('rotation helpers', () => {
    const edges: [string, string, string, string] = ['top', 'right', 'bottom', 'left'];
    const corners: [string, string, string, string] = ['tl', 'tr', 'br', 'bl'];

    it('rotates edges by 0, 90 and 270 degrees', () => {
      expect(rotateEdgesForAngle(edges, 0)).toEqual(['top', 'right', 'bottom', 'left']);
      expect(rotateEdgesForAngle(edges, 90)).toEqual(['right', 'bottom', 'left', 'top']);
      expect(rotateEdgesForAngle(edges, 270)).toEqual(['left', 'top', 'right', 'bottom']);
      expect(rotateEdgesForAngle(edges, 180)).toEqual(['top', 'right', 'bottom', 'left']);
      expect(rotateEdgesForAngle(edges, -90)).toEqual(['left', 'top', 'right', 'bottom']);
    });

    it('rotates corners by 0, 90 and 270 degrees', () => {
      expect(rotateCornersForAngle(corners, 0)).toEqual(['tl', 'tr', 'br', 'bl']);
      expect(rotateCornersForAngle(corners, 90)).toEqual(['tr', 'br', 'bl', 'tl']);
      expect(rotateCornersForAngle(corners, 270)).toEqual(['bl', 'tl', 'tr', 'br']);
      expect(rotateCornersForAngle(corners, 180)).toEqual(['tl', 'tr', 'br', 'bl']);
    });
  });

  describe('isBottomUnderlineOnly', () => {
    it('identifies a bottom-only edge set', () => {
      expect(isBottomUnderlineOnly([{ presence: 'visible' }])).toBe(true);
      expect(
        isBottomUnderlineOnly([
          { presence: 'hidden' },
          { style: 'none' },
          { presence: 'visible' },
          { presence: 'invisible' },
        ])
      ).toBe(true);
    });

    it('rejects missing, empty and non-bottom-only edge sets', () => {
      expect(isBottomUnderlineOnly(undefined)).toBe(false);
      expect(isBottomUnderlineOnly([])).toBe(false);
      expect(isBottomUnderlineOnly([{}, { presence: 'visible' }, {}, {}])).toBe(false);
      expect(isBottomUnderlineOnly([{}, {}, { style: 'none' }, {}])).toBe(false);
    });
  });
});

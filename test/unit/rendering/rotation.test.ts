import {
  isVerticalRotation,
  normalizeRotation,
  rotatedAnchor,
} from '../../../src/rendering/text/rotation';

describe('rotation', () => {
  describe('normalizeRotation', () => {
    it('normalizes mod 360 with positive results', () => {
      expect(normalizeRotation(0)).toBe(0);
      expect(normalizeRotation(360)).toBe(0);
      expect(normalizeRotation(450)).toBe(90);
      expect(normalizeRotation(720)).toBe(0);
      expect(normalizeRotation(90)).toBe(90);
      expect(normalizeRotation(270)).toBe(270);
    });

    it('normalizes negative angles', () => {
      expect(normalizeRotation(-90)).toBe(270);
      expect(normalizeRotation(-30)).toBe(330);
      expect(normalizeRotation(-360)).toBe(0);
    });

    it('treats non-finite input as 0', () => {
      expect(normalizeRotation(NaN)).toBe(0);
      expect(normalizeRotation(Infinity)).toBe(0);
    });
  });

  describe('isVerticalRotation', () => {
    it('is true only for 90/270', () => {
      expect(isVerticalRotation(90)).toBe(true);
      expect(isVerticalRotation(270)).toBe(true);
      expect(isVerticalRotation(-90)).toBe(true);
      expect(isVerticalRotation(450)).toBe(true);
      expect(isVerticalRotation(0)).toBe(false);
      expect(isVerticalRotation(180)).toBe(false);
      expect(isVerticalRotation(30)).toBe(false);
    });
  });

  describe('rotatedAnchor', () => {
    const box = { x: 10, y: 20, w: 40, h: 100 }; // PDF coords: y = bottom
    const common = { lineLen: 60, ascent: 8, descent: 2 };

    it('returns null for non-vertical rotations', () => {
      expect(rotatedAnchor({ ...common, rotate: 0, box, align: 'left', valign: 'top' })).toBeNull();
      expect(rotatedAnchor({ ...common, rotate: 180, box, align: 'left', valign: 'top' })).toBeNull();
    });

    it('rotate 90: reading runs bottom→top; top-align starts line at box bottom + …', () => {
      // valign top: reading END at box top → anchorY = top − lineLen
      const a = rotatedAnchor({ ...common, rotate: 90, box, align: 'left', valign: 'top' });
      expect(a).toEqual({ x: 10 + 8, y: 20 + 100 - 60 });
    });

    it('rotate 90: bottom-align anchors at box bottom', () => {
      const a = rotatedAnchor({ ...common, rotate: 90, box, align: 'left', valign: 'bottom' });
      expect(a).toEqual({ x: 18, y: 20 });
    });

    it('rotate 90: right-align shifts anchor left by descent', () => {
      const a = rotatedAnchor({ ...common, rotate: 90, box, align: 'right', valign: 'bottom' });
      expect(a).toEqual({ x: 10 + 40 - 2, y: 20 });
    });

    it('rotate 90: center-align centers the cross extent', () => {
      const a = rotatedAnchor({ ...common, rotate: 90, box, align: 'center', valign: 'bottom' });
      // anchorX + (descent − ascent)/2 = box center
      expect(a!.x + (2 - 8) / 2).toBeCloseTo(10 + 20, 10);
      expect(a!.y).toBe(20);
    });

    it('rotate 90: middle valign centers along reading axis', () => {
      const a = rotatedAnchor({ ...common, rotate: 90, box, align: 'left', valign: 'middle' });
      expect(a!.y).toBeCloseTo(20 + (100 - 60) / 2, 10);
    });

    it('rotate 90: multi-line stacks toward +x (right shift for right-align)', () => {
      const single = rotatedAnchor({ ...common, rotate: 90, box, align: 'right', valign: 'bottom' });
      const multi = rotatedAnchor({
        ...common,
        rotate: 90,
        box,
        align: 'right',
        valign: 'bottom',
        advance: 12,
        lineCount: 3,
      });
      expect(multi!.x).toBe(single!.x - 24);
      expect(multi!.y).toBe(20);
    });

    it('rotate 270: reading runs top→bottom; top-align anchors at box top', () => {
      const a = rotatedAnchor({ ...common, rotate: 270, box, align: 'left', valign: 'top' });
      expect(a).toEqual({ x: 10 + 2, y: 20 + 100 });
    });

    it('rotate 270: bottom-align ends the line at box bottom', () => {
      const a = rotatedAnchor({ ...common, rotate: 270, box, align: 'left', valign: 'bottom' });
      expect(a).toEqual({ x: 12, y: 20 + 60 });
    });

    it('rotate 270: right-align anchors by ascent', () => {
      const a = rotatedAnchor({ ...common, rotate: 270, box, align: 'right', valign: 'top' });
      expect(a).toEqual({ x: 10 + 40 - 8, y: 120 });
    });

    it('rotate 270: multi-line block is flush left (anchor shifts +x with stack)', () => {
      // lines march −x from the anchor; left-align puts the leftmost line's
      // descent edge at box.x → anchorX = box.x + descent + stack
      const single = rotatedAnchor({ ...common, rotate: 270, box, align: 'left', valign: 'top' });
      const multi = rotatedAnchor({
        ...common,
        rotate: 270,
        box,
        align: 'left',
        valign: 'top',
        advance: 12,
        lineCount: 3,
      });
      expect(single!.x).toBe(12);
      expect(multi!.x).toBe(single!.x + 24);
    });
  });
});

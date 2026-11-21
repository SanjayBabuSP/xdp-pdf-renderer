import { resolveExtent, resolveSubformHeight, clamp, isHeightGrowable, isWidthGrowable } from '../../../../src/domain/layout/sizing';

describe('layout/sizing', () => {
  describe('isHeightGrowable', () => {
    it('fixed h is not growable', () => {
      expect(isHeightGrowable({ h: 50 })).toBe(false);
    });
    it('h=0 counts as unspecified', () => {
      expect(isHeightGrowable({ h: 0 })).toBe(true);
    });
    it('bounded [minH,maxH] range is not growable', () => {
      expect(isHeightGrowable({ minH: 10, maxH: 50 })).toBe(false);
    });
    it('minH alone stays growable', () => {
      expect(isHeightGrowable({ minH: 10 })).toBe(true);
    });
    it('no position is growable', () => {
      expect(isHeightGrowable(undefined)).toBe(true);
    });
  });

  describe('isWidthGrowable', () => {
    it('fixed w is not growable', () => {
      expect(isWidthGrowable({ w: 100 })).toBe(false);
    });
    it('unspecified w is growable', () => {
      expect(isWidthGrowable({})).toBe(true);
    });
  });

  describe('clamp', () => {
    it('applies min and max', () => {
      expect(clamp(5, 10, 20)).toBe(10);
      expect(clamp(25, 10, 20)).toBe(20);
      expect(clamp(15, 10, 20)).toBe(15);
    });
    it('missing bounds are open', () => {
      expect(clamp(5, undefined, 20)).toBe(5);
      expect(clamp(25, 10, undefined)).toBe(25);
    });
  });

  describe('resolveExtent', () => {
    it('uses fixed h when specified (still clamped)', () => {
      expect(resolveExtent({ h: 50 }, 'height', 100)).toBe(50);
      expect(resolveExtent({ h: 50, minH: 80 }, 'height', 100)).toBe(80);
      expect(resolveExtent({ h: 50, maxH: 30 }, 'height', 100)).toBe(30);
    });
    it('content-driven height clamped into [minH,maxH]', () => {
      expect(resolveExtent({}, 'height', 42)).toBe(42);
      expect(resolveExtent({ minH: 60 }, 'height', 42)).toBe(60);
      expect(resolveExtent({ maxH: 30 }, 'height', 42)).toBe(30);
    });
    it('width defaults to available extent, clamped by maxW', () => {
      expect(resolveExtent({}, 'width', 487)).toBe(487);
      expect(resolveExtent({ maxW: 100 }, 'width', 487)).toBe(100);
      expect(resolveExtent({ w: 200 }, 'width', 487)).toBe(200);
    });
  });

  describe('resolveSubformHeight', () => {
    it('ignores a lone minH on a growable subform', () => {
      expect(resolveSubformHeight({ minH: 71.7 }, 34)).toBe(34);
      expect(resolveSubformHeight(undefined, 42)).toBe(42);
    });
    it('honors explicit h and bounded [minH,maxH] ranges', () => {
      expect(resolveSubformHeight({ h: 50 }, 100)).toBe(50);
      expect(resolveSubformHeight({ minH: 60, maxH: 100 }, 42)).toBe(60);
      expect(resolveSubformHeight({ minH: 10, maxH: 30 }, 42)).toBe(30);
      expect(resolveSubformHeight({ maxH: 30 }, 42)).toBe(30);
    });
  });
});

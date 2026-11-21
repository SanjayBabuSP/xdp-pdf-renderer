import { clampAlpha, parseOpacityValue } from '../../../src/lib/opacity';

describe('clampAlpha', () => {
  it('clamps values to the 0..1 range', () => {
    expect(clampAlpha(-2)).toBe(0);
    expect(clampAlpha(0)).toBe(0);
    expect(clampAlpha(0.35)).toBe(0.35);
    expect(clampAlpha(1)).toBe(1);
    expect(clampAlpha(5)).toBe(1);
  });
});

describe('parseOpacityValue', () => {
  it('returns undefined for absent or blank input', () => {
    expect(parseOpacityValue(undefined)).toBeUndefined();
    expect(parseOpacityValue('')).toBeUndefined();
    expect(parseOpacityValue('   ')).toBeUndefined();
  });

  it('returns undefined for non-numeric input', () => {
    expect(parseOpacityValue('opaque')).toBeUndefined();
    expect(parseOpacityValue('abc%')).toBeUndefined();
  });

  it('keeps fractional values between 0 and 1 unchanged', () => {
    expect(parseOpacityValue('0')).toBe(0);
    expect(parseOpacityValue('0.25')).toBeCloseTo(0.25, 10);
    expect(parseOpacityValue('1')).toBe(1);
  });

  it('scales values above 1 as percentages', () => {
    expect(parseOpacityValue('50')).toBeCloseTo(0.5, 10);
    expect(parseOpacityValue('75')).toBeCloseTo(0.75, 10);
    expect(parseOpacityValue('120')).toBe(1);
  });

  it('scales explicit percentages and clamps them', () => {
    expect(parseOpacityValue('40%')).toBeCloseTo(0.4, 10);
    expect(parseOpacityValue(' 60 % ')).toBeCloseTo(0.6, 10);
    expect(parseOpacityValue('150%')).toBe(1);
    expect(parseOpacityValue('-20%')).toBe(0);
  });
});

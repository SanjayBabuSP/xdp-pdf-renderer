import {
  lineAdvanceFactor,
  lookupXdcMetrics,
} from '../../../src/rendering/text/font-metrics';

/**
 * Values come from adobepdf.xdc <metrics> blocks (size="1000pt"), so they are
 * already per-mille.
 */
describe('XDC font metrics (adobepdf.xdc:265-333)', () => {
  it('reads Helvetica lineHeight 1149 and ascent/descent', () => {
    const m = lookupXdcMetrics('Helvetica');
    expect(m).toBeDefined();
    expect(m!.lineHeight).toBe(1149);
    expect(m!.ascent).toBe(728);
    expect(m!.descent).toBe(210);
    expect(m!.xHeight).toBe(523);
  });

  it('reads Courier lineHeight 1000', () => {
    const m = lookupXdcMetrics('Courier');
    expect(m!.lineHeight).toBe(1000);
    expect(m!.ascent).toBe(613);
  });

  it('reads Times and Symbol/Zapf lineHeights', () => {
    expect(lookupXdcMetrics('Times')!.lineHeight).toBe(1149);
    expect(lookupXdcMetrics('Symbol')!.lineHeight).toBe(1200);
    expect(lookupXdcMetrics('ITC Zapf Dingbats')!.lineHeight).toBe(1200);
  });

  it('resolves base-14 aliases (Arial→Helvetica, Times New Roman→Times, Courier New→Courier)', () => {
    expect(lookupXdcMetrics('Arial')!.ascent).toBe(728);
    expect(lookupXdcMetrics('Times New Roman')!.capHeight).toBe(662);
    expect(lookupXdcMetrics('Courier New')!.lineHeight).toBe(1000);
  });

  it('selects the weight-specific face', () => {
    expect(lookupXdcMetrics('Courier', 'bold')!.ascent).toBe(633);
    expect(lookupXdcMetrics('Times', 'bold')!.ascent).toBe(677);
    expect(lookupXdcMetrics('Helvetica', 'bold')!.xHeight).toBe(531);
  });

  it('returns undefined for embedded/non-base-14 families', () => {
    expect(lookupXdcMetrics('DejaVu Sans')).toBeUndefined();
    expect(lookupXdcMetrics(undefined)).toBeUndefined();
  });

  it('lineAdvanceFactor uses XDC lineHeight / 1000', () => {
    expect(lineAdvanceFactor('Helvetica')).toBeCloseTo(1.149, 6);
    expect(lineAdvanceFactor('Arial')).toBeCloseTo(1.149, 6);
    expect(lineAdvanceFactor('Times')).toBeCloseTo(1.149, 6);
    expect(lineAdvanceFactor('Courier')).toBeCloseTo(1.0, 6);
    expect(lineAdvanceFactor('Symbol')).toBeCloseTo(1.2, 6);
    // No XDC face → Adobe's 1.2 default spacing (font_disasm.c:10517).
    expect(lineAdvanceFactor('DejaVu Sans')).toBe(1.2);
    expect(lineAdvanceFactor(undefined)).toBe(1.2);
  });
});

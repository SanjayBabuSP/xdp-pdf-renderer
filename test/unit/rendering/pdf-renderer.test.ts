import { formatValue } from '../../../src/rendering/pdf-renderer';

/**
 * `computeFieldTextLayout` was deliberately removed (docs/FIXES.md §6): it was
 * dead (zero call sites) and used bogus constants (1 em per character,
 * `(height-fontSize)/2` baselines). The renderer computes caption/value geometry
 * inline from real font metrics (pdf-renderer.ts renderField), so these tests
 * assert that live path's observable output instead of resurrecting the helper.
 */
describe('pdf renderer formatting', () => {
  it('formats numeric values using XFA-style picture masks', () => {
    expect(formatValue(1234.5, '9999.00')).toBe('1234.50');
    expect(formatValue(1234.5, '₹#,##0.00')).toBe('₹1,234.50');
  });

  it('formats date values using common XFA-style picture masks', () => {
    expect(formatValue('2026-06-03', 'yyyy-mm-dd')).toBe('2026-06-03');
    expect(formatValue('2026-06-03', 'dd/mm/yyyy')).toBe('03/06/2026');
  });
});

import { formatValue } from '../../../src/rendering/pdf-renderer';

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

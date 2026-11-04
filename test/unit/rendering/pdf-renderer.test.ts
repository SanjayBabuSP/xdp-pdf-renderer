import { computeFieldTextLayout, formatValue } from '../../../src/rendering/pdf-renderer';

describe('pdf renderer formatting', () => {
  it('formats numeric values using XFA-style picture masks', () => {
    expect(formatValue(1234.5, '9999.00')).toBe('1234.50');
    expect(formatValue(1234.5, '₹#,##0.00')).toBe('₹1,234.50');
  });

  it('formats date values using common XFA-style picture masks', () => {
    expect(formatValue('2026-06-03', 'yyyy-mm-dd')).toBe('2026-06-03');
    expect(formatValue('2026-06-03', 'dd/mm/yyyy')).toBe('03/06/2026');
  });

  it('reserves caption space and aligns field values like Adobe text fields', () => {
    const layout = computeFieldTextLayout({
      x: 20,
      width: 180,
      height: 20,
      reserve: 60,
      captionText: 'Total',
      valueText: '1234.50',
      valueAlign: 'right',
      fontSize: 10,
    });

    expect(layout.captionX).toBe(20);
    expect(layout.captionY).toBe(30);
    expect(layout.valueX).toBe(20 + 60 + 180 - 60 - 10 * '1234.50'.length);
    expect(layout.valueY).toBe(30);
  });

  it('centers text vertically when Designer specifies middle alignment', () => {
    const layout = computeFieldTextLayout({
      x: 10,
      y: 5,
      width: 120,
      height: 20,
      reserve: 25,
      captionText: 'Name',
      valueText: 'ABC',
      valueAlign: 'left',
      verticalAlign: 'middle',
      fontSize: 10,
    });

    expect(layout.captionY).toBe(5 + (20 - 10) / 2);
    expect(layout.valueY).toBe(5 + (20 - 10) / 2);
  });
});

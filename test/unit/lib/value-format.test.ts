import { formatValue } from '../../../src/lib/value-format';

describe('G13 — compound date/time pictures', () => {
  const iso = '2024-03-05T14:30:05Z';

  it('formats a date directive', () => {
    expect(formatValue(iso, 'date{DD/MM/YYYY}')).toBe('05/03/2024');
    expect(formatValue(iso, 'date{M/D/YYYY}')).toBe('3/5/2024');
  });

  it('supports short month names', () => {
    expect(formatValue(iso, 'date{D-MMM-YYYY}')).toBe('5-Mar-2024');
    expect(formatValue(iso, 'date{MMMM D, YYYY}')).toBe('March 5, 2024');
  });

  it('formats date and time together', () => {
    expect(formatValue(iso, 'date{M/D/YYYY} time{h:MM:SS A}')).toBe('3/5/2024 2:30:05 PM');
    expect(formatValue(iso, 'time{HH:MM:SS}')).toBe('14:30:05');
  });

  it('parses time-only values', () => {
    expect(formatValue('14:30:05', 'time{HH:MM:SS}')).toBe('14:30:05');
    expect(formatValue('14:30', 'time{h:MM A}')).toBe('2:30 PM');
  });

  it('uses locale month and weekday names', () => {
    expect(formatValue(iso, 'date{MMMM}', 'de-DE')).toBe('März');
    expect(formatValue(iso, 'date{MMMM}', 'fr-FR')).toBe('mars');
    expect(formatValue(iso, 'date{EEEE}')).toBe('Tuesday');
    expect(formatValue(iso, 'date{EEE}')).toBe('Tue');
  });

  it('falls back to defaults for empty directives', () => {
    expect(formatValue(iso, 'date{}')).toBe('3/5/2024');
    expect(formatValue(iso, 'time{}')).toBe('2:30:05 PM');
  });

  it('keeps literal surrounding text', () => {
    expect(formatValue(iso, 'On date{YYYY} at time{HH:MM}')).toBe('On 2024 at 14:30');
  });
});

describe('G13 — simple date patterns still work', () => {
  it('handles lowercase masks', () => {
    expect(formatValue('2024-03-05', 'dd/mm/yyyy')).toBe('05/03/2024');
    expect(formatValue('2024-03-05', 'yyyy-mm-dd')).toBe('2024-03-05');
  });
});

describe('numeric masks (regression)', () => {
  it('formats grouping and decimals', () => {
    expect(formatValue(1234.5, '###,###.##')).toBe('1,234.50');
    expect(formatValue(-1234.5, '$###,###.00')).toBe('$-1,234.50');
  });
});

describe('Adobe numeric picture tokens (jfutility locale tables)', () => {
  it('supports 9/z zero-suppressed placeholders', () => {
    expect(formatValue(1234.5, '$z,zz9.99')).toBe('$1,234.50');
    expect(formatValue(0, '$z,zz9.99')).toBe('$   0.00');
    expect(formatValue(1234.5, '$ z,zz9.99')).toBe('$ 1,234.50');
  });

  it('omits all-zero optional fractional digits like Adobe', () => {
    expect(formatValue(200, '999.zz')).toBe('200');
    expect(formatValue(0, '999.zz').trim()).toBe('0');
    expect(formatValue(200.5, '999.zz')).toBe('200.50');
    expect(formatValue(200, '999.##')).toBe('200');
    expect(formatValue(200, '999.99')).toBe('200.00');
  });

  it('supports | alternates for negative values', () => {
    expect(formatValue(-1234.5, '$z,zz9.99|($z,zz9.99)')).toBe('($1,234.50)');
    expect(formatValue(1234.5, '$z,zz9.99|($z,zz9.99)')).toBe('$1,234.50');
  });

  it('treats CR / DB as literal credit-debit suffixes', () => {
    expect(formatValue(1234.5, '$z,zz9.99CR')).toBe('$1,234.50CR');
    expect(formatValue(1234.5, '$z,zz9.99DB')).toBe('$1,234.50DB');
  });

  it('scales percent pictures by 100', () => {
    expect(formatValue(0.25, 'z,zz9%')).toBe('  25%');
  });

  it('keeps the #/0 masks working', () => {
    expect(formatValue(1234.5, '###,###.##')).toBe('1,234.50');
    expect(formatValue(-1234.5, '$###,###.00')).toBe('$-1,234.50');
  });
});

describe('text{…} templates (LocalesList.xml presets)', () => {
  it('formats phone numbers', () => {
    expect(formatValue('5551234567', "text{'('999')' 999-9999}")).toBe('(555) 123-4567');
  });

  it('formats zip / zip+4', () => {
    expect(formatValue('123456789', 'text{99999-9999}')).toBe('12345-6789');
  });

  it('consumes letters with A', () => {
    expect(formatValue('ABC123', 'text{AAA-999}')).toBe('ABC-123');
  });
});

describe('numeric pictures are minimum width, not maximum', () => {
  it('prints digits wider than the mask', () => {
    expect(formatValue(12.345, '0.00')).toBe('12.35');
    expect(formatValue(12345, '#,##0')).toBe('12,345');
    expect(formatValue(1234567.5, '$0.00')).toBe('$1234567.50');
  });
});

describe('date pictures are idempotent on display values (ADS parity)', () => {
  it('keeps DD-MM-YYYY display text stable', () => {
    expect(formatValue('06-11-2026', 'date{DD-MM-YYYY}')).toBe('06-11-2026');
    expect(formatValue('06-11-2026', 'DD-MM-YYYY')).toBe('06-11-2026');
  });
  it('still parses ISO input through the picture', () => {
    expect(formatValue('2026-11-06', 'date{DD-MM-YYYY}')).toBe('06-11-2026');
  });
});

describe('formatValue fallback and compound directives', () => {
  it('returns the plain string when the picture is not a known pattern', () => {
    expect(formatValue('abc', 'CR')).toBe('abc');
    expect(formatValue(7, undefined)).toBe('7');
    expect(formatValue(null)).toBe('');
    expect(formatValue(undefined)).toBe('');
  });

  it('formats num and datetime directives', () => {
    expect(formatValue(1234.5, 'num{}')).toBe('     1,234.50');
    expect(formatValue(1234.5, 'num{0.0}')).toBe('1234.5');
    expect(formatValue('2024-03-05T14:30:05Z', 'datetime{YYYY-MM-DD}')).toBe('2024-03-05');
  });

  it('formats text templates with O/X/x and unterminated quoted literals', () => {
    expect(formatValue('abcd', 'text{OOXx}')).toBe('abcd');
    expect(formatValue('X', "text{'unterminated}")).toBe('unterminated');
    expect(formatValue('abc', 'text{}')).toBe('');
  });
});

describe('formatValue date and time tokens', () => {
  it('formats single and double year tokens', () => {
    expect(formatValue('2024-03-05', 'Y')).toBe('2024');
    expect(formatValue('2024-03-05', 'YY')).toBe('24');
  });

  it('formats every hour, minute and second token', () => {
    expect(formatValue('14:30:05', 'time{H}')).toBe('14');
    expect(formatValue('14:30:05', 'time{hh}')).toBe('02');
    expect(formatValue('14:30:05', 'time{KK}')).toBe('02');
    expect(formatValue('14:30:05', 'time{K}')).toBe('2');
    expect(formatValue('14:30:05', 'time{M}')).toBe('30');
    expect(formatValue('14:30:05', 'time{S}')).toBe('5');
    expect(formatValue('00:30', 'time{hh}')).toBe('12');
  });

  it('coerces numeric and generic date values', () => {
    expect(formatValue(0, 'date{YYYY}')).toBe('1970');
    expect(formatValue('March 5, 2024', 'date{YYYY}')).toBe('2024');
    expect(formatValue(Number.NaN, 'date{YYYY}')).toBe('NaN');
    expect(formatValue('not a date', 'date{YYYY}')).toBe('not a date');
  });
});

describe('formatValue numeric coercion and padding', () => {
  it('parses strings with grouping separators and currency symbols', () => {
    expect(formatValue('1,234.50', '$#,##0.00')).toBe('$1,234.50');
    expect(formatValue('$1,234.50', '$#,##0.00')).toBe('$1,234.50');
    expect(formatValue(' 42 ', '0')).toBe('42');
  });

  it('falls back for non-numeric strings and non-numeric values', () => {
    expect(formatValue('abc', '0')).toBe('abc');
    expect(formatValue(true, '0')).toBe('true');
    expect(formatValue(Number.NaN, '0')).toBe('NaN');
  });

  it('zero-fills integer placeholders that are not needed for the digits', () => {
    expect(formatValue(5, '000')).toBe('005');
  });
});

describe('locale-aware picture formatting', () => {
  const iso = '2024-03-05T14:30:05Z';

  it('accepts XFA-style locale identifiers', () => {
    expect(formatValue(iso, 'date{MMMM}', 'de_DE')).toBe('März');
    expect(formatValue(iso, 'date{MMMM}', 'fr_FR')).toBe('mars');
  });

  it('localizes meridiem text in time pictures', () => {
    expect(formatValue(iso, 'time{h:MM:SS A}', 'zh-CN')).toBe('2:30:05 下午');
    expect(formatValue(iso, 'time{HH:MM A}')).toBe('14:30 PM');
  });

  it('localizes number separators in both directions', () => {
    expect(formatValue(1234.5, '$#,##0.00', 'de_DE')).toBe('$1.234,50');
    expect(formatValue('1.234,50', '$#,##0.00', 'de_DE')).toBe('$1.234,50');
    expect(formatValue(1234.5, '$#,##0.00', 'en-US')).toBe('$1,234.50');
  });
});

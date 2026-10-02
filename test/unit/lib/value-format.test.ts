import { formatValue } from '../../../src/lib/value-format';

/**
 * G13 — compound picture engine: `date{…}` / `time{…}`, locale month/day names
 * and AM/PM. Evidence: ConvertWord.exe_disasm.c:92370
 * (`date{M/D/YYYY} time{h:MM:SS A}`), jfutility_disasm.c (`date{D-MMM}`).
 */

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
    // 2024-03-05 is a Tuesday.
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

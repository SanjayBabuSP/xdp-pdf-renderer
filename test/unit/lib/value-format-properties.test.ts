import fc from 'fast-check';
import { formatValue } from '../../../src/lib/value-format';
import { getNumberSeparators } from '../../../src/lib/locale-format';

describe('formatValue properties', () => {
  it('passes values through verbatim when no picture is supplied', () => {
    fc.assert(
      fc.property(fc.oneof(fc.integer(), fc.string({ maxLength: 100 })), (value) => {
        expect(formatValue(value)).toBe(String(value));
      }),
      { numRuns: 200 }
    );
  });

  it('preserves every digit when applying locale-aware grouping', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }),
        fc.constantFrom('de-DE', 'en-US'),
        (value, locale) => {
          const formatted = formatValue(value, 'zzz,zzz,zz9', locale);
          const { group } = getNumberSeparators(locale);
          expect(formatted.trim().split(group).join('')).toBe(String(value));
        }
      ),
      { numRuns: 200 }
    );
  });

  it('keeps ungrouped output free of grouping separators', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 999_999_999 }),
        fc.constantFrom('de-DE', 'en-US'),
        (value, locale) => {
          const formatted = formatValue(value, '999999999', locale);
          const { group } = getNumberSeparators(locale);
          expect(formatted.includes(group)).toBe(false);
        }
      ),
      { numRuns: 200 }
    );
  });

  it('handles null and empty-picture edge cases', () => {
    expect(formatValue(null, 'zzz,zzz,zz9')).toBe('');
    expect(formatValue(42, '')).toBe('42');
  });
});

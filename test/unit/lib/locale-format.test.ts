import {
  getMeridiem,
  getMonthNames,
  getNumberSeparators,
  getWeekdayNames,
  normalizeLocale,
} from '../../../src/lib/locale-format';

describe('locale formatting helpers', () => {
  it('normalizes XFA locale identifiers and ignores invalid values', () => {
    expect(normalizeLocale('de_DE')).toBe('de-DE');
    expect(normalizeLocale('en-US')).toBe('en-US');
    expect(normalizeLocale('not_a_locale!')).toBeUndefined();
    expect(normalizeLocale('')).toBeUndefined();
  });

  it('returns localized month and weekday names', () => {
    expect(getMonthNames('de_DE', 'long')[2]).toBe('März');
    expect(getMonthNames('en-US', 'short')[2]).toBe('Mar');
    expect(getWeekdayNames('fr-FR', 'long')[5]).toBe('vendredi');
    expect(getWeekdayNames(undefined, 'long')[0]).toBe('Sunday');
  });

  it('returns localized meridiem text', () => {
    expect(getMeridiem(undefined, false)).toBe('AM');
    expect(getMeridiem(undefined, true)).toBe('PM');
    expect(getMeridiem('zh-CN', false)).toBe('上午');
    expect(getMeridiem('zh-CN', true)).toBe('下午');
  });

  it('property: locale normalization is idempotent', () => {
    for (const locale of ['en-US', 'en_US', 'de_DE', 'de-DE', 'fr-FR', 'zh-CN', 'invalid!', '']) {
      const once = normalizeLocale(locale);
      expect(normalizeLocale(once)).toBe(once);
    }
  });

  it('returns localized number separators', () => {
    expect(getNumberSeparators('en-US')).toEqual({ group: ',', decimal: '.' });
    expect(getNumberSeparators('de_DE')).toEqual({ group: '.', decimal: ',' });
    expect(getNumberSeparators('not_a_locale!')).toEqual({ group: ',', decimal: '.' });
  });
});

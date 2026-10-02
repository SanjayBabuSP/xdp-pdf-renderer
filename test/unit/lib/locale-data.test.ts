import { getLocaleInfo, listLocales, getCustomPatterns } from '../../../src/lib/locale-data';

/**
 * Recreated from Designer 11.0 `EN/LocalesList.xml` (now present in
 * reference/Adobe-LiveCycle-Designer-11.0/EN/). Regenerate: npm run locales:import.
 */
describe('XFA locale catalog', () => {
  it('resolves a locale to its language and region', () => {
    expect(getLocaleInfo('en_US')).toEqual({ language: 'English', region: 'USA' });
    expect(getLocaleInfo('de_DE')?.language).toBe('German');
  });

  it('accepts hyphenated lcids', () => {
    expect(getLocaleInfo('en-GB')?.region).toBe('United Kingdom');
  });

  it('lists the full Designer locale set', () => {
    const locales = listLocales();
    expect(locales.length).toBeGreaterThan(100);
    for (const lcid of ['en_US', 'en_GB', 'de_DE', 'fr_FR', 'ja_JP', 'zh_CN']) {
      expect(locales).toContain(lcid);
    }
  });
});

describe('XFA custom picture presets', () => {
  it('exposes the en_US presets', () => {
    const patterns = getCustomPatterns('en_US').map((p) => p.pattern);
    expect(patterns).toContain('99999-9999');
    expect(patterns).toContain('999-99-9999');
  });

  it('includes the global numeric presets', () => {
    const patterns = getCustomPatterns().map((p) => p.pattern);
    expect(patterns).toContain('$z,zz9.99');
  });
});

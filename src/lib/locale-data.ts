import localeData from '../config/xfa-locales.json';

/**
 * XFA locale catalog and picture presets, recreated from Designer 11.0's
 * `EN/LocalesList.xml` (see `reference/Adobe-LiveCycle-Designer-11.0/EN/`).
 *
 * Regenerate with `npm run locales:import`.
 */

export interface LocaleInfo {
  /** Language display name, e.g. `English`. */
  language: string;
  /** Country/region display name, e.g. `USA`. */
  region: string;
}

export interface CustomPattern {
  /** `text` | `num` | `pwd` */
  type: string;
  /** Human-readable description. */
  desc: string;
  /** XFA picture, e.g. `99999-9999` or `$z,zz9.99`. */
  pattern: string;
}

interface LocaleData {
  locales: Record<string, LocaleInfo>;
  patterns: Record<string, CustomPattern[]>;
  globalPatterns: CustomPattern[];
}

const DATA = localeData as LocaleData;

/** Look up a locale by its `lcid` (e.g. `en_US`, `de_DE`). */
export function getLocaleInfo(lcid: string): LocaleInfo | undefined {
  return DATA.locales[lcid] ?? DATA.locales[lcid.replace('-', '_')];
}

/** Every locale `lcid` known to Designer 11.0. */
export function listLocales(): string[] {
  return Object.keys(DATA.locales);
}

/**
 * Custom picture presets available for a locale: the per-locale patterns first,
 * then the global presets (postal codes, SSN, currency masks, …).
 */
export function getCustomPatterns(lcid?: string): CustomPattern[] {
  const scoped = lcid ? DATA.patterns[lcid] ?? DATA.patterns[lcid.replace('-', '_')] ?? [] : [];
  return [...scoped, ...DATA.globalPatterns];
}

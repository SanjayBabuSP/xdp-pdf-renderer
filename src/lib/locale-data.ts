import localeData from '../config/xfa-locales.json';

export interface LocaleInfo {
  language: string;
  region: string;
}

export interface CustomPattern {
  type: string;
  desc: string;
  pattern: string;
}

interface LocaleData {
  locales: Record<string, LocaleInfo>;
  patterns: Record<string, CustomPattern[]>;
  globalPatterns: CustomPattern[];
}

const DATA = localeData as LocaleData;

export function getLocaleInfo(lcid: string): LocaleInfo | undefined {
  return DATA.locales[lcid] ?? DATA.locales[lcid.replace('-', '_')];
}

export function listLocales(): string[] {
  return Object.keys(DATA.locales);
}

export function getCustomPatterns(lcid?: string): CustomPattern[] {
  const scoped = lcid ? (DATA.patterns[lcid] ?? DATA.patterns[lcid.replace('-', '_')] ?? []) : [];
  return [...scoped, ...DATA.globalPatterns];
}

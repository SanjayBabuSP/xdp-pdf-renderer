const canonicalCache = new Map<string, string | undefined>();
const monthCache = new Map<string, string[]>();
const weekdayCache = new Map<string, string[]>();
const meridiemCache = new Map<string, [string, string]>();
const separatorCache = new Map<string, { group: string; decimal: string }>();

export function normalizeLocale(locale?: string): string | undefined {
  if (!locale?.trim()) return undefined;
  const key = locale.trim();
  if (canonicalCache.has(key)) return canonicalCache.get(key);
  let value: string | undefined;
  try {
    value = Intl.getCanonicalLocales(key.replace(/_/g, '-'))[0];
  } catch {
    value = undefined;
  }
  canonicalCache.set(key, value);
  return value;
}

function formatterLocale(locale?: string): string {
  return normalizeLocale(locale) ?? 'en-US';
}

export function getMonthNames(locale?: string, style: 'long' | 'short' = 'long'): string[] {
  const resolved = formatterLocale(locale);
  const key = `${resolved}:${style}`;
  const cached = monthCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(resolved, { month: style, timeZone: 'UTC' });
  const names = Array.from({ length: 12 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2020, i, 1)))
  );
  monthCache.set(key, names);
  return names;
}

export function getWeekdayNames(locale?: string, style: 'long' | 'short' = 'long'): string[] {
  const resolved = formatterLocale(locale);
  const key = `${resolved}:${style}`;
  const cached = weekdayCache.get(key);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat(resolved, { weekday: style, timeZone: 'UTC' });
  const names = Array.from({ length: 7 }, (_, i) =>
    formatter.format(new Date(Date.UTC(2024, 0, 7 + i)))
  );
  weekdayCache.set(key, names);
  return names;
}

function dayPeriod(formatter: Intl.DateTimeFormat, hour: number): string {
  const parts = formatter.formatToParts(new Date(Date.UTC(2024, 0, 1, hour, 0, 0)));
  return parts.find((part) => part.type === 'dayPeriod')?.value ?? (hour < 12 ? 'AM' : 'PM');
}

export function getMeridiem(locale: string | undefined, pm: boolean): string {
  const resolved = formatterLocale(locale);
  const cached = meridiemCache.get(resolved);
  let pair = cached;
  if (!pair) {
    const formatter = new Intl.DateTimeFormat(resolved, {
      hour: 'numeric',
      hour12: true,
      timeZone: 'UTC',
    });
    pair = [dayPeriod(formatter, 9), dayPeriod(formatter, 15)];
    meridiemCache.set(resolved, pair);
  }
  return pm ? pair[1] : pair[0];
}

export interface NumberSeparators {
  group: string;
  decimal: string;
}

export function getNumberSeparators(locale?: string): NumberSeparators {
  const resolved = formatterLocale(locale);
  const cached = separatorCache.get(resolved);
  if (cached) return cached;
  const parts = new Intl.NumberFormat(resolved).formatToParts(1234.5);
  const value = {
    group: parts.find((part) => part.type === 'group')?.value ?? ',',
    decimal: parts.find((part) => part.type === 'decimal')?.value ?? '.',
  };
  separatorCache.set(resolved, value);
  return value;
}

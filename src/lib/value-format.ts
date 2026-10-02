// ────────────────────────────────────────────────────────────────────────────
// Value formatting — XFA `<bind><picture>` aware display formatting.
//
// Shared by the PDF renderer (field value painting) and the FormCalc field
// accessor (`.formattedValue`), so it lives in lib/ rather than in either
// consumer.
// ────────────────────────────────────────────────────────────────────────────

export function formatValue(value: unknown, picture?: string): string {
  if (value == null) return '';
  if (!picture) return String(value);

  const pattern = picture.trim();
  if (looksLikeDatePattern(pattern)) {
    return formatDateValue(value, pattern);
  }

  if (looksLikeNumberPattern(pattern)) {
    return formatNumberValue(value, pattern);
  }

  return String(value);
}

function looksLikeDatePattern(pattern: string): boolean {
  const upper = pattern.toLowerCase();
  return /(y|m|d)/.test(upper) && (upper.includes('y') || upper.includes('d'));
}

function looksLikeNumberPattern(pattern: string): boolean {
  return /[0#]/.test(pattern) && !/[a-z]/i.test(pattern);
}

function formatDateValue(value: unknown, pattern: string): string {
  const date = coerceDate(value);
  if (!date) return String(value);

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const replacements: Record<string, string> = {
    yyyy: String(year),
    yy: String(year).slice(-2),
    mm: String(month).padStart(2, '0'),
    m: String(month),
    dd: String(day).padStart(2, '0'),
    d: String(day),
  };

  let formatted = pattern;
  for (const [token, replacement] of Object.entries(replacements)) {
    formatted = formatted.replace(new RegExp(token, 'g'), replacement);
  }

  return formatted;
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value !== 'string') return null;

  const normalized = value.trim();
  if (!normalized) return null;

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatNumberValue(value: unknown, pattern: string): string {
  const number = coerceNumber(value);
  if (number === null) return String(value);

  const mask = pattern.replace(/\s+/g, '');
  const prefix = mask.match(/^[^0-9#.,%]+/)?.[0] ?? '';
  const suffix = mask.match(/[^0-9#.,%]+$/)?.[0] ?? '';
  const digitsMask = mask.slice(prefix.length, mask.length - suffix.length);
  const hasDecimal = digitsMask.includes('.');
  const decimalPlaces = hasDecimal ? digitsMask.split('.')[1]?.replace(/[^0#]/g, '').length ?? 0 : 0;
  const hasGrouping = digitsMask.includes(',');

  const absValue = Math.abs(number);
  const rounded = absValue.toFixed(decimalPlaces);
  const [wholeRaw, fractionRaw = ''] = rounded.split('.');

  let whole = wholeRaw;
  if (hasGrouping) {
    whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  const sign = number < 0 ? '-' : '';
  const numeric = hasDecimal ? `${whole}.${fractionRaw}` : whole;
  return `${prefix}${sign}${numeric}${suffix}`;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const compact = normalized.replace(/[$€£¥₹,\s]/g, '').replace(/%/g, '');
    const parsed = Number(compact);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

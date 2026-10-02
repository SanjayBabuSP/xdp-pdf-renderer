// ────────────────────────────────────────────────────────────────────────────
// Value formatting — XFA `<bind><picture>` / `<format><picture>` display rules.
//
// Shared by the PDF renderer (field value painting) and the FormCalc field
// accessor (`.formattedValue`), so it lives in lib/ rather than in either
// consumer.
//
// Supports three picture grammars:
//   • numeric masks          `###,###.##`, `($###.##)`
//   • simple date patterns   `DD/MM/YYYY`, `yyyy-mm-dd`
//   • compound pictures      `date{M/D/YYYY} time{h:MM:SS A}` (G13)
// ────────────────────────────────────────────────────────────────────────────

export function formatValue(value: unknown, picture?: string, locale?: string): string {
  if (value == null) return '';
  if (!picture) return String(value);

  const pattern = picture.trim();

  const compound = formatCompoundValue(value, pattern, locale);
  if (compound !== null) return compound;

  if (looksLikeDatePattern(pattern)) {
    return formatDateValue(value, pattern, locale);
  }

  if (looksLikeNumberPattern(pattern)) {
    return formatNumberValue(value, pattern);
  }

  return String(value);
}

// ─── Compound pictures: date{…} / time{…} ────────────────────────────────

const COMPOUND_RE = /(datetime|date|time)\{([^}]*)\}/gi;

/**
 * Format a value through a compound picture such as
 * `date{D-MMM}` or `date{M/D/YYYY} time{h:MM:SS A}`.
 * Evidence: ConvertWord.exe_disasm.c:92370, jfutility_disasm.c:31xxx.
 * Returns null when the pattern has no compound directive.
 */
function formatCompoundValue(value: unknown, pattern: string, locale?: string): string | null {
  COMPOUND_RE.lastIndex = 0;
  if (!COMPOUND_RE.test(pattern)) return null;

  const date = coerceDate(value);
  if (!date) return String(value);

  COMPOUND_RE.lastIndex = 0;
  return pattern.replace(COMPOUND_RE, (_match, kind: string, body: string) => {
    const k = kind.toLowerCase();
    if (k === 'time') return formatTimeBody(date, body || 'h:MM:SS A');
    if (k === 'datetime') return formatDateBody(date, body || 'M/D/YYYY', locale);
    return formatDateBody(date, body || 'M/D/YYYY', locale);
  });
}

// ─── Simple date patterns ────────────────────────────────────────────────

function looksLikeDatePattern(pattern: string): boolean {
  const upper = pattern.toLowerCase();
  return /(y|m|d)/.test(upper) && (upper.includes('y') || upper.includes('d'));
}

function formatDateValue(value: unknown, pattern: string, locale?: string): string {
  const date = coerceDate(value);
  if (!date) return String(value);
  return formatDateBody(date, pattern, locale);
}

/** Format a date with XFA date tokens (Y/M/D/E). Matching is case-insensitive. */
function formatDateBody(date: Date, body: string, locale?: string): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();

  const tokens: Array<[RegExp, () => string]> = [
    [/^YYYY/i, () => String(year)],
    [/^YY/i, () => String(year).slice(-2)],
    [/^Y/i, () => String(year)],
    [/^MMMM/i, () => monthName(date, 'long', locale)],
    [/^MMM/i, () => monthName(date, 'short', locale)],
    [/^MM/i, () => String(month).padStart(2, '0')],
    [/^M/i, () => String(month)],
    [/^EEEE/i, () => weekdayName(date, 'long', locale)],
    [/^EEE/i, () => weekdayName(date, 'short', locale)],
    [/^DD/i, () => String(day).padStart(2, '0')],
    [/^D/i, () => String(day)],
  ];
  return applyTokens(body, tokens);
}

/** Format a time with XFA time tokens (H/h/K=hour, M=minute, S=second, A=AM/PM). */
function formatTimeBody(date: Date, body: string): string {
  const hours24 = date.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const meridiem = hours24 < 12 ? 'AM' : 'PM';
  const pad = (n: number): string => String(n).padStart(2, '0');

  const tokens: Array<[RegExp, () => string]> = [
    [/^HH/, () => pad(hours24)],
    [/^H/, () => String(hours24)],
    [/^hh/, () => pad(hours12)],
    [/^h/, () => String(hours12)],
    [/^KK/, () => pad(hours12)],
    [/^K/, () => String(hours12)],
    [/^MM/, () => pad(minutes)],
    [/^M/, () => String(minutes)],
    [/^SS/, () => pad(seconds)],
    [/^S/, () => String(seconds)],
    [/^A/, () => meridiem],
  ];
  return applyTokens(body, tokens);
}

/** Greedily scan `body`, replacing the longest matching token at each position. */
function applyTokens(body: string, tokens: Array<[RegExp, () => string]>): string {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const rest = body.slice(i);
    let matched = false;
    for (const [re, render] of tokens) {
      const m = re.exec(rest);
      if (m) {
        out += render();
        i += m[0].length;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += body[i];
      i++;
    }
  }
  return out;
}

function monthName(date: Date, style: 'long' | 'short', locale?: string): string {
  return new Intl.DateTimeFormat(locale ?? 'en-US', { month: style, timeZone: 'UTC' }).format(date);
}

function weekdayName(date: Date, style: 'long' | 'short', locale?: string): string {
  return new Intl.DateTimeFormat(locale ?? 'en-US', { weekday: style, timeZone: 'UTC' }).format(date);
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

  // Time-only values (`14:30`, `14:30:05`) cannot be parsed by `new Date`.
  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (timeOnly) {
    const d = new Date(Date.UTC(1970, 0, 1, Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3] ?? 0)));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Date-only values are interpreted at UTC midnight so output is timezone-stable.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (dateOnly) {
    const d = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

// ─── Numeric masks ───────────────────────────────────────────────────────

function looksLikeNumberPattern(pattern: string): boolean {
  return /[0#]/.test(pattern) && !/[a-z]/i.test(pattern);
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

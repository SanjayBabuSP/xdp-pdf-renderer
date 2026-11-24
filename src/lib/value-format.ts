import {
  getMeridiem,
  getMonthNames,
  getNumberSeparators,
  getWeekdayNames,
  normalizeLocale,
  type NumberSeparators,
} from './locale-format';

export function formatValue(value: unknown, picture?: string, locale?: string): string {
  if (value == null) return '';
  if (!picture) return String(value);

  const pattern = picture.trim();
  const resolvedLocale = normalizeLocale(locale);

  const compound = formatCompoundValue(value, pattern, resolvedLocale);
  if (compound !== null) return compound;

  if (looksLikeNumberPattern(pattern)) {
    return formatNumberValue(value, pattern, resolvedLocale);
  }

  if (looksLikeDatePattern(pattern)) {
    return formatDateValue(value, pattern, resolvedLocale);
  }

  return String(value);
}

const COMPOUND_RE = /(datetime|date|time|text|num)\{([^}]*)\}/gi;

function formatCompoundValue(value: unknown, pattern: string, locale?: string): string | null {
  COMPOUND_RE.lastIndex = 0;
  if (!COMPOUND_RE.test(pattern)) return null;

  return pattern.replace(COMPOUND_RE, (_match, kind: string, body: string) => {
    const k = kind.toLowerCase();
    if (k === 'text') return formatTextTemplate(value, body);
    if (k === 'num') return formatNumberValue(value, body || 'zzz,zzz,zz9.99', locale);
    const effective = body || (k === 'time' ? 'h:MM:SS A' : 'M/D/YYYY');
    const pictured = typeof value === 'string' ? parseDateByPicture(value, effective) : null;
    const date = pictured ?? coerceDate(value);
    if (!date) return String(value);
    if (k === 'time') return formatTimeBody(date, effective, locale);
    return formatDateBody(date, effective, locale);
  });
}

function formatTextTemplate(value: unknown, template: string): string {
  const source = String(value);
  let out = '';
  let si = 0;
  let i = 0;
  while (i < template.length) {
    const ch = template[i];
    if (ch === "'") {
      const end = template.indexOf("'", i + 1);
      if (end < 0) {
        out += template.slice(i + 1);
        break;
      }
      out += template.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    if (ch === '9') {
      if (si < source.length) out += source[si++];
      i++;
      continue;
    }
    if (ch === 'A') {
      while (si < source.length && !/[A-Za-z]/.test(source[si])) si++;
      if (si < source.length) out += source[si++];
      i++;
      continue;
    }
    if (ch === 'O' || ch === 'X' || ch === 'x') {
      if (si < source.length) out += source[si++];
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function looksLikeDatePattern(pattern: string): boolean {
  const upper = pattern.toLowerCase();
  return /(y|m|d)/.test(upper) && (upper.includes('y') || upper.includes('d'));
}

function formatDateValue(value: unknown, pattern: string, locale?: string): string {
  const pictured = typeof value === 'string' ? parseDateByPicture(value, pattern) : null;
  const date = pictured ?? coerceDate(value);
  if (!date) return String(value);
  return formatDateBody(date, pattern, locale);
}

function parseDateByPicture(value: string, pattern: string): Date | null {
  const tokens: Array<'d' | 'm' | 'y'> = [];
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i].toUpperCase();
    if (ch === 'D' && tokens[tokens.length - 1] !== 'd') tokens.push('d');
    else if (ch === 'M' && tokens[tokens.length - 1] !== 'm') {
      tokens.push('m');
    } else if (ch === 'Y' && tokens[tokens.length - 1] !== 'y') tokens.push('y');
  }
  if (tokens.length !== 3) return null;
  if (/[hHkK]/.test(pattern.replace(/'[^']*'/g, '')) || /S\b/.test(pattern)) return null;
  const groups = value
    .trim()
    .split(/[^0-9]+/)
    .filter(Boolean);
  if (groups.length !== 3) return null;
  const parts: Record<'d' | 'm' | 'y', number> = { d: 0, m: 0, y: 0 };
  for (let i = 0; i < 3; i++) {
    const v = parseInt(groups[i], 10);
    if (!Number.isFinite(v)) return null;
    parts[tokens[i]] = v;
  }
  let { y } = parts;
  const m = parts.m;
  const d = parts.d;
  if (y < 100) y += y < 50 ? 2000 : 1900;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt;
}

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

function formatTimeBody(date: Date, body: string, locale?: string): string {
  const hours24 = date.getUTCHours();
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const meridiem = getMeridiem(locale, hours24 >= 12);
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
  return getMonthNames(locale, style)[date.getUTCMonth()];
}

function weekdayName(date: Date, style: 'long' | 'short', locale?: string): string {
  return getWeekdayNames(locale, style)[date.getUTCDay()];
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

  const timeOnly = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (timeOnly) {
    const d = new Date(
      Date.UTC(1970, 0, 1, Number(timeOnly[1]), Number(timeOnly[2]), Number(timeOnly[3] ?? 0))
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(normalized);
  if (dateOnly) {
    const d = new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? null : d;
}

function looksLikeNumberPattern(pattern: string): boolean {
  if (/\{/.test(pattern)) return false;
  return /[0#9z%]/.test(pattern);
}

const INT_PLACEHOLDER = /[0#9z]/;

function formatNumberValue(value: unknown, pattern: string, locale?: string): string {
  const separators = getNumberSeparators(locale);
  const number = coerceNumber(value, separators);
  if (number === null) return String(value);

  const bar = pattern.indexOf('|');
  const positivePart = bar >= 0 ? pattern.slice(0, bar) : pattern;
  const negativePart = bar >= 0 ? pattern.slice(bar + 1) : undefined;

  const negative = number < 0;
  const part = negative && negativePart !== undefined ? negativePart : positivePart;
  const addSign = negative && negativePart === undefined;

  const scaled = /%/.test(part) ? Math.abs(number) * 100 : Math.abs(number);

  return renderNumberTemplate(scaled, part, addSign, separators);
}

function renderNumberTemplate(
  abs: number,
  template: string,
  addSign: boolean,
  separators: NumberSeparators
): string {
  const dot = template.indexOf('.');
  const intTemplate = dot >= 0 ? template.slice(0, dot) : template;
  const afterDot = dot >= 0 ? template.slice(dot + 1) : '';
  const fracMatch = /^[0#9z]*/.exec(afterDot);
  const fracTemplate = fracMatch ? fracMatch[0] : '';
  const suffix = afterDot.slice(fracTemplate.length);

  const decimals = fracTemplate.length;
  const rounded = abs.toFixed(decimals);
  const [intDigits, fracDigits = ''] = rounded.split('.');
  const hasMandatoryFraction = /[09]/.test(fracTemplate);
  const showFraction =
    decimals > 0 && (hasMandatoryFraction || [...fracDigits].some((digit) => digit !== '0'));

  const intOut = renderIntegerTemplate(intTemplate, intDigits, addSign, separators.group);
  const fracOut = showFraction
    ? `${separators.decimal}${fillPlaceholders(fracTemplate, fracDigits)}`
    : '';
  return `${intOut}${fracOut}${suffix}`;
}

function renderIntegerTemplate(
  template: string,
  digits: string,
  addSign: boolean,
  groupSeparator: string
): string {
  const chars = [...template];
  const placeholderIdx = chars
    .map((c, i) => (INT_PLACEHOLDER.test(c) ? i : -1))
    .filter((i) => i >= 0);

  const overflowCount = Math.max(0, digits.length - placeholderIdx.length);
  const overflow = overflowCount > 0 ? digits.slice(0, overflowCount) : '';
  const significant = overflowCount > 0 ? digits.slice(overflowCount) : digits;

  const rendered = new Map<number, string>();
  let d = significant.length - 1;
  for (let k = placeholderIdx.length - 1; k >= 0; k--) {
    const ch = chars[placeholderIdx[k]];
    if (d >= 0) {
      rendered.set(placeholderIdx[k], significant[d--]);
    } else if (ch === '0') {
      rendered.set(placeholderIdx[k], '0');
    } else if (ch === '9' || ch === 'z') {
      rendered.set(placeholderIdx[k], ' ');
    } else {
      rendered.set(placeholderIdx[k], '');
    }
  }

  let out = '';
  let signPlaced = !addSign;
  let overflowPlaced = overflow === '';
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (INT_PLACEHOLDER.test(ch)) {
      const value = rendered.get(i) ?? '';
      if (!signPlaced) {
        out += '-';
        signPlaced = true;
      }
      if (!overflowPlaced) {
        out += overflow;
        overflowPlaced = true;
      }
      out += value;
      continue;
    }
    if (ch === ',') {
      const leftHasContent = placeholderIdx.some(
        (idx) => idx < i && (rendered.get(idx) ?? '') !== '' && (rendered.get(idx) ?? '') !== ' '
      );
      if (leftHasContent || !overflowPlaced) out += groupSeparator;
      continue;
    }
    out += ch;
  }
  if (!overflowPlaced) out += overflow;
  if (!signPlaced) out = `-${out}`;
  return out;
}

function fillPlaceholders(template: string, digits: string): string {
  let out = '';
  let d = 0;
  for (const ch of template) {
    if (INT_PLACEHOLDER.test(ch)) {
      out += d < digits.length ? digits[d++] : ch === '0' ? '0' : ' ';
    } else {
      out += ch;
    }
  }
  return out;
}

function coerceNumber(value: unknown, separators: NumberSeparators): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    const compact = normalized
      .replace(/[$€£¥₹\s]/g, '')
      .replace(/%/g, '')
      .split(separators.group)
      .join('')
      .split(separators.decimal)
      .join('.');
    const parsed = Number(compact);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

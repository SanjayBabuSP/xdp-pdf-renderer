// ────────────────────────────────────────────────────────────────────────────
// Value formatting — XFA `<bind><picture>` / `<format><picture>` display rules.
//
// Shared by the PDF renderer (field value painting) and the FormCalc field
// accessor (`.formattedValue`), so it lives in lib/ rather than in either
// consumer.
//
// Supports four picture grammars:
//   • numeric masks          `###,###.##`, `$z,zz9.99`, `$z,zz9.99|($z,zz9.99)`
//   • simple date patterns   `DD/MM/YYYY`, `yyyy-mm-dd`
//   • compound pictures      `date{M/D/YYYY} time{h:MM:SS A}` (G13)
//   • text templates         `text{'('999')' 999-9999}` (G14 follow-up)
//
// The numeric token set (`0 # 9 z , . CR DB %` and `|` alternates) follows the
// locale picture tables compiled into `jfutility.dll`
// (reference/decompiled/jfutility_disasm.c:31412 `z,zz9.zzz`, `$ z,zz9.99s`, …)
// and the Designer preset list in `LocalesList.xml`.
// ────────────────────────────────────────────────────────────────────────────

export function formatValue(value: unknown, picture?: string, locale?: string): string {
  if (value == null) return '';
  if (!picture) return String(value);

  const pattern = picture.trim();

  const compound = formatCompoundValue(value, pattern, locale);
  if (compound !== null) return compound;

  // Numeric masks are tested before dates: a picture such as `$z,zz9.99DB`
  // contains a `D` that would otherwise be mistaken for a day token.
  if (looksLikeNumberPattern(pattern)) {
    return formatNumberValue(value, pattern);
  }

  if (looksLikeDatePattern(pattern)) {
    return formatDateValue(value, pattern, locale);
  }

  return String(value);
}

// ─── Compound pictures: date{…} / time{…} ────────────────────────────────

const COMPOUND_RE = /(datetime|date|time|text)\{([^}]*)\}/gi;

/**
 * Format a value through a compound picture such as
 * `date{D-MMM}`, `date{M/D/YYYY} time{h:MM:SS A}` or
 * `text{'('999')' 999-9999}`.
 * Evidence: ConvertWord.exe_disasm.c:92370, jfutility_disasm.c:31xxx;
 * pattern presets in `LocalesList.xml`.
 * Returns null when the pattern has no compound directive.
 */
function formatCompoundValue(value: unknown, pattern: string, locale?: string): string | null {
  COMPOUND_RE.lastIndex = 0;
  if (!COMPOUND_RE.test(pattern)) return null;

  return pattern.replace(COMPOUND_RE, (_match, kind: string, body: string) => {
    const k = kind.toLowerCase();
    if (k === 'text') return formatTextTemplate(value, body);
    const date = coerceDate(value);
    if (!date) return String(value);
    if (k === 'time') return formatTimeBody(date, body || 'h:MM:SS A');
    return formatDateBody(date, body || 'M/D/YYYY', locale);
  });
}

/**
 * `text{…}` template: `9` consumes a digit, `A` a letter, `O`/`X` any
 * character, single-quoted runs are literal, everything else is literal.
 */
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

/** A numeric picture uses at least one placeholder or the percent token. */
function looksLikeNumberPattern(pattern: string): boolean {
  if (/\{/.test(pattern)) return false;
  return /[0#9z%]/.test(pattern);
}

const INT_PLACEHOLDER = /[0#9z]/;

function formatNumberValue(value: unknown, pattern: string): string {
  const number = coerceNumber(value);
  if (number === null) return String(value);

  // `|` separates the positive and negative sub-pictures.
  const bar = pattern.indexOf('|');
  const positivePart = bar >= 0 ? pattern.slice(0, bar) : pattern;
  const negativePart = bar >= 0 ? pattern.slice(bar + 1) : undefined;

  const negative = number < 0;
  const part = negative && negativePart !== undefined ? negativePart : positivePart;
  const addSign = negative && negativePart === undefined;

  // `%` in a picture scales the value by 100 (Excel/XFA behaviour).
  const scaled = /%/.test(part) ? Math.abs(number) * 100 : Math.abs(number);

  return renderNumberTemplate(scaled, part, addSign);
}

/**
 * Render a number through a picture template. Placeholders:
 *   `0` always prints a digit, `#` prints nothing when absent,
 *   `9`/`z` print a space when absent, `,` groups, `.` separates decimals.
 * Literals (currency symbols, `CR`, `DB`, `%`) are copied verbatim.
 */
function renderNumberTemplate(abs: number, template: string, addSign: boolean): string {
  const dot = template.indexOf('.');
  const intTemplate = dot >= 0 ? template.slice(0, dot) : template;
  const afterDot = dot >= 0 ? template.slice(dot + 1) : '';
  const fracMatch = /^[0#9z]*/.exec(afterDot);
  const fracTemplate = fracMatch ? fracMatch[0] : '';
  const suffix = afterDot.slice(fracTemplate.length);

  const decimals = fracTemplate.length;
  const rounded = abs.toFixed(decimals);
  const [intDigits, fracDigits = ''] = rounded.split('.');

  const intOut = renderIntegerTemplate(intTemplate, intDigits, addSign);
  const fracOut = decimals > 0 ? `.${fillPlaceholders(fracTemplate, fracDigits)}` : '';
  return `${intOut}${fracOut}${suffix}`;
}

function renderIntegerTemplate(template: string, digits: string, addSign: boolean): string {
  const chars = [...template];
  const placeholderIdx = chars
    .map((c, i) => (INT_PLACEHOLDER.test(c) ? i : -1))
    .filter((i) => i >= 0);

  // A picture is a minimum width: digits beyond the placeholder count are
  // still printed (e.g. `0.00` on 12.345 → `12.35`, not `2.35`).
  const overflowCount = Math.max(0, digits.length - placeholderIdx.length);
  const overflow = overflowCount > 0 ? digits.slice(0, overflowCount) : '';
  const significant = overflowCount > 0 ? digits.slice(overflowCount) : digits;

  // Right-align the remaining digits into the placeholders.
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
      // Emit the separator only when significant output remains to its left.
      const leftHasContent = placeholderIdx.some(
        (idx) => idx < i && (rendered.get(idx) ?? '') !== '' && (rendered.get(idx) ?? '') !== ' '
      );
      if (leftHasContent || !overflowPlaced) out += ',';
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

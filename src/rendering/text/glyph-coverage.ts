import type { PDFFont } from 'pdf-lib';

type CharacterSet = ReadonlySet<number>;

const CHARSET_CACHE = new WeakMap<PDFFont, CharacterSet | null>();
const WHITESPACE = /\s/u;
const BLANK_SEPARATOR = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/u;

function isPrintableAscii(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x7e;
}

function charsetFor(font: PDFFont): CharacterSet | null {
  const cached = CHARSET_CACHE.get(font);
  if (cached !== undefined) return cached;

  let charset: CharacterSet | null = null;
  try {
    const getCharacterSet = font.getCharacterSet;
    if (typeof getCharacterSet === 'function') charset = new Set(getCharacterSet.call(font));
  } catch {
    charset = null;
  }
  CHARSET_CACHE.set(font, charset);
  return charset;
}

/**
 * Reports whether a font can represent a Unicode code point.
 *
 * Printable ASCII is always covered. Returns true when the font does not
 * expose a character set, since coverage cannot be determined in that case.
 *
 * @param font - Font to inspect.
 * @param codePoint - Unicode code point to test.
 * @returns True when the code point is representable or coverage is unknown.
 * @example
 * ```ts
 * hasGlyph(arialFont, 0x039e); // false for the Latin-1 Arial subset
 * ```
 */
export function hasGlyph(font: PDFFont, codePoint: number): boolean {
  if (isPrintableAscii(codePoint)) return true;
  const charset = charsetFor(font);
  return charset === null || charset.has(codePoint);
}

/**
 * Drops code points that the supplied font cannot represent.
 *
 * Printable ASCII is always covered. Whitespace is preserved so wrapping,
 * indentation and word spacing are unaffected; when the font exposes a
 * character set that lacks a whitespace code point, a regular space is
 * substituted so the encoder never emits `.notdef` tofu. Text is returned
 * unchanged when the font does not expose a character set.
 *
 * @param text - Text to filter.
 * @param font - Font whose character set decides coverage.
 * @returns The text with unmappable code points removed.
 * @example
 * ```ts
 * sanitizeTextForFont('ΞF  mqx', arialFont); // 'F  mqx'
 * ```
 */
export function sanitizeTextForFont(text: string, font: PDFFont): string {
  const charset = charsetFor(font);

  const kept: string[] = [];
  for (const ch of Array.from(text)) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined || isPrintableAscii(codePoint)) {
      kept.push(ch);
      continue;
    }
    if (WHITESPACE.test(ch)) {
      if (charset !== null && !charset.has(codePoint) && BLANK_SEPARATOR.test(ch)) {
        kept.push(' ');
        continue;
      }
      kept.push(ch);
      continue;
    }
    if (charset === null || charset.has(codePoint)) kept.push(ch);
  }
  return kept.join('');
}

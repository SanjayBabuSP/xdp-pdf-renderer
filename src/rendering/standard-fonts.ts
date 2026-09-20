import { StandardFonts } from 'pdf-lib';

/**
 * Base-14 standard PDF font resolution.
 *
 * Derived from Adobe LiveCycle Designer 11.0's PDF device config
 * (reference/config_files/Designer.xdc) `<pdl><seq>` entries, which map
 * `Family_Weight_Posture_Encoding` to the PDF PostScript font name:
 *
 *   Courier_Normal_Normal_ISO-8859-1   → Courier
 *   Courier_Bold_Normal_ISO-8859-1     → Courier-Bold
 *   Courier_Bold_Italic_ISO-8859-1     → Courier-BoldOblique
 *   Helvetica_Bold_Italic_ISO-8859-1   → Helvetica-BoldOblique
 *   Times_Normal_Italic_ISO-8859-1     → Times-Italic
 *   Symbol_..._fontSpecific            → SymbolMT
 *   ITC Zapf Dingbats_..._fontSpecific → ZapfDingbats
 *
 * Windows/metric-compatible aliases (Arial, Times New Roman, Courier New) are
 * also resolved to their metric-matching PDF base font, mirroring the XCI
 * equate behavior (Helvetica ↔ Arial, Times ↔ Times New Roman, ...).
 */

/** Canonical base-14 family → StandardFonts name (from the XDC seq values). */
const BASE14_NAMES: Record<string, StandardFonts> = {
  courier: StandardFonts.Courier,
  helvetica: StandardFonts.Helvetica,
  times: StandardFonts.TimesRoman,
  symbol: StandardFonts.Symbol,
  zapfdingbats: StandardFonts.ZapfDingbats,
};

/** Family-name aliases mapped to their metric-matching base-14 family. */
const FAMILY_ALIASES: Record<string, string> = {
  courier: 'courier',
  'courier new': 'courier',
  helvetica: 'helvetica',
  helv: 'helvetica',
  arial: 'helvetica',
  'arial narrow': 'helvetica',
  times: 'times',
  'times new roman': 'times',
  timesnewroman: 'times',
  symbol: 'symbol',
  zapfdingbats: 'zapfdingbats',
  'zapf dingbats': 'zapfdingbats',
  'itc zapf dingbats': 'zapfdingbats',
};

const BOLD_WEIGHTS = new Set(['bold', 'b', 'black', 'heavy', 'demi']);

/**
 * Resolve an XDP font request (family + weight + posture) to a PDF base-14
 * standard font, following the XDC `<seq>` mapping. Returns undefined when the
 * family has no standard PDF counterpart (an embedded font should be used).
 */
export function mapToStandardPdfFont(
  family: string | undefined,
  weight?: string,
  posture?: string
): StandardFonts | undefined {
  if (!family) return undefined;
  const canonical = FAMILY_ALIASES[family.trim().toLowerCase()];
  if (!canonical) return undefined;

  const bold = isBoldWeight(weight);
  const italic = isItalicPosture(posture);

  switch (canonical) {
    case 'courier':
      return bold
        ? italic
          ? StandardFonts.CourierBoldOblique
          : StandardFonts.CourierBold
        : italic
          ? StandardFonts.CourierOblique
          : StandardFonts.Courier;
    case 'helvetica':
      return bold
        ? italic
          ? StandardFonts.HelveticaBoldOblique
          : StandardFonts.HelveticaBold
        : italic
          ? StandardFonts.HelveticaOblique
          : StandardFonts.Helvetica;
    case 'times':
      return bold
        ? italic
          ? StandardFonts.TimesRomanBoldItalic
          : StandardFonts.TimesRomanBold
        : italic
          ? StandardFonts.TimesRomanItalic
          : StandardFonts.TimesRoman;
    default:
      // Symbol and ZapfDingbats have no weight/posture variants.
      return BASE14_NAMES[canonical];
  }
}

/** Returns the base-14 family the given family maps to, if any. */
export function base14Family(family: string | undefined): string | undefined {
  if (!family) return undefined;
  return FAMILY_ALIASES[family.trim().toLowerCase()];
}

/** True if the family resolves to one of the PDF base-14 fonts. */
export function isBase14Family(family: string | undefined): boolean {
  return base14Family(family) !== undefined;
}

/** True when the weight token indicates a bold face. */
export function isBoldWeight(weight: string | undefined): boolean {
  if (!weight) return false;
  return BOLD_WEIGHTS.has(weight.trim().toLowerCase());
}

/** True when the posture token indicates an italic/oblique face. */
export function isItalicPosture(posture: string | undefined): boolean {
  if (!posture) return false;
  const normalized = posture.trim().toLowerCase();
  return normalized === 'italic' || normalized === 'oblique';
}

/**
 * True if the text is safe to render with a WinAnsi-only standard PDF font.
 * Base-14 fonts (and pdf-lib's standard font encoding) only cover WinAnsi code
 * points; anything else must be drawn with an embedded Unicode font instead.
 */
export function isWinAnsiSafe(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    // WinAnsi leaves 0x80–0x9F undefined and caps at 0xFF.
    if (code > 0xff || (code >= 0x80 && code <= 0x9f)) return false;
  }
  return true;
}
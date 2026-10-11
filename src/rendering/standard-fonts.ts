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

/**
 * Family-name aliases mapped to their metric-matching base-14 family.
 *
 * Each entry must be metrically defensible, not merely "renders as text":
 * the alias decides the advance widths used for wrapping, alignment and
 * justification, so a wrong alias silently re-measures every text run.
 *
 * - `arial` / `arialmt` / `helvetica` / `helv` → Helvetica. Arial was designed
 *   as a metric clone of Helvetica, so this is exact.
 * - `arial narrow` / `arialnarrow` → Helvetica **at a horizontal scale** (see
 *   NARROW_SCALE). Arial Narrow is a *condensed* face; mapping it to
 *   full-width Helvetica overstates every advance by ~20%.
 * - `times` / `times new roman` / `timesnewroman` → Times-Roman (metric clone).
 * - `courier` / `courier new` → Courier (monospaced, both 600/1000).
 */
const FAMILY_ALIASES: Record<string, string> = {
  courier: 'courier',
  'courier new': 'courier',
  couriernew: 'courier',
  helvetica: 'helvetica',
  helv: 'helvetica',
  arial: 'helvetica',
  // "ArialMT" is the PostScript-style name Designer authors frequently use for
  // plain Arial; treating it as an unknown family sent it to the Unicode
  // fallback font, which is ~13% wider than Arial and broke every wrap in the
  // field. It is the same face as Arial, so it belongs here.
  arialmt: 'helvetica',
  'arial narrow': 'helvetica',
  arialnarrow: 'helvetica',
  times: 'times',
  'times new roman': 'times',
  timesnewroman: 'times',
  symbol: 'symbol',
  zapfdingbats: 'zapfdingbats',
  'zapf dingbats': 'zapfdingbats',
  'itc zapf dingbats': 'zapfdingbats',
};

/**
 * Horizontal scale applied when a *condensed* family resolves to its
 * full-width base-14 counterpart.
 *
 * Arial Narrow's advance widths are Arial's multiplied by 0.82 for every glyph
 * in the Latin set — a published property of the face, not a tuning knob.
 * Without it, every Arial Narrow run is measured ~22% too wide and wraps into
 * more lines than Designer authored.
 *
 * evidence: Adobe treats a condensed face as a horizontal scale, not a
 * separate base-14 slot (`Designer.xdc` `<seq>` has no Arial Narrow entry, so
 * Designer must scale). 0.82 is the Arial Narrow / Arial advance ratio.
 */
export const NARROW_SCALE = 0.82;

/** Families that must be drawn with {@link NARROW_SCALE} horizontally condensed. */
const NARROW_FAMILIES = new Set(['arial narrow', 'arialnarrow']);

/** Family names (all aliases) that resolve to a base-14 standard font. */
export const BASE14_FAMILIES: readonly string[] = Object.keys(FAMILY_ALIASES);

/**
 * True when `family` is a condensed face that resolves to a full-width base-14
 * font and therefore needs {@link NARROW_SCALE} applied at draw and measure
 * time. The scale is a property of the *requested* family, not of the resolved
 * font, so this must be consulted with the original XDP family name.
 */
export function isCondensedFamily(family: string | undefined): boolean {
  if (!family) return false;
  return NARROW_FAMILIES.has(family.trim().toLowerCase());
}

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
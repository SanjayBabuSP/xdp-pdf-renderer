import { StandardFonts } from 'pdf-lib';

const BASE14_NAMES: Record<string, StandardFonts> = {
  courier: StandardFonts.Courier,
  helvetica: StandardFonts.Helvetica,
  times: StandardFonts.TimesRoman,
  symbol: StandardFonts.Symbol,
  zapfdingbats: StandardFonts.ZapfDingbats,
};

const FAMILY_ALIASES: Record<string, string> = {
  courier: 'courier',
  'courier new': 'courier',
  couriernew: 'courier',
  helvetica: 'helvetica',
  helv: 'helvetica',
  arial: 'helvetica',
  arialmt: 'helvetica',
  'arial narrow': 'helvetica',
  arialnarrow: 'helvetica',
  calibri: 'helvetica',
  'segoe ui': 'helvetica',
  segoeui: 'helvetica',
  times: 'times',
  'times new roman': 'times',
  timesnewroman: 'times',
  symbol: 'symbol',
  zapfdingbats: 'zapfdingbats',
  'zapf dingbats': 'zapfdingbats',
  'itc zapf dingbats': 'zapfdingbats',
};

export const NARROW_SCALE = 0.93;

const NARROW_FAMILIES = new Set(['arial narrow', 'arialnarrow']);

export const BASE14_FAMILIES: readonly string[] = Object.keys(FAMILY_ALIASES);

export function isCondensedFamily(family: string | undefined): boolean {
  if (!family) return false;
  return NARROW_FAMILIES.has(family.trim().toLowerCase());
}

const BOLD_WEIGHTS = new Set(['bold', 'b', 'black', 'heavy', 'demi']);

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
      return BASE14_NAMES[canonical];
  }
}

export function base14Family(family: string | undefined): string | undefined {
  if (!family) return undefined;
  return FAMILY_ALIASES[family.trim().toLowerCase()];
}

export function isBase14Family(family: string | undefined): boolean {
  return base14Family(family) !== undefined;
}

export function isBoldWeight(weight: string | undefined): boolean {
  if (!weight) return false;
  return BOLD_WEIGHTS.has(weight.trim().toLowerCase());
}

export function isItalicPosture(posture: string | undefined): boolean {
  if (!posture) return false;
  const normalized = posture.trim().toLowerCase();
  return normalized === 'italic' || normalized === 'oblique';
}

export function isWinAnsiSafe(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff || (code >= 0x80 && code <= 0x9f)) return false;
  }
  return true;
}
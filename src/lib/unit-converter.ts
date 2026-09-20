import { Result } from '../types';
import { success, failure } from './result-type';

type Unit = 'in' | 'cm' | 'mm' | 'pt' | 'px';

const CONVERSIONS: Record<Unit, number> = {
  in: 72,
  cm: 28.3465,
  mm: 2.83465,
  pt: 1,
  px: 0.75,
};

const UNIT_PATTERN = /^([+-]?[\d.]+)(in|cm|mm|pt|px)$/;

/**
 * Stock paper sizes in points, derived from Adobe LiveCycle Designer 11.0's
 * Designer.xdc <medium> catalog (reference/config_files/Designer.xdc).
 * values are the PDF device's short/long side in points. Keys are normalized
 * to lowercase so lookups are case-insensitive.
 */
const SOURCE_STOCK_SIZES: Record<string, { short: number; long: number }> = {
  default: { short: 612, long: 792 },
  letter: { short: 612, long: 792 },
  letterSmall: { short: 612, long: 792 },
  letterPlain: { short: 612, long: 792 },
  letterLetterhead: { short: 612, long: 792 },
  letterSpecial: { short: 612, long: 792 },
  letterColor: { short: 612, long: 792 },
  letterTransverse: { short: 612, long: 792 },
  letterExtra: { short: 684, long: 864 },
  letterExtraTransverse: { short: 684, long: 864 },
  letterPlus: { short: 612, long: 913.68 },
  tabloid: { short: 792, long: 1224 },
  tabloidExtra: { short: 841.68, long: 1296 },
  ledger: { short: 1224, long: 792 },
  legal: { short: 612, long: 1008 },
  legalExtra: { short: 684, long: 1080 },
  statement: { short: 396, long: 612 },
  executive: { short: 522, long: 756 },
  note: { short: 612, long: 792 },
  folio: { short: 612, long: 936 },
  quarto: { short: 609.45, long: 779.53 },
  a2: { short: 623.62, long: 1683.78 },
  a3: { short: 841.89, long: 1190.55 },
  a3Transverse: { short: 841.89, long: 1190.55 },
  a3Extra: { short: 912.76, long: 1261.42 },
  a3ExtraTransverse: { short: 907.09, long: 1261.42 },
  a4: { short: 595.28, long: 841.89 },
  a4Small: { short: 595.28, long: 841.89 },
  a4Plain: { short: 595.28, long: 841.89 },
  a4Letterhead: { short: 595.28, long: 841.89 },
  a4Special: { short: 595.28, long: 841.89 },
  a4Color: { short: 595.28, long: 841.89 },
  a4Transverse: { short: 595.28, long: 841.89 },
  a4Extra: { short: 667.44, long: 913.68 },
  a4Plus: { short: 595.28, long: 935.43 },
  a5: { short: 419.53, long: 595.28 },
  a5Transverse: { short: 419.53, long: 595.28 },
  a5Extra: { short: 493.23, long: 666.14 },
  b4JIS: { short: 708.66, long: 1003.46 },
  b4JISPlain: { short: 708.66, long: 1003.46 },
  b4JISLetterhead: { short: 708.66, long: 1003.46 },
  b4JISSpecial: { short: 708.66, long: 1003.46 },
  b4JISColor: { short: 708.66, long: 1003.46 },
  b4ISO: { short: 708.66, long: 1000.63 },
  b5JIS: { short: 515.91, long: 728.5 },
  b5JISTransverse: { short: 515.91, long: 728.5 },
  b5ISOExtra: { short: 569.76, long: 782.36 },
  cSizeSheet: { short: 1224, long: 1584 },
  dSizeSheet: { short: 1584, long: 2448 },
  eSizeSheet: { short: 2448, long: 3168 },
  envelope9: { short: 279, long: 639 },
  envelope10: { short: 297, long: 684 },
  envelope11: { short: 324, long: 747 },
  envelope12: { short: 342, long: 792 },
  envelope14: { short: 360, long: 828 },
  envelopeDL: { short: 311.81, long: 623.62 },
  envelopeC3: { short: 918.43, long: 1298.27 },
  envelopeC4: { short: 649.13, long: 918.43 },
  envelopeC5: { short: 459.21, long: 649.13 },
  envelopeC6: { short: 323.15, long: 459.21 },
  envelopeC65: { short: 323.15, long: 649.13 },
  envelopeB4: { short: 708.66, long: 1000.63 },
  envelopeB5: { short: 498.9, long: 708.66 },
  envelopeB6: { short: 498.9, long: 354.33 },
  envelope: { short: 311.81, long: 651.97 },
  envelopeMonarch: { short: 279, long: 540 },
  envelopeInvite: { short: 623.62, long: 623.62 },
  '6And3QuartersEnvelope': { short: 261, long: 468 },
  usStdFanfold: { short: 1071, long: 792 },
  germanStdFanfold: { short: 612, long: 864 },
  germanLegalFanfold: { short: 612, long: 936 },
  japanesePostcard: { short: 283.46, long: 419.53 },
  '9By11Inch': { short: 648, long: 792 },
  '10By11Inch': { short: 720, long: 792 },
  '10By14Inch': { short: 720, long: 1008 },
  '11By17Inch': { short: 792, long: 1224 },
  '15By11Inch': { short: 1080, long: 792 },
  superASuperAA4: { short: 643.46, long: 1009.13 },
  superBSuperBA3: { short: 864.57, long: 1380.47 },
};

/** Lowercase-normalized stock sizes for case-insensitive lookups. */
export const STOCK_SIZES: Record<string, { short: number; long: number }> = Object.fromEntries(
  Object.entries(SOURCE_STOCK_SIZES).map(([key, size]) => [key.toLowerCase(), size])
);

/** Convert a dimension string like "19.05mm" or "72pt" to points. */
export function toPoints(valueWithUnit: string): Result<number> {
  const trimmed = valueWithUnit.trim();
  const match = trimmed.match(UNIT_PATTERN);

  if (!match) {
    const num = Number(trimmed);
    if (!isNaN(num) && trimmed !== '') return success(num);
    return failure('UNKNOWN_UNIT', `Cannot parse dimension: ${trimmed}`);
  }

  const value = parseFloat(match[1]);
  const unit = match[2] as Unit;
  return success(value * CONVERSIONS[unit]);
}

/** Convert a dimension string to points, returning 0 on failure. */
export function toPointsOrZero(valueWithUnit: string | undefined): number {
  if (!valueWithUnit) return 0;
  const r = toPoints(valueWithUnit);
  return r.success ? r.data : 0;
}

/** Look up a stock paper size by name (e.g. "a4", "letter"), in points. */
export function stockSizePoints(stock: string): { short: number; long: number } | undefined {
  return STOCK_SIZES[stock.toLowerCase()];
}

/** All known stock medium names from the Designer.xdc catalog. */
export function stockMediumNames(): string[] {
  return Object.keys(STOCK_SIZES);
}

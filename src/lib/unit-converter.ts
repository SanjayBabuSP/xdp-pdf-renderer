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

const STOCK_SIZES: Record<string, { short: number; long: number }> = {
  a4: { short: 595.28, long: 841.89 },
  a3: { short: 841.89, long: 1190.55 },
  a5: { short: 419.53, long: 595.28 },
  letter: { short: 612, long: 792 },
  legal: { short: 612, long: 1008 },
};

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

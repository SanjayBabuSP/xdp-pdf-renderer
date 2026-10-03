/**
 * Per-font metrics from Adobe LiveCycle Designer 11.0's PDF device config.
 *
 * `reference/Adobe-LiveCycle-Designer-11.0/config_files/adobepdf.xdc:265-333`
 * declares one `<font>`/`<metrics>` block per base-14 face. The values are
 * expressed in 1/1000-em units (the block has `size="1000pt"`), i.e. they are
 * directly the per-mille metrics.
 *
 * These supersede pdf-lib's AFM metrics for the base-14 families: Adobe's own
 * `lineHeight` (1000 Courier, 1149 Helvetica/Times, 1200 Symbol/Zapf) drives
 * the line advance, replacing the previously hard-coded 1.2 factor.
 *
 * Runtime plumbing: `XFABoxModelLayout` asks `XFAFontService::resolveXFAFont`
 * for a `jfFontInstance` (xfalayout_disasm.c:19046) and the instance's
 * `getLineGap`/`getSpacing`/`getAscent`/`getDescent` (font_disasm.c:14651,
 * :14870, :15214, :15229) feed the text engine's line box.
 */

import { base14Family } from '../standard-fonts';

/** A face's vertical metrics in 1/1000 em (from adobepdf.xdc `<metrics>`). */
export interface XdcFontMetrics {
  /** `<metrics ascent>`. */
  ascent: number;
  /** `<metrics descent>` (positive distance below the baseline). */
  descent: number;
  /** `<metrics lineHeight>` — the default line advance at size 1000pt. */
  lineHeight: number;
  /** `<metrics capHeight>`. */
  capHeight: number;
  /** `<metrics xHeight>`. */
  xHeight: number;
  /** `<metrics defaultCharWidth>` (per-mille). */
  defaultCharWidth: number;
}

/** Key: `${canonicalFamily}|${weight}|${posture}` where weight ∈ normal|bold. */
const XDC_METRICS: Readonly<Record<string, XdcFontMetrics>> = {
  // adobepdf.xdc:266-283 — Courier
  'courier|normal|normal': { ascent: 613, descent: 188, lineHeight: 1000, capHeight: 571, xHeight: 423, defaultCharWidth: 600 },
  'courier|normal|italic': { ascent: 613, descent: 188, lineHeight: 1000, capHeight: 571, xHeight: 423, defaultCharWidth: 600 },
  'courier|bold|normal': { ascent: 633, descent: 209, lineHeight: 1000, capHeight: 592, xHeight: 443, defaultCharWidth: 600 },
  'courier|bold|italic': { ascent: 633, descent: 209, lineHeight: 1000, capHeight: 592, xHeight: 443, defaultCharWidth: 600 },

  // adobepdf.xdc:286-303 — Helvetica
  'helvetica|normal|normal': { ascent: 728, descent: 210, lineHeight: 1149, capHeight: 718, xHeight: 523, defaultCharWidth: 949 },
  'helvetica|normal|italic': { ascent: 728, descent: 210, lineHeight: 1149, capHeight: 718, xHeight: 524, defaultCharWidth: 949 },
  'helvetica|bold|normal': { ascent: 728, descent: 210, lineHeight: 1149, capHeight: 718, xHeight: 531, defaultCharWidth: 949 },
  'helvetica|bold|italic': { ascent: 728, descent: 210, lineHeight: 1149, capHeight: 718, xHeight: 531, defaultCharWidth: 949 },

  // adobepdf.xdc:306-323 — Times
  'times|normal|normal': { ascent: 693, descent: 216, lineHeight: 1149, capHeight: 662, xHeight: 450, defaultCharWidth: 949 },
  'times|normal|italic': { ascent: 693, descent: 216, lineHeight: 1149, capHeight: 653, xHeight: 441, defaultCharWidth: 949 },
  'times|bold|normal': { ascent: 677, descent: 216, lineHeight: 1149, capHeight: 676, xHeight: 461, defaultCharWidth: 949 },
  'times|bold|italic': { ascent: 677, descent: 216, lineHeight: 1149, capHeight: 669, xHeight: 462, defaultCharWidth: 949 },

  // adobepdf.xdc:326 — Symbol
  'symbol|normal|normal': { ascent: 775, descent: 225, lineHeight: 1200, capHeight: 700, xHeight: 766, defaultCharWidth: 250 },

  // adobepdf.xdc:331 — ITC Zapf Dingbats
  'zapfdingbats|normal|normal': { ascent: 0, descent: 0, lineHeight: 1200, capHeight: 0, xHeight: 0, defaultCharWidth: 974 },
};

function normalizeWeight(weight?: string): 'normal' | 'bold' {
  if (!weight) return 'normal';
  const w = weight.trim().toLowerCase();
  return w === 'bold' || w === 'b' || w === 'black' || w === 'heavy' || w === 'demi' ? 'bold' : 'normal';
}

function normalizePosture(posture?: string): 'normal' | 'italic' {
  if (!posture) return 'normal';
  const p = posture.trim().toLowerCase();
  return p === 'italic' || p === 'oblique' || p === 'o' || p === 'i' ? 'italic' : 'normal';
}

/**
 * Look up the XDC metrics for a requested font. Family aliases are resolved
 * through the same base-14 map used for PDF font selection (Arial → Helvetica,
 * Times New Roman → Times, Courier New → Courier, …). Returns undefined for
 * families with no XDC face (embedded fonts such as DejaVu fall back to their
 * own fontkit metrics).
 */
export function lookupXdcMetrics(
  family?: string,
  weight?: string,
  posture?: string
): XdcFontMetrics | undefined {
  const canonical = base14Family(family);
  if (!canonical) return undefined;
  const w = normalizeWeight(weight);
  const p = normalizePosture(posture);
  return (
    XDC_METRICS[`${canonical}|${w}|${p}`] ??
    XDC_METRICS[`${canonical}|${w}|normal`] ??
    XDC_METRICS[`${canonical}|normal|${p}`] ??
    XDC_METRICS[`${canonical}|normal|normal`]
  );
}

/**
 * Adobe's default line advance factor for a face.
 * evidence: adobepdf.xdc `<metrics lineHeight>` at size 1000pt.
 * Falls back to 1.2 (font_disasm.c:10517 `jfFontItem::getDefaultSpacing`) when
 * the family has no XDC face.
 */
export function lineAdvanceFactor(
  family?: string,
  weight?: string,
  posture?: string
): number {
  const metrics = lookupXdcMetrics(family, weight, posture);
  return metrics ? metrics.lineHeight / 1000 : 1.2;
}

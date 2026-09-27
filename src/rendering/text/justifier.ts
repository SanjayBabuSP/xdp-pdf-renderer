/**
 * Justifier — horizontal/vertical justification codes matching `jfTextAttr`
 * `JustH`/`JustV`, the justify word distribution and the comb cell math.
 *
 * Codes (jftext:93302-93330 and :99990-100070, markup `text-align`/
 * `vertical-align` → code):
 *   JustH 0 unset, 1 left, 2 center, 3 right, 4 justify, 5 justifyAll,
 *         6 radix-like, 7 comb-left, 8 comb-center, 9 comb-right.
 *   JustV 0 unset, 1 top, 2 middle, 3 bottom.
 *
 * String → code (jftext:96435-96443 + :96420-96428 + :96429-96431 SetEntry;
 * RTF spellings ql/qc/qr/qj map to the same codes — jftext:90311-90317,
 * :90512-90518):
 *   left/ql→1, center/qc→2, right/qr→3, justify/qj→4, justify-all→5,
 *   comb-left→7, comb-center→8, comb-right→9,
 *   top→1, middle→2, bottom→3.
 *
 * XFA enum → code (xfalayout:22113-22137, FormDesigner:804758-804770,
 * :804750-804757 for JustV):
 *   0x160000..0x160005 = left, center, right, justify, justifyAll, radix
 *   0x3e0000..0x3e0002 = top, middle, bottom
 *   (string semantics confirmed against the box-model anchor branches:
 *    AcroForm.ppi:737563 places 0x160000 at the origin, 0x160002 at the far
 *    edge and anything else at mid-width; :737651 does the same for
 *    0x3e0000/0x3e0002 on the vertical axis.)
 *
 * RTL (`this+0x34 & 0x2000`) is out of scope — LTR only.
 */

/** Horizontal justification code (`jfTextAttr::JustH`). */
export type JustHCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

/** Vertical justification code (`jfTextAttr::JustV`). */
export type JustVCode = 0 | 1 | 2 | 3;

export const JUST_H = {
  unset: 0,
  left: 1,
  center: 2,
  right: 3,
  justify: 4,
  justifyAll: 5,
  radix: 6,
  combLeft: 7,
  combCenter: 8,
  combRight: 9,
} as const;

export const JUST_V = {
  unset: 0,
  top: 1,
  middle: 2,
  bottom: 3,
} as const;

/** Map an XFA/markup alignment string to a JustH code (default 0 = unset). */
export function mapJustH(hAlign?: string): JustHCode {
  switch ((hAlign ?? '').trim().toLowerCase()) {
    case 'left':
    case 'start':
    case 'ql':
      return JUST_H.left;
    case 'center':
    case 'centre':
    case 'qc':
      return JUST_H.center;
    case 'right':
    case 'end':
    case 'qr':
      return JUST_H.right;
    case 'justify':
    case 'qj':
      return JUST_H.justify;
    case 'justifyall':
    case 'justify-all':
      return JUST_H.justifyAll;
    case 'radix':
      return JUST_H.radix;
    case 'comb-left':
      return JUST_H.combLeft;
    case 'comb-center':
      return JUST_H.combCenter;
    case 'comb-right':
      return JUST_H.combRight;
    default:
      return JUST_H.unset;
  }
}

/** Map an XFA/markup alignment string to a JustV code (default 0 = unset). */
export function mapJustV(vAlign?: string): JustVCode {
  switch ((vAlign ?? '').trim().toLowerCase()) {
    case 'top':
      return JUST_V.top;
    case 'middle':
    case 'center':
    case 'centre':
      return JUST_V.middle;
    case 'bottom':
      return JUST_V.bottom;
    default:
      return JUST_V.unset;
  }
}

/**
 * Origin of a line inside `availWidth` for the non-justify codes.
 *
 * jftext:73314 remaps code 6 → 3 before the offset switch, then
 * `case 2: slack × 0.5` falls through into `case 3: origin + slack`
 * (jftext:73353-73365). Codes 1/7/8/9 and the justify codes that fall back
 * to left stay at the origin (jftext:73402-73412, :73385-73400).
 */
export function horizontalOffsetX(
  code: JustHCode,
  availWidth: number,
  lineWidth: number
): number {
  const slack = availWidth - lineWidth;
  if (!(slack > 0)) return 0;
  switch (code) {
    case JUST_H.center:
      return slack / 2;
    case JUST_H.right:
    case JUST_H.radix:
      return slack;
    default:
      return 0;
  }
}

/** One drawable run of a justified line, positioned from the line origin. */
export interface JustifiedSegment {
  text: string;
  x: number;
}

export interface JustifyOptions {
  code: JustHCode;
  /**
   * Last line of the paragraph (hard `\n` break or end of text). Code 4
   * (justify) leaves it left-aligned; code 5 (justifyAll) still distributes
   * (jftext:73387-73400).
   */
  paragraphLast?: boolean;
}

/** Space-class glyphs (`charClass & 0x1f === 0x1a`, jftext:73441-73446). */
const SPACE_CLASS = /^\s+$/;

/**
 * Distribute `slack = availWidth − lineWidth` across the line's spaces and
 * return the word runs with their positions — or `null` when the caller
 * should draw the line whole at `horizontalOffsetX(...)`.
 *
 * jftext:73245 `Justify`: slack is `avail − lineWidth` (:73344-73349);
 * the per-gap extra is `slack / gapCount` (:73389, divisor is exactly the
 * space-class glyph count — uint→double idiom at :73390); `gapCount == 0`
 * falls back to left (:73385). The distribution loop (:73441-73470) shifts
 * every glyph by `spacesBefore × extra`, so word *k* sits at
 * `natural(k) + k × extra` and the last word ends exactly at `availWidth`.
 */
export function justifyLine(
  line: string,
  availWidth: number,
  lineWidth: number,
  measure: (s: string) => number,
  opts: JustifyOptions
): JustifiedSegment[] | null {
  const { code, paragraphLast = false } = opts;
  if (code !== JUST_H.justify && code !== JUST_H.justifyAll) return null;
  if (code === JUST_H.justify && paragraphLast) return null;

  const slack = availWidth - lineWidth;
  if (!(slack > 0)) return null;

  // Split into words and whitespace runs, keeping offsets into the line.
  const parts: { text: string; start: number; space: boolean }[] = [];
  const token = /(\s+)/g;
  let match: RegExpExecArray | null;
  let cursor = 0;
  while ((match = token.exec(line)) !== null) {
    if (match.index > cursor) {
      parts.push({ text: line.slice(cursor, match.index), start: cursor, space: false });
    }
    parts.push({ text: match[0], start: match.index, space: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < line.length) parts.push({ text: line.slice(cursor), start: cursor, space: false });

  let gapCount = 0;
  for (const part of parts) if (part.space) gapCount += part.text.length;
  if (gapCount === 0) return null;

  const extra = slack / gapCount;
  const segments: JustifiedSegment[] = [];
  let spacesBefore = 0;
  for (const part of parts) {
    if (part.space) {
      spacesBefore += part.text.length;
      continue;
    }
    segments.push({
      text: part.text,
      x: measure(line.slice(0, part.start)) + spacesBefore * extra,
    });
  }
  return segments.length > 0 ? segments : null;
}

export interface CombPlacement {
  /** Width of one cell inside the text area. */
  cell: number;
  /** Index of the first cluster's cell (left/center/right offset). */
  offset: number;
  /** Centre of cluster `i` measured from the line origin. */
  centre(i: number): number;
}

/**
 * Comb cells — each character cluster is centred in its own cell of an
 * `availWidth / cellCount` grid (jftext:73480-73636).
 *
 * `offset` is 0 for left (codes 1/7), `(cellCount − clusterCount) >> 1` for
 * center (2/8) and `cellCount − clusterCount` for right (3/9); the cluster
 * centre is `(offset + i) × cell + cell/2` (:73574-73577), and the trailing
 * edge is capped at the usable width (:73586-73593).
 *
 * Returns `null` without a positive cell count — the engine skips the whole
 * comb block when `*(frame + 0x88) == 0` (jftext:73501-73503).
 */
export function combPlacement(
  code: JustHCode,
  availWidth: number,
  cellCount: number,
  clusterCount: number
): CombPlacement | null {
  if (!(cellCount > 0) || !(availWidth > 0)) return null;

  const cell = availWidth / cellCount;
  const remaining = Math.max(cellCount - clusterCount, 0);
  let offset: number;
  switch (code) {
    case JUST_H.left:
    case JUST_H.combLeft:
      offset = 0;
      break;
    case JUST_H.center:
    case JUST_H.combCenter:
      offset = remaining >> 1;
      break;
    default:
      offset = remaining;
      break;
  }
  const half = cell * 0.5;
  return {
    cell,
    offset,
    centre: (i: number): number => Math.min((offset + i) * cell + half, availWidth),
  };
}

/**
 * Anchor alignment string for the rotated path (which draws the whole block
 * from one origin and has no per-line word distribution).
 */
export function alignClassOf(code: JustHCode): 'left' | 'center' | 'right' {
  if (code === JUST_H.center) return 'center';
  if (code === JUST_H.right || code === JUST_H.radix) return 'right';
  return 'left';
}

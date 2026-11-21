
export type JustHCode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

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

export interface JustifiedSegment {
  text: string;
  x: number;
}

export interface JustifyOptions {
  code: JustHCode;
  paragraphLast?: boolean;
}

const SPACE_CLASS = /^\s+$/;

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
  return segments.length ? segments : null;
}

export interface CombPlacement {
  cell: number;
  offset: number;
  centre(i: number): number;
}

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

export function alignClassOf(code: JustHCode): 'left' | 'center' | 'right' {
  if (code === JUST_H.center) return 'center';
  if (code === JUST_H.right || code === JUST_H.radix) return 'right';
  return 'left';
}

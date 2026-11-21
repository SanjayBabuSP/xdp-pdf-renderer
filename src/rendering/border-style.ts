
import { LineCapStyle, LineJoinStyle } from 'pdf-lib';

export const DEFAULT_EDGE_THICKNESS_PT = 0.5;

export function quantizeStrokeWidth(width: number): number {
  if (!Number.isFinite(width) || width <= 0) return width;
  return Math.round(width * 1000) / 1000;
}

export const DASH_PATTERNS: Readonly<Record<string, readonly number[]>> = {
  solid: [1, 0],
  dotted: [1, 2],
  dashed: [4, 2],
  dashDot: [3, 2, 1, 2],
  dashDotDot: [3, 2, 1, 2, 1, 2],
  embossed: [1, 0],
  etched: [1, 0],
  raised: [1, 0],
  lowered: [1, 0],
};

export function dashArrayForStyle(style: string | undefined, thickness: number): number[] | undefined {
  const ratios = DASH_PATTERNS[style ?? 'solid'] ?? DASH_PATTERNS.solid;
  if (ratios.length <= 1 || (ratios[0] === 1 && ratios[1] === 0)) return undefined;
  const t = Math.max(thickness, 0.5);
  return ratios.map((r) => r * t);
}

export function xfaCapToPdf(cap: string | undefined): LineCapStyle {
  switch (cap) {
    case 'round':
      return LineCapStyle.Round;
    case 'butt':
      return LineCapStyle.Projecting;
    default:
      return LineCapStyle.Butt;
  }
}

export function xfaJoinToPdf(join: string | undefined): LineJoinStyle {
  switch (join) {
    case 'round':
      return LineJoinStyle.Round;
    case 'bevel':
      return LineJoinStyle.Bevel;
    default:
      return LineJoinStyle.Miter;
  }
}

export function clampCornerRadius(radius: number, w: number, h: number): number {
  return Math.max(0, Math.min(radius, w / 2, h / 2));
}

export function cornerRadiiOf(border: { cornerRadius?: number; cornerRadii?: Array<number | undefined> }): Array<number | undefined> {
  if (border.cornerRadii && border.cornerRadii.some((v) => v != null && v > 0)) {
    return [0, 1, 2, 3].map((i) => border.cornerRadii![i]);
  }
  if (border.cornerRadius && border.cornerRadius > 0) {
    return [border.cornerRadius, border.cornerRadius, border.cornerRadius, border.cornerRadius];
  }
  return [undefined, undefined, undefined, undefined];
}

export function hasRoundedCorners(radii: Array<number | undefined>, w: number, h: number): boolean {
  return radii.some((r) => (r ?? 0) > 0 && clampCornerRadius(r ?? 0, w, h) > 0);
}

export function rotateEdgesForAngle<T>(edges: [T, T, T, T], rotate: number): [T, T, T, T] {
  const r = ((rotate % 360) + 360) % 360;
  const [top, right, bottom, left] = edges;
  if (r === 90) return [right, bottom, left, top];
  if (r === 270) return [left, top, right, bottom];
  return [top, right, bottom, left];
}

export function rotateCornersForAngle<T>(corners: [T, T, T, T], rotate: number): [T, T, T, T] {
  const r = ((rotate % 360) + 360) % 360;
  const [tl, tr, br, bl] = corners;
  if (r === 90) return [tr, br, bl, tl];
  if (r === 270) return [bl, tl, tr, br];
  return [tl, tr, br, bl];
}

export function isBottomUnderlineOnly(edges: Array<{ presence?: string; style?: string } | undefined> | undefined): boolean {
  if (!edges || edges.length === 0) return false;
  const norm: Array<{ presence?: string; style?: string } | undefined> =
    edges.length === 1 ? [undefined, undefined, edges[0], undefined] : [edges[0], edges[1], edges[2], edges[3]];
  const visible = (e: { presence?: string; style?: string } | undefined): boolean =>
    !!e && e.presence !== 'hidden' && e.presence !== 'invisible' && e.style !== 'none';
  return !visible(norm[0]) && !visible(norm[1]) && visible(norm[2]) && !visible(norm[3]);
}

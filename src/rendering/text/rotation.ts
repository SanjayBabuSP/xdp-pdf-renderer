/**
 * Rotation handling — `rotate` normalized mod 360 (xfalayout:19412); 90/270
 * swap the effective text box: wrapping runs along the box HEIGHT (reading
 * axis) and anchors are remapped (renderer:37609,37881).
 *
 * Coordinate system: PDF user space (y grows upward), box.y = bottom edge.
 *
 * rotate 90 (CCW): text reads bottom→top; glyph ascenders extend LEFT of the
 * baseline anchor; successive lines stack toward +x.
 * rotate 270 (CW): text reads top→bottom; ascenders extend RIGHT; successive
 * lines stack toward −x.
 */

export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  // ((x % 360) + 360) % 360 — also normalizes -0 to 0
  return ((deg % 360) + 360) % 360;
}

/** True for 90/270 — box swap + coordinate remap apply. */
export function isVerticalRotation(deg: number): boolean {
  const r = normalizeRotation(deg);
  return r === 90 || r === 270;
}

export interface RotatedAnchorOptions {
  /** Normalized rotation: 90 or 270. */
  rotate: number;
  /** Target box in PDF coordinates (y = bottom edge). */
  box: { x: number; y: number; w: number; h: number };
  /** Horizontal alignment — cross axis when rotated. */
  align: 'left' | 'center' | 'right';
  /** Vertical alignment — along the reading axis when rotated. */
  valign: 'top' | 'middle' | 'bottom';
  /** Reading-axis length of the text block (longest line). */
  lineLen: number;
  /** Glyph ascent (points). */
  ascent: number;
  /** Glyph descent (points). */
  descent: number;
  /** Line advance (points) — used for multi-line cross-axis stacking. */
  advance?: number;
  /** Number of lines — used for multi-line cross-axis stacking. */
  lineCount?: number;
}

/**
 * Baseline anchor for rotated text. Returns null for rotations the caller
 * should handle via the normal (unrotated) layout path.
 */
export function rotatedAnchor(o: RotatedAnchorOptions): { x: number; y: number } | null {
  const r = normalizeRotation(o.rotate);
  const n = Math.max(o.lineCount ?? 1, 1);
  const advance = o.advance ?? 0;
  const stack = (n - 1) * advance;

  if (r === 90) {
    // Reading bottom→top; block spans cross axis [anchorX − ascent,
    // anchorX + descent + stack].
    let anchorX: number;
    if (o.align === 'left') {
      anchorX = o.box.x + o.ascent;
    } else if (o.align === 'right') {
      anchorX = o.box.x + o.box.w - o.descent - stack;
    } else {
      anchorX =
        o.box.x + o.box.w / 2 - (o.descent - o.ascent) / 2 - stack / 2;
    }
    let anchorY: number;
    if (o.valign === 'bottom') {
      anchorY = o.box.y;
    } else if (o.valign === 'middle') {
      anchorY = o.box.y + (o.box.h - o.lineLen) / 2;
    } else {
      anchorY = o.box.y + o.box.h - o.lineLen;
    }
    return { x: anchorX, y: anchorY };
  }

  if (r === 270) {
    // Reading top→bottom; block spans [anchorX − descent − stack,
    // anchorX + ascent].
    let anchorX: number;
    if (o.align === 'left') {
      anchorX = o.box.x + o.descent + stack;
    } else if (o.align === 'right') {
      anchorX = o.box.x + o.box.w - o.ascent;
    } else {
      anchorX =
        o.box.x + o.box.w / 2 + (o.ascent - o.descent) / 2 + stack / 2;
    }
    let anchorY: number;
    if (o.valign === 'top') {
      anchorY = o.box.y + o.box.h;
    } else if (o.valign === 'middle') {
      anchorY = o.box.y + o.box.h - (o.box.h - o.lineLen) / 2;
    } else {
      anchorY = o.box.y + o.lineLen;
    }
    return { x: anchorX, y: anchorY };
  }

  return null;
}

export function normalizeRotation(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

export function isVerticalRotation(deg: number): boolean {
  const r = normalizeRotation(deg);
  return r === 90 || r === 270;
}

export interface RotatedAnchorOptions {
  rotate: number;
  box: { x: number; y: number; w: number; h: number };
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  lineLen: number;
  ascent: number;
  descent: number;
  advance?: number;
  lineCount?: number;
}

export function rotatedAnchor(o: RotatedAnchorOptions): { x: number; y: number } | null {
  const r = normalizeRotation(o.rotate);
  const n = Math.max(o.lineCount ?? 1, 1);
  const advance = o.advance ?? 0;
  const stack = (n - 1) * advance;

  if (r === 90) {
    let anchorX: number;
    if (o.align === 'left') {
      anchorX = o.box.x + o.ascent;
    } else if (o.align === 'right') {
      anchorX = o.box.x + o.box.w - o.descent - stack;
    } else {
      anchorX = o.box.x + o.box.w / 2 - (o.descent - o.ascent) / 2 - stack / 2;
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
    let anchorX: number;
    if (o.align === 'left') {
      anchorX = o.box.x + o.descent + stack;
    } else if (o.align === 'right') {
      anchorX = o.box.x + o.box.w - o.ascent;
    } else {
      anchorX = o.box.x + o.box.w / 2 + (o.ascent - o.descent) / 2 + stack / 2;
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

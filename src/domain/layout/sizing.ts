import { Position } from '../../types';

export function isHeightGrowable(pos?: Position): boolean {
  if (!pos) return true;
  if (pos.h != null && pos.h !== 0) return false;
  if (pos.minH != null && pos.maxH != null && pos.minH <= pos.maxH) return false;
  return true;
}

export function isWidthGrowable(pos?: Position): boolean {
  if (!pos) return true;
  if (pos.w != null && pos.w !== 0) return false;
  if (pos.minW != null && pos.maxW != null && pos.minW <= pos.maxW) return false;
  return true;
}

export function clamp(value: number, min?: number, max?: number): number {
  let out = value;
  if (min != null && out < min) out = min;
  if (max != null && out > max) out = max;
  return out;
}

export function resolveExtent(
  pos: Position | undefined,
  axis: 'height' | 'width',
  contentExtent: number
): number {
  const specified = axis === 'height' ? pos?.h : pos?.w;
  const min = axis === 'height' ? pos?.minH : pos?.minW;
  const max = axis === 'height' ? pos?.maxH : pos?.maxW;
  const base = specified != null && specified !== 0 ? specified : contentExtent;
  return clamp(base, min, max);
}

export function resolveSubformHeight(pos: Position | undefined, contentExtent: number): number {
  const hasFixedH = pos?.h != null && pos.h !== 0;
  if (hasFixedH || pos?.maxH != null) return resolveExtent(pos, 'height', contentExtent);
  return contentExtent;
}

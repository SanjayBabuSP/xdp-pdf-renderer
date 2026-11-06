import { Position } from '../../types';

// ─── XFA sizing rules ─────────────────────────────────────────────────────
// evidence: XFAContainerImpl::isHeightGrowable / isWidthGrowable,
// xfatemplate_disasm.c:8510-8700:
//   - explicit h (0x214) ⇒ not growable (fixed height)
//   - bounded range minH (0x242) && maxH (0x24b) && minH <= maxH ⇒ not growable
//   - otherwise growable
// Property ids: h=0x214, minH=0x242, maxH=0x24b, w=0x2d4, minW=0x244, maxW=0x24c.

/** Height may grow to fit content unless h is fixed or a bounded [minH,maxH] range exists. */
export function isHeightGrowable(pos?: Position): boolean {
  if (!pos) return true;
  if (pos.h != null && pos.h !== 0) return false;
  if (pos.minH != null && pos.maxH != null && pos.minH <= pos.maxH) return false;
  return true;
}

/** Width may shrink/grow to fit content unless w is fixed or a bounded [minW,maxW] range exists. */
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

/**
 * Resolve a node's final extent along one axis:
 *  - `h` specified ⇒ fixed (plan Phase 2 task 4), still floored by minH and
 *    capped by maxH;
 *  - otherwise content-driven, clamped into [minH, maxH].
 */
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

/**
 * Resolve a *subform container's* height.
 *
 * A lone `minH` does NOT reserve space on a growable subform — Adobe sizes
 * these to content. evidence: Example-1 Adobe output renders four
 * `minH="25.288mm"` lr-tb boxes at 11–34pt of content (not 71.7pt) and the
 * `minH="138.906mm"` table at ~140–200pt of rows (not 393.8pt); honoring the
 * floors adds ~390pt and pushes the form to 2 pages where Adobe fits 1.
 * Explicit `h` and bounded [minH,maxH] ranges keep their floors via
 * resolveExtent. Leaves (fields/draws) are untouched — no counter-evidence
 * there and their minH floors are covered by unit tests.
 */
export function resolveSubformHeight(
  pos: Position | undefined,
  contentExtent: number
): number {
  const hasFixedH = pos?.h != null && pos.h !== 0;
  if (hasFixedH || pos?.maxH != null) return resolveExtent(pos, 'height', contentExtent);
  return contentExtent;
}

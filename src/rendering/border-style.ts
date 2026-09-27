/**
 * Border style helpers — Phase 5.
 *
 * Dash ratios: `adobepdf.xdc:187-191` (lineStyle bitPattern, max 8 entries).
 * Cap/join:    `designrenderer:6182` enum `0x50000/1/2` → PDF `J` 0/1/2.
 * Corner clamp:`renderer:24402` — radius ≤ min(w,h)/2.
 * evidence:    pdfldriver:60525 strokeTypeMultiplier=1 (from adobepdf.xdc option name="strokeTypeMultiplier").
 */

import { LineCapStyle, LineJoinStyle } from 'pdf-lib';

// ─── Dash patterns ─────────────────────────────────────────────────────────────

/**
 * Dash patterns parsed from `adobepdf.xdc:187-191` (`<lineStyle
 * name="…" styleType="bitPattern">…</lineStyle>`), max 8 integer entries
 * per pattern, scaled by `strokeTypeMultiplier = 1` × edge thickness
 * (pdfldriver:60525). A single-entry [1, 0] pattern == solid (no dashes).
 */
export const DASH_PATTERNS: Readonly<Record<string, readonly number[]>> = {
  // adobepdf.xdc:187 – solid 1 0
  solid: [1, 0],
  // adobepdf.xdc:188 – dotted 1 2
  dotted: [1, 2],
  // adobepdf.xdc:189 – dashed 4 2
  dashed: [4, 2],
  // adobepdf.xdc:190 – dashDot 3 2 1 2
  dashDot: [3, 2, 1, 2],
  // adobepdf.xdc:191 – dashDotDot 3 2 1 2 1 2
  dashDotDot: [3, 2, 1, 2, 1, 2],
  // Emboss/etch/raise/lower render as solid lines (no dash).
  embossed: [1, 0],
  etched: [1, 0],
  raised: [1, 0],
  lowered: [1, 0],
};

/**
 * Return the PDF dash array `[on, off, …]` scaled by thickness, or `undefined`
 * for solid strokes (no `d` operator needed).
 * evidenced: pdfldriver:60525 (`strokeTypeMultiplier = 1`).
 */
export function dashArrayForStyle(style: string | undefined, thickness: number): number[] | undefined {
  const ratios = DASH_PATTERNS[style ?? 'solid'] ?? DASH_PATTERNS.solid;
  // A single-entry solid pattern or [1,0] means no dash.
  if (ratios.length <= 1 || (ratios[0] === 1 && ratios[1] === 0)) return undefined;
  // Clamp thickness so dash segments are at least 0.5pt when very thin.
  const t = Math.max(thickness, 0.5);
  return ratios.map((r) => r * t);
}

// ─── Cap / join enum ───────────────────────────────────────────────────────────

/**
 * XFA cap enum (designrenderer:6182, `edgeInfo->capStyle`):
 *   0x50000 = square (butt)  → PDF `J 0`
 *   0x50001 = round          → PDF `J 1`
 *   0x50002 = butt (project) → PDF `J 2`
 *
 * The XFA schema calls the attribute `cap="square"|"round"|"butt"`.
 * evidence: designer XSD attribute name matches exactly the renderer enum strings.
 */
export function xfaCapToPdf(cap: string | undefined): LineCapStyle {
  switch (cap) {
    case 'round':
      return LineCapStyle.Round;        // 0x50001 → J 1
    case 'butt':
      return LineCapStyle.Projecting;   // 0x50002 → J 2
    default:
      return LineCapStyle.Butt;         // 0x50000 → J 0 (square, default)
  }
}

/**
 * XFA join enum (designrenderer:6182, `edgeInfo->joinStyle`):
 *   0x60000 = miter  → PDF `j 0`
 *   0x60001 = round  → PDF `j 1`
 *   0x60002 = bevel  → PDF `j 2`
 *
 * XFA attribute: `join="miter"|"round"|"bevel"`.
 */
export function xfaJoinToPdf(join: string | undefined): LineJoinStyle {
  switch (join) {
    case 'round':
      return LineJoinStyle.Round;   // j 1
    case 'bevel':
      return LineJoinStyle.Bevel;   // j 2
    default:
      return LineJoinStyle.Miter;   // j 0 (default)
  }
}

// ─── Corner-radius clamp ───────────────────────────────────────────────────────

/**
 * Clamp corner radius to `min(w, h) / 2` so the arc never exceeds the box.
 * evidence: renderer:24402 — corner radius clamp mode; value is halved when
 * it exceeds the shortest side.
 */
export function clampCornerRadius(radius: number, w: number, h: number): number {
  return Math.max(0, Math.min(radius, w / 2, h / 2));
}

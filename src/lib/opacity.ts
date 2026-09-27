/** XFA opacity → 0..1 (accepts "0.5", "50%", "50"). */
export function parseOpacityValue(raw: string | undefined): number | undefined {
  if (raw == null || raw.trim() === '') return undefined;
  const text = raw.trim();
  const percent = text.endsWith('%');
  const value = Number.parseFloat(text);
  if (Number.isNaN(value)) return undefined;
  const scaled = percent ? value / 100 : value > 1 ? value / 100 : value;
  return clampAlpha(scaled);
}

export function clampAlpha(value: number): number {
  return Math.min(1, Math.max(0, value));
}

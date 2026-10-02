import { ChoiceListItem } from '../types';

/**
 * Resolve a choice-list field's bound value to the text a user sees.
 *
 * A `<choiceList>` binds an *export* value (`<items><text value="M">March</text>`)
 * while displaying the item's text. Before this the renderer printed the raw
 * bound value (`M`), because `renderField` never looked at `ui.items` (G7).
 *
 * Multi-select list boxes carry several selected values. They may arrive as an
 * array (via a nested data node) or as a single whitespace/comma-joined string —
 * both are translated when every token maps to a known item.
 */
export function resolveChoiceText(
  value: unknown,
  items?: ChoiceListItem[],
): string {
  if (value == null) return '';

  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  if (!items || items.length === 0) return values.join(', ');

  const byKey = new Map<string, string>();
  for (const item of items) {
    if (item.value !== undefined) byKey.set(String(item.value), item.text);
    // A value that already equals the display text is left untouched.
    if (!byKey.has(item.text)) byKey.set(item.text, item.text);
  }

  const lookup = (raw: string): string => byKey.get(raw) ?? raw;

  const translated = values.map(lookup);
  // Single joined multi-select string where no whole-string match exists.
  if (values.length === 1 && translated[0] === values[0]) {
    const tokens = values[0].split(/[\s,]+/).filter(Boolean);
    if (tokens.length > 1) {
      const mapped = tokens.map(lookup);
      if (mapped.some((mappedText, i) => mappedText !== tokens[i])) {
        return mapped.join(', ');
      }
    }
  }
  return translated.join(', ');
}

/**
 * The visible text of a `<button>` field: the `<ui><button><label>` when
 * present (Designer's canonical slot), otherwise the mapped value text, then
 * the caption.
 */
export function resolveButtonLabel(
  label: string | undefined,
  valueText: string,
  captionText: string | undefined,
): string {
  return label ?? (valueText || captionText || '');
}

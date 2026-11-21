import { ChoiceListItem } from '../types';

export function resolveChoiceText(value: unknown, items?: ChoiceListItem[]): string {
  if (value == null) return '';

  const values = Array.isArray(value) ? value.map(String) : [String(value)];
  if (!items || items.length === 0) return values.join(', ');

  const byKey = new Map<string, string>();
  for (const item of items) {
    if (item.value !== undefined) byKey.set(String(item.value), item.text);
    if (!byKey.has(item.text)) byKey.set(item.text, item.text);
  }

  const lookup = (raw: string): string => byKey.get(raw) ?? raw;

  const translated = values.map(lookup);
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

export function resolveButtonLabel(
  label: string | undefined,
  valueText: string,
  captionText: string | undefined
): string {
  return label ?? (valueText || captionText || '');
}

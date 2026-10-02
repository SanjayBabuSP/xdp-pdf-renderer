import { resolveChoiceText, resolveButtonLabel } from '../../../src/rendering/ui-values';
import { ChoiceListItem } from '../../../src/types';

const MONTHS: ChoiceListItem[] = [
  { text: 'March', value: 'M' },
  { text: 'April', value: 'A' },
  { text: 'New York', value: 'NY' },
];

describe('G7 — resolveChoiceText', () => {
  it('maps an export value to its display text', () => {
    expect(resolveChoiceText('M', MONTHS)).toBe('March');
  });

  it('leaves a value that is already the display text alone', () => {
    expect(resolveChoiceText('March', MONTHS)).toBe('March');
  });

  it('passes unknown values through untouched', () => {
    expect(resolveChoiceText('Z', MONTHS)).toBe('Z');
  });

  it('translates an array of multi-select values', () => {
    expect(resolveChoiceText(['M', 'A'], MONTHS)).toBe('March, April');
  });

  it('translates a whitespace-joined multi-select string', () => {
    expect(resolveChoiceText('M A', MONTHS)).toBe('March, April');
  });

  it('does not split a single value that legitimately contains a space', () => {
    expect(resolveChoiceText('New York', MONTHS)).toBe('New York');
  });

  it('returns an empty string for null/undefined', () => {
    expect(resolveChoiceText(null, MONTHS)).toBe('');
    expect(resolveChoiceText(undefined, MONTHS)).toBe('');
  });

  it('falls back to the raw value when there are no items', () => {
    expect(resolveChoiceText('M', [])).toBe('M');
    expect(resolveChoiceText('M', undefined)).toBe('M');
  });

  it('translates an array value even without items', () => {
    expect(resolveChoiceText(['a', 'b'], undefined)).toBe('a, b');
  });
});

describe('G7 — resolveButtonLabel', () => {
  it('prefers the <ui><button><label>', () => {
    expect(resolveButtonLabel('Submit', 'value', 'caption')).toBe('Submit');
  });

  it('falls back to the mapped value text', () => {
    expect(resolveButtonLabel(undefined, 'value', 'caption')).toBe('value');
  });

  it('falls back to the caption, then empty', () => {
    expect(resolveButtonLabel(undefined, '', 'caption')).toBe('caption');
    expect(resolveButtonLabel(undefined, '', undefined)).toBe('');
  });
});

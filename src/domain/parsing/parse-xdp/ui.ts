import type { ChoiceListItem, UiSpec } from '../../../types';
import { getChild, toArray, attr, textContent } from '../../../lib/xml-utils';

export function parseUi(ui: unknown): UiSpec | undefined {
  if (!ui) return undefined;
  const has = (name: string): boolean => getChild(ui, name) !== undefined;
  if (has('textEdit')) {
    const te = getChild(ui, 'textEdit');
    return {
      type: 'textEdit',
      multiLine: attr(te, 'multiLine') === '1',
      allowRichText: attr(te, 'allowRichText') === '1',
      hAlign: attr(te, 'hAlign'),
      vAlign: attr(te, 'vAlign'),
    };
  }
  if (has('numericEdit')) {
    const ne = getChild(ui, 'numericEdit');
    return {
      type: 'numericEdit',
      hAlign: attr(ne, 'hAlign'),
      vAlign: attr(ne, 'vAlign'),
    };
  }
  if (has('dateTimeEdit')) {
    const dte = getChild(ui, 'dateTimeEdit');
    return {
      type: 'dateTimeEdit',
      hAlign: attr(dte, 'hAlign'),
      vAlign: attr(dte, 'vAlign'),
    };
  }
  if (has('imageEdit')) return { type: 'imageEdit' };
  if (has('checkButton')) {
    const cb = getChild(ui, 'checkButton');
    return {
      type: 'checkButton',
      checkedValue: textContent(getChild(cb, 'checkedValue')) ?? '1',
      uncheckedValue: textContent(getChild(cb, 'uncheckedValue')) ?? '0',
      mark: attr(cb, 'mark'),
    };
  }
  if (has('choiceList')) {
    const cl = getChild(ui, 'choiceList');
    const items = parseChoiceListItems(cl);
    return {
      type: 'choiceList',
      items,
      open: attr(cl, 'open'),
      textEnclosure: attr(cl, 'textEnclosure'),
    };
  }
  if (has('barcode')) {
    const bc = getChild(ui, 'barcode');
    return {
      type: 'barcode',
      encodeHint: attr(bc, 'encodeHint'),
      charEncoding: attr(bc, 'charEncoding'),
      symbology: attr(bc, 'symbology') ?? attr(bc, 'type'),
      moduleWidth: attr(bc, 'moduleWidth'),
      moduleHeight: attr(bc, 'moduleHeight'),
      checksum: attr(bc, 'checksum'),
      checkDigit: attr(bc, 'printCheckDigit'),
      wideNarrowRatio: attr(bc, 'wideNarrowRatio'),
      textLocation: attr(bc, 'textLocation'),
      errorCorrectionLevel: attr(bc, 'errorCorrectionLevel'),
      dataLength: attr(bc, 'dataLength'),
    };
  }
  if (has('button')) {
    const btn = getChild(ui, 'button');
    return {
      type: 'button',
      label: textContent(getChild(btn, 'label')) ?? attr(btn, 'label'),
      highlight: attr(btn, 'highlight'),
    };
  }
  if (has('signature')) return { type: 'signature' };
  return { type: 'unknown' };
}

const CHOICE_ITEM_SCALARS = new Set([
  'text',
  'integer',
  'float',
  'decimal',
  'boolean',
  'dateTime',
  'date',
  'time',
  'null',
  'base64Binary',
]);

function parseChoiceListItems(cl: unknown): ChoiceListItem[] {
  const result: ChoiceListItem[] = [];
  for (const itemsEl of toArray<unknown>(getChild(cl, 'items'))) {
    if (!itemsEl || typeof itemsEl !== 'object') continue;
    for (const key of Object.keys(itemsEl as Record<string, unknown>)) {
      if (key.startsWith('@_') || key.startsWith('?') || key === '__cdata') continue;
      if (!CHOICE_ITEM_SCALARS.has(key)) continue;
      for (const entry of toArray<unknown>((itemsEl as Record<string, unknown>)[key])) {
        const explicit = attr(entry, 'value');
        const content = textContent(entry) ?? '';
        const value = explicit ?? content;
        if (key === 'text') {
          if (content === '' && explicit === undefined) continue;
          result.push({ text: content || String(explicit ?? ''), value: String(value) });
        } else if (value !== '') {
          result.push({ text: content || String(value), value: String(value) });
        }
      }
    }
  }
  return result;
}

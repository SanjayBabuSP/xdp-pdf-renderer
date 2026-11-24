import type { BorderSpec, BindSpec, FieldNode, PresenceValue } from '../../../types';
import { getChild, attr, textContent } from '../../../lib/xml-utils';
import type { OrderedItem } from './ordered';
import { orderedCaptionHtml } from './ordered';
import {
  parseBind,
  parseFont,
  parsePosition,
  parseEvents,
  parseMargin,
  parseBorder,
  isEffectivelyHiddenBorder,
  parseAssist,
  parseExtras,
  parseTraversal,
  parseBreaks,
  parseCaption,
  parsePara,
} from './helpers';
import { parseUi } from './ui';
import { parseDrawValue } from './draw';

export function parseField(field: unknown, order?: OrderedItem): FieldNode {
  const bind = parseBind(getChild(field, 'bind'));
  const ui = getChild(field, 'ui');
  const uiElement = ui ? findUiElement(ui) : undefined;

  const valueEl = getChild(field, 'value');
  const defaultValue = parseDefaultValue(valueEl);
  const parsedValue = parseDrawValue(valueEl);
  if (parsedValue?.type === 'richText' && order?.richText) {
    parsedValue.content = order.richText;
  }
  const imageValue = parsedValue?.type === 'image' ? parsedValue : undefined;

  const relevant = attr(field, 'relevant');

  return {
    type: 'field',
    name: attr(field, 'name'),
    uid: attr(field, 'id') ?? undefined,
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    formatPicture: parseFormatPicture(field, bind),
    locale: attr(field, 'locale'),
    ui: parseUi(ui),
    font: parseFont(getChild(field, 'font')),
    caption: parseCaption(getChild(field, 'caption'), orderedCaptionHtml(order)),
    para: parsePara(getChild(field, 'para')),
    access: attr(field, 'access'),
    position: parsePosition(field),
    events: parseEvents(getChild(field, 'event')),
    calculate: parseCalculate(getChild(field, 'calculate')),
    validate: parseValidate(getChild(field, 'validate')),
    presence: (attr(field, 'presence') as PresenceValue) ?? 'visible',
    margin: parseMargin(getChild(field, 'margin')),
    colSpan: attr(field, 'colSpan') ? parseInt(attr(field, 'colSpan')!) : undefined,
    border: fieldBorderWithUiFallback(
      getChild(field, 'border'),
      uiElement ? getChild(uiElement, 'border') : undefined
    ),
    relevant: relevant ?? undefined,
    defaultValue,
    imageValue,
    assist: parseAssist(field),
    extras: parseExtras(field),
    traversal: parseTraversal(field),
    ...parseBreaks(field),
  };
}

function findUiElement(ui: unknown): unknown {
  return (
    getChild(ui, 'textEdit') ??
    getChild(ui, 'numericEdit') ??
    getChild(ui, 'dateTimeEdit') ??
    getChild(ui, 'imageEdit') ??
    getChild(ui, 'checkButton') ??
    getChild(ui, 'choiceList') ??
    getChild(ui, 'barcode') ??
    getChild(ui, 'button') ??
    getChild(ui, 'signature') ??
    undefined
  );
}

function fieldBorderWithUiFallback(outerEl: unknown, uiBorderEl: unknown): BorderSpec | undefined {
  const outer = parseBorder(outerEl);
  if (outer && !isEffectivelyHiddenBorder(outer)) return outer;
  const inner = parseBorder(uiBorderEl);
  if (inner && outer?.fill && !inner.fill) inner.fill = outer.fill;
  return inner ?? outer;
}

function parseFormatPicture(field: unknown, bind: BindSpec | undefined): string | undefined {
  const formatPicture = textContent(getChild(getChild(field, 'format'), 'picture'));
  const valuePicture = textContent(getChild(getChild(field, 'value'), 'picture'));
  return formatPicture || valuePicture || bind?.picture || undefined;
}

function parseCalculate(calculate: unknown):
  | {
      override?: string;
      script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string };
    }
  | undefined {
  if (!calculate) return undefined;
  const override = attr(calculate, 'override');
  const scriptEl = getChild(calculate, 'script');
  const scriptContent = textContent(scriptEl);
  const contentType = attr(scriptEl, 'contentType');
  const runAt = attr(scriptEl, 'runAt');
  const script = scriptContent
    ? {
        content: scriptContent,
        contentType: (contentType?.toLowerCase().includes('javascript')
          ? 'javascript'
          : 'formcalc') as 'formcalc' | 'javascript',
        runAt: runAt ?? undefined,
      }
    : undefined;
  return { override: override ?? undefined, script };
}

function parseValidate(
  validate: unknown
):
  | { script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string } }
  | undefined {
  if (!validate) return undefined;
  const scriptEl = getChild(validate, 'script');
  const scriptContent = textContent(scriptEl);
  const contentType = attr(scriptEl, 'contentType');
  const runAt = attr(scriptEl, 'runAt');
  const script = scriptContent
    ? {
        content: scriptContent,
        contentType: (contentType?.toLowerCase().includes('javascript')
          ? 'javascript'
          : 'formcalc') as 'formcalc' | 'javascript',
        runAt: runAt ?? undefined,
      }
    : undefined;
  return { script };
}

function parseDefaultValue(valueEl: unknown): unknown {
  if (!valueEl) return undefined;
  const textEl = getChild(valueEl, 'text');
  if (textEl) return textContent(textEl);
  const booleanEl = getChild(valueEl, 'boolean');
  if (booleanEl) return attr(booleanEl, 'value') === '1' || attr(booleanEl, 'value') === 'true';
  const integerEl = getChild(valueEl, 'integer');
  if (integerEl) return parseInt(attr(integerEl, 'value') ?? '0', 10);
  const floatEl = getChild(valueEl, 'float');
  if (floatEl) return parseFloat(attr(floatEl, 'value') ?? '0');
  const dateEl = getChild(valueEl, 'date');
  if (dateEl) return attr(dateEl, 'value');
  const timeEl = getChild(valueEl, 'time');
  if (timeEl) return attr(timeEl, 'value');
  const dateTimeEl = getChild(valueEl, 'dateTime');
  if (dateTimeEl) return attr(dateTimeEl, 'value');
  const decimalEl = getChild(valueEl, 'decimal');
  if (decimalEl) return parseFloat(attr(decimalEl, 'value') ?? '0');
  return undefined;
}

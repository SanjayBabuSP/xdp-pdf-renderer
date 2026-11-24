import type { DrawNode, PresenceValue } from '../../../types';
import {
  getChild,
  firstChild,
  attr,
  textContent,
  serializeHtmlFragment,
} from '../../../lib/xml-utils';
import type { OrderedItem } from './ordered';
import {
  parseFont,
  parsePara,
  parsePosition,
  parseBorder,
  parseEvents,
  parseMargin,
  parseAssist,
  parseExtras,
  parseBreaks,
} from './helpers';
import { parseUi } from './ui';

export function parseDraw(draw: unknown, order?: OrderedItem): DrawNode {
  const value = parseDrawValue(firstChild(draw, 'value'));
  if (value?.type === 'richText' && order?.richText) {
    value.content = order.richText;
  }
  return {
    type: 'draw',
    name: attr(draw, 'name'),
    uid: attr(draw, 'id') ?? undefined,
    value,
    font: parseFont(firstChild(draw, 'font')),
    para: parsePara(firstChild(draw, 'para')),
    position: parsePosition(draw),
    presence: (attr(draw, 'presence') as PresenceValue) ?? 'visible',
    ui: parseUi(firstChild(draw, 'ui')),
    margin: parseMargin(firstChild(draw, 'margin')),
    border: parseBorder(firstChild(draw, 'border')),
    colSpan: attr(draw, 'colSpan') ? parseInt(attr(draw, 'colSpan')!) : undefined,
    events: parseEvents(getChild(draw, 'event')),
    relevant: attr(draw, 'relevant') ?? undefined,
    assist: parseAssist(draw),
    extras: parseExtras(draw),
    ...parseBreaks(draw),
  };
}

export function parseDrawValue(value: unknown): DrawNode['value'] {
  if (!value) return undefined;
  const image = getChild(value, 'image');
  if (image) {
    const aspectRaw = attr(image, 'aspect');
    const xdpiRaw = attr(image, 'xdpi') ?? attr(image, 'xres');
    const ydpiRaw = attr(image, 'ydpi') ?? attr(image, 'yres');
    const hAlignRaw = attr(image, 'hAlign') as DrawNode['value'] extends { hAlign?: infer T }
      ? T
      : never;
    const vAlignRaw = attr(image, 'vAlign') as DrawNode['value'] extends { vAlign?: infer T }
      ? T
      : never;
    return {
      type: 'image',
      contentType: attr(image, 'contentType') ?? 'image/png',
      content: textContent(image),
      aspectMode: aspectRaw ?? undefined,
      xdpi: xdpiRaw ? parseFloat(xdpiRaw) : undefined,
      ydpi: ydpiRaw ? parseFloat(ydpiRaw) : undefined,
      hAlign: hAlignRaw ?? undefined,
      vAlign: vAlignRaw ?? undefined,
    };
  }

  const exData = getChild(value, 'exData');
  if (exData) {
    const hasNestedMarkup =
      typeof exData === 'object' &&
      exData !== null &&
      Object.keys(exData).some((k) => !k.startsWith('@_') && k !== '#text');
    return {
      type: 'richText',
      contentType: attr(exData, 'contentType') ?? 'text/html',
      content: hasNestedMarkup ? serializeHtmlFragment(exData) : (textContent(exData) ?? ''),
    };
  }
  const rectangle = getChild(value, 'rectangle');
  if (rectangle !== undefined) {
    return { type: 'rectangle', shapeBorder: parseBorder(rectangle) };
  }
  const line = getChild(value, 'line');
  if (line !== undefined) {
    return { type: 'line', shapeBorder: parseBorder(line) };
  }
  const arc = getChild(value, 'arc');
  if (arc !== undefined) {
    return {
      type: 'arc',
      shapeBorder: parseBorder(arc),
      sweepAngle: attr(arc, 'sweepAngle') ? parseFloat(attr(arc, 'sweepAngle')!) : 360,
      startAngle: attr(arc, 'startAngle') ? parseFloat(attr(arc, 'startAngle')!) : 0,
    };
  }
  const circle = getChild(value, 'circle');
  if (circle !== undefined) {
    return { type: 'circle', shapeBorder: parseBorder(circle) };
  }
  const text = getChild(value, 'text');
  if (text != null) {
    return { type: 'text', content: textContent(text) ?? String(text) };
  }
  return undefined;
}

import { XMLParser } from 'fast-xml-parser';
import { stripProcessingInstructions } from '../../../lib/xml-utils';

export interface OrderedItem {
  tag: string;
  kids: OrderedItem[];
  index: number;
  richText?: string;
}

export const ORDERED_NODE_TAGS = new Set([
  'subform',
  'subformSet',
  'area',
  'field',
  'draw',
  'exclGroup',
]);

function orderedChild(nodes: unknown[] | undefined, name: string): unknown[] | undefined {
  if (!nodes) return undefined;
  for (const entry of nodes) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    for (const [key, val] of Object.entries(entry as Record<string, unknown>)) {
      if (key === name && Array.isArray(val)) return val;
    }
  }
  return undefined;
}

function orderedExDataHtml(children: unknown[]): string | undefined {
  const valueKids = orderedChild(children, 'value');
  const exDataKids = orderedChild(valueKids, 'exData');
  if (!exDataKids) return undefined;
  return serializeOrderedHtml(exDataKids).trim();
}

export function orderedCaptionHtml(order: OrderedItem | undefined): string | undefined {
  if (!order) return undefined;
  const captionKids = orderedChild(order.kids, 'caption');
  if (!captionKids) return undefined;
  const valueKids = orderedChild(captionKids, 'value');
  const exDataKids = orderedChild(valueKids, 'exData');
  if (!exDataKids) return undefined;
  return serializeOrderedHtml(exDataKids).trim() || undefined;
}

function serializeOrderedHtml(nodes: unknown[]): string {
  let out = '';
  for (const entry of nodes) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const rec = entry as Record<string, unknown>;
    if (typeof rec['#text'] === 'string') {
      out += rec['#text'];
      continue;
    }
    if (typeof rec['__cdata'] === 'string') {
      out += rec['__cdata'];
      continue;
    }
    const attrs = rec[':@'] as Record<string, unknown> | undefined;
    for (const [key, val] of Object.entries(rec)) {
      if (key === ':@' || key.startsWith('?') || key === '__comment' || !Array.isArray(val)) {
        continue;
      }
      out += `<${key}`;
      if (attrs) {
        for (const [attrName, attrVal] of Object.entries(attrs)) {
          if (!attrName.startsWith('@_')) continue;
          out += ` ${attrName.slice(2)}="${String(attrVal)}"`;
        }
      }
      if (val.length === 0) {
        out += '/>';
      } else {
        out += `>${serializeOrderedHtml(val)}</${key}>`;
      }
      break;
    }
  }
  return out;
}

export function orderedTemplateKids(xdpXml: string): OrderedItem[] | undefined {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
      parseTagValue: false,
      trimValues: false,
      processEntities: false,
      cdataPropName: '__cdata',
      commentPropName: '__comment',
      preserveOrder: true,
    });
    const doc = parser.parse(stripProcessingInstructions(xdpXml)) as unknown[];
    if (!Array.isArray(doc)) return undefined;
    const rootItems = toOrderedItems(doc);
    const rootKids = kidsOfItems(rootItems, ['xdp:xdp', 'xdp']);
    if (!rootKids) return undefined;
    return kidsOfItems(rootKids, ['template']);
  } catch {
    return undefined;
  }
}

export function firstOrderedSubformKids(
  templateKids: OrderedItem[] | undefined
): OrderedItem[] | undefined {
  if (!templateKids) return undefined;
  const first = templateKids.find((i) => i.tag === 'subform');
  return first?.kids;
}

function kidsOfItems(items: OrderedItem[], names: string[]): OrderedItem[] | undefined {
  for (const item of items) {
    if (names.some((n) => item.tag === n || item.tag.endsWith(`:${n}`))) return item.kids;
  }
  return undefined;
}

function toOrderedItems(node: unknown): OrderedItem[] {
  if (!Array.isArray(node)) return [];
  const counters = new Map<string, number>();
  const out: OrderedItem[] = [];
  for (const entry of node) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (
        key === ':@' ||
        key.startsWith('?') ||
        key === '#text' ||
        key === '__cdata' ||
        key === '__comment'
      )
        continue;
      if (!Array.isArray(value)) continue;
      const tag = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
      const index = counters.get(tag) ?? 0;
      counters.set(tag, index + 1);
      out.push({
        tag,
        kids: toOrderedItems(value),
        index,
        richText: orderedExDataHtml(value),
      });
      break;
    }
  }
  return out;
}

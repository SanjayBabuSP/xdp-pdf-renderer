import type { ExclGroupNode, LayoutNode, PresenceValue, SubformNode } from '../../../types';
import { getChild, toArray, attr } from '../../../lib/xml-utils';
import { toPointsOrZero } from '../../../lib/unit-converter';
import { ORDERED_NODE_TAGS } from './ordered';
import type { OrderedItem } from './ordered';
import {
  parseBind,
  parseOccur,
  parseMargin,
  parseBorder,
  parsePosition,
  parseEvents,
  parseAssist,
  parseExtras,
  parseTraversal,
  parseBreaks,
} from './helpers';
import { parseField } from './field';
import { parseDraw } from './draw';

export function parseChildren(parent: unknown, orderedKids?: OrderedItem[]): LayoutNode[] {
  const raw: Record<string, unknown[]> = {
    subform: toArray<unknown>(getChild(parent, 'subform')),
    subformSet: toArray<unknown>(getChild(parent, 'subformSet')),
    area: toArray<unknown>(getChild(parent, 'area')),
    field: toArray<unknown>(getChild(parent, 'field')),
    draw: toArray<unknown>(getChild(parent, 'draw')),
    exclGroup: toArray<unknown>(getChild(parent, 'exclGroup')),
  };
  const orderedByTag = new Map<string, OrderedItem[]>();
  if (orderedKids) {
    for (const item of orderedKids) {
      if (!ORDERED_NODE_TAGS.has(item.tag)) continue;
      const list = orderedByTag.get(item.tag) ?? [];
      list.push(item);
      orderedByTag.set(item.tag, list);
    }
  }

  const parseOne = (tag: string, rawNode: unknown, order?: OrderedItem): LayoutNode | undefined => {
    switch (tag) {
      case 'subform':
        return parseSubform(rawNode, order?.kids);
      case 'subformSet': {
        const active = parseSubformSet(rawNode, order?.kids);
        return active;
      }
      case 'area':
        return parseArea(rawNode, order?.kids);
      case 'field':
        return parseField(rawNode, order);
      case 'draw':
        return parseDraw(rawNode, order);
      case 'exclGroup':
        return parseExclGroup(rawNode, order?.kids);
      default:
        return undefined;
    }
  };

  const nodes: LayoutNode[] = [];
  if (orderedKids && orderedKids.length) {
    const used = new Map<string, number>();
    for (const item of orderedKids) {
      if (!ORDERED_NODE_TAGS.has(item.tag)) continue;
      const slot = used.get(item.tag) ?? 0;
      used.set(item.tag, slot + 1);
      const rawNode = raw[item.tag][item.index] ?? raw[item.tag][slot];
      if (rawNode === undefined) continue;
      const parsed = parseOne(item.tag, rawNode, item);
      if (parsed) nodes.push(parsed);
    }
    const consumed = new Set<string>();
    for (const item of orderedKids) {
      if (!ORDERED_NODE_TAGS.has(item.tag)) continue;
      consumed.add(`${item.tag}:${item.index}`);
    }
    (Object.keys(raw) as Array<keyof typeof raw>).forEach((tag) => {
      raw[tag].forEach((rawNode, i) => {
        if (consumed.has(`${tag}:${i}`)) return;
        const parsed = parseOne(tag, rawNode, undefined);
        if (parsed) nodes.push(parsed);
      });
    });
    return nodes;
  }

  raw.subform.forEach((s) => nodes.push(parseSubform(s)));
  raw.subformSet.forEach((set) => {
    const active = parseSubformSet(set);
    if (active) nodes.push(active);
  });
  raw.area.forEach((a) => nodes.push(parseArea(a)));
  raw.field.forEach((f) => nodes.push(parseField(f)));
  raw.draw.forEach((d) => nodes.push(parseDraw(d)));
  raw.exclGroup.forEach((eg) => nodes.push(parseExclGroup(eg)));

  return nodes;
}

export function parseSubformSet(
  set: unknown,
  orderedKids?: OrderedItem[]
): SubformNode | undefined {
  const subs = toArray<unknown>(getChild(set, 'subform'));
  if (subs.length === 0) return undefined;
  const relation = (attr(set, 'relation') as SubformNode['setRelation']) ?? 'ordered';
  const orderedSubs = (orderedKids ?? []).filter((i) => i.tag === 'subform');
  const pick = (i: number): SubformNode => parseSubform(subs[i], orderedSubs[i]?.kids);

  const children: SubformNode[] = [];
  if (relation === 'choice') {
    const parsed = Number.parseInt(attr(set, 'initial') ?? '0', 10);
    const idx = Number.isFinite(parsed) && parsed >= 0 && parsed < subs.length ? parsed : 0;
    children.push(pick(idx));
  } else {
    for (let i = 0; i < subs.length; i++) children.push(pick(i));
  }

  const setName = attr(set, 'name');
  if (!setName && children.length === 1) return children[0];
  return {
    type: 'subform',
    name: setName,
    uid: attr(set, 'id') ?? undefined,
    layout: relation === 'ordered' ? 'tb' : 'position',
    isSubformSet: true,
    setRelation: relation,
    occur: parseOccur(getChild(set, 'occur')),
    children,
    presence: (attr(set, 'presence') as PresenceValue) ?? 'visible',
    position: parsePosition(set),
    assist: parseAssist(set),
    extras: parseExtras(set),
    ...parseBreaks(set),
  };
}

export function parseArea(area: unknown, orderedKids?: OrderedItem[]): SubformNode {
  return parseSubform(area, orderedKids);
}

export function parseSubform(subform: unknown, orderedKids?: OrderedItem[]): SubformNode {
  const bind = parseBind(getChild(subform, 'bind'));
  const occur = parseOccur(getChild(subform, 'occur'));
  const colWidths = parseColumnWidths(attr(subform, 'columnWidths'));
  const relevant = attr(subform, 'relevant');

  return {
    type: 'subform',
    name: attr(subform, 'name'),
    uid: attr(subform, 'id') ?? undefined,
    layout: (attr(subform, 'layout') as SubformNode['layout']) ?? 'position',
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    occur,
    columnWidths: colWidths,
    children: parseChildren(subform, orderedKids),
    locale: attr(subform, 'locale'),
    presence: (attr(subform, 'presence') as PresenceValue) ?? 'visible',
    margin: parseMargin(getChild(subform, 'margin')),
    border: parseBorder(getChild(subform, 'border')),
    position: parsePosition(subform),
    events: parseEvents(getChild(subform, 'event')),
    relevant: relevant ?? undefined,
    assist: parseAssist(subform),
    extras: parseExtras(subform),
    traversal: parseTraversal(subform),
    ...parseBreaks(subform),
  };
}

function parseColumnWidths(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  const widths = raw
    .trim()
    .split(/\s+/)
    .map((v) => toPointsOrZero(v))
    .map((v) => (v > 0 ? v : -1));
  if (widths.length === 0) return undefined;
  return widths;
}

export function parseExclGroup(eg: unknown, orderedKids?: OrderedItem[]): ExclGroupNode {
  const bind = parseBind(getChild(eg, 'bind'));
  const children = parseChildren(eg, orderedKids);
  return {
    type: 'exclGroup',
    name: attr(eg, 'name'),
    uid: attr(eg, 'id') ?? undefined,
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    children,
    position: parsePosition(eg),
    presence: (attr(eg, 'presence') as PresenceValue) ?? 'visible',
    border: parseBorder(getChild(eg, 'border')),
    margin: parseMargin(getChild(eg, 'margin')),
    relevant: attr(eg, 'relevant') ?? undefined,
    assist: parseAssist(eg),
    extras: parseExtras(eg),
    traversal: parseTraversal(eg),
  };
}

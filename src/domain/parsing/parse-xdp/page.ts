import type { ContentArea, PageDefinition, PageMedium } from '../../../types';
import { getChild, toArray, attr } from '../../../lib/xml-utils';
import { toPointsOrZero, stockSizePoints } from '../../../lib/unit-converter';
import type { OrderedItem } from './ordered';
import { parseChildren } from './subform';

export function parsePages(rootSubform: unknown, orderedKids?: OrderedItem[]): PageDefinition[] {
  const pageSet = getChild(rootSubform, 'pageSet');
  if (!pageSet) return [defaultPage()];

  const pageAreas = toArray(getChild(pageSet, 'pageArea'));
  const orderedAreas = (orderedKids ?? []).filter((i) => i.tag === 'pageArea');
  return pageAreas
    .map((pa, i) => parsePageArea(pa, orderedAreas[i]?.kids))
    .filter(Boolean) as PageDefinition[];
}

function parsePageArea(pageArea: unknown, orderedKids?: OrderedItem[]): PageDefinition {
  const name = attr(pageArea, 'name') ?? 'Page1';
  const id = attr(pageArea, 'id');
  const medium = parseMedium(getChild(pageArea, 'medium'));
  const contentArea = parseContentArea(getChild(pageArea, 'contentArea'), medium);
  const masterPageChildren = parseChildren(pageArea, orderedKids);
  return { name, id, medium, contentArea, masterPageChildren };
}

function parseMedium(medium: unknown): PageMedium {
  if (!medium) return { stock: 'a4', short: 595.28, long: 841.89 };
  const stock = attr(medium, 'stock') ?? 'a4';
  const stockSize = stockSizePoints(stock);
  const short = toPointsOrZero(attr(medium, 'short')) || stockSize?.short || 595.28;
  const long = toPointsOrZero(attr(medium, 'long')) || stockSize?.long || 841.89;
  return { stock, short, long };
}

function parseContentArea(ca: unknown, medium: PageMedium): ContentArea {
  if (!ca) return { x: 0, y: 0, w: medium.short, h: medium.long };
  return {
    x: toPointsOrZero(attr(ca, 'x')),
    y: toPointsOrZero(attr(ca, 'y')),
    w: toPointsOrZero(attr(ca, 'w')),
    h: toPointsOrZero(attr(ca, 'h')),
  };
}

function defaultPage(): PageDefinition {
  return {
    name: 'Page1',
    medium: { stock: 'a4', short: 595.28, long: 841.89 },
    contentArea: { x: 54, y: 54, w: 487.28, h: 733.89 },
    masterPageChildren: [],
  };
}

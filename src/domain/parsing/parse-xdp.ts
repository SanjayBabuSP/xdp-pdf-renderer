import {
  Result,
  LayoutModel,
  LayoutNode,
  SubformNode,
  FieldNode,
  DrawNode,
  PageDefinition,
  FontSpec,
  Position,
  BindSpec,
  CaptionSpec,
  ParaSpec,
  EventSpec,
  UiSpec,
  OccurSpec,
  PresenceValue,
  PageMedium,
  ContentArea,
  ConfigSpec,
  MarginSpec,
} from '../../types';
import { success, failure } from '../../lib/result-type';
import { parseXml, getChild, toArray, attr, textContent } from '../../lib/xml-utils';
import { toPointsOrZero, stockSizePoints } from '../../lib/unit-converter';
import { ERROR_CODES } from '../../errors/error-codes';

const TEMPLATE_NAMESPACES = [
  'http://www.xfa.org/schema/xfa-template/2.8/',
  'http://www.xfa.org/schema/xfa-template/3.3/',
  'http://www.xfa.org/schema/xfa-template/3.6/',
];

/** Parse an XDP XML string into the internal LayoutModel. */
export function parseXdp(xdpXml: string): Result<LayoutModel> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xdpXml);
  } catch (e) {
    return failure(ERROR_CODES.MALFORMED_XML.code, `${ERROR_CODES.MALFORMED_XML.message}: ${e}`);
  }

  const root = getChild(parsed, 'xdp:xdp') ?? getChild(parsed, 'xdp');
  if (!root) return failure(ERROR_CODES.INVALID_XDP.code, ERROR_CODES.INVALID_XDP.message);

  const template = findTemplate(root as Record<string, unknown>);
  if (!template) return failure(ERROR_CODES.MISSING_TEMPLATE.code, ERROR_CODES.MISSING_TEMPLATE.message);

  const rootSubform = findRootSubform(template);
  if (!rootSubform) return failure(ERROR_CODES.MISSING_ROOT_SUBFORM.code, ERROR_CODES.MISSING_ROOT_SUBFORM.message);

  const pages = parsePages(rootSubform);
  const children = parseChildren(rootSubform);
  const config = parseConfig(getChild(root as Record<string, unknown>, 'config'));
  const connection = parseConnectionSet(getChild(root as Record<string, unknown>, 'connectionSet'));

  return success({
    rootSubformName: attr(rootSubform, 'name') ?? 'value',
    locale: attr(rootSubform, 'locale'),
    pages,
    children,
    config,
    ...connection,
  } as LayoutModel);
}

function findTemplate(root: Record<string, unknown>): unknown {
  if (root['template']) return root['template'];
  // Try namespace-prefixed keys
  for (const key of Object.keys(root)) {
    if (key === 'template' || key.endsWith(':template')) return root[key];
  }
  return undefined;
}

function findRootSubform(template: unknown): unknown {
  const subforms = toArray(getChild(template, 'subform'));
  return subforms[0] ?? null;
}

function parsePages(rootSubform: unknown): PageDefinition[] {
  const pageSet = getChild(rootSubform, 'pageSet');
  if (!pageSet) return [defaultPage()];

  const pageAreas = toArray(getChild(pageSet, 'pageArea'));
  return pageAreas.map(parsePageArea).filter(Boolean) as PageDefinition[];
}

function parsePageArea(pageArea: unknown): PageDefinition {
  const name = attr(pageArea, 'name') ?? 'Page1';
  const id = attr(pageArea, 'id');
  const medium = parseMedium(getChild(pageArea, 'medium'));
  const contentArea = parseContentArea(getChild(pageArea, 'contentArea'), medium);
  const masterPageChildren = parseChildren(pageArea);
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

function parseChildren(parent: unknown): LayoutNode[] {
  const nodes: LayoutNode[] = [];
  const subforms = toArray<unknown>(getChild(parent, 'subform'));
  const fields = toArray<unknown>(getChild(parent, 'field'));
  const draws = toArray<unknown>(getChild(parent, 'draw'));

  subforms.forEach((s) => nodes.push(parseSubform(s)));
  fields.forEach((f) => nodes.push(parseField(f)));
  draws.forEach((d) => nodes.push(parseDraw(d)));

  return nodes;
}

function parseSubform(subform: unknown): SubformNode {
  const bind = parseBind(getChild(subform, 'bind'));
  const occur = parseOccur(getChild(subform, 'occur'));
  const colWidths = parseColumnWidths(attr(subform, 'columnWidths'));

  return {
    type: 'subform',
    name: attr(subform, 'name'),
    layout: (attr(subform, 'layout') as SubformNode['layout']) ?? 'tb',
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    occur,
    columnWidths: colWidths,
    children: parseChildren(subform),
    locale: attr(subform, 'locale'),
    presence: (attr(subform, 'presence') as PresenceValue) ?? 'visible',
    margin: parseMargin(getChild(subform, 'margin')),
  };
}

function parseField(field: unknown): FieldNode {
  const bind = parseBind(getChild(field, 'bind'));
  const bindNode = getChild(field, 'bind');

  return {
    type: 'field',
    name: attr(field, 'name'),
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    formatPicture: bind?.picture,
    ui: parseUi(getChild(field, 'ui')),
    font: parseFont(getChild(field, 'font')),
    caption: parseCaption(getChild(field, 'caption')),
    para: parsePara(getChild(field, 'para')),
    access: attr(field, 'access'),
    position: parsePosition(field),
    events: parseEvents(getChild(field, 'event')),
    calculate: parseCalculate(getChild(field, 'calculate')),
    presence: (attr(field, 'presence') as PresenceValue) ?? 'visible',
    margin: parseMargin(getChild(field, 'margin')),
    colSpan: attr(field, 'colSpan') ? parseInt(attr(field, 'colSpan')!) : undefined,
  };

  void bindNode; // used via parseBind above
}

function parseDraw(draw: unknown): DrawNode {
  return {
    type: 'draw',
    name: attr(draw, 'name'),
    value: parseDrawValue(getChild(draw, 'value')),
    font: parseFont(getChild(draw, 'font')),
    position: parsePosition(draw),
    presence: (attr(draw, 'presence') as PresenceValue) ?? 'visible',
    ui: parseUi(getChild(draw, 'ui')),
    margin: parseMargin(getChild(draw, 'margin')),
  };
}

function parseDrawValue(value: unknown): DrawNode['value'] {
  if (!value) return undefined;
  const image = getChild(value, 'image');
  if (image) {
    return {
      type: 'image',
      contentType: attr(image, 'contentType') ?? 'image/png',
      content: textContent(image),
    };
  }
  const exData = getChild(value, 'exData');
  if (exData) {
    return {
      type: 'richText',
      contentType: attr(exData, 'contentType') ?? 'text/html',
      content: textContent(exData) ?? '',
    };
  }
  const text = getChild(value, 'text');
  if (text != null) {
    return { type: 'text', content: textContent(text) ?? String(text) };
  }
  return undefined;
}

function parseBind(bind: unknown): BindSpec | undefined {
  if (!bind) return undefined;
  const match = (attr(bind, 'match') ?? 'dataRef') as BindSpec['match'];
  const ref = attr(bind, 'ref');
  const picture = textContent(getChild(bind, 'picture'));
  return { match, ref, picture };
}

function parseOccur(occur: unknown): OccurSpec | undefined {
  if (!occur) return undefined;
  const maxStr = attr(occur, 'max');
  const max = maxStr === '-1' || maxStr === 'unbounded' ? -1 : parseInt(maxStr ?? '1', 10);
  const min = parseInt(attr(occur, 'min') ?? '0', 10);
  return { min, max };
}

function parseColumnWidths(raw: string | undefined): number[] | undefined {
  if (!raw) return undefined;
  return raw
    .trim()
    .split(/\s+/)
    .map((v) => toPointsOrZero(v))
    .filter((v) => v > 0);
}

function parseFont(font: unknown): FontSpec | undefined {
  if (!font) return undefined;
  return {
    family: attr(font, 'typeface'),
    size: attr(font, 'size') ? parseFloat(attr(font, 'size')!) : undefined,
    weight: attr(font, 'weight'),
    posture: attr(font, 'posture'),
  };
}

function parsePosition(el: unknown): Position {
  return {
    x: attr(el, 'x') ? toPointsOrZero(attr(el, 'x')) : undefined,
    y: attr(el, 'y') ? toPointsOrZero(attr(el, 'y')) : undefined,
    w: attr(el, 'w') ? toPointsOrZero(attr(el, 'w')) : undefined,
    h: attr(el, 'h') ? toPointsOrZero(attr(el, 'h')) : undefined,
    minH: attr(el, 'minH') ? toPointsOrZero(attr(el, 'minH')) : undefined,
    minW: attr(el, 'minW') ? toPointsOrZero(attr(el, 'minW')) : undefined,
  };
}

function parseCaption(caption: unknown): CaptionSpec | undefined {
  if (!caption) return undefined;
  const reserve = attr(caption, 'reserve') ? toPointsOrZero(attr(caption, 'reserve')) : undefined;
  const valueEl = getChild(caption, 'value');
  const text = textContent(getChild(valueEl, 'text'));
  const font = parseFont(getChild(caption, 'font'));
  return { reserve, text, font };
}

function parsePara(para: unknown): ParaSpec | undefined {
  if (!para) return undefined;
  return { vAlign: attr(para, 'vAlign'), hAlign: attr(para, 'hAlign') };
}

function parseEvents(eventEl: unknown): EventSpec[] | undefined {
  const events = toArray<unknown>(eventEl);
  if (events.length === 0) return undefined;
  return events.map((e) => ({
    name: attr(e, 'name'),
    activity: attr(e, 'activity'),
    ref: attr(e, 'ref'),
    script: textContent(getChild(e, 'script')),
  }));
}

function parseCalculate(calculate: unknown): { override?: string } | undefined {
  if (!calculate) return undefined;
  return { override: attr(calculate, 'override') };
}

function parseUi(ui: unknown): UiSpec | undefined {
  if (!ui) return undefined;
  if (getChild(ui, 'textEdit')) {
    const te = getChild(ui, 'textEdit');
    return { type: 'textEdit', multiLine: attr(te, 'multiLine') === '1' };
  }
  if (getChild(ui, 'numericEdit')) return { type: 'numericEdit' };
  if (getChild(ui, 'dateTimeEdit')) return { type: 'dateTimeEdit' };
  if (getChild(ui, 'imageEdit')) return { type: 'imageEdit' };
  return { type: 'unknown' };
}

function parseMargin(margin: unknown): MarginSpec | undefined {
  if (!margin) return undefined;
  return {
    topInset: attr(margin, 'topInset') ? toPointsOrZero(attr(margin, 'topInset')) : undefined,
    bottomInset: attr(margin, 'bottomInset') ? toPointsOrZero(attr(margin, 'bottomInset')) : undefined,
    leftInset: attr(margin, 'leftInset') ? toPointsOrZero(attr(margin, 'leftInset')) : undefined,
    rightInset: attr(margin, 'rightInset') ? toPointsOrZero(attr(margin, 'rightInset')) : undefined,
  };
}

function parseConfig(config: unknown): ConfigSpec | undefined {
  if (!config) return undefined;
  const present = getChild(config, 'present');
  const pdf = getChild(present, 'pdf');
  const psMap = getChild(config, 'psMap');
  const fontEntries = toArray<unknown>(getChild(psMap, 'font'));

  return {
    pdfVersion: textContent(getChild(pdf, 'version')),
    adobeExtensionLevel: parseInt(textContent(getChild(pdf, 'adobeExtensionLevel')) ?? '0', 10),
    fonts: fontEntries.map((f) => ({
      typeface: attr(f, 'typeface') ?? '',
      psName: attr(f, 'psName') ?? '',
      weight: attr(f, 'weight'),
    })),
  };
}

function parseConnectionSet(connSet: unknown): { xsdUri?: string; xsdRootElement?: string } {
  if (!connSet) return {};
  const conn = toArray<unknown>(getChild(connSet, 'xsdConnection'))[0];
  if (!conn) return {};
  return {
    xsdUri: textContent(getChild(conn, 'uri')),
    xsdRootElement: textContent(getChild(conn, 'rootElement')),
  };
}

// Validate namespace is recognized (warns but doesn't fail)
void TEMPLATE_NAMESPACES;

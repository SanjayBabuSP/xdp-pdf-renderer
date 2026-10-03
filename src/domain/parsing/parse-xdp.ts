import {
  Result,
  LayoutModel,
  LayoutNode,
  SubformNode,
  FieldNode,
  DrawNode,
  ExclGroupNode,
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
  FontEquateRule,
  MarginSpec,
  BreakValue,
  KeepSpec,
  BorderSpec,
  EdgeSpec,
  RgbColor,
  ChoiceListItem,
  AssistSpec,
  ExtrasSpec,
  TraversalSpec,
  DocumentMetadata,
} from '../../types';
import { success, failure } from '../../lib/result-type';
import { XMLParser } from 'fast-xml-parser';
import { parseXml, getChild, toArray, attr, textContent, serializeHtmlFragment } from '../../lib/xml-utils';
import { toPointsOrZero, stockSizePoints } from '../../lib/unit-converter';
import { parseOpacityValue } from '../../lib/opacity';
import { ERROR_CODES } from '../../errors/error-codes';
import { stampUids } from '../../lib/node-uid';
import { validateXfaNamespaces } from '../../adobe/xfa-namespace-validation';

/**
 * Default font equate rules from Adobe LiveCycle Designer 11.0's Designer.xci.
 * These are applied as fallbacks when the XDP's <config> section does not
 * specify its own font substitution rules. Matches the reference behavior
 * where Designer.xci is always loaded as the base configuration.
 *
 * This mirrors the full rule set in `src/rendering/font-substitution.ts`
 * (both the <agent> and <present> blocks of Designer.xci, including the
 * CJK/Adobe Kozuka/Mincho/Myriad families). Rules with `force: true` are
 * applied unconditionally; the rest only substitute when the requested font
 * is unavailable (decided by the font manager).
 */
const DEFAULT_FONT_EQUATE_RULES: FontEquateRule[] = [
  { from: 'Helvetica Black_*_*', to: 'Arial Black_*_*', force: false },
  { from: 'HelveticaBlack_*_*', to: 'Arial Black_*_*', force: false },
  { from: 'Helvetica-Black_*_*', to: 'Arial Black_*_*', force: false },
  { from: 'Helvetica_*_*', to: 'Arial_*_*', force: false },
  { from: 'Helv_*_*', to: 'Arial_*_*', force: false },
  { from: 'Cour_*_*', to: 'Courier New_*_*', force: false },
  { from: 'Courier_*_*', to: 'Courier New_*_*', force: false },
  { from: 'Times_*_*', to: 'Times New Roman_*_*', force: false },
  { from: 'TimesNewRoman_*_*', to: 'Times New Roman_*_*', force: false },
  // CJK and Adobe families from Designer.xci (<agent> block; the <present>
  // block differs only in one force flag — force wins, so agent values rule).
  { from: 'Kozuka Gothic Pro-VI B_*_*', to: 'Kozuka Gothic Pro-VI B_bold_normal', force: true },
  { from: 'Kozuka Gothic Pro-VI H_*_*', to: 'Kozuka Gothic Pro-VI H_bold_normal', force: true },
  { from: 'Kozuka Gothic Pro-VI M_*_*', to: 'Kozuka Gothic Pro-VI M_*_*', force: false },
  { from: 'Kozuka Mincho Pro-VI B_*_*', to: 'Kozuka Mincho Pro-VI B_bold_normal', force: true },
  { from: 'Kozuka Mincho Pro-VI H_*_*', to: 'Kozuka Mincho Pro-VI H_bold_normal', force: true },
  { from: 'Kozuka Mincho Pro-VI R_*_*', to: 'Kozuka Mincho Pro-VI R_*_*', force: false },
  { from: 'Myriad Pro Black_normal_*', to: 'Myriad Pro Black_bold_*', force: false },
  { from: 'MyriadPro_bold_normal', to: 'Myriad Pro_bold_normal', force: true },
  { from: 'Adobe Gothic Std B_normal_normal', to: 'Adobe Gothic Std B_bold_normal', force: true },
  { from: 'Adobe Fan Heiti Std B_normal_normal', to: 'Adobe Fan Heiti Std B_bold_normal', force: true },
  { from: 'Kozuka Gothic Pr6N B_*_*', to: 'Kozuka Gothic Pr6N B_bold_normal', force: true },
  { from: 'Kozuka Gothic Pr6N EL_*_*', to: 'Kozuka Gothic Pr6N EL_*_*', force: false },
  { from: 'Kozuka Gothic Pr6N H_*_*', to: 'Kozuka Gothic Pr6N H_bold_normal', force: true },
  { from: 'Kozuka Gothic Pr6N L_*_*', to: 'Kozuka Gothic Pr6N L_*_*', force: false },
  { from: 'Kozuka Gothic Pr6N M_*_*', to: 'Kozuka Gothic Pr6N M_*_*', force: false },
  { from: 'Kozuka Gothic Pr6N R_*_*', to: 'Kozuka Gothic Pr6N R_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N B_*_*', to: 'Kozuka Mincho Pr6N B_bold_normal', force: true },
  { from: 'Kozuka Mincho Pr6N EL_*_*', to: 'Kozuka Mincho Pr6N EL_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N H_*_*', to: 'Kozuka Mincho Pr6N H_bold_normal', force: true },
  { from: 'Kozuka Mincho Pr6N L_*_*', to: 'Kozuka Mincho Pr6N L_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N M_*_*', to: 'Kozuka Mincho Pr6N M_*_*', force: false },
  { from: 'Kozuka Mincho Pr6N R_*_*', to: 'Kozuka Mincho Pr6N R_*_*', force: false },
];

const TEMPLATE_NAMESPACES = [
  'http://www.xfa.org/schema/xfa-template/2.8/',
  'http://www.xfa.org/schema/xfa-template/3.3/',
  'http://www.xfa.org/schema/xfa-template/3.6/',
];

/** Parse an XDP XML string into the internal LayoutModel. */
export interface XdpParseOptions {
  /**
   * Reject templates whose XFA version is recognised but unsupported
   * (2.0–2.7, 3.0–3.5). Default false: parse with a warning.
   */
  strict?: boolean;
  /** Override the XML input size cap (bytes). */
  maxInputSize?: number;
}

export function parseXdp(xdpXml: string, options: XdpParseOptions = {}): Result<LayoutModel> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xdpXml, options.maxInputSize);
  } catch (e) {
    return failure(ERROR_CODES.MALFORMED_XML.code, `${ERROR_CODES.MALFORMED_XML.message}: ${e}`);
  }

  const root = getChild(parsed, 'xdp:xdp') ?? getChild(parsed, 'xdp');
  if (!root) return failure(ERROR_CODES.INVALID_XDP.code, ERROR_CODES.INVALID_XDP.message);

  const template = findTemplate(root as Record<string, unknown>);
  if (!template) return failure(ERROR_CODES.MISSING_TEMPLATE.code, ERROR_CODES.MISSING_TEMPLATE.message);

  // G16: validate the template namespace / XFA version (xfa-namespace-validation).
  // Unsupported-but-known versions fail in strict mode, otherwise they warn and
  // are parsed in backward-compatible mode.
  const namespaceResult = validateXfaNamespaces(
    collectNamespaces(root as Record<string, unknown>, template),
    options.strict === true,
  );
  if (!namespaceResult.valid) {
    return failure(
      'XDP_UNSUPPORTED_XFA_VERSION',
      namespaceResult.errors.join('; ') || 'Unsupported XFA template namespace',
    );
  }

  const rootSubform = findRootSubform(template);
  if (!rootSubform) return failure(ERROR_CODES.MISSING_ROOT_SUBFORM.code, ERROR_CODES.MISSING_ROOT_SUBFORM.message);

  // Document-order index: fast-xml-parser's default (grouped) parse loses the
  // interleaved document order of mixed child types (<field/><draw/><field/>…
  // becomes {field:[…], draw:[…]}), which scrambles flow (tb/lr) containers
  // that must lay out children in author order — exactly what Preview PDF
  // does (XFATemplate model preserves sibling order; xfalayout walks it in
  // sequence). A parallel preserveOrder parse recovers the per-parent child
  // tag sequence; parseChildren below consumes it. Falls back to grouped
  // order when the second parse fails (fail-safe: never worse than before).
  const orderedRootKids = orderedTemplateKids(xdpXml);
  const orderedRootSubformKids = firstOrderedSubformKids(orderedRootKids);

  const pages = parsePages(rootSubform, orderedRootSubformKids);
  const children = parseChildren(rootSubform, orderedRootSubformKids);
  const config = parseConfig(getChild(root as Record<string, unknown>, 'config'));
  const connection = parseConnectionSet(getChild(root as Record<string, unknown>, 'connectionSet'));
  // The root subform is collapsed to rootSubformName — carry its <event>
  // elements (ready ref=$form / $layout, overlay, docReady, …) so the script
  // dispatcher can fire them. evidence: XFAModelImpl::ready dispatches
  // 'ready' on the model alias node (xfa_disasm.c:49230-49275).
  const rootEvents = parseEvents(getChild(rootSubform, 'event'));
  // Adobe sources the output PDF's title/description from the XDP's own
  // `x:xmpmeta` (dc:title) and `$template.#subform.#desc`
  // (pdfdocument_disasm.c:157678-158340; pdfldriver_disasm.c:70670-70760).
  const metadata = parseDocumentMetadata(root as Record<string, unknown>, rootSubform);

  // Every node needs a unique identity so script results can be reconciled
  // back onto the exact node they were produced against.
  stampUids([children, ...pages.map((page) => page.masterPageChildren)]);

  return success({
    rootSubformName: attr(rootSubform, 'name') ?? 'value',
    locale: attr(rootSubform, 'locale'),
    pages,
    children,
    rootEvents,
    config,
    ...connection,
    metadata,
    version: namespaceResult.detectedVersion ?? undefined,
    warnings: namespaceResult.warnings.length > 0 ? namespaceResult.warnings : undefined,
  } as LayoutModel);
}

/**
 * Pull document metadata out of the XDP: `<x:xmpmeta><rdf:RDF><dc:title>` /
 * `dc:description` / `dc:creator` when the metadata packet is present, with
 * the template `<desc><text>` (or `<toolTip>`) as the fallback Adobe uses.
 */
function parseDocumentMetadata(
  root: Record<string, unknown>,
  rootSubform: unknown,
): DocumentMetadata | undefined {
  const title = readXmpLiteral(root, 'dc:title') ?? readDescText(rootSubform);
  const description = readXmpLiteral(root, 'dc:description');
  const author = readXmpCreator(root);
  const out: DocumentMetadata = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (author) out.author = author;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** `<rdf:li>` text of a simple `dc:<property>` element in the XDP's XMP packet. */
function readXmpLiteral(root: Record<string, unknown>, property: string): string | undefined {
  const packet = getChild(root, 'x:xmpmeta') ?? getChild(root, 'xmpmeta');
  if (!packet) return undefined;
  const element = findNestedKey(packet, property);
  if (!element) return undefined;
  // dc:title / dc:description wrap their text in `<rdf:Alt><rdf:li>…`.
  const text = textContent(element) ?? textContent(findNestedKey(element, 'li'));
  return text && text.trim() !== '' ? text.trim() : undefined;
}

/** Depth-first search for the first object property with `name` (or namespaced). */
function findNestedKey(node: unknown, name: string, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 6) return undefined;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === name || key.endsWith(`:${name}`) || key.endsWith(`_${name}`)) return value;
    const nested = findNestedKey(value, name, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function readXmpCreator(root: Record<string, unknown>): string | undefined {
  const packet = getChild(root, 'x:xmpmeta') ?? getChild(root, 'xmpmeta');
  if (!packet) return undefined;
  const creator = findNestedKey(packet, 'creator');
  if (!creator) return undefined;
  // dc:creator is an rdf:Seq; the first li carries the author.
  const list = findNestedKey(creator, 'li');
  const text = textContent(list ?? creator);
  return text && text.trim() !== '' ? text.trim() : undefined;
}

/** `$template.#subform.#desc` — `<desc><text>…</text></desc>` on the root subform. */
function readDescText(rootSubform: unknown): string | undefined {
  const desc = getChild(rootSubform, 'desc');
  if (!desc) return undefined;
  const text = textContent(getChild(desc, 'text'));
  return text && text.trim() !== '' ? text.trim() : undefined;
}

/** Collect `xmlns` / `xmlns:*` declarations from the XDP root and template. */
function collectNamespaces(
  root: Record<string, unknown>,
  template: unknown,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const element of [root, template]) {
    if (!element || typeof element !== 'object') continue;
    for (const key of Object.keys(element as Record<string, unknown>)) {
      if (key === '@_xmlns') {
        out[''] = String((element as Record<string, unknown>)[key]);
      } else if (key.startsWith('@_xmlns:')) {
        out[key.slice('@_xmlns:'.length)] = String((element as Record<string, unknown>)[key]);
      }
    }
  }
  return out;
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

function parsePages(rootSubform: unknown, orderedKids?: OrderedItem[]): PageDefinition[] {
  const pageSet = getChild(rootSubform, 'pageSet');
  if (!pageSet) return [defaultPage()];

  const pageAreas = toArray(getChild(pageSet, 'pageArea'));
  // Match ordered pageArea items to normal ones by position among pageAreas.
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

/**
 * Document-order child sequence recovered from a parallel `preserveOrder`
 * parse (see orderedTemplateKids). Each item is one child element in author
 * order: `tag` is the local element name, `kids` its own ordered children
 * (for containers — threaded down the recursion), `index` its position among
 * same-tag siblings (to pair with the grouped normal-parse arrays).
 */
interface OrderedItem {
  tag: string;
  kids: OrderedItem[];
  /** Occurrence index among same-tag siblings under the same parent. */
  index: number;
}

/** Child tags that become layout nodes, in XFA vocabulary (local names). */
const ORDERED_NODE_TAGS = new Set(['subform', 'subformSet', 'area', 'field', 'draw', 'exclGroup']);

/**
 * Re-parse `xdpXml` with `preserveOrder: true` and return the ordered child
 * items of the `<template>` element. Returns undefined on any failure —
 * callers fall back to grouped (legacy) order.
 */
function orderedTemplateKids(xdpXml: string): OrderedItem[] | undefined {
  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      allowBooleanAttributes: true,
      parseAttributeValue: false,
      trimValues: true,
      processEntities: false,
      cdataPropName: '__cdata',
      commentPropName: '__comment',
      preserveOrder: true,
    });
    const doc = parser.parse(xdpXml) as unknown[];
    if (!Array.isArray(doc)) return undefined;
    const rootItems = toOrderedItems(doc);
    const rootKids = kidsOfItems(rootItems, ['xdp:xdp', 'xdp']);
    if (!rootKids) return undefined;
    return kidsOfItems(rootKids, ['template']);
  } catch {
    return undefined;
  }
}

/**
 * Find the ordered kids of the first `<subform>` (the root subform) inside
 * ordered template kids. Undefined when unavailable (legacy order fallback).
 */
function firstOrderedSubformKids(templateKids: OrderedItem[] | undefined): OrderedItem[] | undefined {
  if (!templateKids) return undefined;
  const first = templateKids.find((i) => i.tag === 'subform');
  return first?.kids;
}

/**
 * Within already-converted ordered items, find the first item whose tag
 * matches one of `names` (exact or namespace-suffixed) and return its kids.
 */
function kidsOfItems(items: OrderedItem[], names: string[]): OrderedItem[] | undefined {
  for (const item of items) {
    if (names.some((n) => item.tag === n || item.tag.endsWith(`:${n}`))) return item.kids;
  }
  return undefined;
}

/**
 * Convert a raw `preserveOrder` node array into OrderedItems, numbering
 * same-tag siblings so they pair 1:1 with the grouped normal-parse arrays.
 * Non-element entries (#text, comments, PIs) are skipped.
 */
function toOrderedItems(node: unknown): OrderedItem[] {
  if (!Array.isArray(node)) return [];
  const counters = new Map<string, number>();
  const out: OrderedItem[] = [];
  for (const entry of node) {
    if (entry == null || typeof entry !== 'object' || Array.isArray(entry)) continue;
    for (const [key, value] of Object.entries(entry as Record<string, unknown>)) {
      if (key === ':@' || key.startsWith('?') || key === '#text' || key === '__cdata' || key === '__comment') continue;
      if (!Array.isArray(value)) continue;
      // Strip namespace prefix for pairing (`xdp:xdp` → `xdp`); child tags
      // inside <template> are unprefixed in practice.
      const tag = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
      const index = counters.get(tag) ?? 0;
      counters.set(tag, index + 1);
      out.push({ tag, kids: toOrderedItems(value), index });
      break; // one tag per entry
    }
  }
  return out;
}

function parseChildren(parent: unknown, orderedKids?: OrderedItem[]): LayoutNode[] {
  // Raw grouped arrays (normal parse) — parsed lazily in document order below.
  const raw: Record<string, unknown[]> = {
    subform: toArray<unknown>(getChild(parent, 'subform')),
    subformSet: toArray<unknown>(getChild(parent, 'subformSet')),
    area: toArray<unknown>(getChild(parent, 'area')),
    field: toArray<unknown>(getChild(parent, 'field')),
    draw: toArray<unknown>(getChild(parent, 'draw')),
    exclGroup: toArray<unknown>(getChild(parent, 'exclGroup')),
  };
  // Group ordered items per tag; item.index pairs with the grouped array slot.
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
        return parseField(rawNode);
      case 'draw':
        return parseDraw(rawNode);
      case 'exclGroup':
        return parseExclGroup(rawNode, order?.kids);
      default:
        return undefined;
    }
  };

  const nodes: LayoutNode[] = [];
  if (orderedKids && orderedKids.length > 0) {
    const used = new Map<string, number>();
    for (const item of orderedKids) {
      if (!ORDERED_NODE_TAGS.has(item.tag)) continue;
      const slot = used.get(item.tag) ?? 0;
      used.set(item.tag, slot + 1);
      // Prefer the occurrence-paired slot; fall back to sequential consume
      // when the two parses disagree on counts.
      const rawNode = raw[item.tag][item.index] ?? raw[item.tag][slot];
      if (rawNode === undefined) continue;
      const parsed = parseOne(item.tag, rawNode, item);
      if (parsed) nodes.push(parsed);
    }
    // Any raw leftovers the order parse missed (parse disagreement) append
    // in legacy group order rather than being dropped.
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

  // Legacy grouped order (no order index available).
  raw.subform.forEach((s) => nodes.push(parseSubform(s)));
  // <subformSet> holds mutually-exclusive alternatives; the active one is
  // selected by @initial (default: the first child). Previously the whole
  // element was silently dropped, losing an entire branch of the template.
  raw.subformSet.forEach((set) => {
    const active = parseSubformSet(set);
    if (active) nodes.push(active);
  });
  // <area> is a subform-shaped, data-unbound container.
  raw.area.forEach((a) => nodes.push(parseArea(a)));
  raw.field.forEach((f) => nodes.push(parseField(f)));
  raw.draw.forEach((d) => nodes.push(parseDraw(d)));
  raw.exclGroup.forEach((eg) => nodes.push(parseExclGroup(eg)));

  return nodes;
}

/**
 * `<subformSet>` — a group of alternative subforms of which exactly one is
 * instantiated. `@initial` selects the default (0-based; anything unparseable
 * falls back to the first child, which is what Designer seeds a new set with).
 */
function parseSubformSet(set: unknown, orderedKids?: OrderedItem[]): SubformNode | undefined {
  const subs = toArray<unknown>(getChild(set, 'subform'));
  if (subs.length === 0) return undefined;
  const parsed = Number.parseInt(attr(set, 'initial') ?? '0', 10);
  const idx = Number.isFinite(parsed) && parsed >= 0 && parsed < subs.length ? parsed : 0;
  const orderedSubs = (orderedKids ?? []).filter((i) => i.tag === 'subform');
  const active = parseSubform(subs[idx], orderedSubs[idx]?.kids);
  // The set is a SOM scope (`set.alt0`); the chosen alternative stays a child
  // so both names remain addressable. Without a name the set is transparent.
  const setName = attr(set, 'name');
  if (!setName) return active;
  return {
    type: 'subform',
    name: setName,
    uid: attr(set, 'id') ?? undefined,
    layout: 'position',
    occur: parseOccur(getChild(set, 'occur')),
    children: [active],
    presence: (attr(set, 'presence') as PresenceValue) ?? 'visible',
    position: parsePosition(set),
    assist: parseAssist(set),
    extras: parseExtras(set),
    ...parseBreaks(set),
  };
}

/** `<area>` — layout container with no data binding (renders like a plain subform). */
function parseArea(area: unknown, orderedKids?: OrderedItem[]): SubformNode {
  return parseSubform(area, orderedKids);
}

function parseSubform(subform: unknown, orderedKids?: OrderedItem[]): SubformNode {
  const bind = parseBind(getChild(subform, 'bind'));
  const occur = parseOccur(getChild(subform, 'occur'));
  const colWidths = parseColumnWidths(attr(subform, 'columnWidths'));
  const relevant = attr(subform, 'relevant');

  return {
    type: 'subform',
    name: attr(subform, 'name'),
    uid: attr(subform, 'id') ?? undefined,
    // XFA default is absolute "position" layout when unspecified — only tb/lr/table/row opt into flow.
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

function parseField(field: unknown): FieldNode {
  const bind = parseBind(getChild(field, 'bind'));
  const ui = getChild(field, 'ui');
  const uiElement = ui ? findUiElement(ui) : undefined;

  // Parse <value> element for default/initial value
  const valueEl = getChild(field, 'value');
  const defaultValue = parseDefaultValue(valueEl);

  // Parse <relevant> attribute for conditional visibility
  const relevant = attr(field, 'relevant');

  return {
    type: 'field',
    name: attr(field, 'name'),
    uid: attr(field, 'id') ?? undefined,
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    formatPicture: parseFormatPicture(field, bind),
    ui: parseUi(ui),
    font: parseFont(getChild(field, 'font')),
    caption: parseCaption(getChild(field, 'caption')),
    para: parsePara(getChild(field, 'para')),
    access: attr(field, 'access'),
    position: parsePosition(field),
    events: parseEvents(getChild(field, 'event')),
    calculate: parseCalculate(getChild(field, 'calculate')),
    validate: parseValidate(getChild(field, 'validate')),
    presence: (attr(field, 'presence') as PresenceValue) ?? 'visible',
    margin: parseMargin(getChild(field, 'margin')),
    colSpan: attr(field, 'colSpan') ? parseInt(attr(field, 'colSpan')!) : undefined,
    border: parseBorder(getChild(field, 'border') ?? (uiElement ? getChild(uiElement, 'border') : undefined)),
    relevant: relevant ?? undefined,
    defaultValue,
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

function parseExclGroup(eg: unknown, orderedKids?: OrderedItem[]): ExclGroupNode {
  const bind = parseBind(getChild(eg, 'bind'));
  // XFA allows field/draw/subform/nested-exclGroup here; parseChildren handles
  // all of them. The old `field`-only collection dropped every other child.
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

function parseDraw(draw: unknown): DrawNode {
  return {
    type: 'draw',
    name: attr(draw, 'name'),
    uid: attr(draw, 'id') ?? undefined,
    value: parseDrawValue(getChild(draw, 'value')),
    font: parseFont(getChild(draw, 'font')),
    para: parsePara(getChild(draw, 'para')),
    position: parsePosition(draw),
    presence: (attr(draw, 'presence') as PresenceValue) ?? 'visible',
    ui: parseUi(getChild(draw, 'ui')),
    margin: parseMargin(getChild(draw, 'margin')),
    border: parseBorder(getChild(draw, 'border')),
    events: parseEvents(getChild(draw, 'event')),
    relevant: attr(draw, 'relevant') ?? undefined,
    assist: parseAssist(draw),
    extras: parseExtras(draw),
    ...parseBreaks(draw),
  };
}

function parseDrawValue(value: unknown): DrawNode['value'] {
  if (!value) return undefined;
  const image = getChild(value, 'image');
  if (image) {
    // XFA image attributes (xfaimageservice_disasm.c:9324, :9281):
    //   aspect="none|fit|actual|width|height"
    //   xdpi/ydpi (or xres/yres) for actual-mode DPI sizing
    //   hAlign/vAlign for alignment within spare space
    const aspectRaw = attr(image, 'aspect');
    const xdpiRaw = attr(image, 'xdpi') ?? attr(image, 'xres');
    const ydpiRaw = attr(image, 'ydpi') ?? attr(image, 'yres');
    const hAlignRaw = attr(image, 'hAlign') as DrawNode['value'] extends { hAlign?: infer T } ? T : never;
    const vAlignRaw = attr(image, 'vAlign') as DrawNode['value'] extends { vAlign?: infer T } ? T : never;
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
    // exData arrives in two shapes: entity-escaped markup as plain text, or
    // real nested elements (`<body><p><span xfa:embed="#id"/></p></body>`).
    // textContent() only sees #text, so nested markup must be re-serialized —
    // otherwise every `xfa:embed` reference is lost before it is resolved.
    const hasNestedMarkup =
      typeof exData === 'object' &&
      exData !== null &&
      Object.keys(exData).some((k) => !k.startsWith('@_') && k !== '#text');
    return {
      type: 'richText',
      contentType: attr(exData, 'contentType') ?? 'text/html',
      content: hasNestedMarkup
        ? serializeHtmlFragment(exData)
        : textContent(exData) ?? '',
    };
  }
  const rectangle = getChild(value, 'rectangle');
  if (rectangle) {
    return { type: 'rectangle', shapeBorder: parseBorder(rectangle) };
  }
  const line = getChild(value, 'line');
  if (line) {
    return { type: 'line', shapeBorder: parseBorder(line) };
  }
  const arc = getChild(value, 'arc');
  if (arc) {
    return {
      type: 'arc',
      shapeBorder: parseBorder(arc),
      sweepAngle: attr(arc, 'sweepAngle') ? parseFloat(attr(arc, 'sweepAngle')!) : 360,
      startAngle: attr(arc, 'startAngle') ? parseFloat(attr(arc, 'startAngle')!) : 0,
    };
  }
  const circle = getChild(value, 'circle');
  if (circle) {
    return { type: 'circle', shapeBorder: parseBorder(circle) };
  }
  const text = getChild(value, 'text');
  if (text != null) {
    return { type: 'text', content: textContent(text) ?? String(text) };
  }
  return undefined;
}

function parseColor(colorEl: unknown): RgbColor | undefined {
  const raw = attr(colorEl, 'value');
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => parseInt(p.trim(), 10));
  if (parts.length < 3 || parts.some(isNaN)) return undefined;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

/**
 * Parse a border/rectangle/line shape element (all share the same edge/fill/corner structure in XFA).
 * A single <edge> applies uniformly to all 4 sides; up to 4 <edge> elements apply as [top, right, bottom, left].
 */
function parseBorder(el: unknown): BorderSpec | undefined {
  if (!el) return undefined;
  // Field/subform borders pass the <border> element directly, while draw shapes
  // (<rectangle>/<arc>/<circle>/<line>) carry an inner <border> child. Unwrap it
  // so both forms resolve edge/fill/corner identically.
  const scope = getChild(el, 'border') ?? el;
  const edgeEls = toArray<unknown>(getChild(scope, 'edge'));
  // XFA orders border sides by <edge index> (0..3); fall back to document order
  // when the attribute is absent. Rendering draws them 0,2,1,3 (designrenderer:6283+).
  const edges: EdgeSpec[] = [];
  edgeEls.forEach((edge, i) => {
    const parsed: EdgeSpec = {
      presence: attr(edge, 'presence'),
      thickness: attr(edge, 'thickness') ? toPointsOrZero(attr(edge, 'thickness')) : undefined,
      color: parseColor(getChild(edge, 'color')),
      style: attr(edge, 'stroke'),
      opacity: parseEdgeOpacity(edge),
      // Cap/join: designrenderer:6182 edgeInfo->capStyle / joinStyle.
      // XFA attributes: cap="square"|"round"|"butt", join="miter"|"round"|"bevel".
      cap: attr(edge, 'cap') ?? undefined,
      join: attr(edge, 'join') ?? undefined,
    };
    const indexRaw = attr(edge, 'index');
    const index = indexRaw != null ? Number.parseInt(indexRaw, 10) : i;
    if (Number.isInteger(index) && index >= 0 && index <= 3) edges[index] = parsed;
    else edges.push(parsed);
  });
  const compacted = edges.filter((edge) => edge !== undefined);
  const fillEl = getChild(scope, 'fill') ?? getChild(el, 'fill');
  const fill = fillEl
    ? {
        presence: attr(fillEl, 'presence'),
        color: parseColor(getChild(fillEl, 'color')),
        opacity: parseFillOpacity(fillEl),
        fillType: attr(fillEl, 'fillType'),
        // Gradient end colour: XFA stores it in a <linear color="…"/> or second
        // <color> child when fillType is a gradient type.
        // evidence: renderer:35845 uses color1/color2 for axial gradient bounds.
        color2: parseFillColor2(fillEl),
      }
    : undefined;
  const cornerEl = getChild(scope, 'corner') ?? getChild(el, 'corner');
  const cornerRadius = cornerEl && attr(cornerEl, 'radius') ? toPointsOrZero(attr(cornerEl, 'radius')) : undefined;

  if (compacted.length === 0 && !fill && cornerRadius == null) return undefined;
  return {
    presence: attr(scope, 'presence') ?? attr(el, 'presence'),
    edges: compacted.length > 0 ? edges : undefined,
    fill,
    cornerRadius,
  };
}

/** `<fill opacity="…">` or `<fill><opacity value="…"/></fill>`. */
function parseFillOpacity(fillEl: unknown): number | undefined {
  const child = getChild(fillEl, 'opacity');
  const fromChild = child ? (attr(child, 'value') ?? textContent(child)) : undefined;
  return parseOpacityValue(attr(fillEl, 'opacity') ?? fromChild);
}

/**
 * Parse the gradient end colour (color2) from a fill element.
 *
 * XFA stores the end colour of a gradient in two ways:
 *   1. A `<linear color="r,g,b">` child element (the common path in Designer 11).
 *   2. A second `<color>` child following the first.
 *
 * evidence: renderer:35845 buildLinearGradient uses color1 and color2 params.
 */
function parseFillColor2(fillEl: unknown): RgbColor | undefined {
  // Path 1: <linear color="r,g,b"/> child
  const linearEl = getChild(fillEl, 'linear');
  if (linearEl) {
    const c = attr(linearEl, 'color');
    if (c) return parseColorString(c);
  }
  // Path 2: second <color> child (rare but spec-legal)
  const colorEls = toArray<unknown>(getChild(fillEl, 'color'));
  if (colorEls.length >= 2) return parseColor(colorEls[1]);
  return undefined;
}

/** Parse a comma-separated `"r,g,b"` color string (used in <linear color="…"/>). */
function parseColorString(raw: string): RgbColor | undefined {
  const parts = raw.split(',').map((s) => parseInt(s.trim(), 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return undefined;
}

/** `<edge><opacity value="…"/></edge>` (stroke alpha, pdfdocument:138444). */
function parseEdgeOpacity(edge: unknown): number | undefined {
  const child = getChild(edge, 'opacity');
  const fromChild = child ? (attr(child, 'value') ?? textContent(child)) : undefined;
  return parseOpacityValue(attr(edge, 'opacity') ?? fromChild);
}

/**
 * `<assist>` — accessibility annotations (`toolTip`, `description`, `name`,
 * `usage`). Readable from scripts as `$.assist.toolTip`.
 */
function parseAssist(el: unknown): AssistSpec | undefined {
  const assist = getChild(el, 'assist');
  if (!assist) return undefined;
  const toolTip = textContent(getChild(assist, 'toolTip'));
  const description = textContent(getChild(assist, 'description'));
  const name = textContent(getChild(assist, 'name'));
  const usage = textContent(getChild(assist, 'usage'));
  const spec: AssistSpec = {};
  if (toolTip) spec.toolTip = toolTip;
  if (description) spec.description = description;
  if (name) spec.name = name;
  if (usage) spec.usage = usage;
  return Object.keys(spec).length > 0 ? spec : undefined;
}

/** `<extras><<name> value="..."/></extras>` — author baggage, `$.extras.<name>`. */
function parseExtras(el: unknown): ExtrasSpec | undefined {
  const extras = getChild(el, 'extras');
  if (extras == null || typeof extras !== 'object') return undefined;
  const out: ExtrasSpec = {};
  for (const [name, raw] of Object.entries(extras as Record<string, unknown>)) {
    if (name === '#text' || name === '__cdata' || name === '__comment') continue;
    for (const child of toArray<unknown>(raw)) {
      // fast-xml-parser yields a bare string/number/boolean for simple
      // elements and an object (`{@_value}` / `{#text}`) once attributes,
      // CDATA or nested markup are involved.
      if (typeof child !== 'object') {
        const text = String(child);
        if (text !== '') out[name] = text;
        continue;
      }
      if (child == null || typeof child !== 'object') continue;
      const value = attr(child, 'value');
      const text = value ?? textContent(child);
      if (text !== undefined && text !== '') out[name] = text;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * `<traversal order="..."><field name="a" .../></traversal>` — the authored
 * focus order for a container. Preserved for the AcroForm tab-order writer.
 */
function parseTraversal(el: unknown): TraversalSpec | undefined {
  const traversal = getChild(el, 'traversal');
  if (!traversal) return undefined;
  const spec: TraversalSpec = {};
  const order = attr(traversal, 'order');
  if (order) spec.order = order;
  const fields = toArray<unknown>(getChild(traversal, 'field'))
    .map((f) => attr(f, 'name'))
    .filter((n): n is string => !!n);
  if (fields.length > 0) spec.fields = fields;
  return Object.keys(spec).length > 0 ? spec : undefined;
}

/**
 * Display picture for a field. Adobe keeps two pictures: `bind/picture`
 * parses the incoming data, `format/picture` (or the fallback `value/picture`)
 * formats the outgoing display. We render display, so the format/value pair
 * wins and `bind/picture` is only a fallback when neither exists.
 */
function parseFormatPicture(field: unknown, bind: BindSpec | undefined): string | undefined {
  const formatPicture = textContent(getChild(getChild(field, 'format'), 'picture'));
  const valuePicture = textContent(getChild(getChild(field, 'value'), 'picture'));
  return formatPicture || valuePicture || bind?.picture || undefined;
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
  const fillEl = getChild(font, 'fill');
  const fontColor = fillEl ? parseColor(getChild(fillEl, 'color')) : undefined;
  return {
    family: attr(font, 'typeface'),
    size: attr(font, 'size') ? parseFloat(attr(font, 'size')!) : undefined,
    weight: attr(font, 'weight'),
    posture: attr(font, 'posture'),
    color: fontColor,
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
    maxH: attr(el, 'maxH') ? toPointsOrZero(attr(el, 'maxH')) : undefined,
    maxW: attr(el, 'maxW') ? toPointsOrZero(attr(el, 'maxW')) : undefined,
    rotate: attr(el, 'rotate') ? parseFloat(attr(el, 'rotate')!) : undefined,
  };
}

const BREAK_VALUES = ['contentArea', 'pageArea', 'pageEven', 'pageFront', 'pageOdd'] as const;

/**
 * breakBefore/breakAfter attributes + optional <keep> element.
 * evidence: xfa.dll atom block "breakAfter, breakBefore … contentArea,
 * pageArea, pageEven, pageFront, pageOdd"; default auto (0x350000,
 * AcroForm.ppi_disasm.c:794816); keep has three enum properties all
 * defaulting to auto (xfalayout_disasm.c:66094 hasActiveKeep).
 */
function parseBreaks(el: unknown): {
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
} {
  const parseBreak = (v: string | undefined): BreakValue | undefined => {
    if (!v || v === 'auto') return undefined;
    return (BREAK_VALUES as readonly string[]).includes(v) ? (v as BreakValue) : undefined;
  };
  const out: { breakBefore?: BreakValue; breakAfter?: BreakValue; keep?: KeepSpec } = {};
  const bb = parseBreak(attr(el, 'breakBefore'));
  const ba = parseBreak(attr(el, 'breakAfter'));
  if (bb) out.breakBefore = bb;
  if (ba) out.breakAfter = ba;

  const keepEl = getChild(el, 'keep');
  if (keepEl != null && typeof keepEl === 'object') {
    const keep: KeepSpec = {};
    for (const [key, val] of Object.entries(keepEl as Record<string, unknown>)) {
      if (key.startsWith('@_')) {
        const name = key.slice(2);
        keep[name] = String(val);
      } else if (typeof val === 'string' || typeof val === 'number') {
        keep[key] = String(val);
      }
    }
    if (Object.keys(keep).length > 0) out.keep = keep;
  }
  return out;
}

function parseCaption(caption: unknown): CaptionSpec | undefined {
  if (!caption) return undefined;
  const reserve = attr(caption, 'reserve') ? toPointsOrZero(attr(caption, 'reserve')) : undefined;
  const placement = attr(caption, 'placement') as CaptionSpec['placement'] | undefined;
  const valueEl = getChild(caption, 'value');
  const text = textContent(getChild(valueEl, 'text'));
  const font = parseFont(getChild(caption, 'font'));
  return { reserve, placement, text, font };
}

function parsePara(para: unknown): ParaSpec | undefined {
  if (!para) return undefined;
  // XFA <para> carries alignment plus paragraph metrics. Property names are the
  // xfa.dll atoms `lineHeight`, `spaceAbove`, `spaceBelow`, `textIndent`,
  // `marginLeft`, `marginRight`; jfTextAttr exposes them as Spacing (:3920),
  // SpaceBefore (:3920)/SpaceAfter (:3782) and MarginL/MarginR (:2888/:2957).
  const spec: ParaSpec = {
    vAlign: attr(para, 'vAlign'),
    hAlign: attr(para, 'hAlign'),
    lineHeight: paraPoints(para, 'lineHeight'),
    spaceAbove: paraPoints(para, 'spaceAbove'),
    spaceBelow: paraPoints(para, 'spaceBelow'),
    textIndent: paraPoints(para, 'textIndent'),
    marginLeft: paraPoints(para, 'marginLeft'),
    marginRight: paraPoints(para, 'marginRight'),
  };
  const hasValue = Object.values(spec).some((v) => v != null && v !== '');
  return hasValue ? spec : undefined;
}

/** Read a `<para>` measurement attribute as points; undefined when absent/empty. */
function paraPoints(para: unknown, name: string): number | undefined {
  const raw = attr(para, name);
  if (raw == null || raw.trim() === '') return undefined;
  const pt = toPointsOrZero(raw);
  return pt || undefined;
}

function parseEvents(eventEl: unknown): EventSpec[] | undefined {
  const events = toArray<unknown>(eventEl);
  if (events.length === 0) return undefined;
  return events.map((e) => {
    // Each <event> can have one or more <script> children with different contentTypes
    const scriptEls = toArray<unknown>(getChild(e, 'script'));
    const firstScript = scriptEls[0];
    const scriptContent = textContent(firstScript) ?? textContent(getChild(e, 'script'));

    // Extract contentType and runAt from the <script> element
    const contentType = attr(firstScript, 'contentType');
    const runAt = attr(firstScript, 'runAt');

    // Normalize event name from 'activity' attribute
    // Reference: xfascripthandler.dll maps <event activity="..."> to canonical events
    const rawActivity = attr(e, 'activity');
    const rawName = attr(e, 'name');
    const normalizedActivity = normalizeEventActivity(rawActivity, rawName);

    return {
      name: normalizedActivity ?? rawName,
      activity: rawActivity ?? undefined,
      ref: attr(e, 'ref'),
      script: scriptContent,
      contentType: contentType ?? undefined,
      runAt: runAt ?? undefined,
    };
  });
}

/**
 * Normalize event activity values to canonical XFA event names.
 * Reference: xfascripthandler.dll event name mapping table.
 *
 * Adobe LiveCycle maps <event activity="..."> values like this:
 *   activity="initialize" → "initialize"
 *   activity="click" → "click"
 *   activity="docReady" → "docReady"
 * Also handles SAP convention: name="event__calculate" → "calculate"
 */
function normalizeEventActivity(activity?: string, name?: string): string | undefined {
  if (activity) {
    const lower = activity.toLowerCase();
    const activityMap: Record<string, string> = {
      'initialize': 'initialize',
      'calculate': 'calculate',
      'validate': 'validate',
      'click': 'click',
      'change': 'change',
      'enter': 'enter',
      'exit': 'exit',
      'mouseenter': 'mouseEnter',
      'mouseexit': 'mouseExit',
      'ready': 'ready',
      'docready': 'docReady',
      'docclose': 'docClose',
      'presave': 'preSave',
      'postsave': 'postSave',
      'preprint': 'prePrint',
      'postprint': 'postPrint',
      'presubmit': 'preSubmit',
      'postsubmit': 'postSubmit',
      'preexecute': 'preExecute',
      'postexecute': 'postExecute',
      'presign': 'preSign',
      'postsign': 'postSign',
      'full': 'full',
      'indexchange': 'indexChange',
      'mouseup': 'mouseUp',
      'mousedown': 'mouseDown',
      'preopen': 'preOpen',
      'postopen': 'postOpen',
      'preclose': 'preClose',
      'postclose': 'postClose',
      'validationstate': 'validationState',
      'overlay': 'overlay',
      'form:ready': 'ready',
      'layout:ready': 'layout:ready',
    };
    return activityMap[lower] ?? lower;
  }

  // Infer from name attribute when activity is missing
  if (name) {
    // Handle SAP naming convention: "event__calculate" → "calculate"
    const sapMatch = name.match(/^event__(.+)$/);
    if (sapMatch) return sapMatch[1].toLowerCase();
    return name;
  }

  return undefined;
}

function parseCalculate(calculate: unknown): { override?: string; script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string } } | undefined {
  if (!calculate) return undefined;
  const override = attr(calculate, 'override');
  // <calculate> can contain a <script> child with the actual calculation expression
  const scriptEl = getChild(calculate, 'script');
  const scriptContent = textContent(scriptEl);
  const contentType = attr(scriptEl, 'contentType');
  const runAt = attr(scriptEl, 'runAt');
  const script = scriptContent
    ? { content: scriptContent, contentType: (contentType?.toLowerCase().includes('javascript') ? 'javascript' : 'formcalc') as 'formcalc' | 'javascript', runAt: runAt ?? undefined }
    : undefined;
  return { override: override ?? undefined, script };
}

function parseValidate(validate: unknown): { script?: { content: string; contentType: 'formcalc' | 'javascript'; runAt?: string } } | undefined {
  if (!validate) return undefined;
  const scriptEl = getChild(validate, 'script');
  const scriptContent = textContent(scriptEl);
  const contentType = attr(scriptEl, 'contentType');
  const runAt = attr(scriptEl, 'runAt');
  const script = scriptContent
    ? { content: scriptContent, contentType: (contentType?.toLowerCase().includes('javascript') ? 'javascript' : 'formcalc') as 'formcalc' | 'javascript', runAt: runAt ?? undefined }
    : undefined;
  return { script };
}

function parseDefaultValue(valueEl: unknown): unknown {
  if (!valueEl) return undefined;
  // <value> can contain <text>, <image>, or <boolean>, <integer>, <float>, <date>, <time>, <dateTime>, <decimal>
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

function parseUi(ui: unknown): UiSpec | undefined {
  if (!ui) return undefined;
  // fast-xml-parser yields `''` for a self-closing element, so test for key
  // *presence* rather than truthiness (`<ui><signature/></ui>`).
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

/** XFA `<items>` may hold `<text>` plus any scalar value element. */
const CHOICE_ITEM_SCALARS = new Set([
  'text', 'integer', 'float', 'decimal', 'boolean', 'dateTime', 'date', 'time', 'null', 'base64Binary',
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
          // Scalar item types display their canonical string form.
          result.push({ text: content || String(value), value: String(value) });
        }
      }
    }
  }
  return result;
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
  // If no <config> section exists, still provide default Designer.xci font equate rules.
  // This matches Adobe LiveCycle Designer behavior where Designer.xci is always loaded
  // as the base configuration, even when the XDP doesn't embed its own <config>.
  if (!config) {
    return {
      fontEquateRules: [...DEFAULT_FONT_EQUATE_RULES],
    };
  }
  const present = getChild(config, 'present');
  const pdf = getChild(present, 'pdf');
  const psMap = getChild(config, 'psMap');
  const fontEntries = toArray<unknown>(getChild(psMap, 'font'));

  // Parse font equate rules from <present><pdf><fontInfo><map><equate> (from XCI reference)
  const fontEquateRules = parseFontEquateRules(pdf);

  // Merge with defaults: XDP-specific rules take precedence, defaults fill in gaps
  const mergedRules = fontEquateRules.length > 0
    ? mergeFontEquateRules(fontEquateRules, DEFAULT_FONT_EQUATE_RULES)
    : [...DEFAULT_FONT_EQUATE_RULES];

  return {
    pdfVersion: textContent(getChild(pdf, 'version')),
    adobeExtensionLevel: parseInt(textContent(getChild(pdf, 'adobeExtensionLevel')) ?? '0', 10),
    fonts: fontEntries.map((f) => ({
      typeface: attr(f, 'typeface') ?? '',
      psName: attr(f, 'psName') ?? '',
      weight: attr(f, 'weight'),
    })),
    fontEquateRules: mergedRules,
  };
}

function parseFontEquateRules(pdf: unknown): FontEquateRule[] {
  if (!pdf) return [];
  const fontInfo = getChild(pdf, 'fontInfo');
  if (!fontInfo) return [];
  const map = getChild(fontInfo, 'map');
  if (!map) return [];
  const equates = toArray<unknown>(getChild(map, 'equate'));
  return equates
    .map((eq) => {
      const from = attr(eq, 'from');
      const to = attr(eq, 'to');
      if (!from || !to) return null;
      return {
        from,
        to,
        force: attr(eq, 'force') === '1',
      };
    })
    .filter(Boolean) as FontEquateRule[];
}

/**
 * Merge XDP-specific font equate rules with defaults.
 * Rules from the XDP take precedence; defaults fill in for
 * 'from' patterns not covered by the XDP rules.
 */
function mergeFontEquateRules(xdpRules: FontEquateRule[], defaultRules: FontEquateRule[]): FontEquateRule[] {
  const merged = [...xdpRules];
  const xdpFromPatterns = new Set(xdpRules.map((r) => r.from.toLowerCase()));
  for (const defaultRule of defaultRules) {
    if (!xdpFromPatterns.has(defaultRule.from.toLowerCase())) {
      merged.push(defaultRule);
    }
  }
  return merged;
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

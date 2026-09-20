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
  BorderSpec,
  EdgeSpec,
  RgbColor,
  ChoiceListItem,
} from '../../types';
import { success, failure } from '../../lib/result-type';
import { parseXml, getChild, toArray, attr, textContent } from '../../lib/xml-utils';
import { toPointsOrZero, stockSizePoints } from '../../lib/unit-converter';
import { ERROR_CODES } from '../../errors/error-codes';

/**
 * Default font equate rules from Adobe LiveCycle Designer 11.0's Designer.xci.
 * These are applied as fallbacks when the XDP's <config> section does not
 * specify its own font substitution rules. Matches the reference behavior
 * where Designer.xci is always loaded as the base configuration.
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
];

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
  const exclGroups = toArray<unknown>(getChild(parent, 'exclGroup'));

  subforms.forEach((s) => nodes.push(parseSubform(s)));
  fields.forEach((f) => nodes.push(parseField(f)));
  draws.forEach((d) => nodes.push(parseDraw(d)));
  exclGroups.forEach((eg) => nodes.push(parseExclGroup(eg)));

  return nodes;
}

function parseSubform(subform: unknown): SubformNode {
  const bind = parseBind(getChild(subform, 'bind'));
  const occur = parseOccur(getChild(subform, 'occur'));
  const colWidths = parseColumnWidths(attr(subform, 'columnWidths'));
  const relevant = attr(subform, 'relevant');

  return {
    type: 'subform',
    name: attr(subform, 'name'),
    // XFA default is absolute "position" layout when unspecified — only tb/lr/table/row opt into flow.
    layout: (attr(subform, 'layout') as SubformNode['layout']) ?? 'position',
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    occur,
    columnWidths: colWidths,
    children: parseChildren(subform),
    locale: attr(subform, 'locale'),
    presence: (attr(subform, 'presence') as PresenceValue) ?? 'visible',
    margin: parseMargin(getChild(subform, 'margin')),
    border: parseBorder(getChild(subform, 'border')),
    position: parsePosition(subform),
    events: parseEvents(getChild(subform, 'event')),
    relevant: relevant ?? undefined,
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
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    formatPicture: bind?.picture,
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

function parseExclGroup(eg: unknown): ExclGroupNode {
  const bind = parseBind(getChild(eg, 'bind'));
  const fields = toArray<unknown>(getChild(eg, 'field')).map(parseField);
  return {
    type: 'exclGroup',
    name: attr(eg, 'name'),
    bindMatch: bind?.match,
    bindRef: bind?.ref,
    children: fields,
    position: parsePosition(eg),
    presence: (attr(eg, 'presence') as PresenceValue) ?? 'visible',
    border: parseBorder(getChild(eg, 'border')),
    margin: parseMargin(getChild(eg, 'margin')),
  };
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
    border: parseBorder(getChild(draw, 'border')),
    events: parseEvents(getChild(draw, 'event')),
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
  const edgeEls = toArray<unknown>(getChild(el, 'edge'));
  const edges: EdgeSpec[] = edgeEls.map((edge) => ({
    presence: attr(edge, 'presence'),
    thickness: attr(edge, 'thickness') ? toPointsOrZero(attr(edge, 'thickness')) : undefined,
    color: parseColor(getChild(edge, 'color')),
    style: attr(edge, 'stroke'),
  }));
  const fillEl = getChild(el, 'fill');
  const fill = fillEl
    ? { presence: attr(fillEl, 'presence'), color: parseColor(getChild(fillEl, 'color')) }
    : undefined;
  const cornerEl = getChild(el, 'corner');
  const cornerRadius = cornerEl && attr(cornerEl, 'radius') ? toPointsOrZero(attr(cornerEl, 'radius')) : undefined;

  if (edges.length === 0 && !fill && cornerRadius == null) return undefined;
  return { presence: attr(el, 'presence'), edges: edges.length > 0 ? edges : undefined, fill, cornerRadius };
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
    rotate: attr(el, 'rotate') ? parseFloat(attr(el, 'rotate')!) : undefined,
  };
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
  return { vAlign: attr(para, 'vAlign'), hAlign: attr(para, 'hAlign') };
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
  if (getChild(ui, 'textEdit')) {
    const te = getChild(ui, 'textEdit');
    return {
      type: 'textEdit',
      multiLine: attr(te, 'multiLine') === '1',
      allowRichText: attr(te, 'allowRichText') === '1',
      hAlign: attr(te, 'hAlign'),
      vAlign: attr(te, 'vAlign'),
    };
  }
  if (getChild(ui, 'numericEdit')) {
    const ne = getChild(ui, 'numericEdit');
    return {
      type: 'numericEdit',
      hAlign: attr(ne, 'hAlign'),
      vAlign: attr(ne, 'vAlign'),
    };
  }
  if (getChild(ui, 'dateTimeEdit')) {
    const dte = getChild(ui, 'dateTimeEdit');
    return {
      type: 'dateTimeEdit',
      hAlign: attr(dte, 'hAlign'),
      vAlign: attr(dte, 'vAlign'),
    };
  }
  if (getChild(ui, 'imageEdit')) return { type: 'imageEdit' };
  if (getChild(ui, 'checkButton')) {
    const cb = getChild(ui, 'checkButton');
    return {
      type: 'checkButton',
      checkedValue: textContent(getChild(cb, 'checkedValue')) ?? '1',
      uncheckedValue: textContent(getChild(cb, 'uncheckedValue')) ?? '0',
      mark: attr(cb, 'mark'),
    };
  }
  if (getChild(ui, 'choiceList')) {
    const cl = getChild(ui, 'choiceList');
    const items = parseChoiceListItems(cl);
    return {
      type: 'choiceList',
      items,
      open: attr(cl, 'open'),
      textEnclosure: attr(cl, 'textEnclosure'),
    };
  }
  if (getChild(ui, 'barcode')) {
    const bc = getChild(ui, 'barcode');
    return {
      type: 'barcode',
      encodeHint: attr(bc, 'encodeHint'),
      charEncoding: attr(bc, 'charEncoding'),
    };
  }
  if (getChild(ui, 'button')) return { type: 'button' };
  if (getChild(ui, 'signature')) return { type: 'signature' };
  return { type: 'unknown' };
}

function parseChoiceListItems(cl: unknown): ChoiceListItem[] {
  const itemsEls = toArray<unknown>(getChild(cl, 'items'));
  const result: ChoiceListItem[] = [];
  for (const itemsEl of itemsEls) {
    const texts = toArray<unknown>(getChild(itemsEl, 'text'));
    for (const t of texts) {
      const text = textContent(t);
      if (text) result.push({ text });
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

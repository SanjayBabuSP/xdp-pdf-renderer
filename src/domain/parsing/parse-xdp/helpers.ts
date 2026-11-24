import type {
  AssistSpec,
  BindSpec,
  BorderSpec,
  BreakValue,
  CaptionSpec,
  EdgeSpec,
  EventSpec,
  ExtrasSpec,
  FontSpec,
  KeepSpec,
  MarginSpec,
  OccurSpec,
  ParaSpec,
  Position,
  RgbColor,
  TraversalSpec,
} from '../../../types';
import {
  getChild,
  toArray,
  attr,
  textContent,
  serializeHtmlFragment,
  extractRichTextContent,
} from '../../../lib/xml-utils';
import { toPointsOrZero } from '../../../lib/unit-converter';
import { parseOpacityValue } from '../../../lib/opacity';

export function parseBind(bind: unknown): BindSpec | undefined {
  if (!bind) return undefined;
  const match = (attr(bind, 'match') ?? 'dataRef') as BindSpec['match'];
  const ref = attr(bind, 'ref');
  const picture = textContent(getChild(bind, 'picture'));
  return { match, ref, picture };
}

export function parseOccur(occur: unknown): OccurSpec | undefined {
  if (!occur) return undefined;
  const maxStr = attr(occur, 'max');
  const max = maxStr === '-1' || maxStr === 'unbounded' ? -1 : parseInt(maxStr ?? '1', 10);
  const min = parseInt(attr(occur, 'min') ?? '0', 10);
  return { min, max };
}

export function parseFont(font: unknown): FontSpec | undefined {
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

export function parsePosition(el: unknown): Position {
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
    anchorType: attr(el, 'anchorType') ?? undefined,
  };
}

const BREAK_VALUES = ['contentArea', 'pageArea', 'pageEven', 'pageFront', 'pageOdd'] as const;
const BREAK_VALUE_SET: ReadonlySet<string> = new Set(BREAK_VALUES);

export function parseBreaks(el: unknown): {
  breakBefore?: BreakValue;
  breakAfter?: BreakValue;
  keep?: KeepSpec;
} {
  const parseBreak = (v: string | undefined): BreakValue | undefined => {
    if (!v || v === 'auto') return undefined;
    return BREAK_VALUE_SET.has(v) ? (v as BreakValue) : undefined;
  };
  const out: { breakBefore?: BreakValue; breakAfter?: BreakValue; keep?: KeepSpec } = {};
  const bb = parseBreak(attr(el, 'breakBefore'));
  const ba = parseBreak(attr(el, 'breakAfter'));
  if (bb) out.breakBefore = bb;
  if (ba) out.breakAfter = ba;

  for (const [tag, key] of [
    ['breakBefore', 'breakBefore'],
    ['breakAfter', 'breakAfter'],
  ] as const) {
    if (out[key]) continue;
    const breakEl = getChild(el, tag);
    if (breakEl == null || typeof breakEl !== 'object') continue;
    const startNew = attr(breakEl, 'startNew');
    if (startNew === '0' || startNew === 'false') continue;
    const target = parseBreak(attr(breakEl, 'targetType'));
    if (target) out[key] = target;
  }

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
    if (Object.keys(keep).length) out.keep = keep;
  }
  return out;
}

export function parseCaption(caption: unknown, richHtml?: string): CaptionSpec | undefined {
  if (!caption) return undefined;
  const reserve = attr(caption, 'reserve') ? toPointsOrZero(attr(caption, 'reserve')) : undefined;
  const placement = attr(caption, 'placement') as CaptionSpec['placement'] | undefined;
  const valueEl = getChild(caption, 'value');
  let text = textContent(getChild(valueEl, 'text'));
  if (text == null) {
    text = extractRichTextContent(getChild(valueEl, 'exData')) ?? undefined;
  }
  const font = parseFont(getChild(caption, 'font'));
  const para = parsePara(getChild(caption, 'para'));
  let html = richHtml;
  if (!html) {
    const ex = getChild(valueEl, 'exData');
    if (ex) html = serializeHtmlFragment(ex) || undefined;
  }
  return { reserve, placement, text, font, richHtml: html, para };
}

export function parsePara(para: unknown): ParaSpec | undefined {
  if (!para) return undefined;
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

function paraPoints(para: unknown, name: string): number | undefined {
  const raw = attr(para, name);
  if (raw == null || raw.trim() === '') return undefined;
  const pt = toPointsOrZero(raw);
  return pt || undefined;
}

export function parseEvents(eventEl: unknown): EventSpec[] | undefined {
  const events = toArray<unknown>(eventEl);
  if (events.length === 0) return undefined;
  return events.map((e) => {
    const scriptEls = toArray<unknown>(getChild(e, 'script'));
    const firstScript = scriptEls[0];
    const scriptContent = textContent(firstScript) ?? textContent(getChild(e, 'script'));

    const contentType = attr(firstScript, 'contentType');
    const runAt = attr(firstScript, 'runAt');

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

function normalizeEventActivity(activity?: string, name?: string): string | undefined {
  if (activity) {
    const lower = activity.toLowerCase();
    const activityMap: Record<string, string> = {
      initialize: 'initialize',
      calculate: 'calculate',
      validate: 'validate',
      click: 'click',
      change: 'change',
      enter: 'enter',
      exit: 'exit',
      mouseenter: 'mouseEnter',
      mouseexit: 'mouseExit',
      ready: 'ready',
      docready: 'docReady',
      docclose: 'docClose',
      presave: 'preSave',
      postsave: 'postSave',
      preprint: 'prePrint',
      postprint: 'postPrint',
      presubmit: 'preSubmit',
      postsubmit: 'postSubmit',
      preexecute: 'preExecute',
      postexecute: 'postExecute',
      presign: 'preSign',
      postsign: 'postSign',
      full: 'full',
      indexchange: 'indexChange',
      mouseup: 'mouseUp',
      mousedown: 'mouseDown',
      preopen: 'preOpen',
      postopen: 'postOpen',
      preclose: 'preClose',
      postclose: 'postClose',
      validationstate: 'validationState',
      overlay: 'overlay',
      'form:ready': 'ready',
      'layout:ready': 'layout:ready',
    };
    return activityMap[lower] ?? lower;
  }

  if (name) {
    const sapMatch = name.match(/^event__(.+)$/);
    if (sapMatch) return sapMatch[1].toLowerCase();
    return name;
  }

  return undefined;
}

export function parseMargin(margin: unknown): MarginSpec | undefined {
  if (!margin) return undefined;
  return {
    topInset: attr(margin, 'topInset') ? toPointsOrZero(attr(margin, 'topInset')) : undefined,
    bottomInset: attr(margin, 'bottomInset')
      ? toPointsOrZero(attr(margin, 'bottomInset'))
      : undefined,
    leftInset: attr(margin, 'leftInset') ? toPointsOrZero(attr(margin, 'leftInset')) : undefined,
    rightInset: attr(margin, 'rightInset') ? toPointsOrZero(attr(margin, 'rightInset')) : undefined,
  };
}

export function parseAssist(el: unknown): AssistSpec | undefined {
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
  return Object.keys(spec).length ? spec : undefined;
}

export function parseExtras(el: unknown): ExtrasSpec | undefined {
  const extras = getChild(el, 'extras');
  if (extras == null || typeof extras !== 'object') return undefined;
  const out: ExtrasSpec = {};
  for (const [name, raw] of Object.entries(extras as Record<string, unknown>)) {
    if (name === '#text' || name === '__cdata' || name === '__comment') continue;
    for (const child of toArray<unknown>(raw)) {
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
  return Object.keys(out).length ? out : undefined;
}

export function parseTraversal(el: unknown): TraversalSpec | undefined {
  const traversal = getChild(el, 'traversal');
  if (!traversal) return undefined;
  const spec: TraversalSpec = {};
  const order = attr(traversal, 'order');
  if (order) spec.order = order;
  const fields = toArray<unknown>(getChild(traversal, 'field'))
    .map((f) => attr(f, 'name'))
    .filter((n): n is string => !!n);
  if (fields.length) spec.fields = fields;
  return Object.keys(spec).length ? spec : undefined;
}

function parseColor(colorEl: unknown): RgbColor | undefined {
  const raw = attr(colorEl, 'value');
  if (!raw) return undefined;
  const parts = raw.split(',').map((p) => parseInt(p.trim(), 10));
  if (parts.length < 3 || parts.some(isNaN)) return undefined;
  return { r: parts[0], g: parts[1], b: parts[2] };
}

function parseColorString(raw: string): RgbColor | undefined {
  const parts = raw.split(',').map((s) => parseInt(s.trim(), 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return { r: parts[0], g: parts[1], b: parts[2] };
  }
  return undefined;
}

function parseFillOpacity(fillEl: unknown): number | undefined {
  const child = getChild(fillEl, 'opacity');
  const fromChild = child ? (attr(child, 'value') ?? textContent(child)) : undefined;
  return parseOpacityValue(attr(fillEl, 'opacity') ?? fromChild);
}

function parseFillColor2(fillEl: unknown): RgbColor | undefined {
  const linearEl = getChild(fillEl, 'linear');
  if (linearEl) {
    const c = attr(linearEl, 'color');
    if (c) return parseColorString(c);
  }
  const colorEls = toArray<unknown>(getChild(fillEl, 'color'));
  if (colorEls.length >= 2) return parseColor(colorEls[1]);
  return undefined;
}

function parseEdgeOpacity(edge: unknown): number | undefined {
  const child = getChild(edge, 'opacity');
  const fromChild = child ? (attr(child, 'value') ?? textContent(child)) : undefined;
  return parseOpacityValue(attr(edge, 'opacity') ?? fromChild);
}

export function parseBorder(el: unknown): BorderSpec | undefined {
  if (!el) return undefined;
  const scope = getChild(el, 'border') ?? el;
  const edgeEls = toArray<unknown>(getChild(scope, 'edge'));
  const edges: EdgeSpec[] = [];
  edgeEls.forEach((edge, i) => {
    const parsed: EdgeSpec = {
      presence: attr(edge, 'presence'),
      thickness: attr(edge, 'thickness') ? toPointsOrZero(attr(edge, 'thickness')) : undefined,
      color: parseColor(getChild(edge, 'color')),
      style: attr(edge, 'stroke'),
      opacity: parseEdgeOpacity(edge),
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
        color2: parseFillColor2(fillEl),
      }
    : undefined;
  const scopeCorners = toArray<unknown>(getChild(scope, 'corner'));
  const cornerEls =
    scope !== el ? [...scopeCorners, ...toArray<unknown>(getChild(el, 'corner'))] : scopeCorners;
  const cornerSlots: Array<number | undefined> = [];
  cornerEls.forEach((corner, i) => {
    const presence = attr(corner, 'presence');
    const radiusRaw = attr(corner, 'radius');
    const radius = radiusRaw ? toPointsOrZero(radiusRaw) : undefined;
    const value =
      presence === 'hidden' || presence === 'invisible' || presence === 'inactive'
        ? undefined
        : radius;
    const indexRaw = attr(corner, 'index');
    const index = indexRaw != null ? Number.parseInt(indexRaw, 10) : i;
    if (Number.isInteger(index) && index >= 0 && index <= 3) cornerSlots[index] = value;
    else cornerSlots.push(value);
  });
  const multiCornerSet = cornerEls.length > 1;
  const loneIndexed = cornerEls.length === 1 && attr(cornerEls[0], 'index') != null;
  const loneUnindexedStamp = cornerEls.length === 1 && !loneIndexed;
  const cornerRadii =
    (multiCornerSet || loneIndexed) && cornerSlots.some((v) => v != null && v > 0)
      ? cornerSlots
      : undefined;
  const firstCorner = cornerEls[0];
  const cornerRadius =
    !loneUnindexedStamp && firstCorner && attr(firstCorner, 'radius')
      ? toPointsOrZero(attr(firstCorner, 'radius'))
      : undefined;

  if (compacted.length === 0 && !fill && cornerRadius == null && cornerRadii == null)
    return undefined;
  return {
    presence: attr(scope, 'presence') ?? attr(el, 'presence'),
    edges: compacted.length ? edges : undefined,
    fill,
    cornerRadius,
    cornerRadii,
  };
}

export function isEffectivelyHiddenBorder(border: BorderSpec | undefined): boolean {
  if (!border) return true;
  if (
    border.presence === 'hidden' ||
    border.presence === 'invisible' ||
    border.presence === 'inactive'
  )
    return true;
  const edges = border.edges ?? [];
  const visibleEdge = edges.some(
    (e) => e && e.presence !== 'hidden' && e.presence !== 'invisible' && e.style !== 'none'
  );
  const visibleFill =
    !!border.fill?.color &&
    border.fill.presence !== 'hidden' &&
    border.fill.presence !== 'invisible';
  if (!visibleEdge && !visibleFill) return true;
  return false;
}

import { XfaNode, ScriptableNode } from './script-types';
import { FieldAccessor } from './formcalc/evaluator';
import { formatValue } from '../../lib/value-format';
import type { RgbColor } from '../../types';

export const STYLE_ATTRS = ['fillColor', 'fontColor', 'borderColor', 'bgColor'] as const;
export type StyleAttr = (typeof STYLE_ATTRS)[number];

export function isStyleAttr(name: string): name is StyleAttr {
  return (STYLE_ATTRS as readonly string[]).includes(name);
}

export function parseStyleColor(raw: unknown): RgbColor | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-fA-F]{6}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return undefined;
  }
  const parts = s.split(',').map((p) => Number(p.trim()));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    const [r, g, b] = parts.map((n) => Math.max(0, Math.min(255, Math.round(n))));
    return { r: r as number, g: g as number, b: b as number };
  }
  return undefined;
}

export function styleColorToString(c: RgbColor | undefined): string | undefined {
  if (!c) return undefined;
  return `${c.r},${c.g},${c.b}`;
}

export function readLayoutColors(layoutNode: unknown): {
  fillColor?: string;
  fontColor?: string;
  borderColor?: string;
} {
  const ln = layoutNode as
    | {
        font?: { color?: RgbColor };
        border?: { fill?: { color?: RgbColor }; edges?: Array<{ color?: RgbColor }> };
      }
    | undefined;
  if (!ln) return {};
  const out: { fillColor?: string; fontColor?: string; borderColor?: string } = {};
  const fill = ln.border?.fill?.color ? styleColorToString(ln.border.fill.color) : undefined;
  if (fill) out.fillColor = fill;
  const font = ln.font?.color ? styleColorToString(ln.font.color) : undefined;
  if (font) out.fontColor = font;
  const edge = ln.border?.edges?.find((e) => e?.color)?.color;
  const edgeStr = edge ? styleColorToString(edge) : undefined;
  if (edgeStr) out.borderColor = edgeStr;
  return out;
}

export function writeLayoutColor(layoutNode: unknown, attr: StyleAttr, value: unknown): void {
  const color = parseStyleColor(value);
  if (!color) return;
  const ln = layoutNode as unknown as Record<string, unknown>;
  if (!ln || typeof ln !== 'object') return;
  const key = attr === 'bgColor' ? 'fillColor' : attr;
  if (key === 'fontColor') {
    const font = (ln.font as Record<string, unknown> | undefined) ?? {};
    font.color = color;
    ln.font = font;
    return;
  }
  if (key === 'fillColor') {
    const border = (ln.border as Record<string, unknown> | undefined) ?? {};
    const fill = (border.fill as Record<string, unknown> | undefined) ?? {};
    fill.color = color;
    if (fill.presence === 'hidden' || fill.presence === 'invisible') delete fill.presence;
    border.fill = fill;
    ln.border = border;
    return;
  }
  const border = (ln.border as Record<string, unknown> | undefined) ?? {};
  const edges = border.edges as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(edges) && edges.length) {
    for (const e of edges) {
      if (e && typeof e === 'object') {
        e.color = color;
        if (e.presence === 'hidden' || e.presence === 'invisible') delete e.presence;
      }
    }
  } else {
    border.edges = [{ color }];
  }
  ln.border = border;
}

const NODE_ATTRS = ['presence', 'access', 'rotate', 'x', 'y', 'w', 'h', 'name'] as const;

function splitNodeAttribute(path: string): {
  base: string;
  attribute?: (typeof NODE_ATTRS)[number];
} {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return { base: path };
  const attr = path.slice(dot + 1);
  if ((NODE_ATTRS as readonly string[]).includes(attr)) {
    return { base: path.slice(0, dot), attribute: attr as (typeof NODE_ATTRS)[number] };
  }
  return { base: path };
}

function readCompoundAttribute(node: ScriptableNode, path: string): unknown | undefined {
  if (!path) return undefined;
  const layout = node.layoutNode as
    { assist?: Record<string, string | undefined>; extras?: Record<string, string> } | undefined;
  if (path === 'assist') return layout?.assist;
  if (path === 'extras') return layout?.extras;
  if (path.startsWith('assist.')) {
    const assist = layout?.assist;
    if (!assist) return undefined;
    return assist[path.slice('assist.'.length)];
  }
  if (path.startsWith('extras.')) {
    const extras = layout?.extras;
    if (!extras) return undefined;
    return extras[path.slice('extras.'.length)];
  }
  return undefined;
}

function isCompoundAttribute(path: string): boolean {
  return path.startsWith('assist') || path.startsWith('extras');
}

const VALUE_PROPERTIES = ['rawValue', 'formattedValue'] as const;
type ValueProperty = (typeof VALUE_PROPERTIES)[number];

function normalizeSomPath(path: string): string {
  if (path.startsWith('$$')) return path.slice(2);
  if (path.startsWith('$')) return path.slice(1);
  return path;
}

function splitValueProperty(path: string): { base: string; property?: ValueProperty } {
  for (const property of VALUE_PROPERTIES) {
    if (path === property) return { base: '', property };
    if (path.endsWith(`.${property}`)) {
      return { base: path.slice(0, -(property.length + 1)), property };
    }
  }
  return { base: path };
}

export function createFieldAccessor(
  allNodes: Map<string, ScriptableNode>,
  data: Record<string, unknown>
): FieldAccessor {
  let currentKey: string | null = null;

  const currentNode = (): ScriptableNode | undefined =>
    currentKey != null ? allNodes.get(currentKey) : undefined;

  const readValue = (node: ScriptableNode): unknown => {
    if (node.resolvedValue !== undefined) return node.resolvedValue;
    if (node.path) {
      const fromData = resolvePathFromData(node.path, data);
      if (fromData !== undefined) return fromData;
    }
    return undefined;
  };

  const rawOf = (node: ScriptableNode | undefined): string | null => {
    if (!node) return null;
    const v = readValue(node);
    return v == null ? '' : String(v);
  };

  const formattedOf = (node: ScriptableNode | undefined): string => {
    if (!node) return '';
    const v = readValue(node);
    if (v == null) return '';
    return formatValue(v, node.formatPicture);
  };

  const resolveScoped = (ref: string): ScriptableNode | undefined => {
    const segments = ref.split('.');
    let scope: ScriptableNode | undefined = currentNode();
    while (scope) {
      const current: ScriptableNode | undefined =
        scope.name === segments[0]
          ? scope
          : (scope.children ?? []).find((child) => child.name === segments[0]);
      if (current) {
        let ok = true;
        let cursor: ScriptableNode = current;
        for (let i = 1; i < segments.length; i++) {
          const next: ScriptableNode | undefined = (cursor.children ?? []).find(
            (child) => child.name === segments[i]
          );
          if (!next) {
            ok = false;
            break;
          }
          cursor = next;
        }
        if (ok) return cursor;
        if (ok) return current;
      }
      scope = scope.parent;
    }

    if (ref) {
      const candidate = allNodes.get(ref);
      if (candidate) return candidate;
    }
    let best: ScriptableNode | undefined;
    let bestLength = Infinity;
    for (const [path, candidate] of allNodes) {
      if (path === ref || path.endsWith(`.${ref}`)) {
        if (path.length < bestLength) {
          best = candidate;
          bestLength = path.length;
        }
      }
    }
    return best;
  };

  const resolveNodeRef = (ref: string): ScriptableNode | undefined => {
    if (!ref) return currentNode();
    if (ref.startsWith('.')) {
      const rest = ref.slice(1);
      const self = currentNode();
      if (!self) return undefined;
      const prop = splitValueProperty(rest);
      if (prop.property) return self;
      if (prop.base && !prop.base.includes('.')) {
        return self.path ? allNodes.get(`${self.path}.${prop.base}`) : undefined;
      }
      return self.path ? allNodes.get(`${self.path}.${rest}`) : undefined;
    }
    return resolveScoped(ref) ?? allNodes.get(ref);
  };

  const readAttribute = (self: ScriptableNode, name: string): unknown => {
    if (isStyleAttr(name)) {
      const key = name === 'bgColor' ? 'fillColor' : name;
      const cached = (self as unknown as Record<string, unknown>)[key];
      if (typeof cached === 'string') return cached;
      const fromLayout = readLayoutColors(self.layoutNode)[
        key as 'fillColor' | 'fontColor' | 'borderColor'
      ];
      return fromLayout ?? null;
    }
    switch (name) {
      case 'presence':
        return self.presence ?? 'visible';
      case 'access':
        return self.access ?? 'open';
      case 'name':
        return self.name ?? '';
      case 'id':
        return self.uid ?? '';
      case 'x':
      case 'y':
      case 'w':
      case 'h':
      case 'rotate':
        return self.position?.[name] ?? null;
      case 'value':
        return readValue(self);
      default:
        return undefined;
    }
  };

  const assignValue = (node: ScriptableNode | undefined, value: unknown): void => {
    if (!node) return;
    node.resolvedValue = value;
    const ln = node.layoutNode as Record<string, unknown> | undefined;
    if (ln) ln.resolvedValue = value;
  };

  const writeAttribute = (self: ScriptableNode, name: string, value: unknown): void => {
    const layout = self.layoutNode as Record<string, unknown> | undefined;
    if (name.startsWith('assist.') || name.startsWith('extras.')) {
      if (!layout) return;
      const dot = name.indexOf('.');
      const head = name.slice(0, dot);
      const key = name.slice(dot + 1);
      const bag = layout[head];
      if (bag && typeof bag === 'object') {
        (bag as Record<string, unknown>)[key] = String(value);
      } else if (head === 'assist' || head === 'extras') {
        layout[head] = { [key]: String(value) };
      }
      return;
    }
    if (isStyleAttr(name)) {
      const key = name === 'bgColor' ? 'fillColor' : name;
      const str = String(value);
      (self as unknown as Record<string, unknown>)[key] = str;
      if (key === 'borderColor') (self as unknown as Record<string, unknown>).borderColor = str;
      if (layout) writeLayoutColor(layout, name, value);
      return;
    }
    switch (name) {
      case 'presence':
        self.presence = String(value);
        if (layout) layout.presence = String(value);
        return;
      case 'access':
        self.access = String(value);
        if (layout) layout.access = String(value);
        return;
      case 'name':
        self.name = String(value);
        if (layout) layout.name = String(value);
        return;
      case 'rotate':
      case 'x':
      case 'y':
      case 'w':
      case 'h': {
        const num = Number(value);
        const next = Number.isFinite(num) ? num : 0;
        const layoutNode = self.layoutNode as
          { position?: Record<string, number | undefined> } | undefined;
        const position =
          layoutNode && 'position' in layoutNode
            ? (layoutNode.position ?? (layoutNode.position = {}))
            : (self.position as Record<string, number | undefined> | undefined);
        if (position) position[name] = next;
        if (self.position && self.position !== position) {
          (self.position as Record<string, number | undefined>)[name] = next;
        } else if (!self.position && position) {
          self.position = position as ScriptableNode['position'];
        }
        return;
      }
      default:
        assignValue(self, value);
    }
  };

  const resolveCompound = (path: string): unknown | undefined => {
    const self = currentNode();
    if (self) {
      const direct = readCompoundAttribute(self, path);
      if (direct !== undefined) return direct;
    }
    const parts = path.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
      const owner = allNodes.get(parts.slice(0, i).join('.'));
      if (!owner) continue;
      const value = readCompoundAttribute(owner, parts.slice(i).join('.'));
      if (value !== undefined) return value;
    }
    return undefined;
  };

  const accessor: FieldAccessor & {
    setCurrentKey(key: string | null): void;
    getCurrentKey(): string | null;
  } = {
    getField(rawPath: string): unknown {
      const path = normalizeSomPath(rawPath);
      const { base, property } = splitValueProperty(path);

      if (path === '' || path === '$' || path.startsWith('.')) {
        const self = currentNode();
        if (!self) return null;
        if (path === '' || path === '$') return readValue(self) ?? null;
        const rest = path.slice(1);
        const prop = splitValueProperty(rest);
        if (prop.property === 'rawValue') return rawOf(self);
        if (prop.property === 'formattedValue') return formattedOf(self);
        if (prop.base.includes('.')) {
          const child = self.path ? allNodes.get(`${self.path}.${prop.base}`) : undefined;
          if (child) return readValue(child) ?? null;
          const compound = readCompoundAttribute(self, prop.base);
          if (compound !== undefined) return compound;
          return resolvePathFromData(rest, data);
        }
        if (prop.base) {
          const child = self.path ? allNodes.get(`${self.path}.${prop.base}`) : undefined;
          if (child) return readValue(child) ?? null;
          const attr = readAttribute(self, prop.base);
          if (attr !== undefined) return attr;
          const compound = readCompoundAttribute(self, prop.base);
          if (compound !== undefined) return compound;
          return resolvePathFromData(rest, data);
        }
        return readValue(self) ?? null;
      }

      if (property === 'rawValue') {
        const owner = resolveNodeRef(base);
        if (owner) return rawOf(owner);
        const fromData = resolvePathFromData(base, data);
        return fromData == null ? null : String(fromData);
      }
      if (property === 'formattedValue') {
        const owner = resolveNodeRef(base);
        if (owner) return formattedOf(owner);
        const fromData = resolvePathFromData(base, data);
        if (fromData == null) return '';
        return formatValue(fromData);
      }

      const withAttr = splitNodeAttribute(path);
      if (withAttr.attribute) {
        const owner = resolveScoped(withAttr.base) ?? allNodes.get(withAttr.base);
        if (owner) {
          const attr = readAttribute(owner, withAttr.attribute);
          if (attr !== undefined) return attr;
        }
      }

      const node = resolveScoped(path) ?? allNodes.get(path);
      if (node) {
        const value = readValue(node);
        if (value !== undefined) return value;
      }
      const compound = resolveCompound(path);
      if (compound !== undefined) return compound;
      return resolvePathFromData(path, data);
    },

    setField(rawPath: string, _prefix: '$' | '$$', value: unknown): void {
      const path = normalizeSomPath(rawPath);
      const { base, property } = splitValueProperty(path);

      if (path === '' || path === '$' || path.startsWith('.')) {
        const self = currentNode();
        if (!self) return;
        if (path === '' || path === '$') {
          assignValue(self, value);
          return;
        }
        const rest = path.slice(1);
        const prop = splitValueProperty(rest);
        if (prop.property) {
          assignValue(self, value);
          return;
        }
        if (prop.base && !prop.base.includes('.')) {
          const child = self.path ? allNodes.get(`${self.path}.${prop.base}`) : undefined;
          if (child) {
            assignValue(child, value);
            return;
          }
          writeAttribute(self, prop.base, value);
          return;
        }
        if (isCompoundAttribute(prop.base)) {
          writeAttribute(self, prop.base, value);
          return;
        }
        const child = self.path ? allNodes.get(`${self.path}.${rest}`) : undefined;
        assignValue(child, value);
        return;
      }

      if (!property) {
        const withAttr = splitNodeAttribute(path);
        if (withAttr.attribute) {
          const owner = resolveScoped(withAttr.base) ?? allNodes.get(withAttr.base);
          if (owner) {
            writeAttribute(owner, withAttr.attribute, value);
            return;
          }
        }
      }

      const target = property ? resolveNodeRef(base) : resolveNodeRef(path);
      if (target) {
        assignValue(target, value);
        return;
      }
      setPathInData(property ? base : path, data, value);
    },

    hasField(rawPath: string): boolean {
      const path = normalizeSomPath(rawPath);
      if (path === '' || path.startsWith('.')) return currentNode() !== undefined;
      return allNodes.has(path) || resolveScoped(path) !== undefined;
    },

    getCurrentNode(): XfaNode | null {
      const node = currentNode();
      return node ? scriptableToXfaNode(node, node.path ?? node.key ?? '') : null;
    },

    getFormData(): unknown {
      return data;
    },

    setCurrentKey(key: string | null): void {
      currentKey = key;
    },

    getCurrentKey(): string | null {
      return currentKey;
    },
  };

  return accessor;
}

export function buildNodeMap(
  nodes: ScriptableNode[],
  parentPath = ''
): Map<string, ScriptableNode> {
  const map = new Map<string, ScriptableNode>();

  for (const node of nodes) {
    const name = node.name ?? '<unnamed>';
    const somPath = parentPath ? `${parentPath}.${name}` : name;

    map.set(somPath, node);

    if (node.children) {
      const childMap = buildNodeMap(node.children, somPath);
      for (const [key, val] of childMap) {
        map.set(key, val);
      }
    }
  }

  return map;
}

export interface ScriptEntry {
  elementPath: string;
  element: ScriptableNode;
  eventName: string;
  scriptContent: string;
  language: 'formcalc' | 'javascript';
  runAt?: string;
  ref?: string;
}

export function collectScripts(nodes: ScriptableNode[], parentPath = ''): ScriptEntry[] {
  const entries: ScriptEntry[] = [];

  for (const node of nodes) {
    const name = node.name ?? '<unnamed>';
    const somPath = parentPath ? `${parentPath}.${name}` : name;

    if (node.events) {
      for (const event of node.events) {
        if (event.script) {
          entries.push({
            elementPath: somPath,
            element: node,
            eventName: event.name ?? 'unknown',
            scriptContent: event.script,
            language: detectLanguage(event.contentType),
            runAt: event.runAt,
            ref: event.ref,
          });
        }
      }
    }

    if (node.calculate?.script) {
      entries.push({
        elementPath: somPath,
        element: node,
        eventName: 'calculate',
        scriptContent: node.calculate.script.content,
        language: node.calculate.script.contentType,
        runAt: node.calculate.script.runAt,
      });
    }

    if (node.children) {
      entries.push(...collectScripts(node.children, somPath));
    }
  }

  return entries;
}

function detectLanguage(contentType?: string): 'formcalc' | 'javascript' {
  if (!contentType) return 'formcalc';
  const lower = contentType.toLowerCase();
  if (lower.includes('javascript') || lower.includes('ecmascript')) return 'javascript';
  return 'formcalc';
}

function stripRecordPrefix(path: string): { isRecord: boolean; rest: string } {
  const prefixes = [
    'xfa.datasets.data.',
    'xfa.datasets.',
    'xfa.record.',
    'xfa.form.record.',
    'record.',
    '$record.',
  ];
  for (const p of prefixes) {
    if (path === p.slice(0, -1)) return { isRecord: true, rest: '' };
    if (path.startsWith(p)) return { isRecord: true, rest: path.slice(p.length) };
  }
  if (path === 'xfa.record' || path === 'xfa') return { isRecord: true, rest: '' };
  return { isRecord: false, rest: path };
}

function parseDataSegment(seg: string): { name: string; index?: number; wildcard?: boolean } {
  const m = seg.match(/^([^[]+)\[([^\]]*)\]$/);
  if (!m) return { name: seg };
  const name = m[1];
  const inside = m[2].trim();
  if (inside === '*') return { name, wildcard: true };
  const n = Number(inside);
  if (Number.isInteger(n) && n >= 0) return { name, index: n };
  return { name };
}

function childAtData(container: unknown, key: string): unknown {
  if (container == null) return undefined;
  if (Array.isArray(container)) {
    const n = Number(key);
    if (Number.isInteger(n)) return container[n];
    for (const item of container) {
      const found = childAtData(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof container === 'object') {
    return (container as Record<string, unknown>)[key];
  }
  return undefined;
}

export function resolveRecordValue(rawPath: string, data: Record<string, unknown>): unknown {
  const { isRecord, rest: afterPrefix } = stripRecordPrefix(rawPath);
  let path = isRecord ? afterPrefix : rawPath;
  if (!path) return data;
  let wantScalar = false;
  if (/(^|\.)value$/.test(path)) {
    wantScalar = true;
    path = path.replace(/(^|\.)value$/, '');
    if (!path) return data;
  }
  const parts = path.split('.').filter((p) => p.length);
  let current: unknown = data;
  for (const seg of parts) {
    if (current == null) return undefined;
    const { name, index, wildcard } = parseDataSegment(seg);
    if (wildcard) {
      current = childAtData(current, name);
      continue;
    }
    let next = childAtData(current, name);
    if (next === undefined) return undefined;
    if (index !== undefined) {
      if (Array.isArray(next)) next = next[index];
      else return undefined;
      if (next === undefined) return undefined;
    }
    current = next;
  }
  if (wantScalar && current != null && typeof current === 'object') {
    if (Array.isArray(current))
      return current.map((v) => (typeof v === 'object' ? '' : String(v))).join('');
    return '';
  }
  return current;
}

function resolvePathFromData(path: string, data: Record<string, unknown>): unknown {
  const viaRecord = resolveRecordValue(path, data);
  if (viaRecord !== undefined) return viaRecord;
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setPathInData(path: string, data: Record<string, unknown>, value: unknown): void {
  const { isRecord, rest } = stripRecordPrefix(path);
  let clean = isRecord ? rest : path;
  clean = clean.replace(/(^|\.)value$/, '');
  if (!clean) return;
  const parts = clean.split('.').filter((p) => p.length);
  let current: unknown = data;
  for (let i = 0; i < parts.length - 1; i++) {
    const { name, index } = parseDataSegment(parts[i]);
    if (typeof current !== 'object' || current == null) return;
    const container = current as Record<string, unknown>;
    if (index !== undefined) {
      let arr = container[name];
      if (!Array.isArray(arr)) {
        arr = [];
        container[name] = arr;
      }
      while ((arr as unknown[]).length <= index) (arr as unknown[]).push({});
      if (typeof (arr as unknown[])[index] !== 'object' || (arr as unknown[])[index] == null) {
        (arr as unknown[])[index] = {};
      }
      current = (arr as unknown[])[index];
    } else {
      if (container[name] == null || typeof container[name] !== 'object') {
        const next = parseDataSegment(parts[i + 1]);
        container[name] = next.index !== undefined ? [] : {};
      }
      current = container[name];
    }
  }
  const last = parseDataSegment(parts[parts.length - 1]);
  if (typeof current !== 'object' || current == null) return;
  const container = current as Record<string, unknown>;
  if (last.index !== undefined) {
    let arr = container[last.name];
    if (!Array.isArray(arr)) {
      arr = [];
      container[last.name] = arr;
    }
    (arr as unknown[])[last.index] = value;
  } else {
    container[last.name] = value;
  }
}

export function scriptableToXfaNode(node: ScriptableNode, path: string): XfaNode {
  return {
    name: node.name ?? path.split('.').pop() ?? '<unnamed>',
    type: node.type,
    value: node.resolvedValue ?? null,
    rawValue: node.resolvedValue != null ? String(node.resolvedValue) : null,
    presence: node.presence ?? 'visible',
    access: node.access ?? 'open',
    mandatory: 'optional',
    relevant: '',
    boundNode: null,
    children: (node.children ?? []).map((child, idx) =>
      scriptableToXfaNode(child, `${path}.${child.name ?? idx}`)
    ),
    parent: null,
    x: node.position?.x,
    y: node.position?.y,
    w: node.position?.w,
    h: node.position?.h,
    repeating: false,
    index: 1,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// XFA Object Model — Bridges the layout tree to the script execution engines
// ────────────────────────────────────────────────────────────────────────────

import { XfaNode, XfaEventObject, ScriptableNode } from './script-types';
import { FieldAccessor } from './formcalc/evaluator';
import { formatValue } from '../../lib/value-format';

/**
 * Node-level attributes addressed as `<node>.<attr>` (e.g. `txtWatermark.rotate`,
 * `Field.presence`). They live on the node, not on a child element — resolving
 * them as a child path would silently write into the bound data instead.
 */
const NODE_ATTRS = ['presence', 'access', 'rotate', 'x', 'y', 'w', 'h', 'name'] as const;

function splitNodeAttribute(path: string): { base: string; attribute?: (typeof NODE_ATTRS)[number] } {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return { base: path };
  const attr = path.slice(dot + 1);
  if ((NODE_ATTRS as readonly string[]).includes(attr)) {
    return { base: path.slice(0, dot), attribute: attr as (typeof NODE_ATTRS)[number] };
  }
  return { base: path };
}

/**
 * Property suffixes FormCalc/XFA expose on nodes rather than child elements.
 * `node.rawValue` / `node.formattedValue` must resolve the *node* first and
 * then format it — never be looked up as a child named "rawValue".
 */
const VALUE_PROPERTIES = ['rawValue', 'formattedValue'] as const;
type ValueProperty = (typeof VALUE_PROPERTIES)[number];

/**
 * FormCalc hands the accessor paths like `$.rawValue` / `$$foo.bar`: `$` is
 * lexed as an ordinary identifier, so the prefix survives into `FieldRef.path`.
 * Strip it so everything downstream sees a plain SOM path.
 */
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

/**
 * Creates a FieldAccessor that bridges XFA SOM paths to the layout tree.
 * This is how scripts access field values: $field.rawValue, $form.table.col, etc.
 *
 * Resolution order for a read:
 *   1. `$` / `.rest` — the node whose script is currently executing
 *   2. `x.rawValue` / `x.formattedValue` — resolve `x` first, then format
 *   3. exact SOM path in the node map
 *   4. scoped resolution walking up from the current node (FormCalc SOM
 *      scoping: sibling references like `OEM.TechnicalSalesDocumentation_OEM`
 *      are relative to the scripting object's ancestors)
 *   5. the bound data record (empty elements resolve to '' — never a throw)
 */
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

  /** Walk up from the current node trying `ancestor.path + '.' + ref`. */
  const resolveScoped = (ref: string): ScriptableNode | undefined => {
    let node = currentNode();
    while (node) {
      if (node.path) {
        const candidate = allNodes.get(`${node.path}.${ref}`);
        if (candidate) return candidate;
      }
      node = node.parent;
    }
    return allNodes.get(ref);
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
    return allNodes.get(ref) ?? resolveScoped(ref);
  };

  /** Attribute reads on the scripting object itself (`$.presence`, `$.x` …). */
  const readAttribute = (self: ScriptableNode, name: string): unknown => {
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

  /** Write a value onto a scripting node *and* its concrete layout node. */
  const assignValue = (node: ScriptableNode | undefined, value: unknown): void => {
    if (!node) return;
    node.resolvedValue = value;
    const ln = node.layoutNode as Record<string, unknown> | undefined;
    if (ln) ln.resolvedValue = value;
  };

  const writeAttribute = (self: ScriptableNode, name: string, value: unknown): void => {
    // Mirror onto the concrete layout node as well: the scriptable is the
    // mutation surface, `layoutNode` is what the renderer reads.
    const layout = self.layoutNode as Record<string, unknown> | undefined;
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
          | { position?: Record<string, number | undefined> }
          | undefined;
        const position =
          layoutNode && 'position' in layoutNode
            ? layoutNode.position ?? (layoutNode.position = {})
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

  const accessor: FieldAccessor & { setCurrentKey(key: string | null): void; getCurrentKey(): string | null } = {
    getField(rawPath: string): unknown {
      const path = normalizeSomPath(rawPath);
      const { base, property } = splitValueProperty(path);

      // `$` alone and relative `.rest` — the scripting object itself
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
          return resolvePathFromData(rest, data);
        }
        if (prop.base) {
          const child = self.path ? allNodes.get(`${self.path}.${prop.base}`) : undefined;
          if (child) return readValue(child) ?? null;
          const attr = readAttribute(self, prop.base);
          return attr === undefined ? resolvePathFromData(rest, data) : attr;
        }
        return readValue(self) ?? null;
      }

      // `.rawValue` / `.formattedValue`: resolve the owner as a template node
      // first, then fall back to the bound data — designers write both
      // `SomeField.rawValue` and `record.path.rawValue`, and an unqualified
      // sibling reference normally addresses the *data* instance.
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
        const owner = allNodes.get(withAttr.base) ?? resolveScoped(withAttr.base);
        if (owner) {
          const attr = readAttribute(owner, withAttr.attribute);
          if (attr !== undefined) return attr;
        }
      }

      const node = allNodes.get(path) ?? resolveScoped(path);
      if (node) {
        const value = readValue(node);
        if (value !== undefined) return value;
      }
      return resolvePathFromData(path, data);
    },

    setField(rawPath: string, _prefix: '$' | '$$', value: unknown): void {
      const path = normalizeSomPath(rawPath);
      const { base, property } = splitValueProperty(path);

      // `$` alone and relative `.rest` — write to the scripting object itself
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
        const child = self.path ? allNodes.get(`${self.path}.${rest}`) : undefined;
        assignValue(child, value);
        return;
      }

      if (!property) {
        const withAttr = splitNodeAttribute(path);
        if (withAttr.attribute) {
          const owner = allNodes.get(withAttr.base) ?? resolveScoped(withAttr.base);
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

/**
 * Build a flat map of all scriptable nodes by their SOM path.
 * This allows O(1) lookup during script execution.
 */
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

/**
 * Collect all scripts from the layout tree, organized by event name and element.
 */
export interface ScriptEntry {
  /** The SOM path of the element that owns this script */
  elementPath: string;
  /** The element node */
  element: ScriptableNode;
  /** The event name */
  eventName: string;
  /** The script content */
  scriptContent: string;
  /** The script language */
  language: 'formcalc' | 'javascript';
  /** When to run */
  runAt?: string;
  /**
   * The event's ref target ($form, $layout, $host, $).
   * evidence: createEventNode(name, activity, parent, ref) writes ref on every
   * default event node — xfatemplate_disasm.c:32238-32264 ("OnFormReady"/ready/$form,
   * "OnFormClosing"/docClose/$host). The renderer matches activity=ready +
   * ref="$layout" (renderer_disasm.c:35574-35578).
   */
  ref?: string;
}

export function collectScripts(
  nodes: ScriptableNode[],
  parentPath = ''
): ScriptEntry[] {
  const entries: ScriptEntry[] = [];

  for (const node of nodes) {
    const name = node.name ?? '<unnamed>';
    const somPath = parentPath ? `${parentPath}.${name}` : name;

    // Collect event scripts
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

    // Collect calculate scripts
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

    // Recurse into children
    if (node.children) {
      entries.push(...collectScripts(node.children, somPath));
    }
  }

  return entries;
}

function detectLanguage(contentType?: string): 'formcalc' | 'javascript' {
  if (!contentType) return 'formcalc'; // FormCalc is the default in XFA
  const lower = contentType.toLowerCase();
  if (lower.includes('javascript') || lower.includes('ecmascript')) return 'javascript';
  return 'formcalc';
}

function resolvePathFromData(path: string, data: Record<string, unknown>): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setPathInData(path: string, data: Record<string, unknown>, value: unknown): void {
  const parts = path.split('.');
  let current: Record<string, unknown> = data;
  for (let i = 0; i < parts.length - 1; i++) {
    if (current[parts[i]] == null || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Create an XfaNode from a ScriptableNode for script execution context.
 */
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

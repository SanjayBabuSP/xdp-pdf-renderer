
import { ScriptableNode, XfaNode } from '../script-types';
import { LayoutNode } from '../../../types';
import { isStyleAttr, writeLayoutColor, type StyleAttr } from '../xfa-object-model';

export const XFA_NODE_KEY = Symbol('xfa.node.key');

export interface ProxyHooks {
  addInstance(parentPath: string): string | null;
  removeInstance(parentPath: string, index: number): void;
  setInstances(parentPath: string, count: number): void;
  moveInstance(parentPath: string, from: number, to: number): void;
}

let activeHooks: ProxyHooks | undefined;

export function setActiveProxyHooks(hooks: ProxyHooks | undefined): void {
  activeHooks = hooks;
}

export function createXfaFormProxy(
  nodeMap: Map<string, ScriptableNode>,
  currentPath: string,
  modifiedFields: string[],
  parentProxy?: Record<string, unknown>
): Record<string, unknown> {
  const node = nodeMap.get(currentPath);

  const target: Record<string, unknown> = {};

  return new Proxy(target, {
    get(_target, prop) {
      if (typeof prop === 'symbol') {
        if (prop === XFA_NODE_KEY) {
          return currentPath;
        }
        if (prop === Symbol.toPrimitive) {
          return () => node?.resolvedValue ?? '';
        }
        if (prop === Symbol.toStringTag) {
          return 'XfaFormNode';
        }
        return undefined;
      }

      const propName = String(prop);

      switch (propName) {
        case 'rawValue':
          return node?.resolvedValue != null ? String(node.resolvedValue) : null;

        case 'value':
          return node?.resolvedValue ?? null;

        case 'presence':
          return node?.presence ?? 'visible';

        case 'access':
          return node?.access ?? 'open';

        case 'name':
          return node?.name ?? currentPath.split('.').pop() ?? '';

        case 'className':
          return node?.type ?? 'unknown';

        case 'type':
          return node?.type ?? 'unknown';

        case 'x':
        case 'y':
        case 'w':
        case 'h':
        case 'rotate':
          return getNodeAttribute(node, propName);

        case 'fillColor':
        case 'fontColor':
        case 'borderColor':
        case 'bgColor':
          return getNodeAttribute(node, propName);

        case 'somExpression':
          return currentPath;

        case 'index':
          return 0;

        case 'parent':
          if (parentProxy) return parentProxy;
          const lastDot = currentPath.lastIndexOf('.');
          if (lastDot >= 0) {
            const parentPath = currentPath.substring(0, lastDot);
            return createXfaFormProxy(nodeMap, parentPath, modifiedFields);
          }
          return null;

        case 'x':
          return node?.position?.x ?? 0;
        case 'y':
          return node?.position?.y ?? 0;
        case 'w':
          return node?.position?.w ?? 0;
        case 'h':
          return node?.position?.h ?? 0;

        case 'resolveNode':
          return (somExpr: string) => {
            return resolveSomFromProxy(nodeMap, somExpr, currentPath, modifiedFields);
          };

        case 'resolveNodes':
          return (somExpr: string) => {
            return resolveAllFromProxy(nodeMap, somExpr, currentPath, modifiedFields);
          };

        case 'getValue':
          return () => node?.resolvedValue ?? null;

        case 'setValue':
          return (val: unknown) => {
            if (node) {
              node.resolvedValue = val;
              modifiedFields.push(currentPath);
            }
          };

        case 'getRawValue':
          return () => node?.resolvedValue != null ? String(node.resolvedValue) : null;

        case 'setRawValue':
          return (val: string) => {
            if (node) {
              node.resolvedValue = val;
              modifiedFields.push(currentPath);
            }
          };

        case 'isNull':
          return () => node?.resolvedValue == null;

        case 'isHidden':
          return () => node?.presence === 'hidden' || node?.presence === 'invisible';

        case 'isVisible':
          return () => node?.presence === 'visible' || node?.presence === undefined;

        case 'getAttribute':
          return (attrName: string) => {
            return getNodeAttribute(node, attrName);
          };

        case 'setAttribute':
          return (attrName: string, val: unknown) => {
            setNodeAttribute(node, attrName, val, currentPath, modifiedFields);
          };

        case 'equals':
          return (other: unknown) => {
            if (other && typeof other === 'object' && 'rawValue' in other) {
              return node?.resolvedValue === (other as Record<string, unknown>).rawValue;
            }
            return node?.resolvedValue === other;
          };

        case 'instanceManager':
          return createInstanceManagerProxy(nodeMap, currentPath, modifiedFields);

        case 'count': {
          const children = getChildPaths(nodeMap, currentPath);
          return children.length;
        }

        case 'length': {
          const children = getChildPaths(nodeMap, currentPath);
          return children.length;
        }

        case 'all': {
          const children = getChildPaths(nodeMap, currentPath);
          return children.map((cp) =>
            createXfaFormProxy(nodeMap, cp, modifiedFields, createXfaFormProxy(nodeMap, currentPath, modifiedFields))
          );
        }

        case 'nodes': {
          const children = getChildPaths(nodeMap, currentPath);
          return {
            length: children.length,
            item: (idx: number) => {
              if (idx >= 0 && idx < children.length) {
                return createXfaFormProxy(nodeMap, children[idx], modifiedFields);
              }
              return null;
            },
          };
        }

        default: {
          const numIdx = parseInt(propName, 10);
          if (!isNaN(numIdx)) {
            const children = getChildPaths(nodeMap, currentPath);
            if (numIdx >= 0 && numIdx < children.length) {
              return createXfaFormProxy(nodeMap, children[numIdx], modifiedFields);
            }
            return null;
          }

          if (propName === 'assist' || propName === 'extras') {
            const ownPath = currentPath ? `${currentPath}.${propName}` : propName;
            if (!nodeMap.has(ownPath)) {
              const layout = node?.layoutNode as
                | { assist?: Record<string, unknown>; extras?: Record<string, unknown> }
                | undefined;
              const bag = layout?.[propName];
              if (bag) return bag;
              if (propName === 'extras') return {};
            }
          }

          const childPath = currentPath ? `${currentPath}.${propName}` : propName;
          if (nodeMap.has(childPath)) {
            return createXfaFormProxy(
              nodeMap,
              childPath,
              modifiedFields,
              createXfaFormProxy(nodeMap, currentPath, modifiedFields)
            );
          }

          const children = getChildPaths(nodeMap, currentPath);
          const matching = children.filter((cp) => {
            const name = cp.substring(cp.lastIndexOf('.') + 1);
            return name === propName;
          });

          if (matching.length === 1) {
            return createXfaFormProxy(
              nodeMap,
              matching[0],
              modifiedFields,
              createXfaFormProxy(nodeMap, currentPath, modifiedFields)
            );
          }

          if (matching.length > 1) {
            return createXfaFormProxy(
              nodeMap,
              matching[0],
              modifiedFields,
              createXfaFormProxy(nodeMap, currentPath, modifiedFields)
            );
          }

          return createNullSafeProxy();
        }
      }
    },

    set(_target, prop, val) {
      if (typeof prop !== 'string') return true;

      switch (prop) {
        case 'rawValue':
        case 'value':
        case 'presence':
        case 'access':
          if (node) {
            setNodeAttributeBase(node, prop, val);
            mirrorToLayout(node, prop, val);
            modifiedFields.push(currentPath);
          }
          return true;

        default:
          if (!node) return true;
          if (isGeometryAttr(prop)) {
            setGeometryAttr(node, prop, val);
            modifiedFields.push(currentPath);
            return true;
          }
          setNodeAttribute(node, prop, val, currentPath, modifiedFields);
          return true;
      }
    },
  });
}

function resolveSomFromProxy(
  nodeMap: Map<string, ScriptableNode>,
  somExpr: string,
  contextPath: string,
  modifiedFields: string[]
): Record<string, unknown> | null {
  let resolvedPath: string | null = null;

  if (somExpr.startsWith('$.') || somExpr.startsWith('this.')) {
    const rest = somExpr.startsWith('$.') ? somExpr.substring(2) : somExpr.substring(5);
    resolvedPath = contextPath ? `${contextPath}.${rest}` : rest;
  } else if (somExpr.startsWith('$$.')) {
    const subformPath = findContainingSubform(nodeMap, contextPath);
    const rest = somExpr.substring(3);
    resolvedPath = subformPath ? `${subformPath}.${rest}` : rest;
  } else if (somExpr.startsWith('xfa.form.') || somExpr.startsWith('$form.')) {
    const rest = somExpr.startsWith('xfa.form.') ? somExpr.substring(9) : somExpr.substring(6);
    resolvedPath = rest;
  } else {
    resolvedPath = resolveScoped(nodeMap, somExpr, contextPath);
  }

  if (resolvedPath && nodeMap.has(resolvedPath)) {
    return createXfaFormProxy(nodeMap, resolvedPath, modifiedFields);
  }

  return null;
}

function resolveAllFromProxy(
  nodeMap: Map<string, ScriptableNode>,
  somExpr: string,
  contextPath: string,
  modifiedFields: string[]
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];

  if (somExpr.includes('[*]')) {
    const basePath = somExpr.replace(/\[\*\]/g, '');
    for (const [path] of nodeMap) {
      if (pathMatchesPattern(path, basePath)) {
        results.push(createXfaFormProxy(nodeMap, path, modifiedFields));
      }
    }
    return results;
  }

  const single = resolveSomFromProxy(nodeMap, somExpr, contextPath, modifiedFields);
  if (single) results.push(single);
  return results;
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  const patternParts = pattern.split('.');
  const pathParts = path.split('.');

  if (pathParts.length < patternParts.length) return false;

  for (let i = 0; i < patternParts.length; i++) {
    const offset = pathParts.length - patternParts.length + i;
    if (pathParts[offset] !== patternParts[i]) return false;
  }
  return true;
}

function resolveScoped(
  nodeMap: Map<string, ScriptableNode>,
  path: string,
  contextPath: string
): string | null {
  const parts = contextPath.split('.');
  for (let i = parts.length; i >= 0; i--) {
    const base = parts.slice(0, i).join('.');
    const candidate = base ? `${base}.${path}` : path;
    if (nodeMap.has(candidate)) return candidate;
  }
  return null;
}

function findContainingSubform(
  nodeMap: Map<string, ScriptableNode>,
  path: string
): string | null {
  const parts = path.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(0, i).join('.');
    const node = nodeMap.get(candidate);
    if (node && node.type === 'subform') return candidate;
  }
  return null;
}

function createInstanceManagerProxy(
  nodeMap: Map<string, ScriptableNode>,
  currentPath: string,
  modifiedFields: string[]
): Record<string, unknown> {
  return {
    get count() {
      return getChildPaths(nodeMap, currentPath).length;
    },
    addInstance: (_merge?: boolean) => {
      const path = activeHooks?.addInstance(currentPath);
      if (!path) return null;
      return createXfaFormProxy(nodeMap, path, modifiedFields);
    },
    removeInstance: (index: number) => {
      activeHooks?.removeInstance(currentPath, index);
    },
    setInstances: (count: number) => {
      activeHooks?.setInstances(currentPath, count);
    },
    moveInstance: (from: number, to: number) => {
      activeHooks?.moveInstance(currentPath, from, to);
    },
  };
}

function createNullSafeProxy(): Record<string, unknown> {
  return new Proxy({} as Record<string, unknown>, {
    get(_target, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === Symbol.toStringTag) return 'NullXfaNode';
      if (typeof prop === 'string') {
        if (prop === 'isNull') return () => true;
        if (prop === 'isHidden') return () => true;
        if (prop === 'isVisible') return () => false;
        if (prop === 'rawValue' || prop === 'value') return null;
        if (prop === 'presence') return 'hidden';
        if (prop === 'children' || prop === 'all') return [];
        if (prop === 'count' || prop === 'length') return 0;
        if (prop === 'resolveNode') return () => null;
        if (prop === 'resolveNodes') return () => [];
        if (prop === 'getAttribute' || prop === 'setValue'
            || prop === 'setRawValue' || prop === 'setAttribute') return () => {};
        return createNullSafeProxy();
      }
      return undefined;
    },
    set() { return true; },
  });
}

function getChildPaths(nodeMap: Map<string, ScriptableNode>, parentPath: string): string[] {
  const children: string[] = [];
  const prefix = parentPath ? `${parentPath}.` : '';

  for (const [path] of nodeMap) {
    if (path.startsWith(prefix) && path !== parentPath) {
      const rest = path.substring(prefix.length);
      if (!rest.includes('.')) {
        children.push(path);
      }
    }
  }

  return children;
}

const GEOMETRY_ATTRS = new Set(['x', 'y', 'w', 'h', 'rotate']);

export function isGeometryAttr(attrName: string): boolean {
  return GEOMETRY_ATTRS.has(attrName);
}

export function setGeometryAttr(
  node: ScriptableNode | undefined,
  attrName: string,
  val: unknown
): void {
  if (!node || !isGeometryAttr(attrName)) return;
  const num = Number(val);
  const value = Number.isFinite(num) ? num : 0;

  const layoutNode = node.layoutNode as
    | { position?: Record<string, number | undefined> }
    | undefined;
  const position =
    layoutNode && 'position' in layoutNode
      ? layoutNode.position ?? (layoutNode.position = {})
      : (node.position as Record<string, number | undefined> | undefined);

  if (position) position[attrName] = value;
  if (node.position && node.position !== position) {
    (node.position as Record<string, number | undefined>)[attrName] = value;
  } else if (!node.position && position) {
    node.position = position as ScriptableNode['position'];
  }
}

function getNodeAttribute(node: ScriptableNode | undefined, attrName: string): unknown {
  if (!node) return null;
  if (GEOMETRY_ATTRS.has(attrName)) return node.position?.[attrName as 'x'] ?? null;
  if (isStyleAttr(attrName)) {
    const key = attrName === 'bgColor' ? 'fillColor' : attrName;
    const cached = (node as unknown as Record<string, unknown>)[key];
    if (typeof cached === 'string') return cached;
    const layout = node.layoutNode as
      | { font?: { color?: { r: number; g: number; b: number } }; border?: { fill?: { color?: { r: number; g: number; b: number } }; edges?: Array<{ color?: { r: number; g: number; b: number } }> } }
      | undefined;
    if (!layout) return null;
    if (key === 'fontColor') {
      const c = layout.font?.color;
      return c ? `${c.r},${c.g},${c.b}` : null;
    }
    if (key === 'fillColor') {
      const c = layout.border?.fill?.color;
      return c ? `${c.r},${c.g},${c.b}` : null;
    }
    const e = layout.border?.edges?.find((ed) => ed?.color)?.color;
    return e ? `${e.r},${e.g},${e.b}` : null;
  }
  switch (attrName) {
    case 'name': return node.name;
    case 'type': return node.type;
    case 'presence': return node.presence;
    case 'access': return node.access;
    case 'rawValue': return node.resolvedValue != null ? String(node.resolvedValue) : null;
    case 'value': return node.resolvedValue;
    case 'x': return node.position?.x;
    case 'y': return node.position?.y;
    case 'w': return node.position?.w;
    case 'h': return node.position?.h;
    default: return (node as unknown as Record<string, unknown>)[attrName] ?? null;
  }
}

function setNodeAttributeBase(
  node: import('../script-types').ScriptableNode,
  attrName: string,
  val: unknown
): void {
  if (attrName === 'presence') node.presence = val as string;
  else if (attrName === 'access') node.access = val as string;
  else node.resolvedValue = val;
}

function mirrorToLayout(
  node: import('../script-types').ScriptableNode,
  attrName: string,
  val: unknown
): void {
  const layout = node.layoutNode as Record<string, unknown> | undefined;
  if (!layout) return;
  if (attrName === 'rawValue' || attrName === 'value') layout.resolvedValue = val;
  else if (attrName === 'presence') layout.presence = val;
  else if (attrName === 'access') layout.access = val;
  else if (isStyleAttr(attrName)) writeLayoutColor(layout, attrName as StyleAttr, val);
}

function setNodeAttribute(
  node: ScriptableNode | undefined,
  attrName: string,
  val: unknown,
  path: string,
  modifiedFields: string[]
): void {
  if (!node) return;
  if (GEOMETRY_ATTRS.has(attrName)) {
    setGeometryAttr(node, attrName, val);
    modifiedFields.push(path);
    return;
  }
  if (isStyleAttr(attrName)) {
    const key = attrName === 'bgColor' ? 'fillColor' : attrName;
    (node as unknown as Record<string, unknown>)[key] = String(val);
    if (key === 'borderColor') (node as unknown as Record<string, unknown>).borderColor = String(val);
    mirrorToLayout(node, attrName, val);
    modifiedFields.push(path);
    return;
  }
  switch (attrName) {
    case 'presence':
    case 'access':
    case 'rawValue':
    case 'value':
      setNodeAttributeBase(node, attrName, val);
      mirrorToLayout(node, attrName, val);
      break;
    default:
      (node as unknown as Record<string, unknown>)[attrName] = val;
  }
  modifiedFields.push(path);
}

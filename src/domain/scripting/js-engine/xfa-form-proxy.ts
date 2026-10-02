// ────────────────────────────────────────────────────────────────────────────
// XFA Form Proxy — Deep navigation proxy for xfa.form.Path.To.Field access
//
// Reference: ExtendScript.dll + xfaform.dll (script-accessible form model)
// Scripts navigate the form tree via property chains:
//   xfa.form.Page1.Header.CompanyName.rawValue = "ACME"
// Each property access returns another Proxy that resolves the next child.
// ────────────────────────────────────────────────────────────────────────────

import { ScriptableNode, XfaNode } from '../script-types';

// ─── Node Proxy Factory ─────────────────────────────────────────────────

/**
 * Creates a recursive Proxy that wraps a ScriptableNode for deep property access.
 * This is the implementation behind `xfa.form.Path.To.Field.rawValue`.
 *
 * @param nodeMap - Flat map of all nodes by SOM path
 * @param currentPath - SOM path of the current node
 * @param modifiedFields - Array to track which fields were modified by scripts
 * @param parentProxy - Parent proxy reference (for $.parent)
 */
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
        if (prop === Symbol.toPrimitive) {
          return () => node?.resolvedValue ?? '';
        }
        if (prop === Symbol.toStringTag) {
          return 'XfaFormNode';
        }
        return undefined;
      }

      const propName = String(prop);

      // ── Direct node properties ──────────────────────────────────
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

        case 'somExpression':
          return currentPath;

        case 'index':
          return 0; // Default index; overridden for repeating instances

        case 'parent':
          if (parentProxy) return parentProxy;
          // Navigate to parent via path
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

        // ── Methods ──────────────────────────────────────────────

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

        // ── Instance Manager (for repeating subforms) ────────────

        case 'instanceManager':
          return createInstanceManagerProxy(nodeMap, currentPath, modifiedFields);

        // ── Children / Collection Access ─────────────────────────

        case 'count': {
          const children = getChildPaths(nodeMap, currentPath);
          return children.length;
        }

        case 'length': {
          const children = getChildPaths(nodeMap, currentPath);
          return children.length;
        }

        case 'all': {
          // Return all children as an array of proxies
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

        // ── Numeric index access (for array-like repeating nodes) ─
        default: {
          // Try numeric index first
          const numIdx = parseInt(propName, 10);
          if (!isNaN(numIdx)) {
            // Access repeating instance by index
            const children = getChildPaths(nodeMap, currentPath);
            if (numIdx >= 0 && numIdx < children.length) {
              return createXfaFormProxy(nodeMap, children[numIdx], modifiedFields);
            }
            return null;
          }

          // Navigate to child by name
          const childPath = currentPath ? `${currentPath}.${propName}` : propName;
          if (nodeMap.has(childPath)) {
            return createXfaFormProxy(
              nodeMap,
              childPath,
              modifiedFields,
              createXfaFormProxy(nodeMap, currentPath, modifiedFields)
            );
          }

          // Try finding among direct children by name
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
            // Multiple matches: return the first (XFA behavior)
            return createXfaFormProxy(
              nodeMap,
              matching[0],
              modifiedFields,
              createXfaFormProxy(nodeMap, currentPath, modifiedFields)
            );
          }

          // Not found — return a null-safe proxy that won't throw
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
          // Geometry (`x`/`y`/`w`/`h`/`rotate`) lives on `position` — writing it
          // as a plain property on the ScriptableNode would be invisible to
          // the renderer (`txtWatermark.rotate = "30"`).
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

// ─── SOM Resolution from Proxy Context ──────────────────────────────────

function resolveSomFromProxy(
  nodeMap: Map<string, ScriptableNode>,
  somExpr: string,
  contextPath: string,
  modifiedFields: string[]
): Record<string, unknown> | null {
  // Handle $.path
  let resolvedPath: string | null = null;

  if (somExpr.startsWith('$.') || somExpr.startsWith('this.')) {
    const rest = somExpr.startsWith('$.') ? somExpr.substring(2) : somExpr.substring(5);
    resolvedPath = contextPath ? `${contextPath}.${rest}` : rest;
  } else if (somExpr.startsWith('$$.')) {
    // Find containing subform
    const subformPath = findContainingSubform(nodeMap, contextPath);
    const rest = somExpr.substring(3);
    resolvedPath = subformPath ? `${subformPath}.${rest}` : rest;
  } else if (somExpr.startsWith('xfa.form.') || somExpr.startsWith('$form.')) {
    const rest = somExpr.startsWith('xfa.form.') ? somExpr.substring(9) : somExpr.substring(6);
    resolvedPath = rest;
  } else {
    // Scoped resolution: try relative, then global
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

  // For [*] wildcard, find all matching paths
  if (somExpr.includes('[*]')) {
    const basePath = somExpr.replace(/\[\*\]/g, '');
    for (const [path] of nodeMap) {
      if (pathMatchesPattern(path, basePath)) {
        results.push(createXfaFormProxy(nodeMap, path, modifiedFields));
      }
    }
    return results;
  }

  // Try single resolution
  const single = resolveSomFromProxy(nodeMap, somExpr, contextPath, modifiedFields);
  if (single) results.push(single);
  return results;
}

function pathMatchesPattern(path: string, pattern: string): boolean {
  // Simple pattern matching: "Table.Row" matches "Table.Row",
  // "Form.Table.Row.0", "Form.Table.Row.1", etc.
  const patternParts = pattern.split('.');
  const pathParts = path.split('.');

  if (pathParts.length < patternParts.length) return false;

  // Check if the terminal segments match
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
  // Try relative paths, walking up from context
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

// ─── Instance Manager Proxy ─────────────────────────────────────────────

function createInstanceManagerProxy(
  nodeMap: Map<string, ScriptableNode>,
  currentPath: string,
  modifiedFields: string[]
): Record<string, unknown> {
  const children = getChildPaths(nodeMap, currentPath);

  return {
    count: children.length,
    addInstance: (_merge?: boolean) => {
      // In static PDF generation, addInstance is a no-op with a warning
      return null;
    },
    removeInstance: (_index: number) => {
      // In static PDF generation, removeInstance is a no-op
    },
    setInstances: (_count: number) => {
      // In static PDF generation, setInstances is a no-op
    },
    moveInstance: (_from: number, _to: number) => {
      // In static PDF generation, moveInstance is a no-op
    },
  };
}

// ─── Null-Safe Proxy ────────────────────────────────────────────────────

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
        // For any other property, return another null-safe proxy
        // This prevents "cannot read property X of undefined" errors in scripts
        return createNullSafeProxy();
      }
      return undefined;
    },
    set() { return true; },
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────

function getChildPaths(nodeMap: Map<string, ScriptableNode>, parentPath: string): string[] {
  const children: string[] = [];
  const prefix = parentPath ? `${parentPath}.` : '';

  for (const [path] of nodeMap) {
    if (path.startsWith(prefix) && path !== parentPath) {
      // Only direct children (one level deep)
      const rest = path.substring(prefix.length);
      if (!rest.includes('.')) {
        children.push(path);
      }
    }
  }

  return children;
}

/** Geometry attributes that live on `node.position`, not on the node itself. */
const GEOMETRY_ATTRS = new Set(['x', 'y', 'w', 'h', 'rotate']);

export function isGeometryAttr(attrName: string): boolean {
  return GEOMETRY_ATTRS.has(attrName);
}

/**
 * Write a geometry attribute back onto the layout node the scriptable mirrors.
 * Scripts assign these directly (`txtWatermark.rotate = "30"`), so the value
 * must reach `position.rotate` — writing it on the ScriptableNode would be
 * invisible to the renderer.
 */
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
  // Keep the scriptable's view in sync when it does not share the same object.
  if (node.position && node.position !== position) {
    (node.position as Record<string, number | undefined>)[attrName] = value;
  } else if (!node.position && position) {
    node.position = position as ScriptableNode['position'];
  }
}

function getNodeAttribute(node: ScriptableNode | undefined, attrName: string): unknown {
  if (!node) return null;
  if (GEOMETRY_ATTRS.has(attrName)) return node.position?.[attrName as 'x'] ?? null;
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

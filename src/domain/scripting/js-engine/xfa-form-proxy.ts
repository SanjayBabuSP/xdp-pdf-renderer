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
          if (node) {
            node.resolvedValue = val;
            modifiedFields.push(currentPath);
          }
          return true;

        case 'presence':
          if (node) {
            node.presence = val as string;
            modifiedFields.push(currentPath);
          }
          return true;

        case 'access':
          if (node) {
            node.access = val as string;
            modifiedFields.push(currentPath);
          }
          return true;

        default:
          // Try setting on child nodes
          if (node) {
            (node as unknown as Record<string, unknown>)[prop] = val;
          }
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

function getNodeAttribute(node: ScriptableNode | undefined, attrName: string): unknown {
  if (!node) return null;
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

function setNodeAttribute(
  node: ScriptableNode | undefined,
  attrName: string,
  val: unknown,
  path: string,
  modifiedFields: string[]
): void {
  if (!node) return;
  switch (attrName) {
    case 'presence': node.presence = val as string; break;
    case 'access': node.access = val as string; break;
    case 'rawValue':
    case 'value':
      node.resolvedValue = val;
      break;
    default:
      (node as unknown as Record<string, unknown>)[attrName] = val;
  }
  modifiedFields.push(path);
}

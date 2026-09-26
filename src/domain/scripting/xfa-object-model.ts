// ────────────────────────────────────────────────────────────────────────────
// XFA Object Model — Bridges the layout tree to the script execution engines
// ────────────────────────────────────────────────────────────────────────────

import { XfaNode, XfaEventObject, ScriptableNode } from './script-types';
import { FieldAccessor } from './formcalc/evaluator';

/**
 * Creates a FieldAccessor that bridges XFA SOM paths to the layout tree.
 * This is how scripts access field values: $field.rawValue, $form.table.col, etc.
 */
export function createFieldAccessor(
  allNodes: Map<string, ScriptableNode>,
  data: Record<string, unknown>
): FieldAccessor {
  return {
    getField(path: string, prefix: '$' | '$$'): unknown {
      // $$ = form-level reference (absolute path from form root)
      // $ = current node context (relative path)
      const node = allNodes.get(path);
      if (node && node.resolvedValue !== undefined) {
        return node.resolvedValue;
      }
      // Fall back to the data backing store (also covers nodes that have no
      // bound/resolved value yet)
      return resolvePathFromData(path, data);
    },

    setField(path: string, prefix: '$' | '$$', value: unknown): void {
      const node = allNodes.get(path);
      if (node) {
        node.resolvedValue = value;
      }
      // Also update data backing store
      setPathInData(path, data, value);
    },

    hasField(path: string): boolean {
      return allNodes.has(path);
    },

    getCurrentNode(): XfaNode | null {
      return null; // Set by dispatcher per-event
    },

    getFormData(): unknown {
      return data;
    },
  };
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

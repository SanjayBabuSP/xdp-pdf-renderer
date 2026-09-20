// ────────────────────────────────────────────────────────────────────────────
// SOM Expression Resolver — Full XFA Scripting Object Model path resolution
//
// Reference: xfa.dll + xfaform.dll (SOM expression handling)
// SOM paths let scripts navigate the XFA form tree, e.g.:
//   $form.Page1.Header.CompanyName.rawValue
//   $.parent.Amount
//   Table.Row[2].Total
//   $record.COMPANY.NAME
// ────────────────────────────────────────────────────────────────────────────

import { ScriptableNode, XfaNode } from './script-types';

// ─── SOM Resolution Result ───────────────────────────────────────────────

export interface SomResolutionResult {
  /** The resolved node(s). Multiple results for wildcard/predicate queries. */
  nodes: ScriptableNode[];
  /** Whether the resolution was successful */
  found: boolean;
  /** The property name being accessed (e.g., 'rawValue', 'presence') if the terminal segment is a property */
  property?: string;
}

// ─── SOM Segment Types ──────────────────────────────────────────────────

interface SomSegment {
  /** Name of the node/property */
  name: string;
  /** Index predicate: [0], [1], [*] → -1 for all, undefined for none */
  index?: number;
  /** Whether this segment accesses all matching nodes ([*]) */
  wildcard: boolean;
}

// ─── SOM Expression Parser ─────────────────────────────────────────────

/**
 * Parse a SOM expression string into segments.
 * Examples:
 *   "Page1.Header.CompanyName" → [{name:"Page1"}, {name:"Header"}, {name:"CompanyName"}]
 *   "Table.Row[2].Amount" → [{name:"Table"}, {name:"Row", index:2}, {name:"Amount"}]
 *   "Table.Row[*].Amount" → [{name:"Table"}, {name:"Row", wildcard:true}, {name:"Amount"}]
 */
export function parseSomExpression(expression: string): SomSegment[] {
  const segments: SomSegment[] = [];
  const parts = expression.split('.');

  for (const part of parts) {
    const bracketMatch = part.match(/^([^[]+)\[(.+)\]$/);
    if (bracketMatch) {
      const name = bracketMatch[1];
      const indexStr = bracketMatch[2];
      if (indexStr === '*') {
        segments.push({ name, wildcard: true });
      } else {
        const index = parseInt(indexStr, 10);
        segments.push({ name, index: isNaN(index) ? undefined : index, wildcard: false });
      }
    } else {
      segments.push({ name: part, wildcard: false });
    }
  }

  return segments;
}

// ─── Known XFA Properties (not node names) ──────────────────────────────

const XFA_PROPERTIES = new Set([
  'rawValue', 'value', 'presence', 'access', 'mandatory', 'relevant',
  'name', 'type', 'x', 'y', 'w', 'h',
  'className', 'somExpression', 'index', 'parent',
  'count', 'length', 'all', 'nodes',
  'instanceManager',
  'caption', 'border', 'margin', 'font', 'para',
  'fillColor', 'borderColor', 'fontColor',
  'validate', 'calculate', 'format',
  'dataNode', 'boundNode',
]);

// ─── SOM Resolver ───────────────────────────────────────────────────────

export class SomExpressionResolver {
  private nodeMap: Map<string, ScriptableNode>;
  private parentMap: Map<string, string>;
  private childrenMap: Map<string, string[]>;
  private formRootPath: string;
  private dataRoot: Record<string, unknown>;

  constructor(
    nodeMap: Map<string, ScriptableNode>,
    dataRoot: Record<string, unknown> = {},
    formRootPath = ''
  ) {
    this.nodeMap = nodeMap;
    this.dataRoot = dataRoot;
    this.formRootPath = formRootPath;

    // Build parent and children lookup maps from the flat nodeMap
    this.parentMap = new Map();
    this.childrenMap = new Map();

    for (const [path] of nodeMap) {
      const lastDot = path.lastIndexOf('.');
      if (lastDot >= 0) {
        const parentPath = path.substring(0, lastDot);
        this.parentMap.set(path, parentPath);

        if (!this.childrenMap.has(parentPath)) {
          this.childrenMap.set(parentPath, []);
        }
        this.childrenMap.get(parentPath)!.push(path);
      }
    }
  }

  /**
   * Resolve a SOM expression relative to a context node.
   *
   * @param expression - The SOM expression (e.g., "$.parent.Amount", "$form.Page1.Field")
   * @param contextPath - The SOM path of the current node (for $ resolution)
   * @returns Resolution result with matched nodes
   */
  resolve(expression: string, contextPath: string): SomResolutionResult {
    if (!expression || expression.trim() === '') {
      return { nodes: [], found: false };
    }

    const trimmed = expression.trim();

    // ── Handle special prefixes ─────────────────────────────────────
    if (trimmed === '$' || trimmed === 'this') {
      const node = this.nodeMap.get(contextPath);
      return node ? { nodes: [node], found: true } : { nodes: [], found: false };
    }

    if (trimmed.startsWith('$.') || trimmed.startsWith('this.')) {
      const rest = trimmed.startsWith('$.') ? trimmed.substring(2) : trimmed.substring(5);
      return this.resolveRelative(rest, contextPath);
    }

    if (trimmed.startsWith('$$.')) {
      // $$ = containing subform
      const containingSubform = this.findContainingSubform(contextPath);
      if (!containingSubform) return { nodes: [], found: false };
      const rest = trimmed.substring(3);
      return this.resolveRelative(rest, containingSubform);
    }

    if (trimmed === '$$') {
      const containingSubform = this.findContainingSubform(contextPath);
      if (!containingSubform) return { nodes: [], found: false };
      const node = this.nodeMap.get(containingSubform);
      return node ? { nodes: [node], found: true } : { nodes: [], found: false };
    }

    if (trimmed.startsWith('$form.') || trimmed.startsWith('xfa.form.')) {
      const rest = trimmed.startsWith('$form.')
        ? trimmed.substring(6)
        : trimmed.substring(9);
      return this.resolveFromRoot(rest);
    }

    if (trimmed === '$form' || trimmed === 'xfa.form') {
      // Return the form root node
      const rootNode = this.nodeMap.get(this.formRootPath);
      return rootNode ? { nodes: [rootNode], found: true } : { nodes: [], found: false };
    }

    if (trimmed.startsWith('$record.')) {
      const rest = trimmed.substring(8);
      return this.resolveFromData(rest);
    }

    if (trimmed.startsWith('$host') || trimmed.startsWith('$event')
        || trimmed.startsWith('$layout')) {
      // These are special objects handled by the script engines, not the SOM resolver
      return { nodes: [], found: false, property: trimmed };
    }

    // ── Scoped resolution: try relative first, then global ──────────
    // This matches Adobe's scoping: bare names resolve relative to the
    // containing subform first, then walk up to the form root.
    const relativeResult = this.resolveScoped(trimmed, contextPath);
    if (relativeResult.found) return relativeResult;

    // Absolute fallback: try from form root
    return this.resolveFromRoot(trimmed);
  }

  /**
   * Resolve a SOM path relative to a specific node.
   */
  private resolveRelative(path: string, basePath: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    return this.walkSegments(segments, basePath);
  }

  /**
   * Resolve a SOM path from the form root.
   */
  private resolveFromRoot(path: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    // Try from form root path first
    const result = this.walkSegments(segments, this.formRootPath);
    if (result.found) return result;

    // Try from empty root (for top-level nodes)
    return this.walkSegments(segments, '');
  }

  /**
   * Scoped resolution: walk up from context to form root trying to resolve
   * the expression at each level.
   */
  private resolveScoped(path: string, contextPath: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    let current = contextPath;

    while (current !== '') {
      // Try resolving from this scope
      const result = this.walkSegments(segments, current);
      if (result.found) return result;

      // Walk up to parent
      const parentPath = this.parentMap.get(current);
      if (!parentPath && parentPath !== '') break;
      current = parentPath ?? '';
    }

    // Try from the root (empty path)
    return this.walkSegments(segments, '');
  }

  /**
   * Walk SOM segments starting from a base path.
   */
  private walkSegments(segments: SomSegment[], basePath: string): SomResolutionResult {
    if (segments.length === 0) {
      const node = this.nodeMap.get(basePath);
      return node ? { nodes: [node], found: true } : { nodes: [], found: false };
    }

    let currentPaths = [basePath];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      // Check if this is a property access on the final segment
      if (isLast && XFA_PROPERTIES.has(segment.name)) {
        // Return the current nodes with the property name
        const nodes: ScriptableNode[] = [];
        for (const cp of currentPaths) {
          const node = this.nodeMap.get(cp);
          if (node) nodes.push(node);
        }
        return nodes.length > 0
          ? { nodes, found: true, property: segment.name }
          : { nodes: [], found: false };
      }

      // Handle 'parent' navigation
      if (segment.name === 'parent') {
        const nextPaths: string[] = [];
        for (const cp of currentPaths) {
          const parentPath = this.parentMap.get(cp);
          if (parentPath !== undefined) nextPaths.push(parentPath);
        }
        currentPaths = nextPaths;
        if (currentPaths.length === 0) return { nodes: [], found: false };
        continue;
      }

      // Find children matching this segment name
      const nextPaths: string[] = [];

      for (const cp of currentPaths) {
        const children = this.childrenMap.get(cp) ?? [];
        const matching = children.filter((childPath) => {
          const childName = childPath.substring(childPath.lastIndexOf('.') + 1);
          return childName === segment.name;
        });

        if (segment.wildcard) {
          // [*] — all matching children
          nextPaths.push(...matching);
        } else if (segment.index !== undefined) {
          // [n] — specific index (0-based in our model, but XFA uses 0-based too for SOM)
          if (segment.index < matching.length) {
            nextPaths.push(matching[segment.index]);
          }
        } else {
          // No index — first match (or all matches for intermediate segments)
          if (matching.length > 0) {
            nextPaths.push(matching[0]);
          } else {
            // Try direct path construction
            const directPath = cp ? `${cp}.${segment.name}` : segment.name;
            if (this.nodeMap.has(directPath)) {
              nextPaths.push(directPath);
            }
          }
        }
      }

      currentPaths = nextPaths;
      if (currentPaths.length === 0) return { nodes: [], found: false };
    }

    // Collect resolved nodes
    const nodes: ScriptableNode[] = [];
    for (const path of currentPaths) {
      const node = this.nodeMap.get(path);
      if (node) nodes.push(node);
    }

    return nodes.length > 0
      ? { nodes, found: true }
      : { nodes: [], found: false };
  }

  /**
   * Find the containing subform for a given node path.
   */
  private findContainingSubform(path: string): string | null {
    let current = this.parentMap.get(path);
    while (current !== undefined && current !== '') {
      const node = this.nodeMap.get(current);
      if (node && node.type === 'subform') return current;
      current = this.parentMap.get(current);
    }
    return this.formRootPath || null;
  }

  /**
   * Resolve a path from the data model ($record).
   */
  private resolveFromData(path: string): SomResolutionResult {
    const parts = path.split('.');
    let current: unknown = this.dataRoot;

    for (const part of parts) {
      if (current == null || typeof current !== 'object') {
        return { nodes: [], found: false };
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (current === undefined) return { nodes: [], found: false };

    // Wrap data values as pseudo-nodes
    const pseudoNode: ScriptableNode = {
      type: 'data',
      name: parts[parts.length - 1],
      resolvedValue: current,
    };

    return { nodes: [pseudoNode], found: true };
  }

  /**
   * Get all nodes matching a name (for FormCalc aggregate functions).
   */
  resolveAllByName(name: string): ScriptableNode[] {
    const results: ScriptableNode[] = [];
    for (const [path, node] of this.nodeMap) {
      const nodeName = path.substring(path.lastIndexOf('.') + 1);
      if (nodeName === name) results.push(node);
    }
    return results;
  }

  /**
   * Get a node by its exact SOM path.
   */
  getNodeByPath(path: string): ScriptableNode | undefined {
    return this.nodeMap.get(path);
  }

  /**
   * Get the parent path for a given node path.
   */
  getParentPath(path: string): string | undefined {
    return this.parentMap.get(path);
  }

  /**
   * Get all child paths for a given node path.
   */
  getChildPaths(path: string): string[] {
    return this.childrenMap.get(path) ?? [];
  }

  /**
   * Build the full SOM path for a node (for somExpression property).
   */
  getFullSomPath(path: string): string {
    return path;
  }
}

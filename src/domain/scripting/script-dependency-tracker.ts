// ────────────────────────────────────────────────────────────────────────────
// Script Dependency Tracker — Builds a dependency graph for calculate cascading
//
// Reference: xfascripthandler.dll (dependency-aware calculate ordering)
// When Field_A's calculate script reads Field_B.rawValue, and Field_B's
// calculate script modifies itself, Field_A must re-run after Field_B.
// Adobe LiveCycle caps cascading at 25 iterations to prevent infinite loops.
// ────────────────────────────────────────────────────────────────────────────

import { ScriptableNode } from './script-types';
import { ScriptEntry } from './xfa-object-model';

// ─── Dependency Graph ───────────────────────────────────────────────────

export interface FieldDependency {
  /** SOM path of the field that has a calculate script */
  fieldPath: string;
  /** SOM paths of fields this field's script reads from */
  readsFrom: Set<string>;
  /** SOM paths of fields that depend on this field (reverse map) */
  dependents: Set<string>;
}

export interface DependencyGraph {
  /** Map of field path → dependency info */
  dependencies: Map<string, FieldDependency>;
  /** Topologically sorted execution order (leaves first) */
  executionOrder: string[];
  /** Whether cycles were detected */
  hasCycles: boolean;
  /** Paths involved in cycles (for diagnostics) */
  cyclePaths: string[];
}

// ─── Script Reference Extractor ─────────────────────────────────────────

/** Regex patterns to extract field references from scripts */
const FORMCALC_FIELD_REF_PATTERNS = [
  // $ references: $field.path, $$form.path
  /\$\$?\.?([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
  // Bare SOM paths that look like field references (e.g., Table.Row.Amount)
  /\b([A-Z][a-zA-Z_]*(?:\.[A-Z][a-zA-Z_]*)+)/g,
];

const JAVASCRIPT_FIELD_REF_PATTERNS = [
  // xfa.resolveNode("path") or xfa.resolveNode('path')
  /xfa\.resolveNode\s*\(\s*["']([^"']+)["']\s*\)/g,
  // xfa.form.path.to.field
  /xfa\.form\.([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
  // $.path or this.path
  /(?:\$|this)\.([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
  // $$.path (containing subform)
  /\$\$\.([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
];

/**
 * Extract field references from a script body.
 * This is a static analysis (best-effort) — it won't catch dynamic
 * references built at runtime, but handles the vast majority of XFA scripts.
 */
export function extractFieldReferences(
  scriptContent: string,
  language: 'formcalc' | 'javascript'
): Set<string> {
  const refs = new Set<string>();
  const patterns = language === 'formcalc'
    ? FORMCALC_FIELD_REF_PATTERNS
    : JAVASCRIPT_FIELD_REF_PATTERNS;

  for (const pattern of patterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(scriptContent)) !== null) {
      const ref = match[1];
      if (ref && !isKnownBuiltin(ref)) {
        refs.add(ref);
      }
    }
  }

  return refs;
}

/** Filter out known builtins / properties that aren't field references */
function isKnownBuiltin(ref: string): boolean {
  const builtins = new Set([
    'rawValue', 'value', 'presence', 'access', 'mandatory',
    'parent', 'length', 'count', 'all', 'nodes',
    'className', 'somExpression', 'instanceManager',
    'Math', 'Date', 'String', 'Number', 'Boolean',
    'console', 'log', 'warn', 'error',
    'JSON', 'parse', 'stringify',
    'host', 'event', 'layout', 'record',
    'alert', 'messageBox', 'print',
  ]);
  return builtins.has(ref);
}

// ─── Dependency Graph Builder ───────────────────────────────────────────

/**
 * Build the dependency graph from a list of calculate script entries.
 * Analyzes each script's body to determine which fields it reads from,
 * then topologically sorts for optimal execution order.
 */
export function buildDependencyGraph(
  calcScripts: ScriptEntry[],
  allNodes: Map<string, ScriptableNode>
): DependencyGraph {
  const dependencies = new Map<string, FieldDependency>();

  // Step 1: Extract dependencies for each calculate script
  for (const entry of calcScripts) {
    const refs = extractFieldReferences(entry.scriptContent, entry.language);

    // Resolve references to actual node paths
    const resolvedRefs = new Set<string>();
    for (const ref of refs) {
      // Try to match the reference to an actual node in the tree
      const resolved = resolveRefToPath(ref, entry.elementPath, allNodes);
      if (resolved) resolvedRefs.add(resolved);
    }

    dependencies.set(entry.elementPath, {
      fieldPath: entry.elementPath,
      readsFrom: resolvedRefs,
      dependents: new Set(),
    });
  }

  // Step 2: Build reverse dependency map (dependents)
  for (const [path, dep] of dependencies) {
    for (const readFrom of dep.readsFrom) {
      const sourceDep = dependencies.get(readFrom);
      if (sourceDep) {
        sourceDep.dependents.add(path);
      }
    }
  }

  // Step 3: Topological sort (Kahn's algorithm)
  const { order, hasCycles, cyclePaths } = topologicalSort(dependencies);

  return {
    dependencies,
    executionOrder: order,
    hasCycles,
    cyclePaths,
  };
}

/**
 * Try to resolve a reference string to a full SOM path in the node map.
 */
function resolveRefToPath(
  ref: string,
  contextPath: string,
  allNodes: Map<string, ScriptableNode>
): string | null {
  // Direct match
  if (allNodes.has(ref)) return ref;

  // Try relative to context path
  const parts = contextPath.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(0, i).join('.') + (i > 0 ? '.' : '') + ref;
    if (allNodes.has(candidate)) return candidate;
  }

  // Try matching by terminal name (the last segment)
  const terminalName = ref.split('.').pop() ?? ref;
  for (const [path] of allNodes) {
    if (path.endsWith(`.${terminalName}`) || path === terminalName) {
      return path;
    }
  }

  return null;
}

/**
 * Topological sort using Kahn's algorithm.
 * Returns nodes in dependency order (no-dependency nodes first).
 */
function topologicalSort(
  dependencies: Map<string, FieldDependency>
): { order: string[]; hasCycles: boolean; cyclePaths: string[] } {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

  // Initialize
  for (const [path, dep] of dependencies) {
    if (!inDegree.has(path)) inDegree.set(path, 0);
    if (!adjacency.has(path)) adjacency.set(path, new Set());

    for (const readFrom of dep.readsFrom) {
      if (dependencies.has(readFrom)) {
        if (!adjacency.has(readFrom)) adjacency.set(readFrom, new Set());
        adjacency.get(readFrom)!.add(path);
        inDegree.set(path, (inDegree.get(path) ?? 0) + 1);
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [path, degree] of inDegree) {
    if (degree === 0) queue.push(path);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    const neighbors = adjacency.get(current) ?? new Set();
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // Detect cycles: nodes not in the order are part of cycles
  const hasCycles = order.length < dependencies.size;
  const cyclePaths: string[] = [];
  if (hasCycles) {
    for (const [path] of dependencies) {
      if (!order.includes(path)) {
        cyclePaths.push(path);
        // Add cycle members to the end of the order so they still execute
        order.push(path);
      }
    }
  }

  return { order, hasCycles, cyclePaths };
}

// ─── Cascade Executor ───────────────────────────────────────────────────

/** Adobe LiveCycle's maximum cascade depth */
export const ADOBE_MAX_CASCADE_DEPTH = 25;

/**
 * Determine which fields need re-calculation after a field value changes.
 * Returns the list of field paths that depend on the modified field.
 */
export function getFieldsToRecalculate(
  modifiedFieldPath: string,
  graph: DependencyGraph
): string[] {
  const toRecalc: string[] = [];
  const visited = new Set<string>();

  function walk(path: string) {
    if (visited.has(path)) return;
    visited.add(path);

    const dep = graph.dependencies.get(path);
    if (!dep) return;

    for (const dependent of dep.dependents) {
      toRecalc.push(dependent);
      walk(dependent);
    }
  }

  walk(modifiedFieldPath);
  return toRecalc;
}


import { ScriptableNode } from './script-types';
import { ScriptEntry } from './xfa-object-model';

export interface FieldDependency {
  fieldPath: string;
  readsFrom: Set<string>;
  dependents: Set<string>;
}

export interface DependencyGraph {
  dependencies: Map<string, FieldDependency>;
  executionOrder: string[];
  hasCycles: boolean;
  cyclePaths: string[];
}

const FORMCALC_FIELD_REF_PATTERNS = [
  /\$\$?\.?([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
  /\b([A-Z][a-zA-Z_]*(?:\.[A-Z][a-zA-Z_]*)+)/g,
];

const JAVASCRIPT_FIELD_REF_PATTERNS = [
  /xfa\.resolveNode\s*\(\s*["']([^"']+)["']\s*\)/g,
  /xfa\.form\.([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
  /(?:\$|this)\.([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
  /\$\$\.([a-zA-Z_]\w*(?:\.[a-zA-Z_]\w*)*)/g,
];

export function extractFieldReferences(
  scriptContent: string,
  language: 'formcalc' | 'javascript'
): Set<string> {
  const refs = new Set<string>();
  const patterns = language === 'formcalc'
    ? FORMCALC_FIELD_REF_PATTERNS
    : JAVASCRIPT_FIELD_REF_PATTERNS;

  for (const pattern of patterns) {
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

export function buildDependencyGraph(
  calcScripts: ScriptEntry[],
  allNodes: Map<string, ScriptableNode>
): DependencyGraph {
  const dependencies = new Map<string, FieldDependency>();

  for (const entry of calcScripts) {
    const refs = extractFieldReferences(entry.scriptContent, entry.language);

    const resolvedRefs = new Set<string>();
    for (const ref of refs) {
      const resolved = resolveRefToPath(ref, entry.elementPath, allNodes);
      if (resolved) resolvedRefs.add(resolved);
    }

    dependencies.set(entry.elementPath, {
      fieldPath: entry.elementPath,
      readsFrom: resolvedRefs,
      dependents: new Set(),
    });
  }

  for (const [path, dep] of dependencies) {
    for (const readFrom of dep.readsFrom) {
      const sourceDep = dependencies.get(readFrom);
      if (sourceDep) {
        sourceDep.dependents.add(path);
      }
    }
  }

  const { order, hasCycles, cyclePaths } = topologicalSort(dependencies);

  return {
    dependencies,
    executionOrder: order,
    hasCycles,
    cyclePaths,
  };
}

function resolveRefToPath(
  ref: string,
  contextPath: string,
  allNodes: Map<string, ScriptableNode>
): string | null {
  if (allNodes.has(ref)) return ref;

  const parts = contextPath.split('.');
  for (let i = parts.length - 1; i >= 0; i--) {
    const candidate = parts.slice(0, i).join('.') + (i > 0 ? '.' : '') + ref;
    if (allNodes.has(candidate)) return candidate;
  }

  const terminalName = ref.split('.').pop() ?? ref;
  for (const [path] of allNodes) {
    if (path.endsWith(`.${terminalName}`) || path === terminalName) {
      return path;
    }
  }

  return null;
}

function topologicalSort(
  dependencies: Map<string, FieldDependency>
): { order: string[]; hasCycles: boolean; cyclePaths: string[] } {
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, Set<string>>();

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

  const queue: string[] = [];
  for (const [path, degree] of inDegree) {
    if (degree === 0) queue.push(path);
  }

  const order: string[] = [];
  while (queue.length) {
    const current = queue.shift()!;
    order.push(current);

    const neighbors = adjacency.get(current) ?? new Set();
    for (const neighbor of neighbors) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  const hasCycles = order.length < dependencies.size;
  const cyclePaths: string[] = [];
  if (hasCycles) {
    for (const [path] of dependencies) {
      if (!order.includes(path)) {
        cyclePaths.push(path);
        order.push(path);
      }
    }
  }

  return { order, hasCycles, cyclePaths };
}

export const ADOBE_MAX_CASCADE_DEPTH = 25;

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

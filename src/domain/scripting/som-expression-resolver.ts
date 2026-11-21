import { ScriptableNode } from './script-types';

export interface SomResolutionResult {
  nodes: ScriptableNode[];
  found: boolean;
  property?: string;
}

interface SomSegment {
  name: string;
  index?: number;
  wildcard: boolean;
}

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

const XFA_PROPERTIES = new Set([
  'rawValue',
  'value',
  'presence',
  'access',
  'mandatory',
  'relevant',
  'name',
  'type',
  'x',
  'y',
  'w',
  'h',
  'className',
  'somExpression',
  'index',
  'parent',
  'count',
  'length',
  'all',
  'nodes',
  'instanceManager',
  'caption',
  'border',
  'margin',
  'font',
  'para',
  'fillColor',
  'borderColor',
  'fontColor',
  'validate',
  'calculate',
  'format',
  'dataNode',
  'boundNode',
]);

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

  resolve(expression: string, contextPath: string): SomResolutionResult {
    if (!expression || expression.trim() === '') {
      return { nodes: [], found: false };
    }

    const trimmed = expression.trim();

    if (trimmed === '$' || trimmed === 'this') {
      const node = this.nodeMap.get(contextPath);
      return node ? { nodes: [node], found: true } : { nodes: [], found: false };
    }

    if (trimmed.startsWith('$.') || trimmed.startsWith('this.')) {
      const rest = trimmed.startsWith('$.') ? trimmed.substring(2) : trimmed.substring(5);
      return this.resolveRelative(rest, contextPath);
    }

    if (trimmed.startsWith('$$.')) {
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
      const rest = trimmed.startsWith('$form.') ? trimmed.substring(6) : trimmed.substring(9);
      return this.resolveFromRoot(rest);
    }

    if (trimmed === '$form' || trimmed === 'xfa.form') {
      const rootNode = this.nodeMap.get(this.formRootPath);
      return rootNode ? { nodes: [rootNode], found: true } : { nodes: [], found: false };
    }

    if (trimmed.startsWith('$record.')) {
      const rest = trimmed.substring(8);
      return this.resolveFromData(rest);
    }

    if (
      trimmed.startsWith('$host') ||
      trimmed.startsWith('$event') ||
      trimmed.startsWith('$layout')
    ) {
      return { nodes: [], found: false, property: trimmed };
    }

    const relativeResult = this.resolveScoped(trimmed, contextPath);
    if (relativeResult.found) return relativeResult;

    const rootResult = this.resolveFromRoot(trimmed);
    if (rootResult.found) return rootResult;

    return this.resolveByFirstName(trimmed);
  }

  private resolveByFirstName(path: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    if (segments.length === 0) return { nodes: [], found: false };
    const first = segments[0];
    const matches: string[] = [];
    for (const candidate of this.nodeMap.keys()) {
      if (candidate.substring(candidate.lastIndexOf('.') + 1) === first.name) {
        matches.push(candidate);
      }
    }
    const bases = first.wildcard
      ? matches
      : first.index !== undefined
        ? matches[first.index] !== undefined
          ? [matches[first.index]]
          : []
        : matches.slice(0, 1);
    for (const base of bases) {
      const result = this.walkSegments(segments.slice(1), base);
      if (result.found) return result;
    }
    return { nodes: [], found: false };
  }

  private resolveRelative(path: string, basePath: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    return this.walkSegments(segments, basePath);
  }

  private resolveFromRoot(path: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    const result = this.walkSegments(segments, this.formRootPath);
    if (result.found) return result;

    return this.walkSegments(segments, '');
  }

  private resolveScoped(path: string, contextPath: string): SomResolutionResult {
    const segments = parseSomExpression(path);
    let current = contextPath;

    while (current !== '') {
      const result = this.walkSegments(segments, current);
      if (result.found) return result;

      const parentPath = this.parentMap.get(current);
      if (!parentPath && parentPath !== '') break;
      current = parentPath ?? '';
    }

    return this.walkSegments(segments, '');
  }

  private walkSegments(segments: SomSegment[], basePath: string): SomResolutionResult {
    if (segments.length === 0) {
      const node = this.nodeMap.get(basePath);
      return node ? { nodes: [node], found: true } : { nodes: [], found: false };
    }

    let currentPaths = [basePath];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isLast = i === segments.length - 1;

      if (isLast && XFA_PROPERTIES.has(segment.name)) {
        const nodes: ScriptableNode[] = [];
        for (const cp of currentPaths) {
          const node = this.nodeMap.get(cp);
          if (node) nodes.push(node);
        }
        return nodes.length
          ? { nodes, found: true, property: segment.name }
          : { nodes: [], found: false };
      }

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

      const nextPaths: string[] = [];

      for (const cp of currentPaths) {
        const children = this.childrenMap.get(cp) ?? [];
        const matching = children.filter((childPath) => {
          const childName = childPath.substring(childPath.lastIndexOf('.') + 1);
          return childName === segment.name;
        });

        if (segment.wildcard) {
          nextPaths.push(...matching);
        } else if (segment.index !== undefined) {
          if (segment.index < matching.length) {
            nextPaths.push(matching[segment.index]);
          }
        } else {
          if (matching.length) {
            nextPaths.push(matching[0]);
          } else {
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

    const nodes: ScriptableNode[] = [];
    for (const path of currentPaths) {
      const node = this.nodeMap.get(path);
      if (node) nodes.push(node);
    }

    return nodes.length ? { nodes, found: true } : { nodes: [], found: false };
  }

  private findContainingSubform(path: string): string | null {
    let current = this.parentMap.get(path);
    while (current !== undefined && current !== '') {
      const node = this.nodeMap.get(current);
      if (node && node.type === 'subform') return current;
      current = this.parentMap.get(current);
    }
    return this.formRootPath || null;
  }

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

    const pseudoNode: ScriptableNode = {
      type: 'data',
      name: parts[parts.length - 1],
      resolvedValue: current,
    };

    return { nodes: [pseudoNode], found: true };
  }

  resolveAllByName(name: string): ScriptableNode[] {
    const results: ScriptableNode[] = [];
    for (const [path, node] of this.nodeMap) {
      const nodeName = path.substring(path.lastIndexOf('.') + 1);
      if (nodeName === name) results.push(node);
    }
    return results;
  }

  getNodeByPath(path: string): ScriptableNode | undefined {
    return this.nodeMap.get(path);
  }

  getParentPath(path: string): string | undefined {
    return this.parentMap.get(path);
  }

  getChildPaths(path: string): string[] {
    return this.childrenMap.get(path) ?? [];
  }

  getFullSomPath(path: string): string {
    return path;
  }
}

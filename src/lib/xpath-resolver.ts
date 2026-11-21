import { DataObject, DataValue } from '../types';

export function resolveXPath(ref: string, data: DataObject): DataValue | undefined {
  const path = stripDataRefPrefix(ref);
  if (path == null) return undefined;
  return resolvePath(path, data);
}

function stripDataRefPrefix(ref: string): string | null {
  if (ref.startsWith('$.')) return ref.slice(2);
  if (ref.startsWith('$')) return null;
  return ref;
}

export function resolveXPathRelative(ref: string, scope: DataObject): DataValue | undefined {
  const path = stripDataRefPrefix(ref);
  if (path == null) return undefined;
  const direct = resolvePath(path, scope);
  if (direct !== undefined) return direct;
  const stripped = stripFirstSegment(path);
  if (stripped != null && stripped !== path) return resolvePath(stripped, scope);
  return undefined;
}

function stripFirstSegment(path: string): string | null {
  const dot = findNextDot(path);
  if (dot < 0) return null;
  return path.slice(dot + 1);
}

function resolvePath(path: string, current: unknown): DataValue | undefined {
  if (!path || current == null) return current as DataValue;

  if (Array.isArray(current)) {
    const out: DataValue[] = [];
    for (const item of current) {
      const resolved = resolvePath(path, item);
      if (resolved === undefined) continue;
      if (Array.isArray(resolved)) out.push(...resolved);
      else out.push(resolved);
    }
    return out.length ? (out as unknown as DataValue) : undefined;
  }

  const dotIndex = findNextDot(path);
  const segment = dotIndex === -1 ? path : path.slice(0, dotIndex);
  const rest = dotIndex === -1 ? '' : path.slice(dotIndex + 1);

  const resolved = resolveSegment(segment, current as DataObject);
  if (rest === '') return resolved;
  return resolvePath(rest, resolved);
}

function resolveSegment(segment: string, data: DataObject): DataValue | undefined {
  if (data == null || typeof data !== 'object') return undefined;

  const bracketMatch = segment.match(/^(\w+)\[(\*|\d+)\]$/);
  if (bracketMatch) {
    const fieldName = bracketMatch[1];
    const subscript = bracketMatch[2];
    const value = (data as Record<string, unknown>)[fieldName];
    if (subscript === '*') return value as DataValue;
    return Array.isArray(value) ? (value[parseInt(subscript)] as DataValue) : (value as DataValue);
  }

  return (data as Record<string, unknown>)[segment] as DataValue | undefined;
}

function findNextDot(path: string): number {
  let depth = 0;
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '[') depth++;
    else if (path[i] === ']') depth--;
    else if (path[i] === '.' && depth === 0) return i;
  }
  return -1;
}

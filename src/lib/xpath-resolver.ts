import { DataObject, DataValue } from '../types';

/**
 * Resolve an XFA-style bind reference against a data object.
 *
 * Supported patterns:
 *   $.Name                     → data.Name
 *   $.Quotation.OEM            → data.Quotation.OEM
 *   $.revisionHistory[*]       → data.revisionHistory (full array)
 *   $.to_Perf[0].Value         → data.to_Perf[0].Value
 */
export function resolveXPath(ref: string, data: DataObject): DataValue | undefined {
  if (!ref.startsWith('$.')) return undefined;
  const path = ref.slice(2);
  return resolvePath(path, data);
}

/**
 * Resolve a `$.path` dataRef relative to an already-bound data scope (the
 * nearest bound ancestor's data node), as XFA dataRefs are evaluated.
 */
export function resolveXPathRelative(ref: string, scope: DataObject): DataValue | undefined {
  if (!ref.startsWith('$.')) return undefined;
  return resolvePath(ref.slice(2), scope);
}

function resolvePath(path: string, current: unknown): DataValue | undefined {
  if (!path || current == null) return current as DataValue;

  // A wildcard segment (`Nodes[*].Child`) leaves an array in `current`.
  // Continue the remaining path from every item and flatten the results, so
  // XFA nested repeat bindings (`$.Element_2659[*].Element_2660`) resolve to
  // the concatenation of each occurrence's children.
  if (Array.isArray(current)) {
    const out: DataValue[] = [];
    for (const item of current) {
      const resolved = resolvePath(path, item);
      if (resolved === undefined) continue;
      if (Array.isArray(resolved)) out.push(...resolved);
      else out.push(resolved);
    }
    return out.length > 0 ? (out as unknown as DataValue) : undefined;
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

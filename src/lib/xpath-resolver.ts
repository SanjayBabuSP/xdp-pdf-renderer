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

function resolvePath(path: string, current: unknown): DataValue | undefined {
  if (!path || current == null) return current as DataValue;

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

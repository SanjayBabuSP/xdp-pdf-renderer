import { Result, LayoutModel, SchemaModel, LayoutNode, SchemaFields } from '../../types';
import { success, failure } from '../../lib/result-type';
import { ERROR_CODES } from '../../errors/error-codes';

/** Validate that all dataRef bind expressions in the layout resolve to schema fields. */
export function validateBindings(layout: LayoutModel, schema: SchemaModel): Result<void> {
  const errors: string[] = [];
  const allRefs = collectBindRefs(layout.children);

  for (const ref of allRefs) {
    if (!refResolvesToSchema(ref, schema.fields)) {
      errors.push(`Unresolvable bind ref: ${ref}`);
    }
  }

  // Also check master page children
  for (const page of layout.pages) {
    const pageRefs = collectBindRefs(page.masterPageChildren);
    for (const ref of pageRefs) {
      if (!refResolvesToSchema(ref, schema.fields)) {
        errors.push(`Unresolvable bind ref in master page: ${ref}`);
      }
    }
  }

  if (errors.length > 0) {
    return failure(ERROR_CODES.UNRESOLVED_BINDING.code, ERROR_CODES.UNRESOLVED_BINDING.message, errors);
  }
  return success(undefined);
}

function collectBindRefs(nodes: LayoutNode[]): string[] {
  const refs: string[] = [];
  for (const node of nodes) {
    if ((node.type === 'field' || node.type === 'subform') && node.bindMatch === 'dataRef' && node.bindRef) {
      refs.push(node.bindRef);
    }
    if (node.type === 'subform') {
      refs.push(...collectBindRefs(node.children));
    }
  }
  return refs;
}

function refResolvesToSchema(ref: string, fields: SchemaFields): boolean {
  if (!ref.startsWith('$.')) return false;
  const path = ref.slice(2).replace(/\[\*\]|\[\d+\]/g, '');
  return pathExistsInSchema(path, fields);
}

function pathExistsInSchema(path: string, fields: SchemaFields): boolean {
  const dotIndex = path.indexOf('.');
  const segment = dotIndex === -1 ? path : path.slice(0, dotIndex);
  const rest = dotIndex === -1 ? '' : path.slice(dotIndex + 1);

  const fieldDef = fields[segment];
  if (!fieldDef) return false;
  if (!rest) return true;
  if (fieldDef.type === 'complex') return pathExistsInSchema(rest, fieldDef.fields);
  return false;
}

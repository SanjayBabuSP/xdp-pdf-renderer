import {
  Result,
  LayoutModel,
  SchemaModel,
  LayoutNode,
  SchemaFields,
  SchemaField,
  SchemaFieldComplex,
} from '../../types';
import { success, failure } from '../../lib/result-type';
import { ERROR_CODES } from '../../errors/error-codes';

export function validateBindings(
  layout: LayoutModel,
  schema: SchemaModel,
  options: { strict?: boolean } = {}
): Result<void> {
  const strict = options.strict ?? true;
  const errors: string[] = [];
  const allRefs = collectBindRefs(layout.children);

  for (const { ref, arrayContext } of allRefs) {
    if (!refResolvesToSchema(ref, schema.fields, arrayContext)) {
      errors.push(`Unresolvable bind ref: ${ref}`);
    }
  }

  for (const page of layout.pages) {
    const pageRefs = collectBindRefs(page.masterPageChildren);
    for (const { ref, arrayContext } of pageRefs) {
      if (!refResolvesToSchema(ref, schema.fields, arrayContext)) {
        errors.push(`Unresolvable bind ref in master page: ${ref}`);
      }
    }
  }

  if (errors.length && strict) {
    return failure(ERROR_CODES.UNRESOLVED_BINDING.code, ERROR_CODES.UNRESOLVED_BINDING.message, errors);
  }
  return success(undefined);
}

function collectBindRefs(nodes: LayoutNode[], arrayContext?: string): Array<{ ref: string; arrayContext?: string }> {
  const refs: Array<{ ref: string; arrayContext?: string }> = [];
  for (const node of nodes) {
    if ((node.type === 'field' || node.type === 'subform') && node.bindMatch === 'dataRef' && node.bindRef) {
      refs.push({ ref: node.bindRef, arrayContext });
    }
    if (node.type === 'exclGroup') {
      if (node.bindMatch === 'dataRef' && node.bindRef) {
        refs.push({ ref: node.bindRef, arrayContext });
      }
      refs.push(...collectBindRefs(node.children, arrayContext));
    }
    if (node.type === 'subform') {
      const nextArrayContext = isRepeatingArrayRef(node.bindRef, node.bindMatch)
        ? node.bindRef
        : arrayContext;
      refs.push(...collectBindRefs(node.children, nextArrayContext));
    }
  }
  return refs;
}

function isRepeatingArrayRef(bindRef?: string, bindMatch?: string): boolean {
  return bindMatch === 'dataRef' && !!bindRef && (/\[\*\]$/.test(bindRef) || /\[\d+\]$/.test(bindRef));
}

function refResolvesToSchema(ref: string, fields: SchemaFields, arrayContext?: string): boolean {
  if (!ref.startsWith('$.')) return false;
  const path = ref.slice(2).replace(/\[\*\]|\[\d+\]/g, '');
  if (pathExistsInSchema(path, fields)) return true;

  if (!arrayContext) return false;
  const arrayPath = arrayContext.slice(2).replace(/\[\*\]|\[\d+\]/g, '');
  const itemSchema = schemaAtPath(arrayPath, fields);
  if (!itemSchema || itemSchema.type !== 'complex') return false;
  return pathExistsInSchema(path, itemSchema.fields);
}

function schemaAtPath(path: string, fields: SchemaFields): SchemaField | undefined {
  const segments = path.split('.').filter(Boolean);
  let current: SchemaFieldComplex = { type: 'complex', required: false, fields };

  for (const segment of segments) {
    if (current.type !== 'complex') return undefined;
    const next = current.fields[segment];
    if (!next) return undefined;
    if (next.type !== 'complex') return undefined;
    current = next;
  }

  return current;
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

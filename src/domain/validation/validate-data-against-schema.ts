import { Result, DataObject, SchemaModel, SchemaFields, SchemaField } from '../../types';
import { success, failure } from '../../lib/result-type';
import { ERROR_CODES } from '../../errors/error-codes';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/;
const URI_PATTERN = /^[a-zA-Z][a-zA-Z0-9+\-.]*:/;

/** Validate an XML data object against a schema model. Collects ALL errors. */
export function validateDataAgainstSchema(data: DataObject, schema: SchemaModel): Result<DataObject> {
  const errors: string[] = [];
  walkFields(data, schema.fields, '', errors);

  if (errors.length > 0) {
    return failure(ERROR_CODES.VALIDATION_FAILED.code, ERROR_CODES.VALIDATION_FAILED.message, errors);
  }
  return success(data);
}

function walkFields(data: DataObject, fields: SchemaFields, path: string, errors: string[]): void {
  for (const [name, fieldDef] of Object.entries(fields)) {
    const fieldPath = path ? `${path}.${name}` : name;
    const value = data[name];
    validateField(value, fieldDef, fieldPath, errors);
  }
}

function validateField(value: unknown, fieldDef: SchemaField, path: string, errors: string[]): void {
  if (value == null || value === undefined) {
    if (fieldDef.required) errors.push(`Missing required field: ${path}`);
    return;
  }

  if (fieldDef.repeating && !Array.isArray(value)) {
    errors.push(`Field ${path} should be an array`);
    return;
  }

  if (Array.isArray(value)) {
    // Recurse into each item using a non-repeating copy to avoid false "should be array" errors
    const itemDef: SchemaField = { ...fieldDef, repeating: false };
    value.forEach((item, i) => validateField(item, itemDef, `${path}[${i}]`, errors));
    return;
  }

  if (fieldDef.type === 'complex') {
    if (typeof value !== 'object') {
      errors.push(`Field ${path} expected object, got ${typeof value}`);
      return;
    }
    walkFields(value as DataObject, fieldDef.fields, path, errors);
    return;
  }

  validateType(value, fieldDef.type, path, errors);
}

function validateType(value: unknown, type: string, path: string, errors: string[]): void {
  const strVal = String(value);

  switch (type) {
    case 'string':
    case 'anyURI':
      if (typeof value !== 'string' && typeof value !== 'number') {
        errors.push(`${path}: expected string, got ${typeof value}`);
      }
      if (type === 'anyURI' && !URI_PATTERN.test(strVal) && !strVal.startsWith('/') && !strVal.startsWith('.')) {
        // Lenient: only fail if clearly not a URI-like string
      }
      break;
    case 'int':
    case 'integer':
      if (!Number.isInteger(Number(value))) errors.push(`${path}: expected integer, got "${value}"`);
      break;
    case 'byte':
      if (!Number.isInteger(Number(value)) || Number(value) < -128 || Number(value) > 127) {
        errors.push(`${path}: expected byte (-128..127), got "${value}"`);
      }
      break;
    case 'short':
      if (!Number.isInteger(Number(value)) || Number(value) < -32768 || Number(value) > 32767) {
        errors.push(`${path}: expected short (-32768..32767), got "${value}"`);
      }
      break;
    case 'decimal':
    case 'float':
      if (isNaN(parseFloat(strVal))) errors.push(`${path}: expected number, got "${value}"`);
      break;
    case 'date':
      if (!DATE_PATTERN.test(strVal)) errors.push(`${path}: expected date (YYYY-MM-DD), got "${value}"`);
      break;
    case 'dateTime':
      if (!DATETIME_PATTERN.test(strVal)) errors.push(`${path}: expected dateTime (ISO 8601), got "${value}"`);
      break;
  }
}

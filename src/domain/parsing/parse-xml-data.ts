import { Result, DataObject, DataValue, SchemaModel, SchemaField } from '../../types';
import { success, failure } from '../../lib/result-type';
import { parseXml, getChild } from '../../lib/xml-utils';
import { ERROR_CODES } from '../../errors/error-codes';

/** Parse an XML data string into a plain JS object, normalizing repeating fields. */
export function parseXmlData(xmlString: string, schema?: SchemaModel): Result<DataObject> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xmlString);
  } catch (e) {
    return failure(ERROR_CODES.MALFORMED_XML.code, `${ERROR_CODES.MALFORMED_XML.message}: ${e}`);
  }

  const rootName = schema?.rootElement ?? inferRootName(parsed);
  const rootValue = getChild(parsed, rootName);
  if (!rootValue) return failure(ERROR_CODES.MALFORMED_XML.code, `Root element <${rootName}> not found`);

  const data = normalizeObject(rootValue as Record<string, unknown>, schema?.fields ?? {});
  return success(data);
}

function inferRootName(parsed: Record<string, unknown>): string {
  const keys = Object.keys(parsed).filter((k) => !k.startsWith('?'));
  return keys[0] ?? 'value';
}

function normalizeObject(
  obj: Record<string, unknown>,
  schemaFields: Record<string, import('../../types').SchemaField>
): DataObject {
  const result: DataObject = {};
  for (const key of Object.keys(obj)) {
    if (key.startsWith('@_') || key.startsWith('?')) continue;
    const schemaField = schemaFields[key];
    result[key] = normalizeValue(obj[key], schemaField);
  }
  return result;
}

function normalizeValue(value: unknown, schemaField?: SchemaField): DataValue | DataValue[] {
  if (value == null) return null;

  const shouldBeArray = schemaField?.repeating === true;

  if (Array.isArray(value)) {
    return value.map((item) => normalizeItem(item, schemaField)) as DataValue[];
  }

  if (shouldBeArray) {
    return [normalizeItem(value, schemaField)] as DataValue[];
  }

  return normalizeItem(value, schemaField);
}

function normalizeItem(item: unknown, schemaField?: SchemaField): DataValue {
  if (item == null) return null;
  if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
    return coerceType(item, schemaField);
  }
  if (typeof item === 'object') {
    const complexField = schemaField?.type === 'complex' ? schemaField : undefined;
    return normalizeObject(item as Record<string, unknown>, complexField?.fields ?? {});
  }
  return String(item);
}

function coerceType(value: string | number | boolean, schemaField?: SchemaField): DataValue {
  if (!schemaField || schemaField.type === 'complex') return String(value);
  const strVal = String(value);

  switch (schemaField.type) {
    case 'int':
    case 'integer':
    case 'byte':
    case 'short':
      return parseInt(strVal, 10);
    case 'float':
    case 'decimal':
      return parseFloat(strVal);
    default:
      return strVal;
  }
}

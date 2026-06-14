import { Result, SchemaModel, SchemaField, SchemaFields } from '../../types';
import { success, failure } from '../../lib/result-type';
import { parseXml, getChild, toArray, attr } from '../../lib/xml-utils';
import { ERROR_CODES } from '../../errors/error-codes';

type SimpleXsdType = SchemaField extends { type: infer T } ? (T extends 'complex' ? never : T) : never;

const XSD_TYPE_MAP: Record<string, SimpleXsdType> = {
  'xs:string': 'string',
  'xs:int': 'int',
  'xs:integer': 'integer',
  'xs:byte': 'byte',
  'xs:short': 'short',
  'xs:decimal': 'decimal',
  'xs:float': 'float',
  'xs:double': 'float',
  'xs:date': 'date',
  'xs:dateTime': 'dateTime',
  'xs:anyURI': 'anyURI',
  string: 'string',
  int: 'int',
  integer: 'integer',
  byte: 'byte',
  short: 'short',
  decimal: 'decimal',
  float: 'float',
  date: 'date',
  dateTime: 'dateTime',
  anyURI: 'anyURI',
};

/** Parse an XSD XML string into the internal SchemaModel. */
export function parseXsd(xsdXml: string): Result<SchemaModel> {
  let parsed: Record<string, unknown>;
  try {
    parsed = parseXml(xsdXml);
  } catch (e) {
    return failure(ERROR_CODES.MALFORMED_XML.code, `${ERROR_CODES.MALFORMED_XML.message}: ${e}`);
  }

  const schema = findSchema(parsed);
  if (!schema) return failure(ERROR_CODES.INVALID_XSD.code, ERROR_CODES.INVALID_XSD.message);

  const rootElement = findRootElement(schema);
  if (!rootElement) return failure(ERROR_CODES.INVALID_XSD.code, 'XSD missing root element');

  const rootName = attr(rootElement, 'name') ?? 'value';
  const fields = parseComplexFields(rootElement);

  return success({
    rootElement: rootName,
    schemaAttributes: {
      attributeFormDefault: attr(schema, 'attributeFormDefault'),
      elementFormDefault: attr(schema, 'elementFormDefault'),
    },
    fields,
  });
}

function findSchema(parsed: Record<string, unknown>): unknown {
  for (const key of Object.keys(parsed)) {
    if (key === 'xs:schema' || key === 'xsd:schema' || key === 'schema') return parsed[key];
  }
  return undefined;
}

function findRootElement(schema: unknown): unknown {
  const elements = toArray<unknown>(getChild(schema, 'xs:element'));
  if (elements.length > 0) return elements[0];
  const elements2 = toArray<unknown>(getChild(schema, 'xsd:element'));
  return elements2[0] ?? null;
}

function parseComplexFields(element: unknown): SchemaFields {
  const complexType =
    getChild(element, 'xs:complexType') ??
    getChild(element, 'xsd:complexType') ??
    getChild(element, 'complexType');

  const sequence =
    getChild(complexType, 'xs:sequence') ??
    getChild(complexType, 'xsd:sequence') ??
    getChild(complexType, 'sequence');

  if (!sequence) return {};
  return parseSequenceFields(sequence);
}

function parseSequenceFields(sequence: unknown): SchemaFields {
  const elementTag = findXsElements(sequence);
  const fields: SchemaFields = {};

  for (const el of elementTag) {
    const name = attr(el, 'name');
    if (!name) continue;
    fields[name] = parseElement(el);
  }
  return fields;
}

function findXsElements(sequence: unknown): unknown[] {
  return (
    toArray<unknown>(getChild(sequence, 'xs:element')).filter(Boolean).concat(
      toArray<unknown>(getChild(sequence, 'xsd:element')).filter(Boolean)
    )
  );
}

function parseElement(el: unknown): SchemaField {
  const typeProp = attr(el, 'type');
  const minOccurs = attr(el, 'minOccurs') ?? '1';
  const maxOccurs = attr(el, 'maxOccurs') ?? '1';
  const required = minOccurs !== '0';
  const repeating = maxOccurs === 'unbounded' || parseInt(maxOccurs, 10) > 1;
  const maxOccursNum = maxOccurs === 'unbounded' ? -1 : parseInt(maxOccurs, 10);

  const hasComplexType =
    getChild(el, 'xs:complexType') ??
    getChild(el, 'xsd:complexType') ??
    getChild(el, 'complexType');

  if (hasComplexType) {
    return {
      type: 'complex',
      required,
      repeating,
      maxOccurs: maxOccursNum,
      fields: parseComplexFields(el),
    };
  }

  const mappedType = typeProp ? XSD_TYPE_MAP[typeProp] : undefined;
  return {
    type: mappedType ?? 'string',
    required,
    repeating: repeating || undefined,
    maxOccurs: repeating ? maxOccursNum : undefined,
  };
}

import { XMLParser } from 'fast-xml-parser';

const MAX_INPUT_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ParsedXml {
  [key: string]: unknown;
}

/**
 * Parse an XML string into a plain JS object.
 * SECURITY: processEntities disabled to prevent XXE injection.
 */
export function parseXml(xmlString: string): ParsedXml {
  if (xmlString.length > MAX_INPUT_SIZE) {
    throw new Error(`XML input exceeds maximum size of ${MAX_INPUT_SIZE} bytes`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false, // Keep all attribute values as strings
    trimValues: true,
    processEntities: false, // XXE prevention
    cdataPropName: '__cdata',
    commentPropName: '__comment',
  });

  return parser.parse(xmlString) as ParsedXml;
}

/** Safely get a nested value by key, returning undefined if not found. */
export function getChild(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** Normalize a value to an array (for elements that may appear once or many times). */
export function toArray<T>(value: unknown): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as T[];
  return [value as T];
}

/** Get string attribute value, stripping the @_ prefix convention. */
export function attr(obj: unknown, name: string): string | undefined {
  const val = getChild(obj, `@_${name}`);
  if (val == null) return undefined;
  return String(val);
}

/** Get text content of an element (handles both string and object with #text). */
export function textContent(obj: unknown): string | undefined {
  if (obj == null) return undefined;
  if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
  const text = getChild(obj, '#text');
  if (text != null) return String(text);
  return undefined;
}

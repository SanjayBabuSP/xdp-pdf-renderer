import { XMLParser } from 'fast-xml-parser';

const MAX_INPUT_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ParsedXml {
  [key: string]: unknown;
}

/**
 * Parse an XML string into a plain JS object.
 * SECURITY: processEntities disabled to prevent XXE injection.
 */
export function parseXml(xmlString: string, maxInputSize: number = MAX_INPUT_SIZE): ParsedXml {
  if (xmlString.length > maxInputSize) {
    throw new Error(`XML input exceeds maximum size of ${maxInputSize} bytes`);
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

/**
 * Serialize a parsed XML node back to an HTML/XML fragment.
 *
 * `textContent` only returns `#text`, so rich-text `<exData>` that Designer
 * emits as real nested markup (`<body><p><span xfa:embed="#id"/></p></body>`)
 * came through as an empty string — losing every embedded value. This walks
 * the parsed structure and rebuilds equivalent markup.
 */
export function serializeHtmlFragment(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((item) => serializeHtmlFragment(item)).join('');
  if (typeof node !== 'object') return String(node);

  const rec = node as Record<string, unknown>;
  let out = '';
  for (const [key, val] of Object.entries(rec)) {
    if (key.startsWith('@_')) continue;
    if (key === '#text' || key === '__cdata') {
      out += String(val);
      continue;
    }
    if (key === '__comment' || key.startsWith('?')) continue;
    out += serializeElement(key, val);
  }
  return out;
}

function serializeElement(name: string, value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => serializeElement(name, item)).join('');
  }
  if (value == null) return `<${name}></${name}>`;
  if (typeof value === 'string' || typeof value === 'number') {
    return `<${name}>${escapeAttrValue(String(value))}</${name}>`;
  }
  if (typeof value !== 'object') return `<${name}></${name}>`;

  const rec = value as Record<string, unknown>;
  const attrs: string[] = [];
  let inner = '';
  for (const [key, val] of Object.entries(rec)) {
    if (key.startsWith('@_')) {
      attrs.push(` ${key.slice(2)}="${escapeAttrValue(String(val))}"`);
      continue;
    }
    if (key === '#text' || key === '__cdata') {
      inner += String(val);
      continue;
    }
    if (key === '__comment' || key.startsWith('?')) continue;
    inner += serializeElement(key, val);
  }
  return `<${name}${attrs.join('')}>${inner}</${name}>`;
}

function escapeAttrValue(value: string): string {
  return value.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, '&amp;')
    .replace(/"/g, '&quot;');
}

/**
 * Get text content of an element (string, `#text`, or `__cdata`).
 *
 * XFA writes script bodies as CDATA; with `cdataPropName: '__cdata'` a
 * CDATA-only element has no `#text` key at all, so scripts were being parsed
 * as empty and never executed.
 */
export function textContent(obj: unknown): string | undefined {
  if (obj == null) return undefined;
  if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
  const text = getChild(obj, '#text');
  const cdata = getChild(obj, '__cdata');
  if (text != null && cdata != null) return String(cdata) + String(text);
  if (text != null) return String(text);
  if (cdata != null) return String(cdata);
  return undefined;
}

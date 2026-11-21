import { XMLParser } from 'fast-xml-parser';

const MAX_INPUT_SIZE = 10 * 1024 * 1024;

export interface ParsedXml {
  [key: string]: unknown;
}

function stripProcessingInstructions(xml: string): string {
  return xml.replace(/<\?(?!xml[\s?])[\s\S]*?\?>/g, '');
}

export { stripProcessingInstructions };

export function parseXml(xmlString: string, maxInputSize: number = MAX_INPUT_SIZE): ParsedXml {
  if (xmlString.length > maxInputSize) {
    throw new Error(`XML input exceeds maximum size of ${maxInputSize} bytes`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    allowBooleanAttributes: true,
    parseAttributeValue: false,
    parseTagValue: false,
    trimValues: true,
    processEntities: false,
    cdataPropName: '__cdata',
    commentPropName: '__comment',
  });

  const parsed = parser.parse(stripProcessingInstructions(xmlString)) as ParsedXml;
  return decodeEntitiesDeep(parsed) as ParsedXml;
}

const XML_ENTITY_RE = /&(?:amp|lt|gt|quot|apos|#\d{1,7}|#[xX][0-9a-fA-F]{1,6});/g;

export function decodeXmlEntities(text: string): string {
  if (text.indexOf('&') < 0) return text;
  return text.replace(XML_ENTITY_RE, (entity) => {
    switch (entity) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      case '&apos;':
        return "'";
      default: {
        const hex = entity[2] === 'x' || entity[2] === 'X';
        const code = parseInt(entity.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
        if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return entity;
        try {
          return String.fromCodePoint(code);
        } catch {
          return entity;
        }
      }
    }
  });
}

function decodeEntitiesDeep(value: unknown): unknown {
  if (typeof value === 'string') return decodeXmlEntities(value);
  if (Array.isArray(value)) return value.map(decodeEntitiesDeep);
  if (value == null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = decodeEntitiesDeep(val);
  }
  return out;
}

export function getChild(obj: unknown, key: string): unknown {
  if (obj == null || typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

export function toArray<T>(value: unknown): T[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value as T[];
  return [value as T];
}

export function firstChild(obj: unknown, key: string): unknown {
  const val = getChild(obj, key);
  if (Array.isArray(val)) return val[0];
  return val;
}

export function extractRichTextContent(exData: unknown): string | undefined {
  if (exData == null || typeof exData !== 'object') return undefined;
  const body = getChild(exData, 'body');
  const scope = body ?? exData;
  const paras = toArray<unknown>(getChild(scope, 'p'));
  if (paras.length === 0) return collectInlineText(scope) || undefined;
  const out = paras.map((p) => collectInlineText(p)).join('\n');
  return out || undefined;
}

function collectInlineText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map((i) => collectInlineText(i)).join('');
  if (typeof node !== 'object') return '';
  const rec = node as Record<string, unknown>;
  let out = '';
  const text = rec['#text'];
  if (typeof text === 'string' || typeof text === 'number') out += String(text);
  const cdata = rec['__cdata'];
  if (typeof cdata === 'string' || typeof cdata === 'number') out += String(cdata);
  for (const [key, val] of Object.entries(rec)) {
    if (key.startsWith('@_') || key === '#text' || key === '__cdata') continue;
    out += collectInlineText(val);
  }
  return out;
}

export function attr(obj: unknown, name: string): string | undefined {
  const val = getChild(obj, `@_${name}`);
  if (val == null) return undefined;
  return String(val);
}

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

import { XMLParser } from 'fast-xml-parser';

const MAX_INPUT_SIZE = 10 * 1024 * 1024; // 10 MB

export interface ParsedXml {
  [key: string]: unknown;
}

/**
 * Remove processing instructions (except the XML declaration).
 *
 * Designer emits `<?renderCache.…?>` PIs whose payload is not attribute
 * syntax; fast-xml-parser treats a `"` in the payload as an attribute quote
 * and throws "Pi Tag is not closed" (the ESP cover letter hits this). PIs are
 * ignorable metadata — the renderer re-lays out the form and never reads the
 * render cache — so dropping them is safe and matches XML semantics.
 */
function stripProcessingInstructions(xml: string): string {
  return xml.replace(/<\?(?!xml[\s?])[\s\S]*?\?>/g, '');
}

/** Exported for the ordered (preserveOrder) parser in parse-xdp. */
export { stripProcessingInstructions };

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

  return parser.parse(stripProcessingInstructions(xmlString)) as ParsedXml;
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

/**
 * Get a singular child element, tolerating Designer-emitted duplicates.
 * Real forms sometimes repeat a singular child (e.g. two `<value>` blocks
 * under one `<draw>`); Adobe uses the first. Without this, `getChild` hands
 * back an array and every downstream object read misses (empty draw text).
 */
export function firstChild(obj: unknown, key: string): unknown {
  const val = getChild(obj, key);
  if (Array.isArray(val)) return val[0];
  return val;
}

/**
 * Extract plain text from an XFA rich-text `<exData>` block.
 *
 * Captions (and some draws) carry HTML (`<body><p>Text<span>…</span></p>`)
 * instead of a plain `<text>` node. fast-xml-parser groups repeated tags into
 * arrays and does not preserve mixed-content order, so this walks
 * body → paragraphs → (#text, then inline runs) rather than relying on key
 * order. Inline `xfa:embed` references resolve later (resolve-embeds); here
 * only literal text is collected. Formatting (bold/underline) is dropped —
 * content presence is what Adobe parity needs first.
 */
export function extractRichTextContent(exData: unknown): string | undefined {
  if (exData == null || typeof exData !== 'object') return undefined;
  const body = getChild(exData, 'body');
  const scope = body ?? exData;
  const paras = toArray<unknown>(getChild(scope, 'p'));
  // No <p> wrapper (bare text or spans directly under body/exData).
  if (paras.length === 0) return collectInlineText(scope) || undefined;
  const out = paras.map((p) => collectInlineText(p)).join('\n');
  return out || undefined;
}

/** Text of a paragraph: its own #text plus any inline run elements. */
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

/** Get string attribute value, stripping the @_ prefix convention. */export function attr(obj: unknown, name: string): string | undefined {
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

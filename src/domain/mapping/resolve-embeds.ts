// ────────────────────────────────────────────────────────────────────────────
// XFA `xfa:embed` resolution — inline embedding of hidden field values
//
// Designers commonly declare a unit (`kg/m3`, `°C`, `bar g`) as its own
// `presence="hidden"` floatingField at x=0,y=0, then pull its text into a
// visible <draw> through an exData HTML run:
//
//   <draw name="T37" ...>
//     <value><exData contentType="text/html">
//       <body><p><span xfa:embedType="uri" xfa:embedMode="raw"
//                      xfa:embed="#floatingField004827"/></p></body>
//     </exData></value>
//   </draw>
//
// The draw is painted, the hidden field is not — so the unit only appears if
// the embed reference is substituted before the hidden node is dropped by
// evaluateConditions(). This pass therefore runs *after* scripts (so hidden
// fields already carry their script/data values) and *before* condition
// evaluation (so the referenced nodes still exist in the tree).
// ────────────────────────────────────────────────────────────────────────────

import { LayoutModel, LayoutNode } from '../../types';
import { formatValue } from '../../lib/value-format';

interface EmbedTarget {
  /** Raw (unformatted) value of the referenced node. */
  raw: string;
  /** Value rendered through the node's `<bind><picture>`, when present. */
  formatted: string;
}

/**
 * Matches the `xfa:embed="#id"` attribute itself. The trailing `=` guard keeps
 * `xfa:embedType=` / `xfa:embedMode=` from being mistaken for the reference.
 */
const EMBED_ATTR = String.raw`xfa:embed\s*=\s*(["'])(#[^"']+)\1`;

const EMBED_MODE = /xfa:embedMode\s*=\s*(["'])([^"']+)\1/i;

/**
 * Substitute every `xfa:embed="#id"` occurrence in an exData HTML fragment.
 *
 * Handles both real markup (`<span …/>`) and entity-escaped markup
 * (`&lt;span …/&gt;`), which is how XDP stores exData content: the reference
 * attribute is found first, then the enclosing tag is expanded outwards, so a
 * neighbouring tag can never be swallowed.
 *
 * `embedMode="raw"` inserts the value as-is; `formatted` (the XFA default)
 * applies the referenced node's format picture.
 */
export function resolveXfaEmbedsInHtml(
  html: string,
  lookup: (id: string) => EmbedTarget | undefined
): string {
  if (!html || html.toLowerCase().indexOf('xfa:embed') < 0) return html;

  const attr = new RegExp(EMBED_ATTR, 'gi');
  const out: string[] = [];
  let cursor = 0;

  let match: RegExpExecArray | null;
  while ((match = attr.exec(html)) !== null) {
    const attrStart = match.index;
    const attrEnd = match.index + match[0].length;
    const id = match[2].slice(1); // strip '#'

    // Expand outwards to the enclosing tag, in real (`<` … `>`) or
    // entity-escaped (`&lt;` … `&gt;`) form — whichever occurs first.
    const openReal = html.lastIndexOf('<', attrStart);
    const openEsc = html.lastIndexOf('&lt;', attrStart);
    const tagStart = Math.max(Math.max(openReal, openEsc), cursor);

    const closeReal = html.indexOf('>', attrStart);
    const closeEsc = html.indexOf('&gt;', attrStart);
    let tagEnd = html.length;
    if (closeReal >= 0 && (closeEsc < 0 || closeReal < closeEsc)) tagEnd = closeReal + 1;
    else if (closeEsc >= 0) tagEnd = closeEsc + '&gt;'.length;

    const tag = html.slice(tagStart, tagEnd);
    const mode = EMBED_MODE.exec(tag)?.[2] ?? 'formatted';

    // Consume an immediately following explicit closing tag, if any.
    let end = tagEnd;
    const closing = /^\s*(?:<\/span>|&lt;\/span&gt;)/i.exec(html.slice(end));
    if (closing) end += closing[0].length;

    if (cursor < tagStart) out.push(html.slice(cursor, tagStart));

    const target = lookup(id);
    out.push(target ? (mode.toLowerCase() === 'raw' ? target.raw : target.formatted) : '');
    cursor = end;
    attr.lastIndex = cursor;
  }

  if (cursor < html.length) out.push(html.slice(cursor));
  return out.join('');
}

/**
 * Collect `uid`/`name` → value for every node in the layout, including the
 * `presence="hidden"` ones that never get painted on their own.
 */
export function buildEmbedIndex(layout: LayoutModel): Map<string, EmbedTarget> {
  const index = new Map<string, EmbedTarget>();

  const put = (key: string | undefined, node: LayoutNode): void => {
    if (!key || index.has(key)) return;
    const value = 'resolvedValue' in node ? (node as { resolvedValue?: unknown }).resolvedValue : undefined;
    const picture =
      'formatPicture' in node ? (node as { formatPicture?: string }).formatPicture : undefined;
    index.set(key, {
      raw: value == null ? '' : String(value),
      formatted: value == null ? '' : formatValue(value, picture),
    });
  };

  const walk = (nodes: LayoutNode[]): void => {
    for (const node of nodes) {
      put(node.uid, node);
      put(node.name, node);
      if (node.type === 'subform' || node.type === 'exclGroup') walk(node.children);
    }
  };

  walk(layout.children);
  for (const page of layout.pages) walk(page.masterPageChildren);
  return index;
}

/**
 * Rewrite every `xfa:embed` in every rich-text draw on the layout tree.
 * Mutates in place (the tree is already a private deep copy at this point in
 * the pipeline) and returns the number of references that were substituted.
 */
export function resolveXfaEmbeds(layout: LayoutModel): number {
  const index = buildEmbedIndex(layout);
  if (index.size === 0) return 0;
  let substituted = 0;

  const lookup = (id: string): EmbedTarget | undefined => index.get(id);

  const walk = (nodes: LayoutNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'draw' && node.value?.type === 'richText' && node.value.content) {
        const original = node.value.content;
        const next = resolveXfaEmbedsInHtml(original, lookup);
        if (next !== original) {
          node.value.content = next;
          substituted++;
        }
      }
      if (node.type === 'subform' || node.type === 'exclGroup') walk(node.children);
    }
  };

  walk(layout.children);
  for (const page of layout.pages) walk(page.masterPageChildren);
  return substituted;
}

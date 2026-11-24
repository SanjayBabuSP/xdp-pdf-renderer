import { LayoutModel, LayoutNode } from '../../types';
import { formatValue } from '../../lib/value-format';

interface EmbedTarget {
  raw: string;
  formatted: string;
  hasPicture?: boolean;
  pageNumber?: boolean;
}

const EMBED_ATTR = String.raw`xfa:embed\s*=\s*(["'])(#[^"']+)\1`;

const EMBED_MODE = /xfa:embedMode\s*=\s*(["'])([^"']+)\1/i;

export const PAGE_NUMBER_TOKEN = '\uE000XFA_PAGE_NUMBER\uE001';

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
    const id = match[2].slice(1);

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

    let end = tagEnd;
    const selfClosing = /\/\s*(?:>|&gt;)\s*$/i.test(tag);
    if (!selfClosing) {
      const closing = /^\s*(?:<\/span>|&lt;\/span&gt;)/i.exec(html.slice(end));
      if (closing) end += closing[0].length;
    }

    if (cursor < tagStart) out.push(html.slice(cursor, tagStart));

    const target = lookup(id);
    const asRaw = mode.toLowerCase() === 'raw' && target?.hasPicture !== true;
    if (target?.pageNumber) out.push(PAGE_NUMBER_TOKEN);
    else out.push(target ? (asRaw ? target.raw : target.formatted) : '');
    cursor = end;
    attr.lastIndex = cursor;
  }

  if (cursor < html.length) out.push(html.slice(cursor));
  return out.join('');
}

export function buildEmbedIndex(layout: LayoutModel, locale?: string): Map<string, EmbedTarget> {
  const index = new Map<string, EmbedTarget>();

  const put = (key: string | undefined, node: LayoutNode): void => {
    if (!key || index.has(key)) return;
    const value =
      'resolvedValue' in node ? (node as { resolvedValue?: unknown }).resolvedValue : undefined;
    const picture =
      'formatPicture' in node ? (node as { formatPicture?: string }).formatPicture : undefined;
    index.set(key, {
      raw: value == null ? '' : String(value),
      formatted: value == null ? '' : formatValue(value, picture, locale),
      hasPicture: picture != null,
      pageNumber: node.type === 'field' && node.name === 'CurrentPage',
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

export function resolveXfaEmbeds(layout: LayoutModel, locale?: string): number {
  const index = buildEmbedIndex(layout, locale);
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

import type { DocumentMetadata } from '../../../types';
import { getChild, toArray, attr, textContent } from '../../../lib/xml-utils';

export function parseVariables(variables: unknown): Record<string, string> | undefined {
  if (!variables || typeof variables !== 'object') return undefined;
  const out: Record<string, string> = {};
  for (const entry of toArray<unknown>(getChild(variables, 'text'))) {
    const name = attr(entry, 'name');
    if (!name) continue;
    out[name] = textContent(entry) ?? '';
  }
  return Object.keys(out).length ? out : undefined;
}

export function parseDocumentMetadata(
  root: Record<string, unknown>,
  rootSubform: unknown
): DocumentMetadata | undefined {
  const title = readXmpLiteral(root, 'dc:title') ?? readDescText(rootSubform);
  const description = readXmpLiteral(root, 'dc:description');
  const author = readXmpCreator(root);
  const out: DocumentMetadata = {};
  if (title) out.title = title;
  if (description) out.description = description;
  if (author) out.author = author;
  return Object.keys(out).length ? out : undefined;
}

function readXmpLiteral(root: Record<string, unknown>, property: string): string | undefined {
  const packet = getChild(root, 'x:xmpmeta') ?? getChild(root, 'xmpmeta');
  if (!packet) return undefined;
  const element = findNestedKey(packet, property);
  if (!element) return undefined;
  const text = textContent(element) ?? textContent(findNestedKey(element, 'li'));
  return text && text.trim() !== '' ? text.trim() : undefined;
}

function findNestedKey(node: unknown, name: string, depth = 0): unknown {
  if (!node || typeof node !== 'object' || depth > 6) return undefined;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (key === name || key.endsWith(`:${name}`) || key.endsWith(`_${name}`)) return value;
    const nested = findNestedKey(value, name, depth + 1);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function readXmpCreator(root: Record<string, unknown>): string | undefined {
  const packet = getChild(root, 'x:xmpmeta') ?? getChild(root, 'xmpmeta');
  if (!packet) return undefined;
  const creator = findNestedKey(packet, 'creator');
  if (!creator) return undefined;
  const list = findNestedKey(creator, 'li');
  const text = textContent(list ?? creator);
  return text && text.trim() !== '' ? text.trim() : undefined;
}

function readDescText(rootSubform: unknown): string | undefined {
  const desc = getChild(rootSubform, 'desc');
  if (!desc) return undefined;
  const text = textContent(getChild(desc, 'text'));
  return text && text.trim() !== '' ? text.trim() : undefined;
}

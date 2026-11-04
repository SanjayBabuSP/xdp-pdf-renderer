// Packet-aware walk over a tokenized XDP, XSD or XML data file.

import { tokenize, parseAttrs, localName } from './xml-tokens.mjs';

const XHTML = 'http://www.w3.org/1999/xhtml';

export function attrValue(el, name) {
  return el.attrs.find((a) => a.name === name)?.value;
}

function packetFor(kind, stack, local) {
  if (kind === 'xsd') return 'schema';
  if (kind === 'data') return 'data';
  if (stack.length === 0) return 'xdp';
  return stack.length === 1 ? local : stack[1].packet;
}

/** { qname, local, attrs, packet, xhtml } for an open/empty tag; xhtml marks rich-text subtrees. */
export function elementOf(kind, stack, token) {
  const local = localName(token.name);
  const attrs = parseAttrs(token.raw);
  const xhtml =
    Boolean(stack[stack.length - 1]?.xhtml) || attrs.some((a) => a.name === 'xmlns' && a.value === XHTML);
  return { qname: token.name, local, attrs, packet: packetFor(kind, stack, local), xhtml };
}

/** Walks elements with packet context; calls visitor hooks. */
export function walk(file, visit) {
  const stack = [];
  tokenize(file.text).forEach((token, index, tokens) => {
    if (token.type === 'open' || token.type === 'empty') {
      const el = elementOf(file.kind, stack, token);
      visit.element?.(el, token, index, tokens, stack);
      if (token.type === 'open') stack.push(el);
    } else if (token.type === 'close') {
      stack.pop();
      visit.close?.(token);
    } else {
      visit.other?.(token, stack);
    }
  });
}

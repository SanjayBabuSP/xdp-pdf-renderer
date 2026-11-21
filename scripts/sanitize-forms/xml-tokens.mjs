
export function tokenize(xml) {
  const tokens = [];
  const n = xml.length;
  let i = 0;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      tokens.push({ type: 'text', raw: xml.slice(i) });
      break;
    }
    if (lt > i) tokens.push({ type: 'text', raw: xml.slice(i, lt) });
    i = lt;
    if (xml.startsWith('<!--', i)) {
      i = pushUntil(tokens, xml, i, '-->', 'comment');
    } else if (xml.startsWith('<![CDATA[', i)) {
      i = pushUntil(tokens, xml, i, ']]>', 'cdata');
    } else if (xml.startsWith('<?', i)) {
      i = pushUntil(tokens, xml, i, '?>', 'pi');
    } else if (xml.startsWith('<!', i)) {
      let j = i + 2;
      let depth = 0;
      for (; j < n; j++) {
        const c = xml[j];
        if (c === '[') depth++;
        else if (c === ']') depth--;
        else if (c === '>' && depth <= 0) break;
      }
      tokens.push({ type: 'doctype', raw: xml.slice(i, j + 1) });
      i = j + 1;
    } else {
      let j = i + 1;
      let quote = null;
      for (; j < n; j++) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") {
          quote = c;
        } else if (c === '>') {
          break;
        }
      }
      if (j >= n) throw new Error(`Unterminated tag at offset ${i}`);
      const raw = xml.slice(i, j + 1);
      if (raw[1] === '/') {
        tokens.push({ type: 'close', raw, name: raw.slice(2, -1).trim() });
      } else {
        const name = /^<([^\s/>]+)/.exec(raw)[1];
        tokens.push({ type: raw.endsWith('/>') ? 'empty' : 'open', raw, name });
      }
      i = j + 1;
    }
  }
  return tokens;
}

function pushUntil(tokens, xml, start, terminator, type) {
  const end = xml.indexOf(terminator, start + 2);
  if (end === -1) throw new Error(`Unterminated ${type} at offset ${start}`);
  const stop = end + terminator.length;
  tokens.push({ type, raw: xml.slice(start, stop) });
  return stop;
}

export function localName(qname) {
  return qname.slice(qname.indexOf(':') + 1);
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseAttrs(raw) {
  const attrs = [];
  ATTR.lastIndex = /^<[^\s/>]+/.exec(raw)[0].length;
  let m;
  while ((m = ATTR.exec(raw)) !== null) {
    const rawValue = m[2] ?? m[3];
    const quote = m[2] !== undefined ? '"' : "'";
    const valueEnd = m.index + m[0].length - 1;
    attrs.push({
      name: m[1],
      value: decode(rawValue),
      quote,
      nameStart: m.index,
      nameEnd: m.index + m[1].length,
      valueStart: valueEnd - rawValue.length,
      valueEnd,
    });
  }
  return attrs;
}

export function spliceAttrs(raw, attrs, edits) {
  return spliceTag(raw, attrs, { values: edits });
}

export function spliceTag(raw, attrs, { tag, names = new Map(), values = new Map() } = {}) {
  const edits = [];
  for (const [index, value] of values) {
    const attr = attrs[index];
    const original = raw.slice(attr.valueStart, attr.valueEnd);
    edits.push([attr.valueStart, attr.valueEnd, encodeAttr(value, attr.quote, original)]);
  }
  for (const [index, name] of names) edits.push([attrs[index].nameStart, attrs[index].nameEnd, name]);
  if (tag !== undefined) edits.push([1, 1 + /^<([^\s/>]+)/.exec(raw)[1].length, tag]);
  let out = raw;
  for (const [start, end, text] of edits.sort((a, b) => b[0] - a[0])) out = out.slice(0, start) + text + out.slice(end);
  return out;
}

const NAMED = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decode(s) {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (all, ref) => {
    if (ref[0] !== '#') return NAMED[ref];
    const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

export function encodeText(s, like = '') {
  const crRef = /&#(?:x[dD]|13);/.test(like);
  const gtRef = like.includes('&gt;');
  return s.replace(/[&<>\r]/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '>') return gtRef ? '&gt;' : '>';
    return crRef ? '&#xD;' : '\r';
  });
}

export function encodeAttr(s, quote = '"', like = '') {
  return s.replace(/[&<"'\t\n\r]/g, (c) => {
    if (c === '&') return '&amp;';
    if (c === '<') return '&lt;';
    if (c === '"' || c === "'") return c === quote ? (c === '"' ? '&quot;' : '&apos;') : c;
    const ref = { '\t': '&#x9;', '\n': '&#xA;', '\r': '&#xD;' }[c];
    return like.includes(ref) ? ref : c;
  });
}

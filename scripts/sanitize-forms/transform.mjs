// Context rules: which text in an XDP packet, XML data file or XSD is human
// content (scrambled), code (kept), a name (renamed, see names.mjs) or a
// path/URL/email (neutralised).

import { createHash } from 'node:crypto';
import { tokenize, decode, encodeText, localName, spliceTag } from './xml-tokens.mjs';
import { walk, attrValue, elementOf } from './walk.mjs';
import { lexScript, literal, isCodeLiteral, rewriteScript, scriptLanguage, BUILTIN } from './script-literals.mjs';
import { wordsOf, isAllowedUrl } from './scrambler.mjs';
import { sniffImage, makePlaceholder } from './placeholder-image.mjs';
import { collectNames, isDataElement, isDataAttr, GENERATED_WORDS } from './names.mjs';

// SOM roots, picture keywords and URL parts that may remain in kept code/URLs.
const CODE_WORDS = `xfa record data template form layout host event datasets connectionSet dataWindow
  config signature this parent variables resolveNode resolveNodes date time num text zero null datetime
  application javascript formcalc http https ftp file www example mailto`.split(/\s+/);
const FREE_TEXT_ATTRS = new Set(['uuid', 'timeStamp', 'href']);
const XMP_STRUCTURAL_ATTRS = new Set(['rdf:about', 'rdf:parseType', 'rdf:resource', 'xml:lang']);
const PATH_ELEMENTS = new Set(['uri', 'base', 'href', 'fileURI']);
const KEPT_TEMPLATE_ELEMENTS = new Set(['ref']);
const SENSITIVE_VALUE = /@[\w-]+\.|:\/\/|^www\.|\\/;
const URLS = /\b(?:https?|ftp):\/\/[^\s"'<>]+/g;
const BASE64_BLOB = /^[A-Za-z0-9+/=\s]{200,}$/;

export function fileKind(rel) {
  if (/\.xdp$/i.test(rel)) return 'xdp';
  if (/\.xsd$/i.test(rel)) return 'xsd';
  return 'data';
}

export function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

const isUrl = (s) => /^[a-z][\w+.-]*:\/\//i.test(s) && !/^file:/i.test(s);

function isFreeTextAttr(attr, el) {
  if (FREE_TEXT_ATTRS.has(attr.name) || SENSITIVE_VALUE.test(attr.value)) return true;
  if (el.packet === 'xmpmeta' && !attr.name.startsWith('xmlns') && !XMP_STRUCTURAL_ATTRS.has(attr.name)) return true;
  return el.packet === 'schema' && (attr.name === 'default' || attr.name === 'fixed' || el.local === 'enumeration');
}

function scriptSource(token) {
  return token.type === 'cdata' ? token.raw.slice(9, -3) : decode(token.raw);
}

/** Pass 1: name map, kept vocabulary, XSD types, and literals scripts compare against. */
export function collect(files) {
  const names = collectNames(files);
  const vocab = new Set();
  const structuralWords = new Set([...BUILTIN, ...CODE_WORDS, ...GENERATED_WORDS].flatMap((w) => wordsOf(w)));
  const typeMap = new Map();
  const scripts = [];
  const addWords = (s) => wordsOf(s).forEach((w) => structuralWords.add(w));
  // Allow-listed URLs (XML namespaces) are kept, so their words are structural.
  const addKeptUrlWords = (s) => (s.match(URLS) ?? []).filter(isAllowedUrl).forEach(addWords);
  // Fixture file names are kept, both as files and where a form references them.
  files.forEach((file) => addWords(file.rel));

  for (const file of files) {
    walk(file, {
      element(el) {
        // Structural words come from what stays in the output: renamed names count with their new name.
        const data = isDataElement(file.kind, el);
        addWords(data ? names.renameQName(el.qname) : el.qname);
        for (const attr of el.attrs) {
          addWords(data && isDataAttr(attr.name) ? names.renameQName(attr.name) : attr.name);
          addKeptUrlWords(attr.value);
          if (isFreeTextAttr(attr, el)) continue;
          vocab.add(attr.value);
          addWords(names.renameAttribute(el, attr));
        }
        const type = attrValue(el, 'type');
        if (el.packet === 'schema' && el.local === 'element' && attrValue(el, 'name')) {
          const name = attrValue(el, 'name');
          const simple = type && /^xsd?:/.test(type) ? localName(type) : 'string';
          typeMap.set(name, typeMap.has(name) && typeMap.get(name) !== simple ? 'string' : simple);
        }
      },
      other(token, stack) {
        const top = stack[stack.length - 1];
        addKeptUrlWords(token.raw);
        // Designer settings PIs are structural (with a path value, just the target and keyword);
        // renderCache PIs carry form text.
        if (token.type === 'pi' && !/^<\?renderCache\./.test(token.raw)) {
          addWords(SENSITIVE_VALUE.test(token.raw) ? (/^<\?\S+\s+[A-Za-z]+/.exec(token.raw)?.[0] ?? '') : token.raw);
        }
        if (!top || !token.raw.trim()) return;
        if (top.local === 'script' && (token.type === 'text' || token.type === 'cdata')) {
          scripts.push({ src: scriptSource(token), lang: scriptLanguage(attrValue(top, 'contentType')) });
        } else if (['localeSet', 'config', 'connectionSet'].includes(top.packet) && token.type === 'text') {
          const value = decode(token.raw);
          if (top.local === 'rootElement') addWords(names.renameName(value.trim()));
          else if (!SENSITIVE_VALUE.test(token.raw)) addWords(value);
        }
      },
    });
  }

  const controlValues = new Set();
  const controlNumbers = new Set();
  const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)$/;
  const COMPARED_NUMBER =
    /(?:==|!=|<>|\beq\b|\bne\b)\s*([+-]?\d+(?:\.\d+)?)(?![\w.])|(?<![\w.$])(\d+(?:\.\d+)?)\s*(?:==|!=|<>|\beq\b|\bne\b)/g;
  for (const { src, lang } of scripts) {
    const parts = lexScript(src, lang);
    parts.forEach((part, i) => {
      if (part.kind === 'code') {
        addWords(names.renameCode(part.text));
        for (const m of part.text.matchAll(COMPARED_NUMBER)) controlNumbers.add(Number(m[1] ?? m[2]));
      }
      if (part.kind !== 'string') return;
      const content = literal(part).content.trim();
      // Name / SOM-path literals are renamed, never compared against data.
      if (names.renameLiteral(content) !== content || !isCodeLiteral(content, vocab)) return;
      // Number-only literals matter for comparisons, not for assignments like rotate = "30".
      const assigned = /(?:^|[^=!<>])=\s*$/.test(parts[i - 1]?.text ?? '');
      if (/\p{L}/u.test(content) || !assigned) controlValues.add(content);
      if (NUMBER.test(content) && !assigned) controlNumbers.add(Number(content));
    });
  }
  const structuralValues = new Set([...vocab, ...controlValues, ...BUILTIN].filter((v) => !names.renamed.has(v)));
  return { vocab, typeMap, controlValues, controlNumbers, structuralWords, structuralValues, names };
}

/** Pass 2: rewritten file text. Records original image hashes in ctx.originalImageHashes. */
export function transform(file, ctx) {
  const { scrambler: s, typeMap, vocab, stats, names } = ctx;
  const out = [];
  // A referenced file keeps its name only if it is one of the fixture files.
  const keepFile = (p) => Boolean(ctx.fileNames?.has(p.trim().split(/[\\/]+/).filter(Boolean).pop()));
  const applyTerms = (raw) => {
    let next = raw;
    for (const re of ctx.termPatterns) next = next.replace(re, (m) => s.scrambleAll(m));
    return next;
  };
  const count = (key) => {
    stats[key] = (stats[key] ?? 0) + 1;
  };

  function image(raw) {
    const buf = Buffer.from(raw.replace(/\s+/g, ''), 'base64');
    ctx.originalImageHashes.add(sha256(buf));
    const placeholder = makePlaceholder(sniffImage(buf));
    let b64 = placeholder.data.toString('base64');
    const lines = raw.trim().split(/\r?\n/);
    if (lines.length > 1) {
      const width = lines[0].trim().length;
      b64 = b64.match(new RegExp(`.{1,${width}}`, 'g')).join(raw.includes('\r\n') ? '\r\n' : '\n');
    }
    count('images');
    return { text: /^\s*/.exec(raw)[0] + b64 + /\s*$/.exec(raw)[0], contentType: placeholder.contentType };
  }

  function rewriteTag(el, token, next) {
    if (el.local === 'image' && next?.type === 'text' && next.raw.trim()) {
      el.placeholder = image(next.raw);
    }
    const data = isDataElement(file.kind, el);
    const values = new Map();
    const attrNames = new Map();
    el.attrs.forEach((attr, i) => {
      if (data && isDataAttr(attr.name)) {
        const name = names.renameQName(attr.name);
        if (name !== attr.name) attrNames.set(i, name);
      }
      let value = names.renameAttribute(el, attr);
      if (value !== attr.value) count('names');
      if (el.packet === 'xdp' && attr.name === 'uuid') value = s.uuid(value);
      else if (el.packet === 'xdp' && attr.name === 'timeStamp') value = s.isoDate(value) ?? s.text(value);
      else if (attr.name === 'href') value = value.startsWith('#') || isUrl(value) ? s.sensitive(value) : s.path(value);
      else if (attr.name === 'contentType' && el.placeholder) value = el.placeholder.contentType;
      else if (isFreeTextAttr(attr, el) && !SENSITIVE_VALUE.test(attr.value)) value = s.text(value);
      else value = s.sensitive(value);
      if (value !== attr.value) values.set(i, value);
    });
    const tag = data ? names.renameQName(el.qname) : el.qname;
    if (tag !== el.qname) el.newQname = tag;
    if (el.newQname || attrNames.size) count('names');
    if (values.size) count('attributes');
    if (!values.size && !attrNames.size && !el.newQname) return token.raw;
    return spliceTag(token.raw, el.attrs, { tag: el.newQname, names: attrNames, values });
  }

  function templateText(value, stack) {
    const top = stack[stack.length - 1];
    // Picture clauses are code, but quoted literals inside them ('Ref: ') are text.
    if (stack.some((el) => el.local === 'picture')) return value.replace(/'([^']+)'/g, (m, inner) => `'${s.text(inner)}'`);
    if (stack.some((el) => KEPT_TEMPLATE_ELEMENTS.has(el.local))) return value;
    const exData = stack.findLastIndex((el) => el.local === 'exData');
    if (exData === stack.length - 1 && /<[^<>]+>/.test(value)) return markup(value);
    if (exData !== -1) return s.text(value);
    switch (top.local) {
      case 'integer':
        return s.typed(value, 'integer');
      case 'decimal':
      case 'float':
        return s.typed(value, 'decimal');
      case 'date':
      case 'dateTime':
      case 'time':
        return s.typed(value, top.local);
      case 'boolean':
        return value;
      default:
        return s.text(value);
    }
  }

  function markup(value) {
    return tokenize(value)
      .map((t) => (t.type === 'text' && t.raw.trim() ? encodeText(s.text(decode(t.raw)), t.raw) : t.raw))
      .join('');
  }

  function dataText(value, top) {
    if (BASE64_BLOB.test(value)) {
      const info = sniffImage(Buffer.from(value.replace(/\s+/g, ''), 'base64'));
      if (info) return image(value).text;
    }
    return s.typed(value, typeMap.get(top.local) ?? 'string');
  }

  function text(token, stack) {
    const top = stack[stack.length - 1];
    if (!top || !token.raw.trim()) return token.raw;
    if (top.placeholder) return top.placeholder.text;
    const isCdata = token.type === 'cdata';
    const value = isCdata ? token.raw.slice(9, -3) : decode(token.raw);
    let next;
    if (top.local === 'script') {
      next = rewriteScript(value, scriptLanguage(attrValue(top, 'contentType')), { vocab, scramble: s.text, names });
      if (next !== value) count('scripts');
    } else {
      switch (top.packet) {
        case 'template':
          next = templateText(value, stack);
          break;
        case 'config':
        case 'connectionSet':
          if (top.local === 'rootElement') next = value.replace(value.trim(), () => names.renameName(value.trim()));
          else next = PATH_ELEMENTS.has(top.local) && !isUrl(value.trim()) ? s.path(value, keepFile(value)) : s.sensitive(value);
          break;
        case 'localeSet':
          next = value;
          break;
        case 'datasets':
        case 'data':
          next = dataText(value, top);
          break;
        case 'schema':
          next = stack.some((el) => el.local === 'documentation' || el.local === 'appinfo') ? s.text(value) : s.sensitive(value);
          break;
        default:
          next = s.text(value);
      }
      if (next !== value) count('texts');
    }
    if (next === value) return applyTerms(token.raw);
    return applyTerms(isCdata ? `<![CDATA[${next}]]>` : encodeText(next, token.raw));
  }

  function pi(raw) {
    const m = /^<\?(\S+)([\s\S]*?)\?>$/.exec(raw);
    if (!m || m[1] === 'xml') return raw;
    const [, target, body] = m;
    if (target === 'renderCache.textRun') {
      // Designer's cached copy of a draw's text: "<count> <text> <geometry…>".
      const run = /^(\s+\d+\s)([\s\S]*)$/.exec(body);
      if (!run) return `<?${target}${s.text(body)}?>`;
      const chars = [...run[2]];
      const count = parseInt(run[1], 10);
      return `<?${target}${run[1]}${s.text(chars.slice(0, count).join(''))}${chars.slice(count).join('')}?>`;
    }
    const preview = /^(\s*DefaultPreviewDataFileName\s+)([\s\S]*?)(\s*)$/.exec(body);
    if (preview) return `<?${target}${preview[1]}${s.path(preview[2], keepFile(preview[2]))}${preview[3]}?>`;
    if (/^\s*fileDigest\b/.test(body)) {
      return `<?${target}${body.replace(/(shaHash=")([^"]*)(")/, (all, a, v, b) => a + s.digest(v) + b)}?>`;
    }
    return `<?${target}${s.sensitive(body)}?>`;
  }

  const tokens = tokenize(file.text);
  const stack = [];
  tokens.forEach((token, index) => {
    switch (token.type) {
      case 'open':
      case 'empty': {
        const el = elementOf(file.kind, stack, token);
        out.push(applyTerms(rewriteTag(el, token, tokens[index + 1])));
        if (token.type === 'open') stack.push(el);
        break;
      }
      case 'close': {
        const el = stack.pop();
        out.push(applyTerms(el?.newQname ? token.raw.replace(token.name, () => el.newQname) : token.raw));
        break;
      }
      case 'text':
      case 'cdata':
        out.push(text(token, stack));
        break;
      case 'comment':
        count('comments');
        out.push(applyTerms(`<!--${s.text(token.raw.slice(4, -3))}-->`));
        break;
      case 'pi':
        out.push(applyTerms(pi(token.raw)));
        break;
      default:
        out.push(applyTerms(token.raw));
    }
  });
  return out.join('');
}

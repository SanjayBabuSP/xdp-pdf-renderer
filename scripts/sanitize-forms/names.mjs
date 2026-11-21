
import { decode, localName } from './xml-tokens.mjs';
import { walk, attrValue } from './walk.mjs';
import { lexScript, literal, scriptLanguage } from './script-literals.mjs';
import { addGenericWord, isGenericName } from './generic-words.mjs';
import { wordsOf } from './scrambler.mjs';

const KINDS = [
  ['subform', 'Subform'],
  ['exclGroup', 'Group'],
  ['field', 'Field'],
  ['draw', 'Draw'],
  ['pageArea', 'Page'],
  ['contentArea', 'ContentArea'],
  ['pageSet', 'PageSet'],
  ['area', 'Area'],
  ['script', 'Script'],
  ['variable', 'Variable'],
  ['element', 'Element'],
  ['attribute', 'Attribute'],
  ['type', 'Type'],
  ['name', 'Name'],
  ['id', 'Id'],
  ['func', 'func'],
  ['var', 'var'],
  ['ref', 'Name'],
];
const PRIORITY = new Map(KINDS.map(([kind], i) => [kind, i]));
const PREFIX = new Map(KINDS);
const PREFIXES = [...new Set(KINDS.map(([, prefix]) => prefix))];

export const GENERATED = new RegExp(`^_?(?:${PREFIXES.join('|')})_\\d{4,}$`);
export const GENERATED_WORDS = PREFIXES;

const OBJECT_KINDS = {
  subform: 'subform',
  subformSet: 'subform',
  exclGroup: 'exclGroup',
  field: 'field',
  draw: 'draw',
  pageArea: 'pageArea',
  contentArea: 'contentArea',
  pageSet: 'pageSet',
  area: 'area',
};
const XSD_KINDS = {
  element: 'element',
  attribute: 'attribute',
  complexType: 'type',
  simpleType: 'type',
  group: 'type',
  attributeGroup: 'type',
};
const XSD_QNAME_ATTRS = {
  ref: 'element',
  type: 'type',
  base: 'type',
  itemType: 'type',
  memberTypes: 'type',
  substitutionGroup: 'element',
  refer: 'name',
};
const SOM_ATTRS = {
  bind: { ref: 'element' },
  connect: { ref: 'element' },
  bindItems: { ref: 'element', labelRef: 'element', valueRef: 'element' },
  setProperty: { ref: 'element', target: 'name' },
  event: { ref: 'name' },
  traverse: { ref: 'name' },
  breakBefore: { target: 'name', leader: 'name', trailer: 'name' },
  breakAfter: { target: 'name', leader: 'name', trailer: 'name' },
  overflow: { target: 'name', leader: 'name', trailer: 'name' },
  bookend: { leader: 'name', trailer: 'name' },
  break: {
    beforeTarget: 'name',
    afterTarget: 'name',
    overflowTarget: 'name',
    overflowLeader: 'name',
    overflowTrailer: 'name',
    bookendLeader: 'name',
    bookendTrailer: 'name',
  },
};
const REF_ATTRS = new Set(['use', 'usehref', 'xfa:embed']);
const FORM_PACKETS = new Set(['template', 'form']);
const XFA_PACKETS = new Set(['template', 'form', 'config', 'connectionSet', 'localeSet']);

const IDENT = String.raw`[\p{L}_$][\p{L}\p{N}_$]*`;
const SOM_TOKEN = /([$!#]?)([\p{L}_][\p{L}\p{N}_-]*(?:\\\.[\p{L}\p{N}_-]+)*)|\[([^\]]*)\]|[\s\S]/gu;
const CODE_TOKEN = /\d[\p{L}\p{N}_.]*|([$!#]?)([\p{L}_$][\p{L}\p{N}_$]*)/gu;
const SINGLE_NAME = /^[\p{L}_][\p{L}\p{N}_-]*$/u;
const KW_START = String.raw`(?<![\p{L}\p{N}_$.])`;
const KW_END = String.raw`(?![\p{L}\p{N}_$])`;
const JS_FUNCTION = new RegExp(String.raw`${KW_START}function${KW_END}\s*(${IDENT})?\s*\(([^)]*)\)`, 'gu');
const JS_CATCH = new RegExp(String.raw`${KW_START}catch\s*\(\s*(${IDENT})`, 'gu');
const JS_DECLARATION = new RegExp(String.raw`${KW_START}(?:var|let|const)${KW_END}`, 'gu');
const FC_FUNC = new RegExp(String.raw`${KW_START}func${KW_END}\s+(${IDENT})\s*\(([^)]*)\)`, 'giu');
const FC_VAR = new RegExp(String.raw`${KW_START}var${KW_END}\s+(${IDENT})`, 'giu');
const LEADING_IDENT = new RegExp(String.raw`^\s*(${IDENT})`, 'u');

const isXsdBuiltin = (qname) => /^xsd?:/.test(qname);
const isSomish = (s) =>
  /[.[]/.test(s) && /\p{L}/u.test(s) && /^[\p{L}\p{N}_$!#*.\\[\]-]+$/u.test(s.replace(/\[[^\]]*\]/g, '[]'));

export function isDataAttr(name) {
  return !/^(?:xmlns(?::|$)|xsi:|xml:|xfa:|dd:)/.test(name);
}

export function isDataElement(kind, el) {
  if (el.xhtml) return false;
  if (kind === 'data') return true;
  return (el.packet === 'datasets' || el.packet === 'dataDescription') && !/^(?:xfa|dd):/.test(el.qname);
}

function objectKind(el, parent) {
  if (OBJECT_KINDS[el.local]) return OBJECT_KINDS[el.local];
  if (parent?.local === 'variables') return el.local === 'script' ? 'script' : 'variable';
  return 'name';
}

function codeNames(code, add, identifier) {
  for (const m of code.matchAll(CODE_TOKEN)) {
    if (m[2] === undefined) continue;
    identifier?.(m[2]);
    add(m[2], 'ref');
  }
}

function somNames(expr, kind, add) {
  for (const m of expr.matchAll(SOM_TOKEN)) {
    if (m[2] !== undefined) add(m[2].replace(/\\\./g, '.'), m[1] === '#' ? 'id' : kind);
    else if (m[3] !== undefined) codeNames(m[3], add);
  }
}

function refNames(value, add) {
  if (!value.includes('#')) return somNames(value, 'name', add);
  const som = /#som\((.*)\)\s*$/su.exec(value);
  if (som) return somNames(som[1], 'name', add);
  const id = /#([^#\s()]+)$/u.exec(value);
  if (id) add(id[1], 'id');
}

function declarationList(code, from, add) {
  let depth = 0;
  let expectName = true;
  for (let i = from; i < code.length; ) {
    if (expectName) {
      const m = LEADING_IDENT.exec(code.slice(i));
      if (!m) return;
      add(m[1], 'var');
      i += m[0].length;
      expectName = false;
      continue;
    }
    const c = code[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) {
      if (depth === 0) return;
      depth--;
    } else if (depth === 0 && c === ',') expectName = true;
    else if (depth === 0 && c === ';') return;
    else if (depth === 0 && c === '\n' && !/[,=]\s*$/.test(code.slice(from, i))) return;
    i++;
  }
}

function declaredNames(code, lang, add) {
  const params = (list) => {
    for (const param of list.split(',')) {
      const m = LEADING_IDENT.exec(param);
      if (m) add(m[1], 'var');
    }
  };
  if (lang === 'js') {
    for (const m of code.matchAll(JS_FUNCTION)) {
      if (m[1]) add(m[1], 'func');
      params(m[2]);
    }
    for (const m of code.matchAll(JS_CATCH)) add(m[1], 'var');
    for (const m of code.matchAll(JS_DECLARATION)) declarationList(code, m.index + m[0].length, add);
  } else {
    for (const m of code.matchAll(FC_FUNC)) {
      add(m[1], 'func');
      params(m[2]);
    }
    for (const m of code.matchAll(FC_VAR)) add(m[1], 'var');
  }
}

function scriptNames(src, lang, add, identifier) {
  const parts = lexScript(src, lang);
  declaredNames(parts.map((p) => (p.kind === 'code' ? p.text : p.kind === 'string' ? '""' : ' ')).join(''), lang, add);
  for (const part of parts) {
    if (part.kind === 'code') codeNames(part.text, add, identifier);
    else if (part.kind === 'string') {
      const content = literal(part).content.trim();
      if (isSomish(content)) somNames(content, 'ref', add);
    }
  }
}

export function visitNames(file, { add, vocab, identifier }) {
  walk(file, {
    element(el, token, index, tokens, stack) {
      if (file.kind === 'xdp' && XFA_PACKETS.has(el.packet)) {
        vocab?.(el.local);
        for (const attr of el.attrs) vocab?.(localName(attr.name));
      }
      if (isDataElement(file.kind, el)) {
        add(el.local, 'element');
        for (const attr of el.attrs) {
          if (attr.name === 'dd:reqAttrs') for (const name of attr.value.split(/\s+/)) add(name, 'attribute');
          else if (isDataAttr(attr.name)) add(localName(attr.name), 'attribute');
        }
      } else if (el.packet === 'schema') {
        const name = attrValue(el, 'name');
        if (name !== undefined) add(name, XSD_KINDS[el.local] ?? 'name');
        for (const attr of el.attrs) {
          const kind = XSD_QNAME_ATTRS[attr.name];
          if (!kind) continue;
          for (const qname of attr.value.split(/\s+/)) if (qname && !isXsdBuiltin(qname)) add(localName(qname), kind);
        }
      } else if (FORM_PACKETS.has(el.packet)) {
        const name = attrValue(el, 'name');
        if (name !== undefined && el.local !== 'instanceManager') add(name, objectKind(el, stack[stack.length - 1]));
        const id = attrValue(el, 'id');
        if (id !== undefined) add(id, 'id');
        for (const attr of el.attrs) {
          const kind = SOM_ATTRS[el.local]?.[attr.name];
          if (kind) somNames(attr.value, kind, add);
          else if (REF_ATTRS.has(attr.name)) refNames(attr.value, add);
        }
      }
    },
    other(token, stack) {
      const top = stack[stack.length - 1];
      if (!top || (token.type !== 'text' && token.type !== 'cdata') || !token.raw.trim()) return;
      if (top.local === 'script' && FORM_PACKETS.has(top.packet)) {
        const src = token.type === 'cdata' ? token.raw.slice(9, -3) : decode(token.raw);
        scriptNames(src, scriptLanguage(attrValue(top, 'contentType')), add, identifier);
      } else if (top.packet === 'connectionSet' && top.local === 'rootElement') {
        add(decode(token.raw).trim(), 'element');
      }
    },
  });
}

export function vocabularyOf(files) {
  const words = new Set();
  for (const file of files) visitNames(file, { add() {}, vocab: (word) => addGenericWord(words, word) });
  return words;
}

export function collectNames(files) {
  const kinds = new Map();
  const genericWords = new Set();
  const identifiers = new Set();
  const add = (name, kind) => {
    if (!name) return;
    const known = kinds.get(name);
    if (known === undefined || PRIORITY.get(kind) < PRIORITY.get(known)) kinds.set(name, kind);
  };
  for (const file of files) {
    visitNames(file, {
      add,
      vocab: (word) => addGenericWord(genericWords, word),
      identifier: (token) => identifiers.add(token),
    });
  }
  const taken = new Set([...kinds.keys(), ...identifiers]);
  const counters = new Map();
  const map = new Map();
  for (const [name, kind] of kinds) {
    if (isGenericName(name, genericWords)) continue;
    if (name.startsWith('_') && kinds.has(name.slice(1))) continue;
    const prefix = PREFIX.get(kind);
    let n = counters.get(prefix) ?? 0;
    let next;
    do next = `${prefix}_${String(++n).padStart(4, '0')}`;
    while (taken.has(next));
    counters.set(prefix, n);
    map.set(name, next);
  }
  return createRenamer(map);
}

function createRenamer(map) {
  const renameName = (name) => {
    const next = map.get(name);
    if (next !== undefined) return next;
    if (name.startsWith('_') && map.has(name.slice(1))) return `_${map.get(name.slice(1))}`;
    return name;
  };
  const renameQName = (qname) => {
    const colon = qname.indexOf(':');
    return colon === -1 ? renameName(qname) : qname.slice(0, colon + 1) + renameName(qname.slice(colon + 1));
  };
  const renameCode = (code) =>
    code.replace(CODE_TOKEN, (all, sigil, ident) => {
      if (ident === undefined) return all;
      const next = renameName(ident);
      return next === ident ? all : sigil + next;
    });
  const renameSom = (expr) =>
    expr.replace(SOM_TOKEN, (all, sigil, name, index) => {
      if (name !== undefined) {
        const plain = name.replace(/\\\./g, '.');
        const next = renameName(plain);
        return next === plain ? all : sigil + next.replace(/\./g, '\\.');
      }
      if (index !== undefined && /\p{L}/u.test(index)) return `[${renameCode(index)}]`;
      return all;
    });
  const renameRef = (value) => {
    if (!value.includes('#')) return renameSom(value);
    return value
      .replace(/#som\((.*)\)(\s*)$/su, (all, som, tail) => `#som(${renameSom(som)})${tail}`)
      .replace(/#([^#\s()]+)$/u, (all, id) => `#${renameName(id)}`);
  };
  const renameAttribute = (el, attr) => {
    if (FORM_PACKETS.has(el.packet)) {
      if (attr.name === 'name' || attr.name === 'id') return renameName(attr.value);
      if (SOM_ATTRS[el.local]?.[attr.name]) return renameSom(attr.value);
      if (REF_ATTRS.has(attr.name)) return renameRef(attr.value);
    } else if (el.packet === 'schema') {
      if (attr.name === 'name') return renameName(attr.value);
      if (XSD_QNAME_ATTRS[attr.name]) return attr.value.replace(/\S+/g, (q) => (isXsdBuiltin(q) ? q : renameQName(q)));
    } else if (attr.name === 'dd:reqAttrs') {
      return attr.value.replace(/\S+/g, (name) => renameName(name));
    }
    return attr.value;
  };
  const renameLiteral = (content) => {
    const s = content.trim();
    let next = s;
    if (SINGLE_NAME.test(s)) next = renameName(s);
    else if (isSomish(s)) next = renameSom(s);
    return next === s ? content : content.replace(s, () => next);
  };
  const renamedWords = new Set();
  for (const name of map.keys()) for (const word of wordsOf(name)) if (word.length >= 5) renamedWords.add(word);
  return {
    renamed: new Set(map.keys()),
    renamedWords,
    renameName,
    renameQName,
    renameCode,
    renameSom,
    renameAttribute,
    renameLiteral,
  };
}

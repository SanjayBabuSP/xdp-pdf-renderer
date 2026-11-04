// Splits XFA scripts (JavaScript / FormCalc) into code, string literals,
// regex literals and comments, so the sanitizer rewrites literals and comments
// and (through names.mjs) renames identifiers in code.

const JS_REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'do', 'else', 'in', 'instanceof', 'new', 'delete', 'void', 'throw',
]);

// Literal values XFA/JS code compares against or assigns; never scrambled.
export const BUILTIN = new Set(
  `visible hidden invisible inactive open readOnly protected nonInteractive
  left center right justify justifyAll radix top middle bottom
  position tb lr-tb rl-tb row table paginate
  normal bold italic solid dashed dotted lowered raised etched embossed dashDot dashDotDot none
  auto contentArea pageArea pageEven pageOdd page subform subformSet field draw exclGroup area
  print -print screen
  textEdit numericEdit dateTimeEdit choiceList checkButton button imageEdit signature barcode passwordEdit defaultUi
  initialize calculate validate ready docReady layoutReady change exit enter click full mouseEnter mouseExit
  mouseDown mouseUp preSave postSave prePrint postPrint preSubmit postSubmit preOpen postOpen indexChange docClose
  disabled error warning
  string number object undefined boolean function null true false
  rawValue formattedValue value presence access caption font border fill color para margin ui items length
  className name index oneOfChild nodes parent
  Acrobat Exchange Exchange-Pro Reader Designer WIN MAC UNIX pdf html`.split(/\s+/)
);

const SOM =
  /^(?:[$!#]|\.\.|xfa\.)|^[A-Za-z_][\w-]*(?:\[[^\]]*\])?(?:\.{1,2}(?:[A-Za-z_#*][\w-]*|\*)(?:\[[^\]]*\])?)+$/;
const PICTURE = /^(?:(?:date|time|num|text|zero|null|datetime)(?:\([^)]*\))?\{[^}]*\}\s*\|?\s*)+$/i;
const BARE_PICTURE = /^[YyMmDdEeJjGgAaHhKkSsFfZzTtWw9.,:/\-\s'()$€%+]+$/;
const PICTURE_SYMBOLS = /yy|mm|dd|hh|ss|zz|99|MMM|EEE/i;
const LOCALE = /^[a-z]{2,3}(?:[_-](?:[A-Z]{2}|[A-Z][a-z]{3}))?(?:[_-][A-Z]{2})?$/;
const CONTENT_TYPE = /^(?:text|image|application|audio|video|multipart)\/[\w.+-]+$/;

/** True when a string literal is code (keyword, SOM path, picture, ...), not human text. */
export function isCodeLiteral(content, vocab) {
  const s = content.trim();
  if (!s || !/\p{L}/u.test(s)) return true;
  if (vocab.has(s) || BUILTIN.has(s)) return true;
  if (PICTURE.test(s) || (BARE_PICTURE.test(s) && PICTURE_SYMBOLS.test(s))) return true;
  if (/\s/.test(s.replace(/\[[^\]]*\]/g, '[]'))) return false;
  return SOM.test(s) || LOCALE.test(s) || CONTENT_TYPE.test(s);
}

export function scriptLanguage(contentType) {
  return /javascript|ecmascript/i.test(contentType ?? '') ? 'js' : 'formcalc';
}

/** [{ kind: 'code' | 'string' | 'comment' | 'regex', text }] covering `src` exactly. */
export function lexScript(src, lang) {
  return lang === 'js' ? lexJs(src) : lexFormCalc(src);
}

function lineEnd(src, from) {
  const end = src.indexOf('\n', from);
  return end === -1 ? src.length : end;
}

function lexJs(src) {
  const parts = [];
  let code = '';
  let recent = '';
  const flush = () => {
    if (code) parts.push({ kind: 'code', text: code });
    code = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && (c2 === '/' || c2 === '*')) {
      const close = c2 === '/' ? lineEnd(src, i) : src.indexOf('*/', i + 2);
      const end = c2 === '/' ? close : close === -1 ? src.length : close + 2;
      flush();
      parts.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const end = Math.min(j + 1, src.length);
      flush();
      parts.push({ kind: 'string', text: src.slice(i, end), quote: c, lang: 'js' });
      recent = '0';
      i = end;
      continue;
    }
    if (c === '/' && regexAllowed(recent)) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        const d = src[j];
        if (d === '\\') {
          j += 2;
          continue;
        }
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      flush();
      parts.push({ kind: 'regex', text: src.slice(i, j) });
      recent = '0';
      i = j;
      continue;
    }
    code += c;
    recent = (recent + c).slice(-40);
    i++;
  }
  flush();
  return parts;
}

function regexAllowed(recent) {
  const trimmed = recent.trimEnd();
  if (!trimmed) return true;
  const word = /[\w$]+$/.exec(trimmed);
  if (word) return JS_REGEX_KEYWORDS.has(word[0]);
  return '(,=:[!&|?{};+-*%<>~^'.includes(trimmed[trimmed.length - 1]);
}

function lexFormCalc(src) {
  const parts = [];
  let code = '';
  const flush = () => {
    if (code) parts.push({ kind: 'code', text: code });
    code = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j++;
      }
      const end = Math.min(j + 1, src.length);
      flush();
      parts.push({ kind: 'string', text: src.slice(i, end), quote: '"', lang: 'formcalc' });
      i = end;
      continue;
    }
    const isRem =
      /^rem(?![\w$])/i.test(src.slice(i, i + 4)) && (i === 0 || !/[\w$.]/.test(src[i - 1]));
    if (c === ';' || (c === '/' && src[i + 1] === '/') || isRem) {
      const end = lineEnd(src, i);
      flush();
      parts.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const close = src.indexOf('*/', i + 2);
      const end = close === -1 ? src.length : close + 2;
      flush();
      parts.push({ kind: 'comment', text: src.slice(i, end) });
      i = end;
      continue;
    }
    code += c;
    i++;
  }
  flush();
  return parts;
}

/** Decoded content of a string part; `encode` turns new content back into a literal. */
export function literal(part) {
  const { text, quote, lang } = part;
  const closed = text.length > 1 && text.endsWith(quote);
  const body = text.slice(1, closed ? -1 : undefined);
  const close = closed ? quote : '';
  if (lang === 'formcalc') {
    return {
      content: body.replace(/""/g, '"'),
      encode: (s) => `"${s.replace(/"/g, '""')}${close}`,
    };
  }
  return {
    content: body.replace(
      /\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g,
      (all, e) => {
        if (e[0] === 'u') return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
        if (e[0] === 'x') return String.fromCharCode(parseInt(e.slice(1), 16));
        return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
      }
    ),
    encode: (s) =>
      quote +
      s.replace(/[\\\n\r\t]|["']/g, (c) => {
        if (c === '"' || c === "'") return c === quote ? `\\${c}` : c;
        return { '\\': '\\\\', '\n': '\\n', '\r': '\\r', '\t': '\\t' }[c];
      }) +
      close,
  };
}

/**
 * Applies `scramble` to human-text literals (outside any markup) and comments;
 * with `names`, also renames identifiers and name / SOM-path literals.
 */
export function rewriteScript(src, lang, { vocab, scramble, names }) {
  return lexScript(src, lang)
    .map((part) => {
      if (part.kind === 'code') return names ? names.renameCode(part.text) : part.text;
      if (part.kind === 'regex') return part.text;
      if (part.kind === 'comment') return scramble(part.text);
      const { content, encode } = literal(part);
      const renamed = names ? names.renameLiteral(content) : content;
      if (renamed !== content) return encode(renamed);
      if (isCodeLiteral(content, vocab)) return part.text;
      const next = content
        .split(/(<[^<>]*>)/)
        .map((piece, k) => (k % 2 === 1 ? piece : scramble(piece)))
        .join('');
      return next === content ? part.text : encode(next);
    })
    .join('');
}
